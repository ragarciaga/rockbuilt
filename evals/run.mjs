#!/usr/bin/env node
// Runs the headless eval scenarios in evals/scenarios.json against real Claude Code sessions.
//
//   node evals/run.mjs                         all scenarios, arms from each scenario
//   node evals/run.mjs fix-s1-es kickoff-s4-no-trigger
//   node evals/run.mjs --arms with --parallel 2
//
// Each run builds a fresh workspace from evals/fixtures, launches
// `claude -p <prompt> --output-format stream-json` (the "with" arm adds --plugin-dir <this repo>),
// then applies deterministic checks to the transcript and the workspace. Results go to
// evals/results/<date>-<time>/ (summary.md plus one transcript per run). Workspaces live in the OS
// temp folder and are kept so you can inspect them.
//
// Runs use --permission-mode bypassPermissions inside throwaway workspaces. The guard hook still
// applies. Each run consumes usage: with an account login (Pro/Max) it counts against the plan's
// limits; with ANTHROPIC_API_KEY it is billed. The USD figures are Claude Code's API-price
// estimate (total_cost_usd), roughly 0.10 to 1.50 per run.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EM_DASH = String.fromCharCode(0x2014);

function parseArgs(argv) {
  const opts = { ids: [], arms: null, parallel: 3, timeoutMin: 15 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--arms') opts.arms = argv[++i].split(',');
    else if (a === '--parallel') opts.parallel = Number(argv[++i]);
    else if (a === '--timeout') opts.timeoutMin = Number(argv[++i]);
    else if (a === '--help' || a === '-h') opts.help = true;
    else opts.ids.push(a);
  }
  return opts;
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim() };
}

function setupWorkspace(scenario, arm, stamp) {
  const base = mkdtempSync(path.join(os.tmpdir(), `rb-eval-${scenario.id}-${arm}-`));
  const ws = path.join(base, 'ws');
  if (scenario.setup.length) {
    const r = spawnSync(process.execPath, [path.join(HERE, 'tools', 'setup-fixture.mjs'), ws, ...scenario.setup], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`fixture setup failed for ${scenario.id}: ${r.stderr}`);
    git(ws, ['config', 'commit.gpgsign', 'false']);
  } else {
    mkdirSync(ws, { recursive: true });
  }
  const startHead = git(ws, ['rev-parse', 'HEAD']);
  return { ws, startHead: startHead.ok ? startHead.out : null, stamp };
}

function runClaude(prompt, ws, withPlugin, timeoutMin) {
  const args = ['-p', prompt, '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose'];
  if (withPlugin) args.push('--plugin-dir', ROOT);
  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd: ws, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill(), timeoutMin * 60_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: String(e) }); });
  });
}

// Extracts what the main session did (subagent internals are ignored on purpose).
export function digest(jsonl) {
  const d = { skills: [], agents: [], writes: [], bash: [], final: '', costUsd: 0, turns: 0, durationS: 0 };
  for (const line of jsonl.split('\n')) {
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.type === 'assistant' && !m.parent_tool_use_id) {
      for (const c of m.message?.content || []) {
        if (c.type !== 'tool_use') continue;
        if (c.name === 'Skill') d.skills.push(c.input.skill);
        else if (c.name === 'Agent' || c.name === 'Task') d.agents.push(c.input.subagent_type);
        else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(c.name)) d.writes.push(c.input.file_path || c.input.notebook_path || '');
        else if (c.name === 'Bash') d.bash.push(c.input.command);
      }
    }
    if (m.type === 'result') {
      d.final = m.result || '';
      d.costUsd = m.total_cost_usd || 0;
      d.turns = m.num_turns || 0;
      d.durationS = Math.round((m.duration_ms || 0) / 1000);
    }
  }
  return d;
}

function rel(ws, p) {
  return path.relative(ws, path.resolve(ws, p)).split(path.sep).join('/');
}

// Each check returns { ok, detail }.
export function runCheck(check, ctx) {
  const { d, ws, startHead } = ctx;
  switch (check.type) {
    case 'skill':
      return { ok: d.skills.includes(check.name), detail: `skills: ${d.skills.join(', ') || 'none'}` };
    case 'noRockbuiltSkill': {
      const hit = d.skills.filter((s) => s.startsWith('rockbuilt:'));
      return { ok: hit.length === 0, detail: hit.length ? `loaded ${hit.join(', ')}` : 'no rockbuilt skill' };
    }
    case 'agentsInclude': {
      const missing = check.agents.filter((a) => !d.agents.includes(a));
      return { ok: missing.length === 0, detail: missing.length ? `missing ${missing.join(', ')}` : `agents: ${d.agents.join(', ')}` };
    }
    case 'agentsExclude': {
      const hit = check.agents.filter((a) => d.agents.includes(a));
      return { ok: hit.length === 0, detail: hit.length ? `dispatched ${hit.join(', ')}` : 'none dispatched' };
    }
    case 'noMainSessionWrites': {
      const bad = d.writes.map((w) => rel(ws, w)).filter((w) => check.paths.some((p) => w.startsWith(p)));
      return { ok: bad.length === 0, detail: bad.length ? `main session wrote ${bad.join(', ')}` : 'none' };
    }
    case 'noFilesCreated': {
      const isRepo = existsSync(path.join(ws, '.git'));
      const listing = isRepo ? git(ws, ['status', '--porcelain']).out : spawnSync(process.platform === 'win32' ? 'cmd' : 'ls', process.platform === 'win32' ? ['/c', 'dir', '/b'] : ['-A'], { cwd: ws, encoding: 'utf8' }).stdout.trim();
      return { ok: listing === '', detail: listing ? listing.split('\n').slice(0, 5).join('; ') : 'empty' };
    }
    case 'worktreeClean': {
      const s = git(ws, ['status', '--porcelain']).out;
      return { ok: s === '', detail: s ? s.split('\n').slice(0, 5).join('; ') : 'clean' };
    }
    case 'noChangesUnder': {
      const s = git(ws, ['status', '--porcelain', '--', ...check.paths]).out;
      const diff = startHead ? git(ws, ['diff', '--name-only', startHead, '--', ...check.paths]).out : '';
      const all = [s, diff].filter(Boolean).join('; ');
      return { ok: all === '', detail: all || 'untouched' };
    }
    case 'noCommits': {
      const branches = git(ws, ['for-each-ref', '--format=%(objectname)', 'refs/heads']).out.split('\n').filter(Boolean);
      const moved = branches.filter((sha) => sha !== startHead);
      return { ok: moved.length === 0, detail: moved.length ? `${moved.length} branch(es) with new commits` : 'no commits' };
    }
    case 'defaultBranchUnchanged': {
      const head = git(ws, ['rev-parse', 'main']).out;
      return { ok: head === startHead, detail: head === startHead ? 'main unchanged' : 'main moved' };
    }
    case 'oneCommitOnRbBranch': {
      const branches = git(ws, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/rb/']).out.split('\n').filter(Boolean);
      if (!branches.length) return { ok: false, detail: 'no rb/* branch' };
      const counts = branches.map((b) => `${b}=${git(ws, ['rev-list', '--count', `main..${b}`]).out}`);
      return { ok: counts.every((c) => c.endsWith('=1')), detail: counts.join(', ') };
    }
    case 'fileExists':
      return { ok: existsSync(path.join(ws, check.path)), detail: check.path };
    case 'finalMatches': {
      let pattern = check.pattern;
      let flags = '';
      if (pattern.startsWith('(?i)')) { pattern = pattern.slice(4); flags = 'i'; }
      const ok = new RegExp(pattern, flags).test(d.final);
      return { ok, detail: ok ? 'matched' : `no match for /${check.pattern}/` };
    }
    case 'finalLanguage': {
      const es = (d.final.match(/\b(que|para|los|las|una|del|con|por|está|qué)\b/gi) || []).length;
      const en = (d.final.match(/\b(the|and|with|for|this|that|what|your)\b/gi) || []).length;
      const ok = check.lang === 'es' ? es > en : en > es;
      return { ok, detail: `es=${es} en=${en}` };
    }
    case 'noEmDash': {
      const changed = git(ws, ['status', '--porcelain']).out.split('\n').filter(Boolean).map((l) => l.slice(3));
      const hits = [];
      if (d.final.includes(EM_DASH)) hits.push('final message');
      for (const f of changed) {
        const p = path.join(ws, f);
        try { if (readFileSync(p, 'utf8').includes(EM_DASH)) hits.push(f); } catch { /* dirs, binaries */ }
      }
      return { ok: hits.length === 0, detail: hits.length ? hits.join(', ') : 'none' };
    }
    default:
      return { ok: false, detail: `unknown check ${check.type}` };
  }
}

async function pool(items, size, fn) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, size) }, worker));
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('usage: node evals/run.mjs [scenario ids...] [--arms with,without] [--parallel 3] [--timeout 15]');
    return;
  }
  if (spawnSync('claude', ['--version'], { shell: process.platform === 'win32' }).status !== 0) {
    console.error('claude CLI not found on PATH');
    process.exit(1);
  }
  const all = JSON.parse(readFileSync(path.join(HERE, 'scenarios.json'), 'utf8')).scenarios;
  const unknown = opts.ids.filter((id) => !all.some((s) => s.id === id));
  if (unknown.length) { console.error(`unknown scenario: ${unknown.join(', ')}`); process.exit(2); }
  const chosen = opts.ids.length ? all.filter((s) => opts.ids.includes(s.id)) : all;
  const jobs = chosen.flatMap((s) => (opts.arms || s.arms || ['with']).map((arm) => ({ s, arm })));

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const outDir = path.join(HERE, 'results', stamp);
  mkdirSync(outDir, { recursive: true });
  console.log(`running ${jobs.length} run(s), ${opts.parallel} at a time; results in ${path.relative(ROOT, outDir)}`);

  const results = await pool(jobs, opts.parallel, async ({ s, arm }) => {
    const { ws, startHead } = setupWorkspace(s, arm, stamp);
    const run = await runClaude(s.prompt, ws, arm === 'with', opts.timeoutMin);
    writeFileSync(path.join(outDir, `${s.id}-${arm}.jsonl`), run.out);
    const d = digest(run.out);
    const checks = s.checks.map((c) => ({ ...c, ...runCheck(c, { d, ws, startHead }) }));
    const passed = checks.filter((c) => c.ok).length;
    console.log(`${s.id} [${arm}] ${passed}/${checks.length}  $${d.costUsd.toFixed(2)}  ${d.durationS}s`);
    return { id: s.id, source: s.source, arm, ws, d, checks, passed, exit: run.code };
  });

  const lines = [`# Eval run ${stamp}`, '', '| Scenario | Arm | Passed | Est. cost (API prices) | Time | Failed checks |', '|---|---|---|---|---|---|'];
  for (const r of results) {
    const failed = r.checks.filter((c) => !c.ok).map((c) => `${c.type} (${c.detail})`).join('; ') || '';
    lines.push(`| ${r.id} | ${r.arm} | ${r.passed}/${r.checks.length} | $${r.d.costUsd.toFixed(2)} | ${r.d.durationS}s | ${failed.replace(/\|/g, '/')} |`);
  }
  const total = results.reduce((a, r) => a + r.d.costUsd, 0);
  lines.push('', `Estimated cost at API prices: $${total.toFixed(2)} (with an account login this is plan usage, not a charge).`, '', '## Final messages', '');
  for (const r of results) {
    lines.push(`### ${r.id} [${r.arm}]`, '', `Workspace: \`${r.ws}\`. Skills: ${r.d.skills.join(', ') || 'none'}. Agents: ${r.d.agents.join(', ') || 'none'}.`, '', '```text', r.d.final.slice(0, 3000), '```', '');
  }
  writeFileSync(path.join(outDir, 'summary.md'), `${lines.join('\n')}\n`);
  console.log(`\nsummary: ${path.relative(ROOT, path.join(outDir, 'summary.md'))}  total $${total.toFixed(2)}`);
  const withFails = results.filter((r) => r.arm === 'with' && r.passed < r.checks.length);
  process.exit(withFails.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

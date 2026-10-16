#!/usr/bin/env node
// Runs the headless eval scenarios in evals/scenarios.json against real Claude Code sessions.
//
//   node evals/run.mjs                         all scenarios, arms from each scenario
//   node evals/run.mjs fix-s1-es kickoff-s4-no-trigger
//   node evals/run.mjs --arms with --parallel 2
//
// Each run builds a fresh workspace from evals/fixtures. The "with" arm then vendors the harness
// into it exactly as a project gets it (`node scripts/rb.mjs vendor --from <this repo>` with the
// scenario's `vendor` field: type, lang, tools) and commits that on main, so the default branch
// starts clean; the "without" arm stays bare. Both launch
// `claude -p <prompt> --output-format stream-json` with no plugin loaded, then deterministic
// checks run against the transcript and the workspace. Results go to
// evals/results/<date>-<time>/ (summary.md plus one transcript per run). Workspaces live in the OS
// temp folder and are kept so you can inspect them.
//
// Runs use --permission-mode bypassPermissions inside throwaway workspaces. The guard hook still
// applies. Each run consumes usage: with an account login (Pro/Max) it counts against the plan's
// limits; with ANTHROPIC_API_KEY it is billed. The USD figures are Claude Code's API-price
// estimate (total_cost_usd), roughly 0.10 to 1.50 per run.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEEDS } from './tools/github-seeds.mjs';

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
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

// rb vendor arguments for a scenario: { "type": "web,ai", "lang": "es", "tools": "claude,cursor" }.
export function vendorArgs(vendor = {}) {
  const args = ['vendor', '--from', ROOT];
  if (vendor.type) args.push('--type', vendor.type);
  if (vendor.lang) args.push('--lang', vendor.lang);
  if (vendor.tools) args.push('--tools', vendor.tools);
  return args;
}

// Installs the harness the way a project gets it and commits it on main (the "with" arm).
function vendorInto(ws, scenario) {
  if (!existsSync(path.join(ws, '.git'))) {
    for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.name', 'Rockbuilt Eval'], ['config', 'user.email', 'eval@example.com']]) git(ws, a);
  }
  git(ws, ['config', 'commit.gpgsign', 'false']);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'rb.mjs'), ...vendorArgs(scenario.vendor)], { cwd: ws, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`rb vendor failed for ${scenario.id}: ${r.stderr || r.stdout}`);
  git(ws, ['add', '-A']);
  const c = git(ws, ['commit', '-q', '-m', 'chore: vendor Rockbuilt (eval)']);
  if (!c.ok) throw new Error(`committing the vendored harness failed for ${scenario.id}: ${c.err}`);
}

export function setupWorkspace(scenario, arm, stamp) {
  const base = mkdtempSync(path.join(os.tmpdir(), `rb-eval-${scenario.id}-${arm}-`));
  const ws = path.join(base, 'ws');
  if (scenario.setup.length) {
    const r = spawnSync(process.execPath, [path.join(HERE, 'tools', 'setup-fixture.mjs'), ws, ...scenario.setup], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`fixture setup failed for ${scenario.id}: ${r.stderr}`);
    git(ws, ['config', 'commit.gpgsign', 'false']);
  } else {
    mkdirSync(ws, { recursive: true });
  }
  if (arm === 'with') vendorInto(ws, scenario);
  // GitHub simulator (evals/tools/fake-github.mjs): `rb` talks to it as if it were `gh api`, and
  // commits live in the local bare origin the fixture created (setup with --remote).
  let env = null;
  if (scenario.github) {
    const bare = `${ws}.origin.git`;
    if (!existsSync(bare)) throw new Error(`${scenario.id}: "github" needs --remote in setup`);
    git(ws, ['push', '-q', 'origin', 'main']);
    const seed = SEEDS[scenario.github.seed];
    if (!seed) throw new Error(`${scenario.id}: unknown github seed ${scenario.github.seed}`);
    const stateFile = path.join(base, 'gh-state.json');
    writeFileSync(stateFile, JSON.stringify(seed(ws)));
    env = { RB_GH_BIN: path.join(HERE, 'tools', 'fake-github.mjs'), RB_GH_STATE: stateFile, RB_FAKE_GIT: bare, RB_GH_REPO: 'acme/app', RB_GH_RETRY_MS: '0', RB_GH_LOG: path.join(base, 'gh-log.jsonl') };
  }
  const startHead = git(ws, ['rev-parse', 'HEAD']);
  return { ws, startHead: startHead.ok ? startHead.out : null, stamp, env };
}

function runClaude(prompt, ws, timeoutMin, extraEnv = null) {
  const args = ['-p', prompt, '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose'];
  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd: ws, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: extraEnv ? { ...process.env, ...extraEnv } : process.env });
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
  // events keeps the order of agent dispatches and Bash commands (for ordering checks).
  const d = { skills: [], agents: [], writes: [], bash: [], events: [], final: '', costUsd: 0, turns: 0, durationS: 0 };
  for (const line of jsonl.split('\n')) {
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.type === 'assistant' && !m.parent_tool_use_id) {
      for (const c of m.message?.content || []) {
        if (c.type !== 'tool_use') continue;
        if (c.name === 'Skill') d.skills.push(c.input.skill);
        else if (c.name === 'Agent' || c.name === 'Task') {
          d.agents.push(c.input.subagent_type);
          d.events.push({ kind: 'agent', value: c.input.subagent_type });
        }
        else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(c.name)) d.writes.push(c.input.file_path || c.input.notebook_path || '');
        else if (c.name === 'Bash') {
          d.bash.push(c.input.command);
          d.events.push({ kind: 'bash', value: c.input.command });
        }
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

function toRegExp(pattern) {
  if (pattern.startsWith('(?i)')) return new RegExp(pattern.slice(4), 'i');
  return new RegExp(pattern);
}

function filesUnder(full) {
  try {
    if (!statSync(full).isDirectory()) return [full];
  } catch {
    return [];
  }
  return readdirSync(full).flatMap((n) => filesUnder(path.join(full, n)));
}

// Text the run left behind: changed, untracked and ignored files in the working tree (digests go
// to the gitignored .rockbuilt/), plus files committed on any branch since the start.
export function producedTexts(ws, startHead) {
  const texts = [];
  const status = git(ws, ['status', '--porcelain', '--ignored', '--untracked-files=all']).out.split('\n').filter(Boolean);
  for (const line of status) {
    const p = line.slice(3).replace(/^"|"$/g, '');
    if (/(^|\/)node_modules(\/|$)/.test(p)) continue;
    for (const f of filesUnder(path.join(ws, p))) {
      try { texts.push({ file: rel(ws, f), text: readFileSync(f, 'utf8') }); } catch { /* binary or gone */ }
    }
  }
  if (startHead) {
    const branches = git(ws, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).out.split('\n').filter(Boolean);
    for (const b of branches) {
      for (const f of git(ws, ['diff', '--name-only', startHead, b]).out.split('\n').filter(Boolean)) {
        const show = git(ws, ['show', `${b}:${f}`]);
        if (show.ok) texts.push({ file: `${b}:${f}`, text: show.out });
      }
    }
  }
  return texts;
}

// Each check returns { ok, detail }.
export function runCheck(check, ctx) {
  const { d, ws, startHead } = ctx;
  switch (check.type) {
    case 'skill':
      return { ok: d.skills.includes(check.name), detail: `skills: ${d.skills.join(', ') || 'none'}` };
    case 'noRockbuiltSkill': {
      const hit = d.skills.filter((s) => s.startsWith('rockbuilt:') || s.startsWith('rb-'));
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
    case 'ghMerged': {
      // GitHub simulator: these PRs were merged (through the gate's squash merge).
      const st = ctx.env ? JSON.parse(readFileSync(ctx.env.RB_GH_STATE, 'utf8')) : { merges: [] };
      const merged = st.merges.map((x) => x.pr);
      return { ok: check.prs.every((n) => merged.includes(n)), detail: `merged ${merged.join(', ') || 'none'}` };
    }
    case 'ghNoUpdates': {
      const st = ctx.env ? JSON.parse(readFileSync(ctx.env.RB_GH_STATE, 'utf8')) : {};
      return { ok: !(st.updates || []).length, detail: `update-branch on ${(st.updates || []).join(', ') || 'none'}` };
    }
    case 'fileExists':
      return { ok: existsSync(path.join(ws, check.path)), detail: check.path };
    case 'finalMatches': {
      const ok = toRegExp(check.pattern).test(d.final);
      return { ok, detail: ok ? 'matched' : `no match for /${check.pattern}/` };
    }
    case 'textMatches': {
      // The final message or any file the run produced (see producedTexts) matches.
      const re = toRegExp(check.pattern);
      if (re.test(d.final)) return { ok: true, detail: 'final message' };
      const hit = producedTexts(ws, startHead).find((t) => re.test(t.text));
      return { ok: Boolean(hit), detail: hit ? hit.file : `no match for /${check.pattern}/` };
    }
    case 'bashIncludes': {
      const re = toRegExp(check.pattern);
      const hit = d.bash.find((c) => re.test(c));
      return { ok: Boolean(hit), detail: hit || `no command matching /${check.pattern}/` };
    }
    case 'bashExcludes': {
      const re = toRegExp(check.pattern);
      const hit = d.bash.filter((c) => re.test(c));
      return { ok: hit.length === 0, detail: hit.length ? hit.slice(0, 3).join(' | ') : 'none' };
    }
    case 'noAgentBeforeBash': {
      // Passes when the agent was never dispatched, or a Bash command matching the pattern
      // (an escalation, for example) ran before its first dispatch.
      const re = toRegExp(check.pattern);
      const agentAt = d.events.findIndex((e) => e.kind === 'agent' && e.value === check.agent);
      if (agentAt === -1) return { ok: true, detail: `${check.agent} not dispatched` };
      const bashAt = d.events.findIndex((e) => e.kind === 'bash' && re.test(e.value));
      const ok = bashAt !== -1 && bashAt < agentAt;
      return { ok, detail: ok ? `matching command before ${check.agent}` : `${check.agent} dispatched first` };
    }
    case 'anyOf': {
      const results = check.checks.map((c) => runCheck(c, ctx));
      const ok = results.some((r) => r.ok);
      return { ok, detail: results.map((r, i) => `${check.checks[i].type}: ${r.detail}`).join(' / ') };
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
    const { ws, startHead, env } = setupWorkspace(s, arm, stamp);
    const run = await runClaude(s.prompt, ws, opts.timeoutMin, env);
    writeFileSync(path.join(outDir, `${s.id}-${arm}.jsonl`), run.out);
    const d = digest(run.out);
    const checks = s.checks.map((c) => ({ ...c, ...runCheck(c, { d, ws, startHead, env }) }));
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

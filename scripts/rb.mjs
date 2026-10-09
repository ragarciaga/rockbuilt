#!/usr/bin/env node
// rb: the Rockbuilt CLI (DESIGN.md section 10). Zero dependencies, Node >= 20.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBaseline, runBaseline } from './lib/baseline.mjs';
import { COMMAND_SECTIONS, readClaudeMd, sectionCommands } from './lib/claudemd.mjs';
import { runDoctor } from './lib/doctor.mjs';
import { ensureLabels } from './lib/gh.mjs';
import { initProject } from './lib/init.mjs';
import { planBatches } from './lib/parallel.mjs';
import { coverage, loadSpec, taskProblems } from './lib/spec.mjs';
import { aggregate, appendEvent, readEvents, renderTable, writeProgressBlock } from './lib/timing.mjs';
import { CliError, parseArgs, projectRoot, requireRepoRoot } from './lib/util.mjs';
import { addWorktree, listWorktrees, removeWorktree } from './lib/worktree.mjs';

export const COMMANDS = {
  doctor: 'Check node, git, gh auth, CLAUDE.md, settings.json, .gitignore, labels, branch protection',
  init: 'Install templates/project without overwriting  [--type web,ai] [--lang es]',
  labels: 'Create or update the rb:* label set via gh',
  'verify-cmds': 'Print commands from a CLAUDE.md section  [Verification|E2E|Evals|Setup]',
  baseline: 'Run Verification commands, write .rockbuilt/baseline.json  [--check]',
  tasks: 'Parse tasks.md and check coverage against requirements.md  <spec-dir>',
  parallel: 'Batch ready tasks with disjoint files  <spec-dir> [--ids T4,T6] [--max 3]',
  worktree: 'add <task> [--base main] [--slug s] [--title t] [--spec dir] | remove <task> [--force] | list',
  timing: 'start|end <task> <phase> | report [--write]',
  help: 'Show this help',
};

const BOOLEAN_FLAGS = ['json', 'check', 'write', 'force', 'help'];

function makeIo(io) {
  return {
    cwd: io.cwd || process.cwd(),
    out: io.out || ((s) => process.stdout.write(`${s}\n`)),
    err: io.err || ((s) => process.stderr.write(`${s}\n`)),
  };
}

function helpText() {
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  const lines = ['Usage: rb <command> [options] [--json]', '', 'Commands:'];
  for (const [k, v] of Object.entries(COMMANDS)) lines.push(`  ${k.padEnd(width)}  ${v}`);
  return lines.join('\n');
}

// Each handler returns { data, text, code }.
const handlers = {
  help() {
    return { data: { commands: COMMANDS }, text: helpText(), code: 0 };
  },

  doctor({ cwd }) {
    const r = runDoctor(cwd);
    const width = Math.max(...r.checks.map((c) => c.name.length));
    const text = r.checks.map((c) => `${c.status.padEnd(4)}  ${c.name.padEnd(width)}  ${c.detail}`).join('\n');
    return { data: r, text, code: r.ok ? 0 : 1 };
  },

  init({ cwd, flags }) {
    const r = initProject(projectRoot(cwd), { type: flags.type, lang: flags.lang });
    const lines = [
      ...r.created.map((f) => `created  ${f}`),
      ...r.skipped.map((f) => `skipped  ${f} (exists)`),
      r.gitignoreAdded.length ? `.gitignore += ${r.gitignoreAdded.join(', ')}` : '.gitignore already complete',
    ];
    if (r.customized.length) lines.push(`CLAUDE.md set: ${r.customized.join(', ')}`);
    if (r.web) {
      const w = r.web;
      lines.push('web (Playwright):');
      lines.push(...w.created.map((f) => `created  ${f}`), ...w.skipped.map((f) => `skipped  ${f} (exists)`));
      if (w.mcp === 'merged') lines.push('merged   .mcp.json (added the playwright server)');
      if (w.mcp === 'present') lines.push('skipped  .mcp.json (playwright server already configured)');
      if (w.mcp === 'invalid') lines.push('WARN     .mcp.json is not valid JSON; add the playwright server by hand');
      if (w.e2eScript === 'added') lines.push('package.json += scripts.test:e2e = "playwright test"');
      if (w.e2eScript === 'no-package-json') lines.push('WARN     no package.json yet; add "test:e2e": "playwright test" once the app exists');
      if (w.missingDeps.length) {
        lines.push(`next: npm install -D -E ${w.missingDeps.join(' ')}`);
        lines.push('next: npx playwright install chromium');
      }
      if (w.mcp === 'created' || w.mcp === 'merged') lines.push('next: restart Claude Code, approve the "playwright" MCP server, confirm with /mcp');
    }
    return { data: r, text: lines.join('\n'), code: 0 };
  },

  labels({ cwd }) {
    const results = ensureLabels(projectRoot(cwd));
    const failed = results.filter((r) => !r.ok);
    const text = results.map((r) => `${r.ok ? 'ok    ' : 'FAILED'}  ${r.name}${r.error ? `  ${r.error}` : ''}`).join('\n');
    return { data: { labels: results }, text, code: failed.length ? 1 : 0 };
  },

  'verify-cmds'({ cwd, positionals }) {
    const wanted = positionals[0] || 'Verification';
    const section = COMMAND_SECTIONS.find((s) => s.toLowerCase() === wanted.toLowerCase()) || wanted;
    const text = readClaudeMd(projectRoot(cwd));
    if (text === null) throw new CliError('CLAUDE.md not found at the project root');
    const commands = sectionCommands(text, section);
    if (commands === null) throw new CliError(`section "## ${section}" not found in CLAUDE.md`);
    return { data: { section, commands }, text: commands.join('\n'), code: 0 };
  },

  baseline({ cwd, flags, io }) {
    const root = requireRepoRoot(cwd);
    const log = flags.json ? () => {} : io.err;
    if (flags.check) {
      const r = checkBaseline(root, { log });
      const status = r.record.green ? 'green' : 'RED';
      const why = r.reran ? (r.moved ? `${r.defaultBranch} moved, re-ran` : 're-ran') : 'unchanged since last green baseline';
      return { data: r, text: `baseline ${status} at ${String(r.record.sha).slice(0, 7)} (${why})`, code: r.record.green ? 0 : 1 };
    }
    const rec = runBaseline(root, { log });
    const lines = rec.commands.map((c) => `${c.exitCode === 0 ? 'PASS' : 'FAIL'}  ${c.cmd}  (${c.durationMs} ms)${c.exitCode === 0 ? '' : `\n      ${c.summary.join('\n      ')}`}`);
    lines.push(`baseline ${rec.green ? 'green' : 'RED'} at ${String(rec.sha).slice(0, 7)} on ${rec.branch}`);
    return { data: rec, text: lines.join('\n'), code: rec.green ? 0 : 1 };
  },

  tasks({ cwd, positionals }) {
    const specDir = specDirArg(cwd, positionals[0], 'tasks');
    const spec = loadSpec(specDir);
    const problems = taskProblems(spec.tasks);
    const cov = spec.criteria ? coverage(spec.criteria, spec.tasks) : null;
    const data = { specDir, feature: spec.feature, status: spec.status, tasks: spec.tasks, problems };
    const lines = [`${spec.tasks.length} task(s) in ${specDir}`];
    for (const t of spec.tasks) lines.push(`  ${t.id} [${t.status}] ${t.title}  covers ${t.covers.join(', ') || '-'}  depends ${t.depends.join(', ') || 'none'}`);
    if (cov) {
      data.criteria = spec.criteria;
      data.coverage = cov;
      lines.push('', 'Coverage:');
      for (const row of cov.matrix) lines.push(`  ${row.id.padEnd(6)} ${row.tasks.join(', ') || 'UNCOVERED'}`);
      if (cov.uncovered.length) lines.push(`Uncovered criteria: ${cov.uncovered.join(', ')}`);
      if (cov.unknown.length) lines.push(`Unknown IDs: ${cov.unknown.map((u) => `${u.id} (in ${u.task})`).join(', ')}`);
    } else {
      lines.push('', 'requirements.md not found: coverage not checked');
    }
    if (problems.length) lines.push('', 'Problems:', ...problems.map((p) => `  ${p}`));
    const bad = (cov && (cov.uncovered.length || cov.unknown.length)) || problems.length;
    return { data, text: lines.join('\n'), code: bad ? 1 : 0 };
  },

  parallel({ cwd, positionals, flags }) {
    const specDir = specDirArg(cwd, positionals[0], 'parallel');
    const spec = loadSpec(specDir);
    const ids = typeof flags.ids === 'string' ? flags.ids.split(',') : null;
    const max = flags.max !== undefined && flags.max !== true ? Number(flags.max) : 3;
    if (!Number.isInteger(max) || max < 1) throw new CliError('--max must be a positive integer');
    const r = planBatches(spec.tasks, { ids, max });
    const lines = [];
    if (r.batches.length === 0) lines.push('No ready tasks.');
    r.batches.forEach((b, i) => lines.push(`Batch ${i + 1}: ${b.join(', ')}`));
    if (r.excluded.length) lines.push('', 'Not ready:', ...r.excluded.map((e) => `  ${e.id}: ${e.reason}`));
    if (r.reasons.length) lines.push('', 'Reasons:', ...r.reasons.map((x) => `  ${x}`));
    return { data: { specDir, ...r }, text: lines.join('\n'), code: 0 };
  },

  worktree({ cwd, positionals, flags }) {
    const root = requireRepoRoot(cwd);
    const [sub, task] = positionals;
    if (sub === 'add') {
      const r = addWorktree(root, task, { base: flags.base, slug: flags.slug, title: flags.title, spec: flags.spec });
      const text = [`path: ${r.path}`, `branch: ${r.branch}${r.reusedBranch ? ' (existing)' : ` (from ${r.base})`}`, `env files copied: ${r.envCopied.join(', ') || 'none'}`, `suggested port offset: +${r.portOffset}`].join('\n');
      return { data: r, text, code: 0 };
    }
    if (sub === 'remove') {
      const r = removeWorktree(root, task, { force: Boolean(flags.force) });
      return { data: r, text: `removed ${r.path} (branch ${r.branch} kept)`, code: 0 };
    }
    if (sub === 'list') {
      const list = listWorktrees(root);
      const text = list.length ? list.map((w) => `${w.task}  ${w.branch || '(detached)'}  ${w.path}`).join('\n') : 'No rockbuilt worktrees.';
      return { data: { worktrees: list }, text, code: 0 };
    }
    throw new CliError('usage: rb worktree add <task> [--base main] [--slug s] [--title t] [--spec dir] | remove <task> [--force] | list');
  },

  timing({ cwd, positionals, flags }) {
    const root = projectRoot(cwd);
    const [sub, task, phase] = positionals;
    if (sub === 'start' || sub === 'end') {
      const rec = appendEvent(root, sub, task, phase);
      return { data: rec, text: `${sub} ${task} ${phase} at ${rec.ts}`, code: 0 };
    }
    if (sub === 'report') {
      const report = aggregate(readEvents(root));
      const table = renderTable(report);
      let written = null;
      if (flags.write) written = writeProgressBlock(root, table);
      const text = written ? `${table}\n\nwritten to ${written}` : table;
      return { data: { ...report, table, written }, text, code: 0 };
    }
    throw new CliError('usage: rb timing start|end <task> <phase> | rb timing report [--write]');
  },
};

function specDirArg(cwd, arg, cmd) {
  if (!arg) throw new CliError(`usage: rb ${cmd} <spec-dir>`);
  return path.resolve(cwd, arg);
}

export async function main(argv, ioOverrides = {}) {
  const io = makeIo(ioOverrides);
  const [command, ...rest] = argv;
  const { flags, positionals } = parseArgs(rest, BOOLEAN_FLAGS);
  const name = !command || command === '--help' || command === '-h' || flags.help ? 'help' : command;
  const handler = handlers[name];
  if (!handler) {
    io.err(`rb: unknown command "${command}"\n\n${helpText()}`);
    return 2;
  }
  try {
    const r = handler({ cwd: io.cwd, flags, positionals, io });
    io.out(flags.json ? JSON.stringify(r.data, null, 2) : r.text);
    return r.code;
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    if (flags.json) io.out(JSON.stringify({ error: e.message }, null, 2));
    io.err(`rb ${name}: ${e.message}`);
    return e.exitCode;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

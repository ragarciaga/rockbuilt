#!/usr/bin/env node
// rb: the Rockbuilt CLI (DESIGN.md section 21). Zero dependencies, Node >= 20.
// Exit codes: 0 ok, 1 error, 2 usage, 3 not eligible / not allowed.
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptBaseline, checkBaseline, runBaseline } from './lib/baseline.mjs';
import { COMMAND_SECTIONS, readContract, sectionCommands } from './lib/contract.mjs';
import { acquireLock, ensureControl, escalate, lockStatus, postDigest, releaseLock, stopStatus } from './lib/control.mjs';
import { runDoctor } from './lib/doctor.mjs';
import { GH_OPS, GhError, makeGh, ops, runGhOp } from './lib/gh.mjs';
import { mergeGate, revertPr } from './lib/merge.mjs';
import { planBatches } from './lib/parallel.mjs';
import { defaultBranch } from './lib/repo.mjs';
import { computeRisk, riskText } from './lib/risk.mjs';
import { coverage, loadSpec, taskProblems } from './lib/spec.mjs';
import { syncProject, syncText } from './lib/sync.mjs';
import { aggregate, appendEvent, mergeReports, parseBlock, readEvents, renderTable, writeProgressBlock } from './lib/timing.mjs';
import { CliError, listFlag, parseArgs, projectRoot, readText, requireRepoRoot, stringFlag } from './lib/util.mjs';
import { vendorProject, vendorText } from './lib/vendor.mjs';
import { addWorktree, listWorktrees, removeWorktree } from './lib/worktree.mjs';

export const COMMANDS = {
  vendor: 'Install or update the harness  [--tools claude,cursor,codex] [--type web,ai,automation] [--lang es] [--from <harness root>]',
  init: 'Alias of vendor',
  doctor: 'Environment, contract, vendored version, CI, protection mode, labels, control issue',
  'verify-cmds': 'Commands from an AGENTS.md section  [Verification|E2E|Evals|Setup]',
  baseline: 'Run Verification and ratchet against docs/rockbuilt/known-failures.json  [--check] [--accept]',
  tasks: 'Parse tasks.md strictly and check coverage against requirements.md  <spec-dir>',
  parallel: 'Batch ready tasks with disjoint files  <spec-dir> [--ids T4,T6] [--max 3]',
  worktree: 'add <task> [--base main] [--slug s] [--title t] [--spec dir] | remove <task> [--force] | list',
  timing: 'start|end <task> <phase> | report [--write]',
  risk: 'Autonomy tier of a diff  [--pr <n>] [--base <ref>] [--files a,b]',
  sync: 'Mark tasks done from merged PRs, delete merged rb/* branches, repair labels  [--run <id>]',
  gh: `REST GitHub layer  <op> [--repo owner/name]; ops: ${Object.keys(GH_OPS).join(', ')}`,
  'merge-gate': 'Merge a PR only if every gate condition holds  <pr> --run <id> | --human-approved [--dry-run]',
  revert: 'Open a revert PR for a merged PR  <pr>',
  control: 'ensure: find or create the control issue',
  lock: 'acquire --run <id> | release --run <id> | status',
  stop: 'status: exit 3 when the stop switch is on',
  escalate: '<issue|new> --kind human|local --title <t> --body-file <f>',
  digest: 'post --file <md>: append the run digest to the control issue',
  protect: 'Require the rockbuilt-ci check on the default branch (exit 3 when the plan does not allow it)',
  labels: 'Create or update the rb:* label set (same as gh labels-ensure)',
  help: 'Show this help',
};

const BOOLEAN_FLAGS = ['json', 'check', 'write', 'force', 'help', 'accept', 'dry-run', 'human-approved', 'draft'];

function makeIo(io) {
  return {
    cwd: io.cwd || process.cwd(),
    out: io.out || ((s) => process.stdout.write(`${s}\n`)),
    err: io.err || ((s) => process.stderr.write(`${s}\n`)),
    ghRunner: io.ghRunner || null,
  };
}

function helpText() {
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  const lines = ['Usage: rb <command> [options] [--json]', '', 'Commands:'];
  for (const [k, v] of Object.entries(COMMANDS)) lines.push(`  ${k.padEnd(width)}  ${v}`);
  const opWidth = Math.max(...Object.keys(GH_OPS).map((k) => k.length));
  lines.push('', 'rb gh ops (JSON output, optional --repo owner/name):');
  for (const [k, v] of Object.entries(GH_OPS)) lines.push(`  ${k.padEnd(opWidth)}  ${v}`.trimEnd());
  lines.push('', 'Exit codes: 0 ok, 1 error, 2 usage, 3 not eligible / not allowed.');
  return lines.join('\n');
}

const json = (d) => JSON.stringify(d, null, 2);

function client(root, flags, io) {
  return makeGh({ cwd: root, repo: stringFlag(flags, 'repo') || null, runner: io.ghRunner });
}

function bodyFile(cwd, flags, name = 'body-file') {
  const f = stringFlag(flags, name, { required: true });
  const text = readText(path.resolve(cwd, f));
  if (text === null) throw new CliError(`cannot read ${f}`);
  return text;
}

// Each handler returns { data, text, code }.
const handlers = {
  help() {
    return { data: { commands: COMMANDS, ghOps: GH_OPS }, text: helpText(), code: 0 };
  },

  doctor({ cwd, io }) {
    const r = runDoctor(cwd, io.ghRunner ? { gh: makeGh({ cwd: projectRoot(cwd), runner: io.ghRunner }), ghStatusFn: () => ({ installed: true, authenticated: true, detail: 'injected runner' }) } : {});
    const width = Math.max(...r.checks.map((c) => c.name.length));
    const text = r.checks.map((c) => `${c.status.padEnd(4)}  ${c.name.padEnd(width)}  ${c.detail}`).join('\n');
    return { data: r, text, code: r.ok ? 0 : 1 };
  },

  vendor({ cwd, flags }) {
    const r = vendorProject(projectRoot(cwd), { from: flags.from, type: flags.type, lang: flags.lang, tools: flags.tools });
    return { data: r, text: vendorText(r), code: 0 };
  },

  labels({ cwd, flags, io }) {
    const results = ops.labelsEnsure(client(projectRoot(cwd), flags, io));
    return { data: { labels: results }, text: results.map((r) => `${r.action.padEnd(8)} ${r.name}`).join('\n'), code: 0 };
  },

  'verify-cmds'({ cwd, positionals }) {
    const wanted = positionals[0] || 'Verification';
    const section = COMMAND_SECTIONS.find((s) => s.toLowerCase() === wanted.toLowerCase()) || wanted;
    const { file, text } = readContract(projectRoot(cwd));
    if (text === null) throw new CliError('AGENTS.md (or CLAUDE.md) not found at the project root');
    const commands = sectionCommands(text, section);
    if (commands === null) throw new CliError(`section "## ${section}" not found in ${file}`);
    return { data: { file, section, commands }, text: commands.join('\n'), code: 0 };
  },

  baseline({ cwd, flags, io }) {
    const root = requireRepoRoot(cwd);
    const log = flags.json ? () => {} : io.err;
    if (flags.check && !flags.accept) {
      const r = checkBaseline(root, { log });
      const status = r.record.green ? 'green' : 'RED';
      const why = r.reran ? (r.moved ? `${r.defaultBranch} moved, re-ran` : 're-ran') : 'unchanged since last green baseline';
      return { data: r, text: `baseline ${status} at ${String(r.record.sha).slice(0, 7)} (${why})${newFailuresText(r.record)}`, code: r.record.green ? 0 : 1 };
    }
    const rec = runBaseline(root, { log });
    const lines = rec.commands.map((c) => {
      const counts = Object.entries(c.counts || {}).map(([k, v]) => `${v} ${k}`).join(', ');
      const head = `${c.exitCode === 0 ? 'PASS' : 'FAIL'}  ${c.cmd}  (${c.durationMs} ms${counts ? `; ${counts}` : ''})`;
      return c.exitCode === 0 ? head : `${head}\n      ${c.summary.join('\n      ')}`;
    });
    if (flags.accept) {
      const acc = acceptBaseline(root, rec);
      lines.push(`WARNING: accepting failures is a tier C decision; the user must agree. Commit ${path.relative(root, acc.file).replace(/\\/g, '/')} in a PR labelled rb:tier-c.`);
      lines.push(acc.added.length ? `accepted: ${acc.added.map((a) => (a.test ? `${a.cmd} :: ${a.test}` : `${a.cmd} (allowFailure)`)).join('; ')}` : 'nothing new to accept');
      return { data: { ...rec, accepted: acc }, text: lines.join('\n'), code: 0 };
    }
    for (const s of rec.ratchet.shrinkable) lines.push(`known failures now passing (remove from the list): ${s.cmd} :: ${s.tests.join(', ')}`);
    lines.push(`baseline ${rec.green ? 'green' : 'RED'} at ${String(rec.sha).slice(0, 7)} on ${rec.branch}${rec.worktree ? ' (worktree; ratchet from the main checkout)' : ''}${newFailuresText(rec)}`);
    return { data: rec, text: lines.join('\n'), code: rec.green ? 0 : 1 };
  },

  tasks({ cwd, positionals }) {
    const specDir = specDirArg(cwd, positionals[0], 'tasks');
    const spec = loadSpec(specDir);
    const problems = taskProblems(spec.tasks, spec.errors);
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
    throw new CliError('usage: rb worktree add <task> [--base main] [--slug s] [--title t] [--spec dir] | remove <task> [--force] | list', 2);
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
      let table = renderTable(report);
      let written = null;
      if (flags.write) {
        const merged = mergeReports(parseBlock(readText(path.join(root, 'docs', 'progress.md'))), report);
        table = renderTable(merged);
        written = writeProgressBlock(root, table);
      }
      const text = written ? `${table}\n\nwritten to ${written}` : table;
      return { data: { ...report, table, written }, text, code: 0 };
    }
    throw new CliError('usage: rb timing start|end <task> <phase> | rb timing report [--write]');
  },

  risk({ cwd, flags, io }) {
    const root = requireRepoRoot(cwd);
    const files = listFlag(flags.files);
    const pr = stringFlag(flags, 'pr');
    const r = computeRisk(root, { files, pr, base: stringFlag(flags, 'base'), gh: pr ? client(root, flags, io) : null });
    return { data: r, text: riskText(r), code: 0 };
  },

  sync({ cwd, flags, io }) {
    const root = requireRepoRoot(cwd);
    let c = null;
    try {
      c = client(root, flags, io);
      void c.repo;
    } catch {
      c = null;
    }
    const run = typeof flags.run === 'string' ? flags.run : null;
    const r = syncProject(root, c, { log: flags.json ? () => {} : io.err, run });
    return { data: r, text: syncText(r), code: 0 };
  },

  gh({ cwd, positionals, flags, io }) {
    const [op, ...rest] = positionals;
    if (!op) throw new CliError(`usage: rb gh <op>; ops: ${Object.keys(GH_OPS).join(', ')}`, 2);
    const root = projectRoot(cwd);
    const data = runGhOp(client(root, flags, io), op, rest, flags, { cwd, defaultBranch: () => defaultBranch(root) });
    return { data, text: json(data), code: 0 };
  },

  'merge-gate'({ cwd, positionals, flags, io }) {
    const root = requireRepoRoot(cwd);
    const pr = positionals[0];
    if (!pr) throw new CliError('usage: rb merge-gate <pr> --run <id> | --human-approved [--dry-run]', 2);
    const r = mergeGate(root, client(root, flags, io), pr, { dryRun: Boolean(flags['dry-run']), run: stringFlag(flags, 'run') || null, humanApproved: Boolean(flags['human-approved']) });
    const lines = [];
    if (r.merged) lines.push(`merged #${r.pr} (tier ${r.tier}) as ${String(r.mergeSha).slice(0, 7)}; revert: node tools/rockbuilt/rb.mjs revert ${r.pr}`);
    else if (r.eligible) lines.push(`#${r.pr} eligible (tier ${r.tier}); dry run, not merged`);
    else lines.push(`#${r.pr} NOT eligible (label ${r.labelTier || '-'}, risk ${r.riskTier || '-'}):`, ...r.reasons.map((x) => `  ${x.rule.padEnd(15)} ${x.detail}`));
    for (const a of r.after || []) if (!a.ok) lines.push(`WARN after-merge ${a.step}: ${a.error}`);
    return { data: r, text: lines.join('\n'), code: r.eligible ? 0 : 3 };
  },

  revert({ cwd, positionals, flags, io }) {
    const root = requireRepoRoot(cwd);
    if (!positionals[0]) throw new CliError('usage: rb revert <pr>', 2);
    const r = revertPr(root, client(root, flags, io), positionals[0]);
    return { data: r, text: `revert PR #${r.pr} opened from ${r.branch} (reverts #${r.reverted})`, code: 0 };
  },

  control({ cwd, positionals, flags, io }) {
    if (positionals[0] !== 'ensure') throw new CliError('usage: rb control ensure', 2);
    const r = ensureControl(client(projectRoot(cwd), flags, io));
    return { data: r, text: String(r.number), code: 0 };
  },

  lock({ cwd, positionals, flags, io }) {
    const c = client(projectRoot(cwd), flags, io);
    const sub = positionals[0];
    if (sub === 'acquire') {
      const r = acquireLock(c, stringFlag(flags, 'run'));
      const text = r.acquired ? `lock acquired by ${r.run} on #${r.control}${r.tookOverStale ? ` (stale lock of ${r.previous} taken over)` : ''}` : `lock held by ${r.holder} since ${r.since}${r.race ? ' (lost a race)' : ''}`;
      return { data: r, text, code: r.acquired ? 0 : 3 };
    }
    if (sub === 'release') {
      const r = releaseLock(c, stringFlag(flags, 'run'));
      return { data: r, text: r.released ? `lock released by ${r.run}` : r.reason, code: r.released ? 0 : 3 };
    }
    if (sub === 'status') {
      const r = lockStatus(c);
      const text = r.held ? `held by ${r.run} since ${r.at} (${r.ageMinutes} min)` : r.stale ? `free (stale lock of ${r.run}, ${r.ageMinutes} min)` : 'free';
      return { data: r, text, code: 0 };
    }
    throw new CliError('usage: rb lock acquire --run <id> | release --run <id> | status', 2);
  },

  stop({ cwd, positionals, flags, io }) {
    if (positionals[0] !== 'status') throw new CliError('usage: rb stop status', 2);
    const r = stopStatus(client(projectRoot(cwd), flags, io));
    return { data: r, text: r.stop ? `STOP: ${r.issues.map((i) => `#${i.number} ${i.title}`).join(', ')}` : 'stop switch off', code: r.stop ? 3 : 0 };
  },

  escalate({ cwd, positionals, flags, io }) {
    if (!positionals[0]) throw new CliError('usage: rb escalate <issue|new> --kind human|local --title <t> --body-file <f>', 2);
    const r = escalate(client(projectRoot(cwd), flags, io), positionals[0], { kind: stringFlag(flags, 'kind', { required: true }), title: stringFlag(flags, 'title', { required: true }), body: bodyFile(cwd, flags) });
    return { data: r, text: `#${r.issue} labelled ${r.label}${r.created ? ' (new issue)' : ''}`, code: 0 };
  },

  digest({ cwd, positionals, flags, io }) {
    if (positionals[0] !== 'post') throw new CliError('usage: rb digest post --file <md>', 2);
    const r = postDigest(client(projectRoot(cwd), flags, io), bodyFile(cwd, flags, 'file'));
    return { data: r, text: `digest posted on #${r.control}`, code: 0 };
  },

  protect({ cwd, flags, io }) {
    const root = projectRoot(cwd);
    const c = client(root, flags, io);
    const branch = stringFlag(flags, 'branch') || defaultBranch(root);
    try {
      c.api('PUT', `{repo}/branches/${encodeURIComponent(branch)}/protection`, {
        body: { required_status_checks: { strict: true, contexts: ['rockbuilt-ci'] }, enforce_admins: false, required_pull_request_reviews: null, restrictions: null },
      });
    } catch (e) {
      if (e instanceof GhError && (e.status === 403 || /upgrade|pro|public/i.test(e.message))) {
        const data = { protected: false, mode: 'rb-only', branch, reason: e.message };
        return { data, text: `Branch protection is not available on this plan (${e.message}).\nGitHub Pro (USD 4/month) or a public repo enables it; that is a cost, the user decides.\nUntil then rb merge-gate is the only gate (mode rb-only).`, code: 3 };
      }
      throw e;
    }
    return { data: { protected: true, mode: 'github', branch, requiredChecks: ['rockbuilt-ci'] }, text: `${branch}: rockbuilt-ci is now a required status check (no required reviews)`, code: 0 };
  },
};
handlers.init = handlers.vendor;

function newFailuresText(rec) {
  const fresh = (rec.ratchet ? rec.ratchet.verdicts : []).filter((v) => !v.ok);
  return fresh.length ? `\nnew failures: ${fresh.map((v) => `${v.cmd} :: ${v.newFailures.join(', ')}`).join('; ')}` : '';
}

function specDirArg(cwd, arg, cmd) {
  if (!arg) throw new CliError(`usage: rb ${cmd} <spec-dir>`);
  return path.resolve(cwd, arg);
}

export async function main(argv, ioOverrides = {}) {
  const io = makeIo(ioOverrides);
  const [command, ...rest] = argv;
  const { flags, positionals } = parseArgs(rest, BOOLEAN_FLAGS);
  const name = !command || command === '--help' || command === '-h' || (flags.help && command !== 'gh') ? 'help' : command;
  const handler = Object.hasOwn(handlers, name) ? handlers[name] : null;
  if (!handler) {
    io.err(`rb: unknown command "${command}"\n\n${helpText()}`);
    return 2;
  }
  try {
    const r = handler({ cwd: io.cwd, flags, positionals, io });
    io.out(flags.json ? json(r.data) : r.text);
    return r.code;
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    if (flags.json) io.out(json({ error: e.message, status: e.status || null }));
    io.err(`rb ${name}: ${e.message}`);
    return e.exitCode;
  }
}

// Compare real paths: on macOS /var is /private/var, on Windows case and short names differ.
// A false negative here would make the script exit without doing anything.
const realOrSelf = (p) => { try { return realpathSync.native(p); } catch { return path.resolve(p); } };
const sameFile = (a, b) => { const x = realOrSelf(a); const y = realOrSelf(b); return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y; };
const isMain = Boolean(process.argv[1]) && sameFile(process.argv[1], fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

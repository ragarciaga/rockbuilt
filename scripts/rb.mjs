#!/usr/bin/env node
// rb: the Rockbuilt CLI (DESIGN.md section 21). Zero dependencies, Node >= 20.
// Exit codes: 0 ok, 1 error, 2 usage, 3 not eligible / not allowed.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptBaseline, checkBaseline, runBaseline } from './lib/baseline.mjs';
import { COMMAND_SECTIONS, headerField, readContract, sectionCommands } from './lib/contract.mjs';
import { acquireLock, ensureControl, escalate, listFlaky, lockStatus, postDigest, recordFlaky, releaseLock, stopStatus } from './lib/control.mjs';
import { runDoctor } from './lib/doctor.mjs';
import { GH_OPS, GhError, makeGh, ops, runGhOp } from './lib/gh.mjs';
import { DEFAULTS as HOURS_DEFAULTS, HOURS_TITLE, UNATTENDED_TAG, computeHours, makeResolver, manualComment, parseAttention, parseBaseline, parseWindow, readMarks, readState, readManualLocal, recordManualLocal, recordMark, renderCsv, renderHours, sessionComments, writeState } from './lib/hours.mjs';
import { carryBookkeeping, saveBookkeeping } from './lib/bookkeeping.mjs';
import { qualityReport, qualityText } from './lib/quality.mjs';
import { buildQueue, finishQueue } from './lib/queue.mjs';
import { findBrowser } from './lib/browser.mjs';
import { identityLine, reviewDelta } from './lib/delta.mjs';
import { e2ePlan, onlyCommands, parseShard, shardCommands } from './lib/e2e.mjs';
import { mergeGate, revertPr } from './lib/merge.mjs';
import { planBatches } from './lib/parallel.mjs';
import { currentBranch, defaultBranch, mainCheckoutRoot } from './lib/repo.mjs';
import { computeRisk, riskText } from './lib/risk.mjs';
import { coverage, loadSpec, taskProblems } from './lib/spec.mjs';
import { claimIssue, syncProject, syncText } from './lib/sync.mjs';
import { addRows, aggregate, appendEvent, localRow, markPublished, mergeReports, parseBlock, parseTimingLines, readEvents, renderTable, timingLine, writeProgressBlock } from './lib/timing.mjs';
import { CliError, git, listFlag, parseArgs, projectRoot, readText, requireRepoRoot, sleepMs, stringFlag } from './lib/util.mjs';
import { vendorProject, vendorText } from './lib/vendor.mjs';
import { addWorktree, listWorktrees, removeWorktree } from './lib/worktree.mjs';

export const COMMANDS = {
  vendor: 'Install or update the harness  [--tools claude,cursor,codex] [--type web,ai,automation] [--lang es] [--from <harness root>]',
  init: 'Alias of vendor',
  doctor: 'Environment, contract, vendored version, CI, protection mode, labels, control issue',
  'verify-cmds': 'Commands from an AGENTS.md section  [Verification|E2E|Evals|Setup]; E2E only: [--shard i/n] (CI) or [--only a.spec.ts,b.spec.ts] [--grep "title"] (local)',
  'e2e-plan': 'CI: has E2E, shard count and matrix from AGENTS.md (key=value lines for GITHUB_OUTPUT)',
  'review-delta': 'Task change since the reviewed head, by content: identical | test-only | different  --reviewed <sha> [--base origin/<default>] [--line --task <id>: print the verifier identity line, exit 3 unless identical after merges only] (exit 3 when different)',
  baseline: 'Run Verification and ratchet against docs/rockbuilt/known-failures.json  [--check] [--accept]',
  tasks: 'Parse tasks.md strictly and check coverage against requirements.md  <spec-dir>',
  parallel: 'Batch ready tasks with disjoint files  <spec-dir> [--ids T4,T6] [--max 3]',
  worktree: 'add <task> [--base main] [--slug s] [--title t] [--spec dir] | remove <task> [--force] | list',
  timing: 'start|end <task> <phase> | line <task> [--est <hours>] [--pr <n>] | report [--write]',
  hours: 'Your attention hours by feature and task  [report] [--repos a/b,c/d] [--since d] [--until d] [--gap 10] [--tail 5] [--csv f] | log <minutes> [--ref T3] [--spec dir] [--at iso] [--note t] | mark|flush --hook',
  risk: 'Autonomy tier of a diff  [--pr <n>] [--base <ref>] [--files a,b]',
  bookkeeping: 'The day\'s bookkeeping PR: carry (apply the open one at run start) | save [--final] (push tasks.md, progress.md, LESSONS.md to rb/bookkeeping-<date>)  --run <id>',
  ci: 'CI on a commit: wait <sha> [--timeout <min>] (until rockbuilt-ci, and rockbuilt-e2e when the project has E2E, exist and every check completed; exit 0 green, 1 red, 3 timed out) | logs <sha> [--job <name>] [--tail <n>] (log tail, or annotations when the log is not readable)',
  browser: 'Print the Chromium executable for PW_CHROMIUM_PATH (exit 3 when none is found)',
  queue: 'Merge queue: build --run <id> --prs a,b,c (merge them onto the default branch as rb/queue-*, CI runs once) | done --run <id> (delete this run\'s queue branches)',
  quality: 'What escaped the reviews: merged task PRs, kickbacks by source, reverts, bugs traced to merged PRs  [--since d] [--until d]',
  claim: 'Mark an issue as being worked on by this run or session: <issue> --run <id> [--release | --take] (exit 3: another run holds it; rb sync keeps claims active in the last 3 h; --take only after the user confirms)',
  sync: 'Mark tasks done from merged PRs, delete merged rb/* branches, repair labels  [--run <id>]',
  gh: `REST GitHub layer  <op> [--repo owner/name]; ops: ${Object.keys(GH_OPS).join(', ')}`,
  'merge-gate': 'Merge a PR only if every gate condition holds  <pr> --run <id> | --human-approved [--dry-run]',
  revert: 'Open a revert PR for a merged PR  <pr>',
  control: 'ensure: find or create the control issue',
  lock: 'acquire --run <id> | release --run <id> | status',
  stop: 'status: exit 3 when the stop switch is on',
  escalate: '<issue|new> --kind human|local --title <t> --body-file <f>',
  digest: 'post --file <md>: append the run digest to the control issue',
  flaky: 'record <test> [--pr <n>] [--note t] | list: flaky candidates on the control issue (a failure that passed on re-run)',
  protect: 'Require the rockbuilt-ci check on the default branch (exit 3 when the plan does not allow it)',
  labels: 'Create or update the rb:* label set (same as gh labels-ensure)',
  help: 'Show this help',
};

const BOOLEAN_FLAGS = ['json', 'check', 'write', 'force', 'help', 'accept', 'dry-run', 'human-approved', 'draft', 'hook'];

function makeIo(io) {
  return {
    cwd: io.cwd || process.cwd(),
    out: io.out || ((s) => process.stdout.write(`${s}\n`)),
    err: io.err || ((s) => process.stderr.write(`${s}\n`)),
    ghRunner: io.ghRunner || null,
    stdin: io.stdin || (() => readFileSync(0, 'utf8')),
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

// The open "Rockbuilt hours" issue (attention marks and manual entries), created on demand. A
// full one (1500 comments, like the control issue) is closed and replaced; the report reads all.
export const HOURS_ROTATE_AT = 1500;
const HOURS_BODY = '<!-- rockbuilt:hours -->\nAttention marks and manual time entries for `rb hours` (one comment per Claude Code session). Do not close this issue.';

// Only issues the owner opened count: in a shared or public repo anyone can open one.
function hoursIssue(c, { create, login }) {
  const found = ops.issueList(c, { state: 'open' }).filter((i) => i.title === HOURS_TITLE && i.author === login).sort((a, b) => a.number - b.number)[0];
  if (found && !(create && (found.comment_count || 0) >= HOURS_ROTATE_AT)) return found;
  if (!create) return null;
  const next = ops.issueCreate(c, { title: HOURS_TITLE, body: found ? `${HOURS_BODY}\nPrevious: #${found.number}.` : HOURS_BODY });
  if (found) ops.issueEdit(c, found.number, { state: 'closed' });
  return next;
}

// Every hours issue, open or closed (rotated ones, or two created at once by parallel sessions).
function hoursIssues(c, login, issues = null) {
  return (issues || ops.issueList(c, { state: 'all', maxPages: 200 })).filter((i) => i.title === HOURS_TITLE && i.author === login);
}

// AGENTS.md header `Hours: github | local | off`; null when unset (then: github on a private repo,
// local on a public one, decided at the first flush).
function hoursMode(root) {
  const v = (headerField(readText(path.join(root, 'AGENTS.md')) || '', 'Hours') || '').trim().toLowerCase();
  return ['github', 'local', 'off'].includes(v) ? v : null;
}

const digest = (text) => createHash('sha1').update(text).digest('hex');

// Upserts this session's attention comment(s) from the local marks, touching only parts that
// changed. Quiet no-op without new marks.
function flushSession(root, session, flags, io) {
  const marks = readMarks(root).filter((m) => m.session === session);
  if (!marks.length) return { flushed: 0 };
  const known = readState(root, session) || { issue: null, comments: [], sent: [], count: 0 };
  if (known.count === marks.length) return { flushed: 0 };
  if (known.localOnly && hoursMode(root) !== 'github') return { flushed: 0 };
  if (known.localOnly) known.localOnly = false;
  const c = client(root, flags, io);
  const bodies = sessionComments(session, marks);
  if (!known.issue) {
    // Unset mode on a public repo: keep marks local (timestamps and branches would be public).
    if (hoursMode(root) === null && !ops.repoInfo(c).private) {
      writeState(root, session, { ...known, localOnly: true, count: marks.length });
      return { flushed: 0, skipped: 'public repo, set Hours: github to publish' };
    }
    known.issue = hoursIssue(c, { create: true, login: ops.whoami(c).login }).number;
  }
  bodies.forEach((body, k) => {
    const h = digest(body);
    if (known.comments[k] && known.sent[k] === h) return;
    if (known.comments[k]) ops.commentEdit(c, known.comments[k], body);
    else known.comments[k] = ops.issueComment(c, known.issue, body).id;
    known.sent[k] = h;
    writeState(root, session, known); // after every write, so a later failure never re-posts
  });
  known.count = marks.length;
  writeState(root, session, known);
  return { flushed: marks.length, issue: known.issue, comments: known.comments };
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

  'verify-cmds'({ cwd, positionals, flags }) {
    const wanted = positionals[0] || 'Verification';
    const section = COMMAND_SECTIONS.find((s) => s.toLowerCase() === wanted.toLowerCase()) || wanted;
    const { file, text } = readContract(projectRoot(cwd));
    if (text === null) throw new CliError('AGENTS.md (or CLAUDE.md) not found at the project root');
    let commands = sectionCommands(text, section);
    if (commands === null) throw new CliError(`section "## ${section}" not found in ${file}`);
    const shard = stringFlag(flags, 'shard');
    const only = listFlag(flags.only);
    const grep = stringFlag(flags, 'grep');
    if ((shard !== undefined || only.length || grep !== undefined) && section !== 'E2E') throw new CliError('--shard, --only and --grep apply to the E2E section only', 2);
    if (shard !== undefined && (only.length || grep !== undefined)) throw new CliError('--shard is for CI; --only/--grep are for local runs: pick one', 2);
    if (shard !== undefined) {
      const { index, total } = parseShard(shard);
      commands = shardCommands(commands, index, total);
    } else if (only.length || grep !== undefined) {
      commands = onlyCommands(commands, only, grep);
    }
    return { data: { file, section, commands }, text: commands.join('\n'), code: 0 };
  },

  'e2e-plan'({ cwd }) {
    const { text } = readContract(projectRoot(cwd));
    const plan = e2ePlan(text || '');
    return { data: plan, text: `has=${plan.has}\ntotal=${plan.total}\nshards=${JSON.stringify(plan.shards)}`, code: 0 };
  },

  'review-delta'({ cwd, flags }) {
    const root = requireRepoRoot(cwd);
    const reviewed = stringFlag(flags, 'reviewed', { required: true });
    const base = stringFlag(flags, 'base') || `origin/${defaultBranch(root)}`;
    if (flags.line) {
      const r = identityLine(root, { base, reviewed, task: stringFlag(flags, 'task') });
      return { data: r, text: r.ok ? r.line : `${r.class}: ${r.detail} (no identity line: re-review)`, code: r.ok ? 0 : 3 };
    }
    const r = reviewDelta(root, { base, reviewed });
    return { data: r, text: `${r.class}: ${r.detail}`, code: r.class === 'different' ? 3 : 0 };
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

  timing({ cwd, positionals, flags, io }) {
    const root = projectRoot(cwd);
    const [sub, task, phase] = positionals;
    if (sub === 'start' || sub === 'end') {
      const rec = appendEvent(root, sub, task, phase);
      return { data: rec, text: `${sub} ${task} ${phase} at ${rec.ts}`, code: 0 };
    }
    if (sub === 'line') {
      if (!task) throw new CliError('usage: rb timing line <task>', 2);
      const est = stringFlag(flags, 'est');
      let estHours = est === undefined ? null : Number(est);
      if (est !== undefined && !(estHours > 0)) throw new CliError('--est must be a positive number of hours', 2);
      const pr = stringFlag(flags, 'pr');
      const local = localRow(readEvents(root), task);
      let row = local.total;
      if (pr !== undefined) {
        // The PR body already holds the minutes published earlier (maybe by another run, in a
        // checkout that no longer exists); add what happened since here: CI, re-reviews, merge.
        const body = ops.prView(client(root, flags, io), pr).body;
        const prior = parseTimingLines(body).filter((t) => t.task === task).pop() || null;
        if (!prior && !local.total) throw new CliError(`no timing for ${task} in PR #${pr} or in this checkout`);
        if (estHours === null && prior) estHours = prior.estHours;
        row = prior ? addRows(prior, local.since) : local.total;
      }
      if (!row) throw new CliError(`no timing events for ${task} in this checkout`);
      const line = timingLine({ tasks: [row], open: [] }, task, { estHours });
      markPublished(root, task, local.total ? local.total.phases : {});
      return { data: { line }, text: line, code: 0 };
    }
    if (sub === 'report') {
      const local = aggregate(readEvents(root));
      // Oldest to freshest: progress.md rows, then timing lines in rb/* PR bodies on GitHub, then
      // this checkout's events. A fresher source replaces a task's row.
      let report = { tasks: parseBlock(readText(path.join(root, 'docs', 'progress.md'))), open: [] };
      let github = null;
      let githubRead = false;
      try {
        const prs = ops.prList(client(root, flags, io), { state: 'all', headPrefix: 'rb/' });
        const rows = prs.slice().reverse().flatMap((p) => parseTimingLines(p.body));
        report = mergeReports(report.tasks, { tasks: rows, open: [] });
        github = `${rows.length} task(s) from PR bodies`;
        githubRead = true;
      } catch (e) {
        github = `not read (${e.message})`;
      }
      // This checkout: a task whose minutes went into a PR line adds only what came after that
      // line (CI, re-reviews); a task never published here takes its row as it is.
      const events = readEvents(root);
      const rows = report.tasks.map((t) => {
        const l = localRow(events, t.task);
        // Without GitHub the rows come from progress.md, which an earlier report here already
        // wrote with these minutes: only the GitHub rows are a clean base.
        return githubRead && l.since && l.published ? addRows(t, l.since) : t;
      });
      const known = new Set(rows.map((t) => t.task));
      for (const t of local.tasks) {
        if (known.has(t.task)) {
          const l = localRow(events, t.task);
          if (!l.published) { const i = rows.findIndex((x) => x.task === t.task); rows[i] = t; }
        } else rows.push(t);
      }
      report = { tasks: rows, open: local.open };
      const table = renderTable(report);
      const written = flags.write ? writeProgressBlock(root, table) : null;
      const text = `${table}${written ? `\n\nwritten to ${written}` : ''}\n\nGitHub: ${github}`;
      return { data: { ...report, table, written, github }, text, code: 0 };
    }
    throw new CliError('usage: rb timing start|end <task> <phase> | line <task> | report [--write]');
  },

  // Attention hours (DESIGN.md section 22). `mark` and `flush` run as Claude Code hooks: they read
  // the hook JSON on stdin, print nothing and never fail the session.
  hours({ cwd, positionals, flags, io }) {
    const [sub = 'report', ...rest] = positionals;
    if (sub === 'mark' || sub === 'flush') {
      if (!flags.hook) throw new CliError(`usage: rb hours ${sub} --hook (reads the Claude Code hook JSON on stdin)`, 2);
      try {
        let input = {};
        try { input = JSON.parse(io.stdin() || '{}') || {}; } catch { input = {}; }
        // The project is the session's project dir, never the shell's cwd (it may sit in another
        // attached repo), and only a vendored project is ever written to.
        const at = process.env.CLAUDE_PROJECT_DIR || input.cwd || cwd;
        const project = projectRoot(at);
        const root = mainCheckoutRoot(project);
        if (!existsSync(path.join(root, 'tools', 'rockbuilt', 'rb.mjs'))) return { data: { skipped: 'not a Rockbuilt project' }, text: null, code: 0 };
        const mode = hoursMode(root);
        if (mode === 'off') return { data: { skipped: 'Hours: off' }, text: null, code: 0 };
        const session = String(input.session_id || 'unknown');
        if (sub === 'mark') {
          if (String(input.prompt || '').includes(UNATTENDED_TAG)) return { data: { skipped: 'unattended' }, text: null, code: 0 };
          const rec = recordMark(root, { session, branch: currentBranch(project), ts: Date.now() });
          return { data: rec, text: null, code: 0 };
        }
        if (mode === 'local') return { data: { skipped: 'Hours: local' }, text: null, code: 0 };
        // A hook must not stall the end of a reply: no 10 s retry wait on a flaky GitHub.
        process.env.RB_GH_RETRY_MS = '0';
        return { data: flushSession(root, session, flags, io), text: null, code: 0 };
      } catch (e) {
        return { data: { error: e.message }, text: null, code: 0 };
      }
    }
    if (sub === 'log') {
      const root = projectRoot(cwd);
      const minutes = Number(rest[0]);
      if (!(minutes > 0) || minutes > 24 * 60) throw new CliError('usage: rb hours log <minutes> [--ref T3] [--spec docs/specs/NN-slug] [--at iso] [--note text]', 2);
      const atFlag = stringFlag(flags, 'at');
      const at = atFlag === undefined ? new Date() : new Date(parseWindow(atFlag, 'at'));
      const entry = { minutes, at: at.toISOString(), ref: stringFlag(flags, 'ref') || null, spec: stringFlag(flags, 'spec') || null };
      const c = client(root, flags, io);
      let mode = hoursMode(mainCheckoutRoot(root));
      if (mode === null) mode = ops.repoInfo(c).private ? 'github' : 'local';
      if (mode === 'local' || mode === 'off') {
        recordManualLocal(mainCheckoutRoot(root), entry);
        return { data: { local: true, ...entry }, text: `logged ${minutes} min on this machine only (Hours: ${mode})`, code: 0 };
      }
      const issue = hoursIssue(c, { create: true, login: ops.whoami(c).login });
      const body = manualComment({ ...entry, note: stringFlag(flags, 'note') });
      const comment = ops.issueComment(c, issue.number, body);
      return { data: { issue: issue.number, comment: comment.id, minutes, at: at.toISOString() }, text: `logged ${minutes} min on #${issue.number} (${c.repo})`, code: 0 };
    }
    if (sub !== 'report') throw new CliError('usage: rb hours [report] [--repos a/b,c/d] [--since d] [--until d] [--gap 10] [--tail 5] [--csv file] | log <minutes> ... | mark|flush --hook', 2);

    const root = projectRoot(cwd);
    const num = (name, dflt) => {
      const v = stringFlag(flags, name);
      if (v === undefined) return dflt;
      const n = Number(v);
      if (!(n > 0)) throw new CliError(`--${name} must be a positive number of minutes`, 2);
      return n;
    };
    const opts = { gapMin: num('gap', HOURS_DEFAULTS.gapMin), tailMin: num('tail', HOURS_DEFAULTS.tailMin), since: parseWindow(stringFlag(flags, 'since'), 'since'), until: parseWindow(stringFlag(flags, 'until'), 'until') };
    const here = client(root, flags, io);
    const notes = [];
    let login = null;
    try { login = ops.whoami(here).login; } catch (e) { throw new CliError(`cannot reach GitHub (${e.message}); rb hours needs it`); }
    let repos = listFlag(flags.repos);
    if (!repos.length) {
      let current = null;
      try { current = here.repo; } catch { current = null; }
      try {
        repos = ops.reposWithIssueTitled(here, login, HOURS_TITLE);
      } catch (e) {
        // Cloud sessions only reach the repos attached to them (search is refused).
        notes.push(`Only this repository is included: finding your other projects failed (${String(e.message).split(':')[0]}). Overlaps with projects not in the report are not split. Pass --repos with every project (in a cloud session, attach them first), or run it from your computer.`);
      }
      if (current) repos.push(current);
    }
    const seenRepo = new Set();
    repos = repos.filter((r) => !seenRepo.has(r.toLowerCase()) && seenRepo.add(r.toLowerCase())).sort();
    if (!repos.length) throw new CliError('no repositories: pass --repos owner/name[,owner/name]');
    const sinceIso = opts.since === null ? null : new Date(opts.since).toISOString();
    const localRepo = (() => { try { return here.repo; } catch { return null; } })();
    const projects = repos.map((repo) => {
      const c = makeGh({ cwd: root, repo, runner: io.ghRunner });
      const issues = ops.issueList(c, { state: 'all', maxPages: 200 });
      // Only the owner's own comments on the owner's own hours issues: collaborators run the same
      // hooks, and on a public repo anyone can post a fake manual entry.
      const att = parseAttention(hoursIssues(c, login, issues).flatMap((i) => ops.issueComments(c, i.number).filter((x) => x.author === login).map((x) => x.body)));
      let marks = att.marks;
      if (localRepo && repo.toLowerCase() === localRepo.toLowerCase()) {
        att.manual.push(...readManualLocal(mainCheckoutRoot(root)));
        const seen = new Set(marks.map((m) => `${m.session}|${new Date(m.ts).toISOString()}`));
        const local = readMarks(mainCheckoutRoot(root)).filter((m) => !seen.has(`${m.session}|${new Date(m.ts).toISOString()}`));
        if (local.length) notes.push(`${local.length} mark(s) from this machine are not on GitHub yet (they are flushed at the end of each reply).`);
        marks = [...marks, ...local];
      }
      const human = (x) => x.author === login && !/<!--\s*rockbuilt:/.test(x.body) && x.number;
      const comments = [...ops.repoComments(c, { since: sinceIso }), ...ops.repoComments(c, { since: sinceIso, review: true })]
        .filter(human)
        .map((x) => ({ ts: x.created_at, number: x.number }));
      const prs = ops.prList(c, { state: 'all', maxPages: 200 });
      const resolver = makeResolver({ prs, issues });
      const inWindow = (iso) => {
        const t = Date.parse(iso || '');
        if (!Number.isFinite(t)) return opts.since === null && opts.until === null;
        return (opts.since === null || t >= opts.since) && (opts.until === null || t < opts.until);
      };
      // One row per task: the newest PR's timing line (a retry rb/<id>-<slug>-r<k> repeats the
      // estimate, and locally its minutes already include the earlier attempt).
      const latest = new Map();
      for (const p of [...prs].sort((a, b) => a.number - b.number)) {
        if (!inWindow(p.merged_at || p.created_at)) continue;
        const ref = resolver.number(p.number);
        for (const t of parseTimingLines(p.body)) {
          const task = ref.task === '(general)' ? t.task : ref.task;
          latest.set(`${ref.spec || ''}\u0000${task}`, { task, spec: ref.spec, minutes: t.totalMs / 60000, estHours: t.estHours });
        }
      }
      const agent = [...latest.values()];
      const baselines = {};
      const specs = [...new Set([...prs, ...issues].map((x) => resolver.number(x.number).spec).filter(Boolean))];
      if (specs.length) {
        let ref = null;
        try { ref = ops.repoInfo(c).defaultBranch; } catch { ref = null; }
        for (const spec of specs) {
          const b = parseBaseline(ops.fileAt(c, `${spec}/requirements.md`, ref || 'main'));
          if (b !== null) baselines[spec] = b;
        }
      }
      return { repo, marks, comments, manual: att.manual, resolver, agent, baselines };
    });
    const report = computeHours(projects, opts);
    const text = renderHours(report, { repos, notes });
    const csv = stringFlag(flags, 'csv');
    let written = null;
    if (csv) {
      written = path.resolve(cwd, csv);
      writeFileSync(written, renderCsv(report));
    }
    return { data: { ...report, repos, notes, csv: written }, text: written ? `${text}\n\nCSV written to ${written}` : text, code: 0 };
  },

  risk({ cwd, flags, io }) {
    const root = requireRepoRoot(cwd);
    const files = listFlag(flags.files);
    const pr = stringFlag(flags, 'pr');
    const r = computeRisk(root, { files, pr, base: stringFlag(flags, 'base'), gh: pr ? client(root, flags, io) : null });
    return { data: r, text: riskText(r), code: 0 };
  },

  ci({ cwd, positionals, flags, io }) {
    const root = requireRepoRoot(cwd);
    const c = client(root, flags, io);
    const [op, sha] = positionals;
    if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) throw new CliError('usage: rb ci wait|logs <sha>', 2);
    const table = (checks) => checks.map((x) => `${x.name.padEnd(28)} ${(x.conclusion || x.status).padEnd(12)} ${x.minutes != null ? `${x.minutes} min` : ''}`.trimEnd()).join('\n');
    if (op === 'wait') {
      const tmin = Number(stringFlag(flags, 'timeout') ?? 30);
      if (!Number.isFinite(tmin) || tmin < 0 || tmin > 360) throw new CliError('--timeout must be minutes, 0 to 360', 2);
      const limit = Date.now() + tmin * 60000;
      const poll = Math.max(0, Number(process.env.RB_CI_POLL_S ?? 60) || 0) * 1000;
      // The aggregate checks are created after their jobs, so "every present check completed" can be
      // true before rockbuilt-ci or rockbuilt-e2e exists: wait for the required ones too.
      let required = ['rockbuilt-ci'];
      try { if (e2ePlan(readContract(root).text).has) required.push('rockbuilt-e2e'); } catch { required = ['rockbuilt-ci']; }
      for (;;) {
        const checks = ops.checks(c, sha);
        const done = checks.length > 0 && required.every((n) => checks.some((x) => x.name === n)) && checks.every((x) => x.status === 'completed');
        if (done) {
          const red = checks.filter((x) => !['success', 'neutral', 'skipped'].includes(x.conclusion));
          return { data: { sha, checks, green: !red.length }, text: `${red.length ? 'RED' : 'green'} on ${sha.slice(0, 7)}\n${table(checks)}`, code: red.length ? 1 : 0 };
        }
        if (Date.now() + poll > limit) return { data: { sha, checks, timedOut: true }, text: `still running on ${sha.slice(0, 7)} after the timeout\n${table(checks)}`, code: 3 };
        sleepMs(poll);
      }
    }
    if (op === 'logs') {
      const checks = ops.checks(c, sha).filter((x) => x.source === 'check-run' && x.id);
      const job = stringFlag(flags, 'job');
      const pickList = job ? checks.filter((x) => x.name === job || x.name.includes(job)) : checks.filter((x) => x.conclusion && !['success', 'neutral', 'skipped'].includes(x.conclusion));
      if (!pickList.length) return { data: { sha, jobs: [] }, text: job ? `no job named ${job} on ${sha.slice(0, 7)}` : `no failed job on ${sha.slice(0, 7)}`, code: 3 };
      const tail = Number(stringFlag(flags, 'tail') || 200);
      const jobs = pickList.map((x) => ({ name: x.name, conclusion: x.conclusion, minutes: x.minutes ?? null, ...ops.jobLog(c, x.id, { tail }) }));
      return { data: { sha, jobs }, text: jobs.map((j) => `== ${j.name} (${j.conclusion || 'running'}${j.minutes != null ? `, ${j.minutes} min` : ''}) [${j.source}${j.note ? `: ${j.note}` : ''}]\n${j.lines.join('\n')}`).join('\n\n'), code: 0 };
    }
    throw new CliError('usage: rb ci wait|logs <sha>', 2);
  },

  browser() {
    const r = findBrowser();
    return { data: r, text: r.path || `no Chromium executable found (tried ${r.tried.join(', ') || 'nothing'}); run npx playwright install chromium`, code: r.path ? 0 : 3 };
  },

  queue({ cwd, positionals, flags, io }) {
    const root = requireRepoRoot(cwd);
    const c = client(root, flags, io);
    if (positionals[0] === 'build') {
      const r = buildQueue(root, c, { run: flags.run, prs: stringFlag(flags, 'prs', { required: true }) });
      const lines = [r.detail];
      if (r.built) lines.push(`order=${r.included.map((x) => x.pr).join(',')}`, ...r.included.map((x) => `#${x.pr} step=${x.step} branch=${x.branch}`));
      for (const x of r.skipped) lines.push(`skipped #${x.pr}: ${x.reason}`);
      return { data: r, text: lines.join('\n'), code: r.built ? 0 : 3 };
    }
    if (positionals[0] === 'done') {
      const r = finishQueue(root, c, { run: flags.run });
      return { data: r, text: `queue branches deleted: ${r.deleted.join(', ') || 'none'}${r.failed.length ? `; failed: ${r.failed.map((f) => f.branch).join(', ')}` : ''}`, code: 0 };
    }
    throw new CliError('usage: rb queue build --run <id> --prs a,b,c | done --run <id>', 2);
  },

  quality({ cwd, flags, io }) {
    const root = requireRepoRoot(cwd);
    const r = qualityReport(client(root, flags, io), { since: parseWindow(stringFlag(flags, 'since'), 'since'), until: parseWindow(stringFlag(flags, 'until'), 'until') });
    return { data: r, text: qualityText(r), code: 0 };
  },

  bookkeeping({ cwd, positionals, flags, io }) {
    const root = requireRepoRoot(cwd);
    const [op] = positionals;
    let c = null;
    try {
      c = client(root, flags, io);
      void c.repo;
    } catch {
      c = null;
    }
    if (op === 'carry') {
      const r = carryBookkeeping(root, c, { run: flags.run });
      return { data: r, text: r.detail, code: r.code || 0 };
    }
    if (op === 'save') {
      const r = saveBookkeeping(root, c, { run: flags.run, final: Boolean(flags.final) });
      return { data: r, text: r.detail, code: r.code || 0 };
    }
    throw new CliError('usage: rb bookkeeping carry|save --run <id> [--final]', 2);
  },

  claim({ cwd, positionals, flags, io }) {
    const root = requireRepoRoot(cwd);
    const r = claimIssue(client(root, flags, io), positionals[0], { run: flags.run, release: Boolean(flags.release), take: Boolean(flags.take) });
    const text = r.released === false ? `#${r.issue} is claimed by ${r.holder}: not released` : r.released ? `released #${r.issue}` : r.claimed ? `#${r.issue} claimed by ${r.run}` : `#${r.issue} is claimed by ${r.holder} since ${r.since}: leave it`;
    return { data: r, text, code: r.claimed === false || r.released === false ? 3 : 0 };
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
    // pr-create: the tier comes from the real diff too, not only from the plan (rockbuilt #29: a
    // PR labelled B waited a full CI before the gate said rb risk is C). On the head branch, the
    // body's tier line and the tier label rise to rb risk's tier when it is higher.
    let raised = null;
    if (op === 'pr-create' && typeof flags.head === 'string') {
      const cur = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
      if (cur.ok && cur.stdout === flags.head) {
        const base = typeof flags.base === 'string' ? flags.base : defaultBranch(root);
        let risk = null;
        try { risk = computeRisk(root, { base: `origin/${base}` }); } catch { risk = null; }
        const file = typeof flags['body-file'] === 'string' ? path.resolve(cwd, flags['body-file']) : null;
        const text = file ? readText(file) : typeof flags.body === 'string' ? flags.body : null;
        const declared = text && (text.match(/<!--\s*rockbuilt:tier\s+([ABC])\s*-->/i) || [])[1];
        const rank = (t) => 'ABC'.indexOf(String(t || 'A').toUpperCase());
        if (risk && text !== null && rank(risk.tier) > rank(declared)) {
          raised = { from: declared ? declared.toUpperCase() : null, to: risk.tier, reasons: risk.reasons.filter((r) => r.rule !== 'tier-b').slice(0, 5).map((r) => `${r.rule} ${r.path} ${r.detail || ''}`.trim()) };
          const marker = `<!-- rockbuilt:tier ${risk.tier} -->`;
          flags.body = declared ? text.replace(/<!--\s*rockbuilt:tier\s+[ABC]\s*-->/i, marker) : `${text.trimEnd()}\n${marker}\n`;
          delete flags['body-file'];
          if (typeof flags.label === 'string') flags.label = flags.label.split(',').filter((l) => !/^rb:tier-[abc]$/i.test(l.trim())).join(',') || undefined;
          if (flags.label === undefined) delete flags.label;
        }
      }
    }
    const data = runGhOp(client(root, flags, io), op, rest, flags, { cwd, defaultBranch: () => defaultBranch(root) });
    if (raised) data.tierRaised = raised;
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
    // Exit 1 stops the train: the queued merge landed a tree CI did not run.
    if (r.treeMismatch) lines.push(`STOP: #${r.pr} landed a tree different from its tested queue step. Run ${r.revert} now and escalate.`);
    return { data: r, text: lines.join('\n'), code: r.treeMismatch ? 1 : r.eligible ? 0 : 3 };
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
      const text = r.acquired ? `lock ${r.renewed ? 'renewed' : r.already ? 'already held' : 'acquired'} by ${r.run} on #${r.control}${r.tookOverStale ? ` (stale lock of ${r.previous} taken over)` : ''}` : `lock held by ${r.holder} since ${r.since}${r.race ? ' (lost a race)' : ''}`;
      return { data: r, text, code: r.acquired ? 0 : 3 };
    }
    if (sub === 'release') {
      const r = releaseLock(c, stringFlag(flags, 'run'));
      return { data: r, text: r.released ? `lock released by ${r.run}` : r.reason, code: r.released ? 0 : 3 };
    }
    if (sub === 'status') {
      const r = lockStatus(c);
      const text = r.held ? `held by ${r.run} since ${r.since} (run ${r.runMinutes} min, renewed ${r.ageMinutes} min ago)` : r.stale ? `free (stale lock of ${r.run}, ${r.ageMinutes} min)` : 'free';
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

  flaky({ cwd, positionals, flags, io }) {
    const [sub, test] = positionals;
    const c = client(projectRoot(cwd), flags, io);
    if (sub === 'record') {
      const pr = stringFlag(flags, 'pr');
      const r = recordFlaky(c, { test, pr: pr === undefined ? null : Number(pr), note: stringFlag(flags, 'note') || '' });
      return { data: r, text: `flaky candidate ${test} recorded on #${r.control}`, code: 0 };
    }
    if (sub === 'list') {
      const rows = listFlaky(c);
      const text = rows.length ? rows.map((r) => `${r.count}x  ${r.test}  last ${r.last}${r.prs.length ? `  PRs ${r.prs.map((n) => `#${n}`).join(' ')}` : ''}`).join('\n') : 'No flaky candidates recorded.';
      return { data: { flaky: rows }, text, code: 0 };
    }
    throw new CliError('usage: rb flaky record <test> [--pr <n>] [--note <text>] | list', 2);
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
    // Required checks, never "branches must be up to date" (strict): the merge queue merges PRs
    // that are behind the base once GitHub's test merge equals their tested step (DESIGN 8.4), and
    // strict would refuse each of them and bring back one CI run per PR. The gate enforces the
    // up-to-date rule itself. rockbuilt-e2e too when the project has E2E, so the GitHub button
    // cannot merge while E2E still runs (3d_brain #266).
    const contexts = ['rockbuilt-ci', ...(e2ePlan(readContract(root).text || '').has ? ['rockbuilt-e2e'] : [])];
    try {
      c.api('PUT', `{repo}/branches/${encodeURIComponent(branch)}/protection`, {
        body: { required_status_checks: { strict: false, contexts }, enforce_admins: false, required_pull_request_reviews: null, restrictions: null },
      });
    } catch (e) {
      if (e instanceof GhError && (e.status === 403 || /upgrade|pro|public/i.test(e.message))) {
        const data = { protected: false, mode: 'rb-only', branch, reason: e.message };
        return { data, text: `Branch protection is not available on this plan (${e.message}).\nGitHub Pro (USD 4/month) or a public repo enables it; that is a cost, the user decides.\nUntil then rb merge-gate is the only gate (mode rb-only).`, code: 3 };
      }
      throw e;
    }
    return { data: { protected: true, mode: 'github', branch, requiredChecks: contexts, strict: false }, text: `${branch}: ${contexts.join(' and ')} required (not "up to date": the merge queue and rb merge-gate handle that); no required reviews`, code: 0 };
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
    if (flags.json) io.out(json(r.data));
    else if (r.text !== null) io.out(r.text);
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

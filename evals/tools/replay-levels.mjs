#!/usr/bin/env node
// Replay of merged PRs with the 1.0 review levels (PLAN-1.0, item 0.3).
//
// Usage: node evals/tools/replay-levels.mjs <dump.json> [--md] [--prs]
//
// For every merged PR it runs today's classifier (scripts/lib/risk.mjs, the code behind rb risk)
// on the PR's real file list and patches, then derives the 1.0 level (1 batch, 2 normal,
// 3 sensitive) and the owner-approval reasons from the closed list of PLAN-1.0 section 2. The
// output says what share of PRs would still ask the owner, how many owner interruptions per day
// that gives, and how many agent runs the levels save.
//
// The dump is fetched outside this script and never committed (it holds client code). Shape:
//   { "<owner>/<repo>": {
//       "agentsMd": "<AGENTS.md text at the default branch>",
//       "escalations": <escalation comments in the period>,
//       "prs": [{ number, title, head, merged_at, tier,          // tier as recorded (A/B/C/null)
//                 files: [{ path, previousPath, status, additions, deletions, patch }],
//                 packageJson: { "<path>": { old, new } } }] } }
//
// Approximations, each one a default recorded in the results file:
// - "New" (paid SDK, secret-like env var, external host) means absent from every earlier merged
//   PR of the same repo, not from the base tree, which the dump does not hold.
// - Sensitive paths, Tier A paths and Paid services come from today's AGENTS.md, not the one at
//   each PR's base.
// - Agents are counted for one pass with no kickbacks: planner, implementer, verifier, auditor and
//   security reviewer each count one run.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseAutonomy } from '../../scripts/lib/contract.mjs';
import { isTestPath } from '../../scripts/lib/delta.mjs';
import { matchAny, normalizePath } from '../../scripts/lib/glob.mjs';
import { classify } from '../../scripts/lib/risk.mjs';

// PLAN-1.0 A3: bookkeeping files inside a task PR do not raise the level.
export const BOOKKEEPING = ['docs/specs/*/tasks.md', 'docs/progress.md', '.claude/LESSONS.md'];
// PLAN-1.0 A2: the size limit does not count tests or fixtures.
export const FIXTURES = ['**/fixtures/**', '**/__fixtures__/**', '**/testdata/**', '**/__snapshots__/**'];
export const SIZE_LIMIT = 800;
// Level 1: docs, copy, styles (non-sensitive config is left out until A1 defines it).
export const LEVEL1 = ['docs/**', '*.md', '**/*.md', '*.css', '**/*.css', '**/*.scss', '**/locales/**', '**/i18n/**', '**/messages/**/*.json'];
export const NOT_LEVEL1 = ['docs/adr/**', 'docs/specs/**', 'docs/brief.md', '**/design.md', 'AGENTS.md', 'CLAUDE.md', '.claude/**', 'docs/rockbuilt/**'];
// Something the user sees: the auditor runs on level 2 only then (PLAN-1.0 A9).
export const USER_VISIBLE = ['**/*.tsx', '**/*.jsx', '**/*.vue', '**/*.svelte', '**/*.astro', '**/*.html', '**/*.css', '**/*.scss', '**/components/**', '**/pages/**', '**/app/**', '**/views/**', '**/templates/**', '**/public/**', '**/locales/**', '**/i18n/**', '**/messages/**'];
// Branches whose PRs the owner starts or approves by design today (DESIGN 9).
const OWNER_STARTED = /^(chore\/rockbuilt-|rb\/retro-|rb\/revert-)/;
const STRUCTURAL_BRANCH = /^rb\/(spec-|kickoff|adopt)/;

const LEVEL3_RULES = new Set(['auth-permissions-payments', 'sensitive-path', 'data-schema', 'infra-deploy-ci', 'harness-secrets', 'deletions']);

function patchAdded(patch) {
  if (patch == null) return null;
  return patch.split(/\r?\n/).filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
}

// Test files that only add: no deleted lines (PLAN-1.0 B1).
const addOnlyTest = (f) => isTestPath(f.path) && (f.deletions || 0) === 0;

export function levelOf(pr, current, autonomy) {
  const files = pr.files.map((f) => ({ ...f, path: normalizePath(f.path) }));
  const approvals = new Set();
  const level3 = new Set();
  let depCheck = false;
  for (const r of current.reasons) {
    if (r.rule === 'data-schema') approvals.add('structural: schema or migration');
    if (r.rule === 'architecture' || r.rule === 'spec') approvals.add('structural: architecture, ADR or spec');
    if (r.rule === 'deletions') approvals.add('irreversible: large deletion');
    if (r.rule === 'cost' && /imports paid SDK|secret-like env var/.test(r.detail)) approvals.add('cost: new paid service or key');
    if (r.rule === 'cost' && /patch too large/.test(r.detail)) level3.add('diff not readable');
    if (r.rule === 'dependency') {
      // Runtime dependencies added outside the design go to the automatic check (A7); dev and
      // test dependencies are free; a changed script, engine or other manifest field is level 3
      // (a changed test script can make CI green by construction).
      if (/\((dependencies|optionalDependencies|peerDependencies)\)/.test(r.detail) || !/package\.json$/.test(r.path)) depCheck = true;
      if (/\((scripts|overrides|resolutions|engines|packageManager|workspaces|pnpm)\)/.test(r.detail)) level3.add('manifest scripts or engines');
    }
    if (LEVEL3_RULES.has(r.rule)) level3.add(r.rule);
  }
  if (STRUCTURAL_BRANCH.test(pr.head || '')) approvals.add('structural: architecture, ADR or spec');
  const counted = files.filter((f) => !matchAny(f.path, BOOKKEEPING));
  const sizeLines = counted.filter((f) => !isTestPath(f.path) && !matchAny(f.path, FIXTURES)).reduce((s, f) => s + (f.additions || 0) + (f.deletions || 0), 0);
  if (sizeLines > SIZE_LIMIT) level3.add('size');
  const tierA = autonomy.tierAPaths || [];
  const level1 = counted.every((f) => (addOnlyTest(f) || matchAny(f.path, [...LEVEL1, ...tierA])) && !matchAny(f.path, NOT_LEVEL1));
  let level;
  if (level3.size) level = 3;
  else if (level1) level = 1;
  else level = 2;
  // A dependency check only runs on level 1 and 2 work that adds a runtime dependency.
  if (level === 1 && depCheck) level = 2;
  const visible = counted.some((f) => matchAny(f.path, USER_VISIBLE));
  return { level, approvals: [...approvals], level3: [...level3], depCheck, userVisible: visible, sizeLines, security: current.security.required };
}

// Agent runs for one pass. Today: A planner+implementer+verifier; B and C add the auditor, and
// the security reviewer when the diff needs it. 1.0: level 1 none; level 2 planner, implementer,
// verifier, the auditor when something visible changes (plus 1 in 5 by sampling) and security
// when the diff needs it; level 3 all five.
export function agentsToday(tier, security) {
  if (!tier) return 0;
  if (tier === 'A') return 3;
  return 4 + (security ? 1 : 0);
}
export function agentsNew(l) {
  if (l.level === 1) return 0;
  if (l.level === 3) return 5;
  return 3 + (l.userVisible ? 1 : 0.2) + (l.security ? 1 : 0);
}

// PLAN-1.0 A4: a paid service approved with a cap does not ask. rb risk matches exact service keys
// only, so "Anthropic API (monthly cap USD 20)" does not approve the anthropic key today; the
// replay also accepts the entry's first word ("Anthropic").
export function paidServicesFor(entries) {
  return [...entries, ...entries.map((e) => e.split(/[\s(:]/)[0]).filter(Boolean)];
}

export function replayRepo(data) {
  const parsed = parseAutonomy(data.agentsMd || '');
  const autonomy = { ...parsed, paidServices: paidServicesFor(parsed.paidServices) };
  const prs = [...data.prs].filter((p) => p.merged_at).sort((a, b) => Date.parse(a.merged_at) - Date.parse(b.merged_at));
  let corpus = '';
  const rows = [];
  for (const pr of prs) {
    const files = pr.files.map((f) => ({ path: f.path, previousPath: f.previousPath || null, status: f.status === 'removed' ? 'deleted' : f.status, additions: f.additions, deletions: f.deletions, added: patchAdded(f.patch) }));
    const taskFiles = files.filter((f) => !matchAny(normalizePath(f.path), BOOKKEEPING));
    const seen = corpus;
    const current = classify({
      files: taskFiles,
      packageJson: (p) => (pr.packageJson || {})[p] || null,
      baseHas: (s) => seen.includes(s),
      headText: () => null,
      autonomy,
    });
    const l = levelOf(pr, current, autonomy);
    const ownerStarted = OWNER_STARTED.test(pr.head || '');
    rows.push({
      number: pr.number,
      head: pr.head,
      merged: pr.merged_at,
      recordedTier: pr.tier || null,
      tierNow: current.tier,
      ...l,
      ownerStarted,
      asksOwner: l.approvals.length > 0 && !ownerStarted,
      agentsToday: agentsToday(pr.tier, current.security.required),
      agentsNew: pr.tier ? agentsNew(l) : 0,
    });
    corpus += files.map((f) => (f.added || []).join('\n')).join('\n');
  }
  const days = rows.map((r) => r.merged.slice(0, 10)).sort();
  const spanDays = days.length ? Math.round((Date.parse(days[days.length - 1]) - Date.parse(days[0])) / 86400000) + 1 : 0;
  const task = rows.filter((r) => r.recordedTier);
  const count = (xs, f) => xs.filter(f).length;
  const approvals = {};
  for (const r of rows) if (r.asksOwner) for (const a of r.approvals) approvals[a] = (approvals[a] || 0) + 1;
  const asks = count(rows, (r) => r.asksOwner);
  const escalations = data.escalations || 0;
  const round1 = (x) => Math.round(x * 10) / 10;
  return {
    merged: rows.length,
    taskPrs: task.length,
    spanDays,
    levels: { 1: count(rows, (r) => r.level === 1), 2: count(rows, (r) => r.level === 2), 3: count(rows, (r) => r.level === 3) },
    taskLevels: { 1: count(task, (r) => r.level === 1), 2: count(task, (r) => r.level === 2), 3: count(task, (r) => r.level === 3) },
    asksOwner: asks,
    asksOwnerShare: rows.length ? Math.round((asks / rows.length) * 100) : null,
    approvals,
    depChecks: count(rows, (r) => r.depCheck),
    interruptionsPerDay: {
      diffApprovals: spanDays ? round1(asks / spanDays) : null,
      withTodaysEscalations: spanDays ? round1((asks + escalations) / spanDays) : null,
    },
    agents: {
      today: round1(task.reduce((s, r) => s + r.agentsToday, 0)),
      new: round1(task.reduce((s, r) => s + r.agentsNew, 0)),
    },
    tierMismatch: count(task, (r) => r.recordedTier !== r.tierNow),
    rows,
  };
}

export function replay(dump) {
  return Object.fromEntries(Object.entries(dump).map(([repo, data]) => [repo, replayRepo(data)]));
}

export function toMarkdown(res, { prs = false } = {}) {
  const out = [];
  out.push('| Repo | Merged PRs | Level 1/2/3 | Task PRs level 1/2/3 | Ask the owner | Per day (diff only) | Per day (plus today\'s escalations) | Runtime dependency checks | Agent runs today | Agent runs 1.0 | Saved |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [repo, r] of Object.entries(res)) {
    const saved = r.agents.today ? `${Math.round((1 - r.agents.new / r.agents.today) * 100)}%` : '-';
    out.push(`| ${repo} | ${r.merged} | ${r.levels[1]}/${r.levels[2]}/${r.levels[3]} | ${r.taskLevels[1]}/${r.taskLevels[2]}/${r.taskLevels[3]} | ${r.asksOwner} (${r.asksOwnerShare}%) | ${r.interruptionsPerDay.diffApprovals} | ${r.interruptionsPerDay.withTodaysEscalations} | ${r.depChecks} | ${r.agents.today} | ${r.agents.new} | ${saved} |`);
  }
  out.push('');
  out.push('| Repo | Approval reason | PRs |');
  out.push('|---|---|---|');
  for (const [repo, r] of Object.entries(res)) for (const [k, v] of Object.entries(r.approvals).sort((a, b) => b[1] - a[1])) out.push(`| ${repo} | ${k} | ${v} |`);
  if (prs) {
    out.push('');
    out.push('| Repo | PR | Tier recorded | Tier now | Level | Why level 3 | Approval |');
    out.push('|---|---|---|---|---|---|---|');
    for (const [repo, r] of Object.entries(res)) for (const x of r.rows) out.push(`| ${repo} | ${x.number} | ${x.recordedTier || '-'} | ${x.tierNow} | ${x.level} | ${x.level3.join(', ')} | ${x.asksOwner ? x.approvals.join(', ') : ''} |`);
  }
  return out.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file || file === '--help') {
    console.log('Usage: node evals/tools/replay-levels.mjs <dump.json> [--md] [--prs]');
    process.exit(file ? 0 : 1);
  }
  const res = replay(JSON.parse(readFileSync(file, 'utf8')));
  if (process.argv.includes('--md')) console.log(toMarkdown(res, { prs: process.argv.includes('--prs') }));
  else console.log(JSON.stringify(res, (k, v) => (k === 'rows' && !process.argv.includes('--prs') ? undefined : v), 2));
}

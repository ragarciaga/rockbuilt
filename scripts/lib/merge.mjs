// rb merge-gate (DESIGN.md section 8) and rb revert. The only merge path of the harness.
import { appendFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { holdsLock, stopStatus } from './control.mjs';
import { GhError, ops } from './gh.mjs';
import { defaultBranch, resolveBaseRef } from './repo.mjs';
import { headerField, readContract } from './contract.mjs';
import { BOOKKEEPING_FILE } from './bookkeeping.mjs';
import { parseQueueRecord } from './queue.mjs';
import { classify, isTestPath, normalizePatch, samePatches } from './delta.mjs';
import { APPROVAL_REASONS, computeRisk, maxTier, tierRank } from './risk.mjs';
import { approvalStatus } from './approval.mjs';
import { dependencyCheck } from './deps.mjs';
import { inventoryProblems } from './inventory.mjs';
import { ensureControl } from './control.mjs';
import { CliError, git, now, sleepMs } from './util.mjs';
import { matchAny } from './glob.mjs';

const BLOCKING_LABELS = ['rb:needs-human', 'rb:blocked', 'rb:hold'];
const LEVEL_OF_TIER = { A: 1, B: 2, C: 3 };
// PLAN-1.0 B2: one in five level 2 PRs without a visible change still gets the blind auditor.
export const AUDIT_SAMPLE = 5;
const OK_CONCLUSIONS = ['success', 'neutral', 'skipped'];
export const CI_CHECK = 'rockbuilt-ci';

// The CI evidence must be a check run created by GitHub Actions and concluded success. A commit status
// with the same name proves nothing: any token with repo access can post one.
// With an `## E2E` section the `rockbuilt-e2e` check must exist and pass: since E2E runs in shards
// behind a plan job, its check runs appear late, and "every present check is green" alone could
// be read before they exist.
export const E2E_CHECK = 'rockbuilt-e2e';
function e2eRequired(root, checks, no, baseText = null) {
  const text = baseText ?? readContract(root).text;
  if (!/^##\s+E2E\s*$/m.test(text || '')) return;
  const ok = checks.some((x) => x.name === E2E_CHECK && x.source === 'check-run' && x.app === 'github-actions' && x.status === 'completed' && x.conclusion === 'success');
  if (!ok) no('e2e', `no successful ${E2E_CHECK} check run on the head (AGENTS.md has ## E2E)`);
}

export function ciPassed(checks) {
  return checks.some((x) => (x.name === CI_CHECK || x.name.startsWith(`${CI_CHECK} `) || x.name.startsWith(`${CI_CHECK}/`))
    && x.source === 'check-run' && x.app === 'github-actions' && x.status === 'completed' && x.conclusion === 'success');
}

const TRUSTED_ASSOC = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

// Every status line in a text, in order, as { stage, outcome, head, ... }.
export function parseStatusList(text) {
  return [...String(text || '').matchAll(/<!--\s*rockbuilt:status\s+([^>]*?)\s*-->/g)]
    .map((m) => Object.fromEntries([...m[1].matchAll(/([\w-]+)=(\S+)/g)].map((x) => [x[1], x[2]])))
    .filter((kv) => kv.stage);
}
function parseStatusLines(text) {
  return Object.fromEntries(parseStatusList(text).map((kv, i) => [i, kv]));
}

// Machine lines in a PR body: last status line per stage, tier line, security flag.
export function parseBody(body) {
  const status = {};
  for (const kv of parseStatusList(body)) status[kv.stage] = kv;
  const tier = (String(body || '').match(/<!--\s*rockbuilt:tier\s+([ABC])\s*-->/i) || [])[1];
  const security = /<!--\s*rockbuilt:security\s+required\s*-->/i.test(body || '') || /^\s*security:\s*required\s*$/mi.test(body || '');
  const closes = [...String(body || '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi)].map((m) => Number(m[1]));
  const partOf = [...String(body || '').matchAll(/\bpart of\s+#(\d+)/gi)].map((m) => Number(m[1]));
  const quick = /<!--\s*rockbuilt:quick\s*-->/i.test(body || '');
  const lv = (String(body || '').match(/<!--\s*rockbuilt:level\s+([123])\s*-->/i) || [])[1];
  const level = lv ? Number(lv) : tier ? LEVEL_OF_TIER[tier.toUpperCase()] : null;
  // PLAN-1.0 D1: a quick batch of existing issues names them on one line; the batch issue stays the
  // single task issue and the gate closes the others after the merge.
  const bm = String(body || '').match(/<!--\s*rockbuilt:batch\s+([\d,\s#]+?)\s*-->/);
  const batch = bm ? [...new Set(bm[1].split(/[,\s]+/).map((x) => Number(x.replace('#', ''))).filter((n) => Number.isInteger(n) && n > 0))] : [];
  return { status, tier: tier ? tier.toUpperCase() : null, level, security, quick, batch, closes: [...new Set(closes)], partOf: [...new Set(partOf)] };
}

function shaMatches(given, head) {
  return Boolean(given && head && given.length >= 7 && head.toLowerCase().startsWith(given.toLowerCase()));
}

// Two SHAs (either may be abbreviated, 7+ chars) name the same commit.
function sameSha(a, b) {
  if (!a || !b || a.length < 7 || b.length < 7) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

// DESIGN 8.3, the gate's own check (never the verifier's word): for every path the task touched at
// the reviewed head (compare base...reviewed) or touches now (compare base...head), the blob at the
// reviewed head equals the blob at the current head. Paths missing from one listing are read with
// the contents API. 300 files (the compare API truncates) or more than 40 lookups: not confirmed.
// Returns { class: identical | test-only | different, detail }.
export function reviewedChange(c, baseRef, reviewedHead, head) {
  try {
    const before = ops.compareFiles(c, baseRef, reviewedHead);
    const after = ops.compareFiles(c, baseRef, head);
    if (before.truncated || after.truncated) return { class: 'different', detail: 'too many files to compare (300+)' };
    if (!before.files.length) return { class: 'different', detail: `the reviewed head ${String(reviewedHead).slice(0, 7)} has no diff against the base (or is unknown)` };
    const blob = (f) => (f.status === 'removed' ? null : f.sha || undefined);
    // A rename removes the previous path on that side: it is a touched path too (moving app code
    // under tests/ must not read as test-only).
    const side = (files) => {
      const m = new Map(files.map((f) => [f.filename, blob(f)]));
      for (const f of files) if (f.previous && !m.has(f.previous)) m.set(f.previous, null);
      return m;
    };
    const atOld = side(before.files);
    const atNow = side(after.files);
    const touched = [...new Set([...atOld.keys(), ...atNow.keys()])].sort();
    let lookups = 0;
    const read = (map, p, ref) => {
      if (map.has(p) && map.get(p) !== undefined) return map.get(p);
      if (++lookups > 40) throw new Error('too many files to look up');
      const sha = ops.blobSha(c, p, ref);
      map.set(p, sha);
      return sha;
    };
    const differing = touched.filter((p) => read(atOld, p, reviewedHead) !== read(atNow, p, head));
    const cls = classify(differing);
    if (cls !== 'identical') {
      // The same task diff on a base that moved elsewhere (rockbuilt #24): compare the patches.
      const patches = (files) => new Map(files.map((f) => [f.filename, typeof f.patch === 'string' ? normalizePatch(f.patch) : null]));
      if (samePatches(patches(before.files), patches(after.files))) return { class: 'identical', detail: 'same task diff as reviewed (the base changed other parts)' };
    }
    if (cls === 'identical') return { class: cls, detail: `${touched.length} touched file(s), same content as reviewed` };
    if (cls === 'test-only') return { class: cls, detail: `only test files changed: ${differing.slice(0, 3).join(', ')}` };
    return { class: cls, detail: `app files changed: ${differing.filter((p) => !isTestPath(p)).slice(0, 3).join(', ')}` };
  } catch (e) {
    return { class: 'different', detail: `compare failed: ${e.message}` };
  }
}

// DESIGN 8.4: a PR behind its base is still current when it sits in a merge queue and what the
// squash will land is exactly what CI ran. Never taken from the record, all through GitHub:
// - the PR head is still the queued head, and the step is a merge whose second parent is it;
// - GitHub's own test merge of the PR (merge_commit_sha, recomputed on every base change) is a
//   merge of the current base tip and this head with exactly the step's tree: a squash lands that
//   tree. This holds against stacked PRs, a merge from outside the queue, a local git that merges
//   differently, and a forged step;
// - every check on the step passed, E2E included when the project has it.
export function queuedBehind(root, c, view, head) {
  let rec = null;
  try {
    const trusted = ops.issueComments(c, view.number).filter((cm) => ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(cm.author_association));
    for (const cm of trusted) { const r = parseQueueRecord(cm.body); if (r) rec = r; }
  } catch (e) {
    return { ok: false, detail: `could not read comments: ${e.message}` };
  }
  if (!rec) return null;
  const fail = (detail, retry = false) => ({ ok: false, record: rec, detail, retry });
  if (!rec['pr-head'] || !sameSha(rec['pr-head'], head)) return fail('the PR head changed after it was queued');
  try {
    const step = ops.commitInfo(c, rec.step);
    if (step.parents.length !== 2 || !sameSha(step.parents[1], head)) return fail('the queue step is not a merge of this PR head');
    if (view.mergeable !== true || !view.merge_commit_sha) return fail('GitHub has not computed the test merge yet; retry', true);
    const tip = ops.commitInfo(c, view.base.ref);
    const tm = ops.commitInfo(c, view.merge_commit_sha);
    if (tm.parents.length !== 2 || !sameSha(tm.parents[0], tip.sha) || !sameSha(tm.parents[1], head)) return fail('GitHub\'s test merge is not of the current base tip yet; retry', true);
    if (!tm.tree || tm.tree !== step.tree) return fail(`the merge GitHub would land differs from the tested queue step (${view.base.ref} gained something else, or the PR is stacked)`);
    // Only the push run on the record's own queue branch counts: a pull_request run attaches its
    // check runs to the head sha but tests refs/pull/N/merge, another tree. The workflow run's
    // conclusion covers every job in it (E2E shards and their aggregator included).
    const runs = ops.workflowRuns(c, { headSha: rec.step, event: 'push' }).filter((r) => r.name === CI_CHECK && r.branch === rec.branch && sameSha(r.sha, rec.step));
    if (!runs.length) return fail(`no ${CI_CHECK} push run on ${rec.branch} yet`, true);
    const latest = runs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    if (latest.status !== 'completed') return fail(`${CI_CHECK} on ${rec.branch} is ${latest.status}`, true);
    if (latest.conclusion !== 'success') return fail(`${CI_CHECK} on ${rec.branch} concluded ${latest.conclusion}`);
    return { ok: true, record: { ...rec, stepTree: step.tree } };
  } catch (e) {
    return fail(e.message);
  }
}

// PR kinds that carry no reviewer lines (DESIGN 8.1). Bookkeeping may merge unattended when it only
// touches bookkeeping files and LESSONS.md only grows; the rest need the human.
const BOOKKEEPING_PREFIX = 'rb/bookkeeping-';
const HUMAN_ONLY_PREFIXES = ['rb/revert-', 'rb/spec-', 'rb/verify-', 'rb/attack-', 'rb/kickoff', 'rb/adopt', 'rb/retro-', 'chore/rockbuilt-'];

const KIND_FILES = [
  ['rb/spec-', ['docs/specs/**', 'docs/adr/**', 'docs/research/**', 'docs/v2.md', 'docs/brief.md', 'AGENTS.md']],
  // PLAN-1.0 H: the attack report and the probe definitions; fixes go through /rb-fix.
  ['rb/attack-', ['docs/security/**', 'AGENTS.md']],
  ['rb/verify-', ['docs/specs/**', 'e2e/**', 'playwright.config.*', 'evals/**', '.gitignore', 'package.json', 'package-lock.json']],
];

// PLAN-1.0 G1 and G3: an exploration branch never merges; a feature branch carries reviewed level 2
// tasks to the default branch once, with the auditor and the security review on the whole.
export const FEATURE_BRANCH = /^rb\/feature-[A-Za-z0-9._-]+$/;
const EXPLORE_PREFIX = 'rb/explore-';

export function prKind(headRef) {
  const ref = String(headRef || '');
  if (ref.startsWith(EXPLORE_PREFIX)) return 'explore';
  if (FEATURE_BRANCH.test(ref)) return 'feature';
  if (ref.startsWith(BOOKKEEPING_PREFIX)) return 'bookkeeping';
  if (HUMAN_ONLY_PREFIXES.some((p) => ref.startsWith(p))) return 'human-only';
  return 'task';
}

// PLAN-1.0 G4: the review profile from the AGENTS.md header (`Profile: full | minimal | none`).
// `none` means the project runs without the harness; if the gate runs anyway it applies `full`.
export const PROFILES = ['full', 'minimal', 'none'];
export function featureReviewOn(contractText) {
  return /^on\b/i.test(headerField(contractText, 'Feature review') || '');
}

export function profileOf(contractText) {
  const v = (headerField(contractText, 'Profile') || '').toLowerCase().split(/\s/)[0];
  return v === 'minimal' ? 'minimal' : 'full';
}

// The reviews a PR needs (DESIGN 29.7, 33). Full profile: level 1 none; level 2 the verifier, plus
// the blind auditor when something visible changes, the head is sampled or the user asked for it
// (rb/B<n>, rb/Q<n>), but never on a task into a feature branch (G3: the feature PR gets it once);
// level 3 all three. Minimal profile: levels 1 and 2 CI only, level 3 the verifier and the security
// review. A feature PR needs the auditor and the security review on the whole feature. The security
// review the diff requires (rb risk) is added by the caller in every case.
export function requiredReviews({ level, profile = 'full', userVisible = false, sampled = false, askedByUser = false, featureBase = false, feature = false }) {
  if (feature) return ['rb-auditor', 'rb-security-reviewer'];
  if (profile === 'minimal') return level === 3 ? ['rb-verifier', 'rb-security-reviewer'] : [];
  const need = [];
  if (level >= 2) need.push('rb-verifier');
  if (!featureBase && (level === 3 || (level === 2 && (userVisible || sampled || askedByUser)))) need.push('rb-auditor');
  if (level === 3) need.push('rb-security-reviewer');
  return need;
}

// PLAN-1.0 G3: everything a feature PR brings to the default branch came through the gate. Every
// commit in default...head is either the squash of a task PR merged into this feature branch by
// `rb merge-gate` (its trusted merge comment), or a merge whose other parent is already on the
// default branch (updating the feature branch). A direct push to the feature branch is refused.
// A merge must be GitHub's own update of the branch (signed web-flow), so it carries no edits of
// its own; a conflict resolved in GitHub's editor by a person is the known limit.
const GATE_MERGED = /^Merged by `rb merge-gate`/;
export function featureProvenance(c, view, branch, no) {
  const ref = view.head.ref;
  let commits;
  try {
    commits = ops.compareCommits(c, branch, view.head.sha);
  } catch (e) {
    no('feature-provenance', `could not list the commits of ${ref}: ${e.message}`);
    return;
  }
  if (commits.truncated) { no('feature-provenance', `${ref} has more commits than GitHub lists (${commits.total}): split the feature`); return; }
  if (!commits.list.length) { no('feature-provenance', `${ref} has no commits ahead of ${branch}`); return; }
  let merged;
  try {
    merged = ops.prList(c, { state: 'closed', base: ref }).filter((p) => p.merged_at && p.merge_commit_sha && p.base && p.base.ref === ref);
  } catch (e) {
    no('feature-provenance', `could not list the PRs merged into ${ref}: ${e.message}`);
    return;
  }
  const bySha = new Map(merged.map((p) => [String(p.merge_commit_sha).toLowerCase(), p]));
  for (const cm of commits.list) {
    const short = String(cm.sha).slice(0, 7);
    if (cm.parents.length === 1) {
      const p = bySha.get(String(cm.sha).toLowerCase());
      if (!p) { no('feature-provenance', `commit ${short} on ${ref} is not a task PR merged by the gate: build it as a task into ${ref}`); continue; }
      let byGate = false;
      try { byGate = ops.issueComments(c, p.number).some((x) => TRUSTED_ASSOC.has(x.author_association) && GATE_MERGED.test(x.body || '')); } catch { byGate = false; }
      if (!byGate) no('feature-provenance', `#${p.number} was merged into ${ref} outside rb merge-gate`);
    } else if (cm.parents.length === 2) {
      let fromDefault = false;
      for (const parent of cm.parents) {
        try {
          const st = ops.compare(c, parent, branch).status;
          if (st === 'ahead' || st === 'identical') fromDefault = true;
        } catch { /* not readable: not confirmed */ }
      }
      if (!fromDefault) { no('feature-provenance', `merge ${short} on ${ref} does not bring in ${branch}`); continue; }
      // Only GitHub's own update of the branch (rb gh pr-update-branch), which GitHub signs as
      // web-flow: a merge made anywhere else can carry edits of its own (review of 1.4.0).
      let info = null;
      try { info = ops.commitInfo(c, cm.sha); } catch { info = null; }
      if (!info || !info.verified || info.committer !== 'web-flow') no('feature-provenance', `merge ${short} on ${ref} was not made by GitHub (rb gh pr-update-branch): a merge made elsewhere can carry its own edits`);
    } else no('feature-provenance', `commit ${short} on ${ref} has ${cm.parents.length} parents`);
  }
}

// True when every file is a bookkeeping file and LESSONS.md has no removed lines.
// Lines a bookkeeping PR may add or remove in an existing tasks.md: task status and decision-log entries.
const TASKS_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:Status|Estado)(?:\*\*)?\s*:|^\s*-\s*\d{4}-\d{2}-\d{2}\b|^\s*$/i;

function patchLines(patch) {
  const lines = String(patch).split('\n').filter((l) => !l.startsWith('+++') && !l.startsWith('---') && !l.startsWith('@@'));
  return { added: lines.filter((l) => l.startsWith('+')).map((l) => l.slice(1)), removed: lines.filter((l) => l.startsWith('-')).map((l) => l.slice(1)) };
}

// True when every file is an in-place edit of a bookkeeping file: no renames or deletions, a readable
// patch, tasks.md changes limited to status and decision-log lines, LESSONS.md only growing.
export function bookkeepingOnly(files) {
  if (!files.length) return false;
  for (const f of files) {
    const name = f.path || f.filename;
    if (!BOOKKEEPING_FILE.test(name)) return false;
    if (f.previous_path || f.previousPath) return false;
    if (f.patch == null) return false;
    const { added, removed } = patchLines(f.patch);
    // Every run reads these files and injects LESSONS into agent prompts: no hidden HTML comments
    // (invisible on GitHub, could carry instructions or forged markers).
    if (added.some((l) => /<!--|-->/.test(l))) return false;
    if (name === '.claude/LESSONS.md') {
      if (f.status !== 'modified' && f.status !== 'added') return false;
      if (removed.length) return false;
      // Append only: one hunk, at the end of the file, at most 120 new lines per PR (a day's
      // bookkeeping PR collects several runs; a run adds 1 to 3 lessons of 1 to 3 lines).
      const hunks = String(f.patch).split('\n').filter((l) => l.startsWith('@@'));
      if (hunks.length > 1 || added.length > 120) return false;
      const after = String(f.patch).split(/^@@[^\n]*@@[^\n]*\n?/m)[1] || '';
      const lines = after.split('\n').filter((l) => l !== '' && l !== '\\ No newline at end of file');
      const firstAdded = lines.findIndex((l) => l.startsWith('+'));
      if (firstAdded !== -1 && lines.slice(firstAdded).some((l) => !l.startsWith('+'))) return false;
    } else if (name === 'docs/progress.md') {
      if (f.status !== 'modified' && f.status !== 'added') return false;
    } else {
      if (f.status !== 'modified') return false;
      if (![...added, ...removed].every((l) => TASKS_LINE.test(l))) return false;
    }
  }
  return true;
}

// PLAN-1.0 A8: rb:level-1/2/3; the old tier labels still count during the transition.
export function labelLevel(labels) {
  const lv = [3, 2, 1].find((n) => labels.includes(`rb:level-${n}`)) || 0;
  const t = labelTier(labels);
  const n = Math.max(lv, t ? LEVEL_OF_TIER[t] : 0);
  return n || null;
}

function labelTier(labels) {
  if (labels.includes('rb:tier-c')) return 'C';
  if (labels.includes('rb:tier-b')) return 'B';
  if (labels.includes('rb:tier-a')) return 'A';
  return null;
}

// Evaluates every condition; returns { eligible, reasons, ... }. Never merges.
export function evaluateGate(root, c, pr, { run = null, humanApproved = false, dryRun = false, retryMs = Number(process.env.RB_MERGEABLE_RETRY_MS ?? 3000) } = {}) {
  const reasons = [];
  const no = (rule, detail) => reasons.push({ rule, detail });
  let view = ops.prView(c, pr);
  if (view.state === 'open' && view.mergeable === null && retryMs > 0) {
    sleepMs(retryMs);
    view = ops.prView(c, pr);
  }
  const head = view.head ? view.head.sha : null;
  const branch = defaultBranch(root);

  const kind = prKind(view.head && view.head.ref);
  // PLAN-1.0 G3: a task PR may target a feature branch (rb/feature-*) instead of the default branch.
  const featureBase = kind === 'task' && Boolean(view.base) && FEATURE_BRANCH.test(view.base.ref);

  // 1. Open, not draft, base is the default branch (or a feature branch for a task), mergeable.
  if (view.state !== 'open' || view.merged) no('open', `PR is ${view.merged ? 'merged' : view.state}`);
  if (view.draft) no('draft', 'PR is a draft');
  if (!view.base || (view.base.ref !== branch && !featureBase)) no('base', `base is ${view.base ? view.base.ref : '?'}, not ${branch}`);
  if (view.mergeable !== true) no('mergeable', view.mergeable === false ? `not mergeable (${view.mergeable_state || 'conflict'})` : 'mergeability not computed yet; retry');
  // The PR must contain the current tip of the base: CI and reviews ran on that code. Without branch
  // protection GitHub reports "clean" or "unstable" for a PR that is behind (seen live), so compare.
  // Bookkeeping PRs are exempt: they only touch docs the gate inspects line by line, so a CI run on
  // an older base proves the same thing (and the cycle opens them at night's end, behind by design).
  // A task PR is also exempt when everything the base gained since the PR's merge base is
  // bookkeeping (tasks.md status, progress.md, LESSONS.md) and the PR touches none of it: no code
  // the PR runs with changed, so its CI and reviews still describe the squash result (3d_brain,
  // 2026-10-15: #165 and #167 re-ran CI and a verifier only because a bookkeeping PR merged first).
  let behindExempt = null;
  if (view.base && head && prKind(view.head && view.head.ref) !== 'bookkeeping') {
    try {
      const cmp = ops.compare(c, view.base.ref, head);
      if (cmp.behindBy > 0) {
        const gained = ops.compareFiles(c, head, view.base.ref);
        const own = ops.compareFiles(c, view.base.ref, head);
        const docsOnly = !gained.truncated && !own.truncated && gained.files.length > 0
          && gained.files.every((f) => BOOKKEEPING_FILE.test(f.filename) && f.status === 'modified' && !f.previous)
          && !own.files.some((f) => BOOKKEEPING_FILE.test(f.filename) || (f.previous && BOOKKEEPING_FILE.test(f.previous)));
        const queued = docsOnly ? null : queuedBehind(root, c, view, head);
        if (docsOnly) behindExempt = { behindBy: cmp.behindBy, files: gained.files.map((f) => f.filename) };
        else if (queued && queued.ok) behindExempt = { behindBy: cmp.behindBy, queue: queued.record };
        else if (queued && queued.retry) no('queue-pending', `queued, not ready yet: ${queued.detail}`);
        else no('behind', `PR is ${cmp.behindBy} commit(s) behind ${view.base.ref} with code changes${queued ? ` (merge queue not confirmed: ${queued.detail})` : ''}: update the branch (rb gh pr-update-branch), let CI re-run, re-review the new head`);
      }
    } catch (e) {
      no('behind', `could not compare with ${view.base.ref}: ${e.message}`);
    }
  }

  if (kind !== 'task' && kind !== 'feature') return evaluateSpecialKind(root, c, view, kind, { run, humanApproved, no, reasons, head, dryRun });
  const feature = kind === 'feature';

  // The rules come from AGENTS.md at the PR base (A5); for a task into a feature branch, from the
  // default branch, since nothing on a feature branch is reviewed as a whole yet.
  let baseContract = null;
  try { baseContract = view.base && view.base.sha ? ops.fileAt(c, 'AGENTS.md', featureBase ? branch : view.base.sha) : null; } catch { baseContract = null; }
  const profile = profileOf(baseContract);
  // A feature branch only exists when the project turned it on, read where nothing can loosen it.
  if ((featureBase || feature) && !featureReviewOn(baseContract)) no('feature-review', `\`Feature review: on\` is not in AGENTS.md on ${branch}: ${feature ? 'merge the tasks to it one by one' : `open the PR against ${branch}`}`);

  // 2. Labels (PLAN-1.0 A8). Approval waits on the owner's comment, not on a label. A feature PR
  // carries no level: each task in it passed the gate with its own.
  const lt = feature ? null : labelTier(view.labels);
  const ll = feature ? null : labelLevel(view.labels);
  if (!ll && !feature) no('level-label', 'no rb:level-1 / rb:level-2 / rb:level-3 label');
  for (const l of BLOCKING_LABELS) if (view.labels.includes(l)) no('blocking-label', `carries ${l}`);

  // 3. Live level no higher than the label (and the declared level line).
  let risk = null;
  try {
    risk = computeRisk(root, { pr: view.number, gh: c, ...(featureBase ? { rulesRef: branch } : {}) });
  } catch (e) {
    no('risk', `rb risk failed: ${e.message}`);
  }
  // A feature PR holds only level 1 and 2 tasks that asked nothing of the owner: its whole diff
  // must say the same, apart from size (review of 1.4.0: a forged merge commit brought level 3
  // code with no verifier and no approval).
  if (feature && risk) {
    const l3 = (risk.levelReasons || []).filter((r) => r.rule !== 'size');
    if (l3.length) no('feature-level', `the feature diff has level 3 content (${l3.slice(0, 3).map((r) => `${r.rule} ${r.path}`.trim()).join('; ')}): level 3 work never goes through a feature branch`);
    if ((risk.approvals || []).length) no('feature-level', `the feature diff needs the owner (${risk.approvals.map((a) => `${a.reason} ${a.path}`.trim()).slice(0, 3).join('; ')}): such a task never goes through a feature branch`);
    if ((risk.checks || []).includes('dependency')) {
      let d = null;
      try { d = dependencyCheck(root, risk, { ref: view.base && view.base.sha }); } catch (e) { d = { ok: false }; }
      if (!d.ok) no('feature-level', 'a runtime dependency in the feature diff does not pass the automatic check');
    }
  }
  const body = parseBody(view.body);
  if (risk && ll && risk.level > ll) no('risk', `rb risk says level ${risk.level} but the label is level ${ll}: ${(risk.levelReasons || []).slice(0, 3).map((r) => `${r.rule} ${r.path}`.trim()).join('; ') || 'not tests, docs, styles or copy'}`);
  if (body.level && ll && body.level > ll) no('declared-level', `body declares level ${body.level} but the label is level ${ll}`);
  // DESIGN 26: a quick batch (no planner) merges only while the live diff is within the quick
  // limits; a batch that grew needs a plan (/rb-build) or a split, even with the owner's word.
  if (body.quick && risk && risk.quick && !risk.quick.eligible) no('quick', `quick batch outside quick mode: ${risk.quick.reasons.join('; ')}. Split it, or plan the rest with /rb-build and drop <!-- rockbuilt:quick --> once rb-planner's plan is on the issue`);
  const level = feature ? null : Math.max(ll || 1, risk ? risk.level : 1, body.level || 1);
  if (featureBase && risk && (risk.approvals || []).length) no('feature-base', `a task that needs the owner (${risk.approvals.map((a) => a.reason).join(', ')}) never goes through a feature branch: open it against ${branch}`);
  const tier = feature ? 'B' : maxTier(lt || 'A', risk ? risk.tier : 'A', body.tier || 'A');
  // PLAN-1.0 G3: a level 3 task never goes through a feature branch.
  if (featureBase && level === 3) no('feature-base', `a level 3 task never goes through a feature branch: open it against ${branch}`);

  // 4. Reviewer lines with head equal to the PR head (requiredReviews, shared with the skills).
  // Sampled by the head commit, which the agent cannot pick the way it can pick a PR number.
  const sampled = Boolean(head) && Number.parseInt(String(head).slice(0, 8), 16) % AUDIT_SAMPLE === 0;
  // A bug fix (rb/B<n>) or an owner's quick request (rb/Q<n>) describes what the user sees: the blind
  // auditor always checks it.
  const askedByUser = /^rb\/[BQ]\d+/.test((view.head && view.head.ref) || '');
  const need = requiredReviews({ level, profile, userVisible: Boolean(risk && risk.userVisible), sampled, askedByUser, featureBase, feature });
  if (feature) featureProvenance(c, view, branch, no);
  // rockbuilt #42: the diff decides too. A PR that rb risk says needs the security review gets it
  // whatever its body says; the plan can only add the review, never drop it.
  const secByDiff = Boolean(risk && risk.security && risk.security.required);
  if ((body.security || secByDiff) && !need.includes('rb-security-reviewer')) {
    if (!need.includes('rb-verifier')) need.push('rb-verifier');
    need.push('rb-security-reviewer');
  }
  if (secByDiff && !body.security) no('security', `rb risk requires the security review (${risk.security.reasons.slice(0, 3).map((x) => `${x.detail} ${x.path}`.trim()).join('; ')}): run rb-security-reviewer and add <!-- rockbuilt:security required --> with its line`);
  // A verifier pass on the current head may name the head the other reviewers saw:
  // `identical-to=<sha>` (no touched file changed since; the verifier ran its identity check) or
  // `app-identical-to=<sha>` (only test files changed; the verifier re-verified them). Auditor and
  // security lines on that older head then still hold, once the gate itself confirms the class
  // through GitHub (DESIGN 8.3).
  // Both keys may appear when the auditor and the security review sit on different heads.
  // test-only carries the auditor (it judged the running app, unchanged) but never the security
  // review: test code runs in CI with the workflow's secrets and was not looked at.
  const ver = body.status['rb-verifier'];
  const identity = new Map();
  const changeSince = (from) => {
    if (!identity.has(from)) identity.set(from, reviewedChange(c, view.base.ref, from, head));
    return identity.get(from);
  };
  // rockbuilt #43: a review line on an older head still describes the PR when the gate itself finds
  // the task's change identical since that head (only merges from the base that touch none of the
  // task's files). No agent re-confirms it and nobody edits the line; CI on the new head covers the
  // merged result.
  const sameChange = (lineHead) => Boolean(lineHead) && !shaMatches(lineHead, head) && changeSince(lineHead).class === 'identical';
  const verOk = ver && ver.outcome === 'pass' && (shaMatches(ver.head, head) || sameChange(ver.head));
  const carryFor = (stage, lineHead) => {
    if (!verOk) return null;
    if (ver['identical-to'] && sameSha(lineHead, ver['identical-to'])) return { from: ver['identical-to'], allowed: ['identical'] };
    if (ver['app-identical-to'] && sameSha(lineHead, ver['app-identical-to'])) return { from: ver['app-identical-to'], allowed: stage === 'rb-security-reviewer' ? ['identical'] : ['identical', 'test-only'] };
    return null;
  };
  // An `identical-to` verifier line (written by the verifier's identity check or by
  // `rb review-delta --line`) is checked even when no other line sits on that head (tier A).
  if (verOk && ver['identical-to']) {
    const id = changeSince(ver['identical-to']);
    if (id.class !== 'identical') no('stale-head', `the verifier line says identical to ${ver['identical-to']}, but the gate finds the change ${id.class} (${id.detail}): re-review`);
  }
  for (const stage of need) {
    const s = body.status[stage];
    if (!s) no('status-line', `missing ${stage} line`);
    // needs-local: the auditor could not observe a criterion in the cloud; the human checked it on
    // their machine and asked for the merge in the current conversation.
    else if (s.outcome !== 'pass' && !(stage === 'rb-auditor' && s.outcome === 'needs-local' && humanApproved)) no('status-line', `${stage} outcome=${s.outcome}`);
    else if (!shaMatches(s.head, head)) {
      const carry = stage !== 'rb-verifier' ? carryFor(stage, s.head) : null;
      if (sameChange(s.head)) continue;
      if (carry) {
        const id = changeSince(carry.from);
        if (!carry.allowed.includes(id.class)) no('stale-head', `${stage} reviewed ${s.head}; the verifier carries it forward, but the gate finds the change ${id.class} (${id.detail}): re-review`);
      } else no('stale-head', `${stage} reviewed ${s.head || '?'}, PR head is ${head}`);
    }
  }

  // 4b. Every review line in the body matches a verdict posted on the task issue (rockbuilt #34):
  // the issue is the record of every pass and fail, which is what rb quality counts. Lines that
  // rb wrote itself (a `by=rb-review-delta` verifier line with `identical-to`) are re-checked
  // above, not posted. A task PR names its issue (`Closes #n`, or `Part of #n` for a partial PR).
  // `F5-T14` (a run's own prefix) names the spec task `T14` (rockbuilt #47).
  const sameTask = (a, b) => {
    if (!a || !b) return true;
    const x = String(a).toLowerCase();
    const y = String(b).toLowerCase();
    return x === y || x.endsWith(`-${y}`) || y.endsWith(`-${x}`);
  };
  const taskIssues = body.closes.length ? body.closes : body.partOf;
  // One task issue per PR, open, and the same task (adversarial review of 1.0): a second Closes
  // rode on the first issue's approval and was closed unreviewed; an old approved issue could
  // lend its approval to any PR that named it.
  const allIssues = [...new Set([...body.closes, ...body.partOf])];
  if (allIssues.length > 1) no('task-issue', `the body names ${allIssues.map((n) => `#${n}`).join(', ')}: a task PR closes exactly one issue`);
  // PLAN-1.0 A5 and A6: the closed-list approvals (rb risk, plus auth-model when the plan declares
  // it) need the owner's comment on the plan or a delegation that covers the task. Never a flag.
  let issueView = null;
  if (taskIssues.length) {
    try { issueView = ops.issueView(c, taskIssues[0]); } catch (e) { no('approval', `could not read #${taskIssues[0]}: ${e.message}`); }
  }
  if (issueView) {
    if (issueView.state && issueView.state !== 'open') no('task-issue', `#${taskIssues[0]} is ${issueView.state}`);
    if (feature && !(issueView.labels || []).includes('rb:feature')) no('task-issue', `#${taskIssues[0]} is not a feature issue (rb:feature)`);
    const prTask = (String(view.body || '').match(/<!--\s*rockbuilt:task\s+([A-Za-z0-9_-]+)/) || [])[1];
    const issueTask = (String(issueView.body || '').match(/<!--\s*rockbuilt:task\s+([A-Za-z0-9_-]+)/) || [])[1];
    if (prTask && issueTask && !sameTask(prTask, issueTask)) no('task-issue', `the PR is task ${prTask} but #${taskIssues[0]} is task ${issueTask}`);
  }
  // PLAN-1.0 D1: issues batched into a quick PR are open work items that wait for nobody.
  if (body.batch.length) {
    if (!body.quick) no('batch', 'a batch line (rockbuilt:batch) is only for quick batches');
    for (const n of body.batch) {
      if (allIssues.includes(n)) continue;
      let bi = null;
      try { bi = ops.issueView(c, n); } catch (e) { no('batch', `could not read #${n}: ${e.message}`); continue; }
      const held = ['rb:approval-pending', 'rb:needs-human', 'rb:needs-local', 'rb:hold', 'rb:blocked', 'rb:unplanned', 'rb:parked', 'rb:pr-open', 'rb:in-progress'].filter((l) => bi.labels.includes(l));
      if (bi.state !== 'open') no('batch', `batched #${n} is ${bi.state}`);
      else if (held.length) no('batch', `batched #${n} carries ${held.join(', ')}`);
      else if (!bi.labels.some((l) => ['rb:task', 'rb:bug'].includes(l))) no('batch', `batched #${n} is not an rb:task or rb:bug issue`);
      else if (/<!--\s*rockbuilt:task\s+\S+\s+spec=docs\//.test(bi.body || '')) no('batch', `batched #${n} is a spec task: spec tasks are built from tasks.md, never batched`);
    }
  }
  const planLine = issueView ? [...issueView.comments].reverse().find((cm) => TRUSTED_ASSOC.has(cm.author_association) && /^<!--\s*rockbuilt:plan\b/m.test(cm.body || '')) : null;
  const declared = planLine ? ((planLine.body.match(/^<!--\s*rockbuilt:plan\b[^>]*\bapprovals=([\w,-]+)/m) || [])[1] || '').split(',').filter((x) => APPROVAL_REASONS.includes(x)) : [];
  // PLAN-1.0 A7: a runtime dependency outside the design that fails the check asks the owner.
  let deps = null;
  if (risk && (risk.checks || []).includes('dependency')) {
    try { deps = dependencyCheck(root, risk, { ref: view.base && view.base.sha }); } catch (e) { deps = { ok: false, results: [], unsupported: [`check failed: ${e.message}`] }; }
  }
  // A feature PR asks no approval: every task in it passed the gate with its own (G3).
  if (featureBase && declared.length) no('feature-base', `the plan asks the owner (${declared.join(', ')}): such a task never goes through a feature branch`);
  const approvalReasons = feature ? [] : [...new Set([...(risk ? risk.approvals.map((a) => a.reason) : []), ...declared, ...(deps && !deps.ok ? ['dependency'] : [])])];
  let approval = { ok: true, how: null };
  if (approvalReasons.length) {
    if (!taskIssues.length) approval = { ok: false, detail: 'approval needed but the body names no task issue' };
    else if (issueView) {
      let controlComments = [];
      try {
        const ctl = ensureControl(c, { create: false });
        if (ctl) controlComments = ops.issueComments(c, ctl.number);
      } catch { controlComments = []; }
      const perms = new Map();
      const canApprove = (login) => {
        if (!login) return false;
        if (!perms.has(login)) { let p = null; try { p = ops.permission(c, login); } catch { p = null; } perms.set(login, p); }
        return ['admin', 'maintain', 'write'].includes(perms.get(login));
      };
      approval = approvalStatus({ reasons: approvalReasons, issueComments: issueView.comments, controlComments, issue: taskIssues[0], milestone: issueView.milestone, run, at: now().toISOString(), canApprove });
    }
    if (!approval.ok && approval.detail) no('approval', approval.detail);
  }
  if (!taskIssues.length) no('verdicts', 'the body names no task issue (Closes #n or Part of #n): the verdicts are posted there');
  else {
    let posted = null;
    try {
      posted = taskIssues.flatMap((n) => (issueView && n === taskIssues[0] ? issueView.comments : ops.issueComments(c, n))).filter((cm) => TRUSTED_ASSOC.has(cm.author_association)).flatMap((cm) => Object.values(parseStatusLines(cm.body)));
    } catch (e) {
      no('verdicts', `could not read the task issue: ${e.message}`);
    }
    if (posted) {
      // Every review line in the body is checked, required or not: a line is a claim.
      for (const stage of [...new Set([...need, ...['rb-verifier', 'rb-auditor', 'rb-security-reviewer'].filter((st) => body.status[st])])]) {
        const line = body.status[stage];
        if (!line) continue;
        if (line.by === 'rb-review-delta' && stage === 'rb-verifier' && line['identical-to'] && (identity.get(line['identical-to']) || {}).class === 'identical') continue;
        const match = posted.some((v) => v.stage === stage && v.outcome === line.outcome && sameSha(v.head || '', line.head || '') && sameTask(v.task, line.task));
        if (!match) no('verdicts', `the ${stage} line (head ${String(line.head || '?').slice(0, 7)}) has no matching verdict on #${taskIssues[0]}: post the reviewer's final message there (rb gh issue-comment ${taskIssues[0]} --body-file <its report>)`);
      }
    }
  }

  // 5. Checks on the head SHA, rockbuilt-ci among them.
  let checks = [];
  try {
    checks = head ? ops.checks(c, head) : [];
  } catch (e) {
    no('checks', `could not read checks: ${e.message}`);
  }
  if (!ciPassed(checks)) no('ci', `no successful ${CI_CHECK} check run from GitHub Actions on ${String(head).slice(0, 7)}: no CI, no automatic merge`);
  e2eRequired(root, checks, no, baseContract);
  for (const x of checks) {
    if (x.status !== 'completed') no('checks', `${x.name} is ${x.status}`);
    else if (!OK_CONCLUSIONS.includes(x.conclusion)) no('checks', `${x.name} concluded ${x.conclusion}`);
  }

  // 6. Stop switch.
  const stop = stopStatus(c);
  if (stop.stop) no('stop', `stop switch on: ${stop.issues.map((i) => `#${i.number}`).join(', ')}`);

  // 7. Lock held by this run (the human path does not need it).
  if (!humanApproved) {
    if (!run) no('lock', 'pass --run <id> (lock holder) or --human-approved');
    else {
      const l = holdsLock(c, run, { renew: !dryRun });
      if (!l.held) no('lock', l.detail);
    }
  }

  return { pr: view.number, title: view.title, task: (String(view.body || '').match(/<!--\s*rockbuilt:task\s+([A-Za-z0-9_-]+)/) || [])[1] || null, head, base: view.base ? view.base.ref : null, kind, profile, ...(featureBase ? { featureBase: true } : {}), labelTier: lt, riskTier: risk ? risk.tier : null, declaredTier: body.tier, tier, labelLevel: ll, riskLevel: risk ? risk.level : null, level, needs: need, approvalReasons, approval, deps, batch: body.batch, closes: body.closes, eligible: reasons.length === 0, reasons, checks, ...(behindExempt ? { behindExempt } : {}) };
}

// Gate for review-less PR kinds: no reviewer lines, but CI, stop switch, blocking labels and the
// lock (or the human) still apply.
function evaluateSpecialKind(root, c, view, kind, { run, humanApproved, no, reasons, head, dryRun = false }) {
  for (const l of ['rb:blocked', 'rb:hold']) if (view.labels.includes(l)) no('blocking-label', `carries ${l}`);
  if (kind === 'bookkeeping' && !humanApproved) for (const l of ['rb:needs-human', 'rb:tier-c']) if (view.labels.includes(l)) no('blocking-label', `carries ${l}`);
  if (kind === 'human-only' && !humanApproved) no('human-only', `${view.head.ref} PRs merge only when the user asks (--human-approved)`);
  // PLAN-1.0 G1: exploration code never merges, not even on the owner's word. Its conclusion goes
  // to docs/research/<slug>.md through a rb/spec-* PR.
  if (kind === 'explore') no('explore', `${view.head.ref} is an exploration branch and never merges: write the conclusion to docs/research/<slug>.md and open it as a rb/spec-* PR`);
  // A human-only branch name is not a way around the task gate (adversarial review of 1.0): a
  // spec or verify PR may only touch what that kind writes.
  const allowed = KIND_FILES.find(([prefix]) => view.head.ref.startsWith(prefix));
  if (allowed) {
    try {
      const prFiles = ops.prFiles(c, view.number);
      const outside = prFiles.flatMap((f) => [f.path, f.previous_path].filter(Boolean)).filter((p) => !matchAny(p, allowed[1]));
      if (outside.length) no('kind-files', `${allowed[0]}* PRs touch only ${allowed[1].join(', ')}; this one also changes ${outside.slice(0, 5).join(', ')}: build it as a task`);
      // PLAN-1.0 E1: a new spec reaches main only with its decision inventory complete.
      if (allowed[0] === 'rb/spec-') {
        for (const f of prFiles.filter((x) => x.status === 'added' && /^docs\/specs\/[^/]+\/requirements\.md$/.test(x.path))) {
          const text = ops.fileAt(c, f.path, head);
          const gaps = text == null ? ['could not read it'] : inventoryProblems(text);
          if (gaps.length) no('inventory', `${f.path}: ${gaps.slice(0, 4).join('; ')}${gaps.length > 4 ? ` (+${gaps.length - 4})` : ''}: complete it (rb spec check)`);
        }
      }
    } catch (e) {
      no('kind-files', `could not read files: ${e.message}`);
    }
  }
  if (kind === 'bookkeeping') {
    let files = [];
    try {
      files = ops.prFiles(c, view.number);
    } catch (e) {
      no('files', `could not read files: ${e.message}`);
    }
    // GitHub's PR file list can lag behind a base that moved (rockbuilt #45: task PRs merged after
    // the bookkeeping branch was saved, and the list showed their files). The live compare of the
    // base tip and the head is what a squash lands; it decides when the list disagrees.
    let ok = bookkeepingOnly(files);
    if (!ok && view.base && head) {
      try {
        const live = ops.compareFiles(c, view.base.ref, head);
        if (!live.truncated) ok = bookkeepingOnly(live.files.map((f) => ({ filename: f.filename, status: f.status, previous_filename: f.previous, patch: f.patch })));
      } catch { /* keep the refusal */ }
    }
    if (!ok) no('bookkeeping', 'a bookkeeping PR may only touch tasks.md, docs/progress.md and append to .claude/LESSONS.md');
  }
  let checks = [];
  try {
    checks = head ? ops.checks(c, head) : [];
  } catch (e) {
    no('checks', `could not read checks: ${e.message}`);
  }
  if (!ciPassed(checks)) no('ci', `no successful ${CI_CHECK} check run from GitHub Actions on ${String(head).slice(0, 7)}`);
  for (const x of checks) {
    if (x.status !== 'completed') no('checks', `${x.name} is ${x.status}`);
    else if (!OK_CONCLUSIONS.includes(x.conclusion)) no('checks', `${x.name} concluded ${x.conclusion}`);
  }
  const stop = stopStatus(c);
  if (stop.stop) no('stop', `stop switch on: ${stop.issues.map((i) => `#${i.number}`).join(', ')}`);
  if (!humanApproved) {
    if (!run) no('lock', 'pass --run <id> (lock holder) or --human-approved');
    else {
      const l = holdsLock(c, run, { renew: !dryRun });
      if (!l.held) no('lock', l.detail);
    }
  }
  const body = parseBody(view.body);
  return { pr: view.number, title: view.title, head, base: view.base ? view.base.ref : null, kind, labelTier: null, riskTier: null, declaredTier: null, tier: kind === 'bookkeeping' ? 'A' : 'C', closes: body.closes, eligible: reasons.length === 0, reasons, checks };
}

export function mergeGate(root, c, pr, { dryRun = false, run = null, humanApproved = false } = {}) {
  const g = evaluateGate(root, c, pr, { run, humanApproved, dryRun });
  if (!g.eligible || dryRun) return { ...g, merged: false, dryRun };
  let merged;
  try {
    merged = c.api('PUT', `{repo}/pulls/${g.pr}/merge`, { body: { merge_method: 'squash', sha: g.head, commit_title: `${g.title} (#${g.pr})` } });
  } catch (e) {
    // Branch protection that requires an up-to-date branch refuses a PR behind on bookkeeping only:
    // that is the ordinary `behind` hold, not a merge-halting error.
    if (g.behindExempt && e instanceof GhError && e.status === 405) {
      return { ...g, eligible: false, merged: false, reasons: [{ rule: 'behind', detail: `GitHub requires an up-to-date branch (${e.message}): update the branch (rb gh pr-update-branch)` }] };
    }
    throw e;
  }
  const mergeSha = merged && merged.sha ? merged.sha : null;
  // A queued merge must land the tested tree; anything else is reverted by the caller at once.
  let treeMismatch = false;
  if (g.behindExempt && g.behindExempt.queue && mergeSha) {
    try {
      const landed = ops.commitInfo(c, mergeSha).tree;
      treeMismatch = Boolean(landed && landed !== g.behindExempt.queue.stepTree);
    } catch {
      treeMismatch = true;
    }
  }
  const after = [];
  const step = (what, fn) => {
    try { fn(); after.push({ step: what, ok: true }); } catch (e) { after.push({ step: what, ok: false, error: e.message }); }
  };
  step('revert-comment', () => ops.issueComment(c, g.pr, `Merged by \`rb merge-gate\` (${g.kind === 'feature' ? 'feature, auditor and security review on the whole' : g.level ? `level ${g.level}` : `tier ${g.tier}`}${g.featureBase ? `, into ${g.base}` : ''}${g.approval && g.approval.how === 'delegation' ? `, merged by delegation: ${g.approval.delegation.words}` : ''}${g.approval && g.approval.how === 'owner' ? `, plan approved by ${g.approval.approval.by || 'the owner'} on ${String(g.approval.approval.at).slice(0, 10)}` : ''}${humanApproved ? ', human approved' : ''}). To undo: \`node tools/rockbuilt/rb.mjs revert ${g.pr}\` opens a revert PR.`));
  step('pr-labels', () => { ops.labelRemove(c, g.pr, 'rb:pr-open'); ops.labelRemove(c, g.pr, 'rb:approval-pending'); });
  for (const n of [...g.closes, ...(g.batch || []).filter((x) => !g.closes.includes(x))]) {
    step(`issue-${n}`, () => {
      ops.labelRemove(c, n, 'rb:in-progress');
      ops.labelRemove(c, n, 'rb:pr-open');
      ops.labelRemove(c, n, 'rb:approval-pending');
      ops.issueEdit(c, n, { state: 'closed' });
    });
  }
  const record = { at: now().toISOString(), pr: g.pr, title: g.title, tier: g.tier, head: g.head, mergeSha, issues: g.closes, run, humanApproved, revert: `node tools/rockbuilt/rb.mjs revert ${g.pr}` };
  step('record', () => {
    const file = path.join(root, '.rockbuilt', 'merges.jsonl');
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(record)}\n`);
  });
  return { ...g, merged: true, mergeSha, after, ...(treeMismatch ? { treeMismatch: true, revert: `node tools/rockbuilt/rb.mjs revert ${g.pr}` } : {}) };
}

// rb revert <pr>: revert the squash commit on rb/revert-<pr> in a temporary worktree and open a PR.
export function revertPr(root, c, pr) {
  const view = ops.prView(c, pr);
  if (!view.merged || !view.merge_commit_sha) throw new CliError(`PR #${view.number} is not merged`, 3);
  const branch = defaultBranch(root);
  git(root, ['fetch', 'origin', branch]);
  const baseRef = resolveBaseRef(root, `origin/${branch}`) || resolveBaseRef(root, branch);
  if (!baseRef) throw new CliError(`cannot find ${branch} locally`);
  if (!git(root, ['cat-file', '-e', `${view.merge_commit_sha}^{commit}`]).ok) git(root, ['fetch', 'origin', view.merge_commit_sha]);
  const revBranch = `rb/revert-${view.number}`;
  const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'rb-revert-')), 'wt');
  const add = git(root, ['worktree', 'add', '-b', revBranch, dir, baseRef]);
  if (!add.ok) throw new CliError(`git worktree add failed: ${add.stderr}`);
  try {
    const parents = git(root, ['rev-list', '--parents', '-n', '1', view.merge_commit_sha]).stdout.split(' ').length - 1;
    const args = ['revert', '--no-edit'];
    if (parents > 1) args.push('-m', '1');
    args.push(view.merge_commit_sha);
    const rv = git(dir, args);
    if (!rv.ok) throw new CliError(`git revert failed: ${rv.stderr || rv.stdout}`);
    const push = git(dir, ['push', '-u', 'origin', revBranch]);
    if (!push.ok) throw new CliError(`git push failed: ${push.stderr}`);
  } finally {
    git(root, ['worktree', 'remove', '--force', dir]);
    rmSync(path.dirname(dir), { recursive: true, force: true });
  }
  const body = `Reverts #${view.number} (${view.merge_commit_sha}).\n\nOpened by \`rb revert\`. Revert PRs merge only when the user asks (\`rb merge-gate <n> --human-approved\`).\n\n<!-- rockbuilt:tier C -->\n`;
  const created = ops.prCreate(c, { head: revBranch, base: branch, title: `Revert "${view.title}"`, body, labels: ['rb:needs-human'] });
  return { reverted: view.number, branch: revBranch, pr: created.number, url: created.url };
}

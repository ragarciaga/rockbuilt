// rb merge-gate (DESIGN.md section 8) and rb revert. The only merge path of the harness.
import { appendFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { holdsLock, stopStatus } from './control.mjs';
import { GhError, ops } from './gh.mjs';
import { defaultBranch, resolveBaseRef } from './repo.mjs';
import { readContract } from './contract.mjs';
import { BOOKKEEPING_FILE } from './bookkeeping.mjs';
import { parseQueueRecord } from './queue.mjs';
import { classify, isTestPath } from './delta.mjs';
import { computeRisk, maxTier, tierRank } from './risk.mjs';
import { CliError, git, now, sleepMs } from './util.mjs';

const BLOCKING_LABELS = ['rb:needs-human', 'rb:blocked', 'rb:tier-c', 'rb:hold'];
const OK_CONCLUSIONS = ['success', 'neutral', 'skipped'];
export const CI_CHECK = 'rockbuilt-ci';

// The CI evidence must be a check run created by GitHub Actions and concluded success. A commit status
// with the same name proves nothing: any token with repo access can post one.
// With an `## E2E` section the `rockbuilt-e2e` check must exist and pass: since E2E runs in shards
// behind a plan job, its check runs appear late, and "every present check is green" alone could
// be read before they exist.
export const E2E_CHECK = 'rockbuilt-e2e';
function e2eRequired(root, checks, no) {
  const { text } = readContract(root);
  if (!/^##\s+E2E\s*$/m.test(text || '')) return;
  const ok = checks.some((x) => x.name === E2E_CHECK && x.source === 'check-run' && x.app === 'github-actions' && x.status === 'completed' && x.conclusion === 'success');
  if (!ok) no('e2e', `no successful ${E2E_CHECK} check run on the head (AGENTS.md has ## E2E)`);
}

export function ciPassed(checks) {
  return checks.some((x) => (x.name === CI_CHECK || x.name.startsWith(`${CI_CHECK} `) || x.name.startsWith(`${CI_CHECK}/`))
    && x.source === 'check-run' && x.app === 'github-actions' && x.status === 'completed' && x.conclusion === 'success');
}

// Machine lines in a PR body: last status line per stage, tier line, security flag.
export function parseBody(body) {
  const status = {};
  for (const m of String(body || '').matchAll(/<!--\s*rockbuilt:status\s+([^>]*?)\s*-->/g)) {
    const kv = Object.fromEntries([...m[1].matchAll(/([\w-]+)=(\S+)/g)].map((x) => [x[1], x[2]]));
    if (kv.stage) status[kv.stage] = kv;
  }
  const tier = (String(body || '').match(/<!--\s*rockbuilt:tier\s+([ABC])\s*-->/i) || [])[1];
  const security = /<!--\s*rockbuilt:security\s+required\s*-->/i.test(body || '') || /^\s*security:\s*required\s*$/mi.test(body || '');
  const closes = [...String(body || '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi)].map((m) => Number(m[1]));
  return { status, tier: tier ? tier.toUpperCase() : null, security, closes: [...new Set(closes)] };
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
const HUMAN_ONLY_PREFIXES = ['rb/revert-', 'rb/spec-', 'rb/verify-', 'rb/kickoff', 'rb/adopt', 'rb/retro-', 'chore/rockbuilt-'];

export function prKind(headRef) {
  const ref = String(headRef || '');
  if (ref.startsWith(BOOKKEEPING_PREFIX)) return 'bookkeeping';
  if (HUMAN_ONLY_PREFIXES.some((p) => ref.startsWith(p))) return 'human-only';
  return 'task';
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

  // 1. Open, not draft, base is the default branch, mergeable.
  if (view.state !== 'open' || view.merged) no('open', `PR is ${view.merged ? 'merged' : view.state}`);
  if (view.draft) no('draft', 'PR is a draft');
  if (!view.base || view.base.ref !== branch) no('base', `base is ${view.base ? view.base.ref : '?'}, not ${branch}`);
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

  const kind = prKind(view.head && view.head.ref);
  if (kind !== 'task') return evaluateSpecialKind(root, c, view, kind, { run, humanApproved, no, reasons, head, dryRun });

  // 2. Labels.
  const lt = labelTier(view.labels);
  const allowC = humanApproved;
  if (!lt) no('tier-label', 'no rb:tier-a / rb:tier-b label');
  for (const l of BLOCKING_LABELS) {
    if (!view.labels.includes(l)) continue;
    if (allowC && (l === 'rb:tier-c' || l === 'rb:needs-human')) continue;
    no('blocking-label', `carries ${l}`);
  }

  // 3. Live risk no higher than the label (and the declared tier line).
  let risk = null;
  try {
    risk = computeRisk(root, { pr: view.number, gh: c });
  } catch (e) {
    no('risk', `rb risk failed: ${e.message}`);
  }
  const body = parseBody(view.body);
  if (risk && lt && tierRank(risk.tier) > tierRank(lt)) {
    if (!(allowC && lt === 'C')) no('risk', `rb risk says tier ${risk.tier} but the label is tier ${lt}: ${risk.reasons.filter((r) => r.rule !== 'tier-b').slice(0, 3).map((r) => `${r.rule} ${r.path}`.trim()).join('; ')}`);
  }
  if (body.tier && lt && tierRank(body.tier) > tierRank(lt)) no('declared-tier', `body declares tier ${body.tier} but the label is tier ${lt}`);
  const tier = maxTier(lt || 'A', risk ? risk.tier : 'A', body.tier || 'A');
  if (tier === 'C' && !allowC) no('tier-c', 'tier C merges are human: the user merges or asks for it (--human-approved)');

  // 4. Reviewer lines with head equal to the PR head.
  const need = ['rb-verifier'];
  if (tierRank(tier) >= 1) need.push('rb-auditor');
  if (body.security) need.push('rb-security-reviewer');
  // A verifier pass on the current head may name the head the other reviewers saw:
  // `identical-to=<sha>` (no touched file changed since; the verifier ran its identity check) or
  // `app-identical-to=<sha>` (only test files changed; the verifier re-verified them). Auditor and
  // security lines on that older head then still hold, once the gate itself confirms the class
  // through GitHub (DESIGN 8.3).
  // Both keys may appear when the auditor and the security review sit on different heads.
  // test-only carries the auditor (it judged the running app, unchanged) but never the security
  // review: test code runs in CI with the workflow's secrets and was not looked at.
  const ver = body.status['rb-verifier'];
  const verOk = ver && ver.outcome === 'pass' && shaMatches(ver.head, head);
  const carryFor = (stage, lineHead) => {
    if (!verOk) return null;
    if (ver['identical-to'] && sameSha(lineHead, ver['identical-to'])) return { from: ver['identical-to'], allowed: ['identical'] };
    if (ver['app-identical-to'] && sameSha(lineHead, ver['app-identical-to'])) return { from: ver['app-identical-to'], allowed: stage === 'rb-security-reviewer' ? ['identical'] : ['identical', 'test-only'] };
    return null;
  };
  const identity = new Map();
  // An `identical-to` verifier line (written by the verifier's identity check or by
  // `rb review-delta --line`) is checked even when no other line sits on that head (tier A).
  if (verOk && ver['identical-to']) {
    const id = reviewedChange(c, view.base.ref, ver['identical-to'], head);
    identity.set(ver['identical-to'], id);
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
      if (carry) {
        if (!identity.has(carry.from)) identity.set(carry.from, reviewedChange(c, view.base.ref, carry.from, head));
        const id = identity.get(carry.from);
        if (!carry.allowed.includes(id.class)) no('stale-head', `${stage} reviewed ${s.head}; the verifier carries it forward, but the gate finds the change ${id.class} (${id.detail}): re-review`);
      } else no('stale-head', `${stage} reviewed ${s.head || '?'}, PR head is ${head}`);
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
  e2eRequired(root, checks, no);
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

  return { pr: view.number, title: view.title, head, base: view.base ? view.base.ref : null, labelTier: lt, riskTier: risk ? risk.tier : null, declaredTier: body.tier, tier, closes: body.closes, eligible: reasons.length === 0, reasons, checks, ...(behindExempt ? { behindExempt } : {}) };
}

// Gate for review-less PR kinds: no reviewer lines, but CI, stop switch, blocking labels and the
// lock (or the human) still apply.
function evaluateSpecialKind(root, c, view, kind, { run, humanApproved, no, reasons, head, dryRun = false }) {
  for (const l of ['rb:blocked', 'rb:hold']) if (view.labels.includes(l)) no('blocking-label', `carries ${l}`);
  if (kind === 'bookkeeping' && !humanApproved) for (const l of ['rb:needs-human', 'rb:tier-c']) if (view.labels.includes(l)) no('blocking-label', `carries ${l}`);
  if (kind === 'human-only' && !humanApproved) no('human-only', `${view.head.ref} PRs merge only when the user asks (--human-approved)`);
  if (kind === 'bookkeeping') {
    let files = [];
    try {
      files = ops.prFiles(c, view.number);
    } catch (e) {
      no('files', `could not read files: ${e.message}`);
    }
    if (!bookkeepingOnly(files)) no('bookkeeping', 'a bookkeeping PR may only touch tasks.md, docs/progress.md and append to .claude/LESSONS.md');
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
  step('revert-comment', () => ops.issueComment(c, g.pr, `Merged by \`rb merge-gate\` (tier ${g.tier}${humanApproved ? ', human approved' : ''}). To undo: \`node tools/rockbuilt/rb.mjs revert ${g.pr}\` opens a revert PR.`));
  step('pr-labels', () => ops.labelRemove(c, g.pr, 'rb:pr-open'));
  for (const n of g.closes) {
    step(`issue-${n}`, () => {
      ops.labelRemove(c, n, 'rb:in-progress');
      ops.labelRemove(c, n, 'rb:pr-open');
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
  const created = ops.prCreate(c, { head: revBranch, base: branch, title: `Revert "${view.title}"`, body, labels: ['rb:tier-c', 'rb:needs-human'] });
  return { reverted: view.number, branch: revBranch, pr: created.number, url: created.url };
}

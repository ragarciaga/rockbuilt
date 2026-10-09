// rb merge-gate (DESIGN.md section 8) and rb revert. The only merge path of the harness.
import { appendFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { holdsLock, stopStatus } from './control.mjs';
import { ops } from './gh.mjs';
import { defaultBranch, resolveBaseRef } from './repo.mjs';
import { computeRisk, maxTier, tierRank } from './risk.mjs';
import { CliError, git, now, sleepMs } from './util.mjs';

const BLOCKING_LABELS = ['rb:needs-human', 'rb:blocked', 'rb:tier-c', 'rb:hold'];
const OK_CONCLUSIONS = ['success', 'neutral', 'skipped'];
export const CI_CHECK = 'rockbuilt-ci';

// The CI evidence must be a check run created by GitHub Actions and concluded success. A commit status
// with the same name proves nothing: any token with repo access can post one.
export function ciPassed(checks) {
  return checks.some((x) => (x.name === CI_CHECK || x.name.startsWith(`${CI_CHECK} `) || x.name.startsWith(`${CI_CHECK}/`))
    && x.source === 'check-run' && x.app === 'github-actions' && x.status === 'completed' && x.conclusion === 'success');
}

// Machine lines in a PR body: last status line per stage, tier line, security flag.
export function parseBody(body) {
  const status = {};
  for (const m of String(body || '').matchAll(/<!--\s*rockbuilt:status\s+([^>]*?)\s*-->/g)) {
    const kv = Object.fromEntries([...m[1].matchAll(/(\w+)=(\S+)/g)].map((x) => [x[1], x[2]]));
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

// PR kinds that carry no reviewer lines (DESIGN 8.1). Bookkeeping may merge unattended when it only
// touches bookkeeping files and LESSONS.md only grows; the rest need the human.
const BOOKKEEPING_PREFIX = 'rb/bookkeeping-';
const HUMAN_ONLY_PREFIXES = ['rb/revert-', 'rb/spec-', 'rb/verify-', 'rb/kickoff', 'rb/adopt', 'rb/retro-', 'chore/rockbuilt-'];
const BOOKKEEPING_FILE = /^(docs\/specs\/[^/]+\/tasks\.md|docs\/progress\.md|\.claude\/LESSONS\.md)$/;

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
    if (name === '.claude/LESSONS.md') {
      if (f.status !== 'modified' && f.status !== 'added') return false;
      if (removed.length) return false;
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
export function evaluateGate(root, c, pr, { run = null, humanApproved = false, retryMs = Number(process.env.RB_MERGEABLE_RETRY_MS ?? 3000) } = {}) {
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

  const kind = prKind(view.head && view.head.ref);
  if (kind !== 'task') return evaluateSpecialKind(root, c, view, kind, { run, humanApproved, no, reasons, head });

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
  for (const stage of need) {
    const s = body.status[stage];
    if (!s) no('status-line', `missing ${stage} line`);
    // needs-local: the auditor could not observe a criterion in the cloud; the human checked it on
    // their machine and asked for the merge in the current conversation.
    else if (s.outcome !== 'pass' && !(stage === 'rb-auditor' && s.outcome === 'needs-local' && humanApproved)) no('status-line', `${stage} outcome=${s.outcome}`);
    else if (!shaMatches(s.head, head)) no('stale-head', `${stage} reviewed ${s.head || '?'}, PR head is ${head}`);
  }

  // 5. Checks on the head SHA, rockbuilt-ci among them.
  let checks = [];
  try {
    checks = head ? ops.checks(c, head) : [];
  } catch (e) {
    no('checks', `could not read checks: ${e.message}`);
  }
  if (!ciPassed(checks)) no('ci', `no successful ${CI_CHECK} check run from GitHub Actions on ${String(head).slice(0, 7)}: no CI, no automatic merge`);
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
      const l = holdsLock(c, run);
      if (!l.held) no('lock', l.detail);
    }
  }

  return { pr: view.number, title: view.title, head, base: view.base ? view.base.ref : null, labelTier: lt, riskTier: risk ? risk.tier : null, declaredTier: body.tier, tier, closes: body.closes, eligible: reasons.length === 0, reasons, checks };
}

// Gate for review-less PR kinds: no reviewer lines, but CI, stop switch, blocking labels and the
// lock (or the human) still apply.
function evaluateSpecialKind(root, c, view, kind, { run, humanApproved, no, reasons, head }) {
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
      const l = holdsLock(c, run);
      if (!l.held) no('lock', l.detail);
    }
  }
  const body = parseBody(view.body);
  return { pr: view.number, title: view.title, head, base: view.base ? view.base.ref : null, kind, labelTier: null, riskTier: null, declaredTier: null, tier: kind === 'bookkeeping' ? 'A' : 'C', closes: body.closes, eligible: reasons.length === 0, reasons, checks };
}

export function mergeGate(root, c, pr, { dryRun = false, run = null, humanApproved = false } = {}) {
  const g = evaluateGate(root, c, pr, { run, humanApproved });
  if (!g.eligible || dryRun) return { ...g, merged: false, dryRun };
  const merged = c.api('PUT', `{repo}/pulls/${g.pr}/merge`, { body: { merge_method: 'squash', sha: g.head, commit_title: `${g.title} (#${g.pr})` } });
  const mergeSha = merged && merged.sha ? merged.sha : null;
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
  return { ...g, merged: true, mergeSha, after };
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

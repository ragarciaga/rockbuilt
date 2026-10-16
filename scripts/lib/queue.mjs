// rb queue build|done (DESIGN 8.4): a merge queue for the serial train. Several PRs that are ready
// (reviews pass on their heads, CI green on their heads) are merged one after another onto the
// default branch tip in a temporary worktree; step i (the base plus PRs 1..i) is pushed as
// `rb/queue-<run>-<stamp>-<i>`, so CI runs on every prefix at the same time instead of one PR
// after another. Each included PR gets a record comment; `rb merge-gate` then accepts that PR while
// it is behind the base only if GitHub's own test merge of the PR has exactly the tree of its step
// and CI passed on that step (merge.mjs, queuedBehind).
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ops } from './gh.mjs';
import { defaultBranch } from './repo.mjs';
import { CliError, git, now } from './util.mjs';

export const QUEUE_PREFIX = 'rb/queue-';
const RECORD_RE = /<!--\s*rockbuilt:queue\s+([^>]*?)\s*-->/g;

const runId = (run) => {
  if (!run || run === true || !/^[A-Za-z0-9._-]+$/.test(String(run))) throw new CliError('--run <id> is required (letters, digits, . _ -: it becomes a branch name)', 2);
  return String(run);
};

export function parseQueueRecord(body) {
  const all = [...String(body || '').matchAll(RECORD_RE)];
  if (!all.length) return null;
  return Object.fromEntries([...all[all.length - 1][1].matchAll(/([\w-]+)=(\S+)/g)].map((x) => [x[1], x[2]]));
}

export function buildQueue(root, c, { run, prs }) {
  const id = runId(run);
  const list = String(prs || '').split(',').map((s) => Number(s.trim().replace(/^#/, ''))).filter(Boolean);
  if (list.length < 2) throw new CliError('--prs needs two or more PR numbers, in merge order', 2);
  const d = defaultBranch(root);
  if (!git(root, ['fetch', '--quiet', 'origin', `+refs/heads/${d}:refs/remotes/origin/${d}`]).ok) throw new CliError(`git fetch origin ${d} failed`);
  const base = git(root, ['rev-parse', `origin/${d}`]).stdout;
  const stem = `${QUEUE_PREFIX}${id}-${now().getTime().toString(36)}`;
  const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'rb-queue-')), 'wt');
  const add = git(root, ['worktree', 'add', '--detach', dir, base]);
  if (!add.ok) throw new CliError(`git worktree add failed: ${add.stderr}`);
  const included = [];
  const skipped = [];
  let head = base;
  try {
    for (const n of list) {
      const view = ops.prView(c, n);
      if (view.state !== 'open' || !view.head) { skipped.push({ pr: n, reason: 'not open' }); continue; }
      // An explicit refspec: single-branch and shallow clones do not map other branches.
      if (!git(root, ['fetch', '--quiet', 'origin', `+refs/heads/${view.head.ref}:refs/remotes/origin/${view.head.ref}`]).ok) { skipped.push({ pr: n, reason: `cannot fetch ${view.head.ref}` }); continue; }
      const fetched = git(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${view.head.ref}`]).stdout;
      if (fetched !== view.head.sha) { skipped.push({ pr: n, reason: 'head moved since the PR was read' }); continue; }
      // A stacked PR (it shares commits with an earlier queued PR beyond the base) would merge
      // differently in the queue than GitHub squashes it onto the updated base: never queue it.
      const stacked = included.find((x) => {
        const mb = git(root, ['merge-base', x.prHead, view.head.sha]);
        return mb.ok && !git(root, ['merge-base', '--is-ancestor', mb.stdout, base]).ok;
      });
      if (stacked) { skipped.push({ pr: n, reason: `stacked on #${stacked.pr}: merge it serially` }); continue; }
      const m = git(dir, ['merge', '--no-ff', '--no-edit', '-m', `queue: #${n} (${id})`, view.head.sha]);
      if (!m.ok) {
        const conflict = /CONFLICT|Automatic merge failed/i.test(`${m.stdout}\n${m.stderr}`);
        git(dir, ['merge', '--abort']);
        skipped.push({ pr: n, reason: conflict ? 'conflicts with the PRs before it' : `merge failed: ${(m.stderr || m.stdout).split('\n')[0]}` });
        continue;
      }
      const step = git(dir, ['rev-parse', 'HEAD']).stdout;
      included.push({ pr: n, prHead: view.head.sha, prefix: head, step, branch: `${stem}-${included.length + 1}` });
      head = step;
    }
    if (included.length < 2) return { built: false, branch: null, base, included, skipped, detail: 'fewer than two PRs merge cleanly: use the serial train' };
    // Every step is pushed as its own branch, so CI runs on each prefix of the queue at once:
    // wherever the train stops, the default branch holds a tested state.
    const refspecs = included.map((x) => `${x.step}:refs/heads/${x.branch}`);
    const push = git(dir, ['push', '--quiet', 'origin', ...refspecs]);
    if (!push.ok) throw new CliError(`git push failed: ${push.stderr}`);
  } finally {
    git(root, ['worktree', 'remove', '--force', dir]);
    rmSync(path.dirname(dir), { recursive: true, force: true });
  }
  const recorded = [];
  const unrecorded = [];
  for (const [i, x] of included.entries()) {
    try {
      ops.issueComment(c, x.pr, `<!-- rockbuilt:queue run=${id} branch=${x.branch} step=${x.step} prefix=${x.prefix} base=${base} pr-head=${x.prHead} -->\nIn merge queue \`${stem}\` (position ${i + 1} of ${included.length}). CI runs on \`${x.branch}\` (this PR on top of the ones before it); \`rb merge-gate\` merges in this order once each is green.`);
      recorded.push(x.pr);
    } catch (e) {
      unrecorded.push({ pr: x.pr, error: e.message });
    }
  }
  return { built: true, stem, head, base, included, skipped, recorded, unrecorded, detail: `${included.length} PR(s) queued (${stem}-1..${included.length})${skipped.length ? `, ${skipped.length} skipped` : ''}${unrecorded.length ? `, ${unrecorded.length} without a record (they go serially)` : ''}` };
}

// Deletes this run's queue branches on GitHub (best effort; they only ever hold merges of PRs).
export function finishQueue(root, c, { run }) {
  const id = runId(run);
  const r = git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${QUEUE_PREFIX}${id}-*`]);
  const own = new RegExp(`^${QUEUE_PREFIX}${id.replace(/[.]/g, '\\.')}-[0-9a-z]+-\\d+$`);
  const branches = (r.ok ? r.stdout.split(/\r?\n/).filter(Boolean).map((l) => l.split(/\s+/)[1].replace(/^refs\/heads\//, '')) : []).filter((b) => own.test(b));
  const deleted = [];
  const failed = [];
  for (const b of branches) {
    try { ops.refDelete(c, b); deleted.push(b); } catch (e) { failed.push({ branch: b, error: e.message }); }
  }
  return { deleted, failed };
}

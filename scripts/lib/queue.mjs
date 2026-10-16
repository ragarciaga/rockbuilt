// rb queue build|done (DESIGN 8.4): a merge queue for the serial train. Several PRs that are ready
// (reviews pass on their heads, CI green on their heads) are merged one after another onto the
// default branch tip in a temporary worktree and pushed as `rb/queue-<run>-<k>`. CI runs once on
// that branch: the combination is tested, not each PR against a base that moves under it. Each
// included PR gets a record comment; `rb merge-gate` then accepts that PR while it is behind the
// base only if GitHub confirms, commit by commit, that the base is exactly the queue's previous
// step and the queue head's CI passed (merge.mjs, queuedBehind).
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ops } from './gh.mjs';
import { defaultBranch } from './repo.mjs';
import { CliError, git, now } from './util.mjs';

export const QUEUE_PREFIX = 'rb/queue-';
const RECORD_RE = /<!--\s*rockbuilt:queue\s+([^>]*?)\s*-->/g;

const runId = (run) => {
  if (!run || run === true || !/^[A-Za-z0-9._:-]+$/.test(String(run))) throw new CliError('--run <id> is required (letters, digits, . _ : -)', 2);
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
  if (!git(root, ['fetch', '--quiet', 'origin', d]).ok) throw new CliError(`git fetch origin ${d} failed`);
  const base = git(root, ['rev-parse', `origin/${d}`]).stdout;
  const branch = `${QUEUE_PREFIX}${id}-${now().getTime().toString(36)}`;
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
      if (!git(root, ['fetch', '--quiet', 'origin', view.head.ref]).ok) { skipped.push({ pr: n, reason: `cannot fetch ${view.head.ref}` }); continue; }
      const fetched = git(root, ['rev-parse', `origin/${view.head.ref}`]).stdout;
      if (fetched !== view.head.sha) { skipped.push({ pr: n, reason: 'head moved since the PR was read' }); continue; }
      const m = git(dir, ['merge', '--no-ff', '--no-edit', '-m', `queue: #${n} (${id})`, view.head.sha]);
      if (!m.ok) {
        git(dir, ['merge', '--abort']);
        skipped.push({ pr: n, reason: 'conflicts with the PRs before it' });
        continue;
      }
      const step = git(dir, ['rev-parse', 'HEAD']).stdout;
      included.push({ pr: n, prHead: view.head.sha, prefix: head, step });
      head = step;
    }
    if (included.length < 2) return { built: false, branch: null, base, included, skipped, detail: 'fewer than two PRs merge cleanly: use the serial train' };
    const push = git(dir, ['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`]);
    if (!push.ok) throw new CliError(`git push failed: ${push.stderr}`);
  } finally {
    git(root, ['worktree', 'remove', '--force', dir]);
    rmSync(path.dirname(dir), { recursive: true, force: true });
  }
  for (const x of included) {
    ops.issueComment(c, x.pr, `<!-- rockbuilt:queue run=${id} branch=${branch} head=${head} base=${base} prefix=${x.prefix} step=${x.step} pr-head=${x.prHead} -->\nIn merge queue \`${branch}\` (position ${included.indexOf(x) + 1} of ${included.length}). CI runs once on the combination; \`rb merge-gate\` merges in this order once it is green.`);
  }
  return { built: true, branch, head, base, included, skipped, detail: `${included.length} PR(s) queued on ${branch}${skipped.length ? `, ${skipped.length} skipped` : ''}` };
}

// Deletes this run's queue branches on GitHub (best effort; they only ever hold merges of PRs).
export function finishQueue(root, c, { run }) {
  const id = runId(run);
  const r = git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${QUEUE_PREFIX}${id}-*`]);
  const branches = r.ok ? r.stdout.split(/\r?\n/).filter(Boolean).map((l) => l.split(/\s+/)[1].replace(/^refs\/heads\//, '')) : [];
  const deleted = [];
  const failed = [];
  for (const b of branches) {
    try { ops.refDelete(c, b); deleted.push(b); } catch (e) { failed.push({ branch: b, error: e.message }); }
  }
  return { deleted, failed };
}

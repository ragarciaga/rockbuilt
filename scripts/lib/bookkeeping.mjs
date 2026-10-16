// rb bookkeeping carry|save (DESIGN 11, section 6): the day's bookkeeping PR, mechanically.
//
// The run edits tasks.md status lines, docs/progress.md and .claude/LESSONS.md in the checkout and
// never commits them on a task branch. `save` copies the current files into a temporary worktree at
// the default branch, commits them, and pushes to the day's `rb/bookkeeping-<date>` branch (opening
// the PR when there is none). It runs after every task, so a cloud session that ends early (or a
// stop hook that demands a commit) loses nothing (3d_brain, 2026-10-15). `save --final` also
// restores those files in the checkout, leaving the tree clean.
//
// `carry` is run start: the open bookkeeping PR from an earlier run that did not merge is applied
// to the checkout, and `save` then pushes on top of that PR (merge -s ours keeps this tree and makes
// its tip an ancestor), so there is one bookkeeping PR per day.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ops } from './gh.mjs';
import { defaultBranch } from './repo.mjs';
import { CliError, exists, git, gitRaw, now, readJson } from './util.mjs';

export const BOOKKEEPING_FILE = /^(docs\/specs\/[^/]+\/tasks\.md|docs\/progress\.md|\.claude\/LESSONS\.md)$/;
const PATHS = ['docs/specs', 'docs/progress.md', '.claude/LESSONS.md'];
const PREFIX = 'rb/bookkeeping-';

const stateFile = (root) => path.join(root, '.rockbuilt', 'bookkeeping.json');
const readState = (root) => (exists(stateFile(root)) ? readJson(stateFile(root)) || {} : {});
function writeState(root, st) {
  mkdirSync(path.dirname(stateFile(root)), { recursive: true });
  writeFileSync(stateFile(root), `${JSON.stringify(st, null, 2)}\n`);
}

const runId = (run) => {
  if (!run || run === true || !/^[A-Za-z0-9._:-]+$/.test(String(run))) throw new CliError('--run <id> is required (letters, digits, . _ : -)', 2);
  return String(run);
};
const today = () => now().toISOString().slice(0, 10);

function remoteHas(root, branch) {
  const r = git(root, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);
  return r.ok && r.stdout.trim().length > 0;
}

function baseRef(root) {
  const d = defaultBranch(root);
  git(root, ['fetch', '--quiet', 'origin', d]);
  const ref = `origin/${d}`;
  if (!git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) throw new CliError(`cannot resolve ${ref}: fetch it first`);
  return { d, ref };
}

// Bookkeeping files in the checkout whose content differs from the default branch (or that it lacks).
export function changedBookkeeping(root, ref) {
  const list = (args) => {
    const r = gitRaw(root, ['ls-files', '-z', ...args, '--', ...PATHS]);
    return r.ok ? r.stdout.split('\0').filter(Boolean) : [];
  };
  const files = [...new Set([...list([]), ...list(['--others', '--exclude-standard'])])].filter((p) => BOOKKEEPING_FILE.test(p)).sort();
  const out = [];
  for (const p of files) {
    if (!exists(path.join(root, p))) continue;
    const mine = git(root, ['hash-object', '--', p]);
    const theirs = git(root, ['rev-parse', '--verify', '--quiet', `${ref}:${p}`]);
    if (!mine.ok) continue;
    if (!theirs.ok || theirs.stdout !== mine.stdout) out.push(p);
  }
  return out;
}

// The open bookkeeping PR from an earlier run, newest first.
function openBookkeepingPr(c) {
  if (!c) return null;
  const prs = ops.prList(c, { state: 'open', headPrefix: PREFIX }).sort((a, b) => b.number - a.number);
  return prs[0] || null;
}

export function carryBookkeeping(root, c, { run }) {
  const id = runId(run);
  const { ref } = baseRef(root);
  const pr = openBookkeepingPr(c);
  if (!pr) {
    writeState(root, { run: id, date: today(), carry: null });
    return { carried: false, detail: 'no open bookkeeping PR' };
  }
  const branch = pr.head.ref;
  if (!git(root, ['fetch', '--quiet', 'origin', branch]).ok) throw new CliError(`git fetch origin ${branch} failed`);
  const patch = path.join(root, '.rockbuilt', 'bookkeeping.patch');
  mkdirSync(path.dirname(patch), { recursive: true });
  const diff = gitRaw(root, ['diff', '--binary', `--output=${patch}`, `${ref}...origin/${branch}`, '--', ...PATHS]);
  if (!diff.ok) throw new CliError(`git diff failed: ${diff.stderr}`);
  // Plain apply, never --3way: a 3-way conflict passes --check and then leaves conflict markers.
  const check = git(root, ['apply', '--check', patch]);
  if (!check.ok) {
    writeState(root, { run: id, date: today(), carry: null, skipped: { branch, pr: pr.number } });
    return { carried: false, pr: pr.number, branch, code: 3, detail: `PR #${pr.number} does not apply on the checkout (${check.stderr.split('\n')[0]}): left alone, this run opens its own bookkeeping PR` };
  }
  const apply = git(root, ['apply', patch]);
  if (!apply.ok) throw new CliError(`git apply failed after a clean check: ${apply.stderr}`);
  writeState(root, { run: id, date: today(), carry: { branch, pr: pr.number } });
  return { carried: true, pr: pr.number, branch, detail: `PR #${pr.number} applied; this run's bookkeeping goes on top of it` };
}

export function saveBookkeeping(root, c, { run, final = false }) {
  const id = runId(run);
  const { d, ref } = baseRef(root);
  const files = changedBookkeeping(root, ref);
  const st = readState(root);
  if (!files.length) return { saved: false, files, branch: st.branch || null, pr: st.pr || null, detail: 'no bookkeeping changes' };

  let branch = st.run === id && st.branch ? st.branch : null;
  if (!branch && st.run === id && st.carry) branch = st.carry.branch;
  if (!branch) {
    branch = `${PREFIX}${today()}`;
    if (remoteHas(root, branch)) branch = `${branch}-${id}`;
  }
  const onRemote = remoteHas(root, branch);
  if (onRemote && !git(root, ['fetch', '--quiet', 'origin', branch]).ok) throw new CliError(`git fetch origin ${branch} failed`);

  const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'rb-bookkeeping-')), 'wt');
  const add = git(root, ['worktree', 'add', '--detach', dir, ref]);
  if (!add.ok) throw new CliError(`git worktree add failed: ${add.stderr}`);
  let sha;
  try {
    for (const p of files) {
      mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
      copyFileSync(path.join(root, p), path.join(dir, p));
    }
    if (!git(dir, ['add', '--', ...files]).ok) throw new CliError('git add failed in the bookkeeping worktree');
    const commit = git(dir, ['commit', '-q', '-m', `docs: progress (${id})`]);
    if (!commit.ok) throw new CliError(`git commit failed: ${commit.stderr || commit.stdout}`);
    // The earlier tip stays an ancestor; this commit's tree (every bookkeeping file as the checkout
    // has it, carried PR included) is the PR's content.
    if (onRemote) {
      const m = git(dir, ['merge', '-s', 'ours', '--no-edit', `origin/${branch}`]);
      if (!m.ok) throw new CliError(`git merge -s ours failed: ${m.stderr}`);
    }
    const push = git(dir, ['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`]);
    if (!push.ok) throw new CliError(`git push failed: ${push.stderr}`);
    sha = git(dir, ['rev-parse', 'HEAD']).stdout;
  } finally {
    git(root, ['worktree', 'remove', '--force', dir]);
    rmSync(path.dirname(dir), { recursive: true, force: true });
  }

  let pr = st.run === id && st.branch === branch ? st.pr || null : (st.carry && st.carry.branch === branch ? st.carry.pr : null);
  let created = false;
  if (c) {
    const open = ops.prList(c, { state: 'open', headPrefix: branch }).find((p) => p.head.ref === branch);
    if (open) pr = open.number;
    else {
      const body = `Bookkeeping (tasks.md status, docs/progress.md, .claude/LESSONS.md) from run ${id}.\n\nThe next run merges it through \`rb merge-gate\`; the gate refuses any other path.\n`;
      pr = ops.prCreate(c, { head: branch, base: d, title: `docs: progress ${today()}`, body }).number;
      created = true;
    }
  }
  writeState(root, { run: id, date: today(), carry: st.carry || null, branch, pr, sha });

  let restored = [];
  if (final) {
    for (const p of files) {
      if (git(root, ['cat-file', '-e', `HEAD:${p}`]).ok) git(root, ['checkout', 'HEAD', '--', p]);
      else unlinkSync(path.join(root, p));
      restored.push(p);
    }
  }
  return { saved: true, files, branch, sha, pr, created, restored, detail: `${files.length} file(s) pushed to ${branch}${pr ? ` (PR #${pr}${created ? ', opened' : ''})` : ''}` };
}

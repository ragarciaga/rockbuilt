// rb worktree add/remove/list.
import { copyFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { defaultBranch } from './repo.mjs';
import { parseTasks } from './spec.mjs';
import { CliError, exists, git, readText, slugify, toPosix } from './util.mjs';

export function normalizeTaskId(task) {
  if (!task || task === true) throw new CliError('usage: rb worktree add|remove <task>');
  const t = String(task).trim();
  if (!/^[A-Za-z0-9._-]+$/.test(t)) throw new CliError(`invalid task id "${t}"`);
  return /^t\d+$/i.test(t) ? t.toUpperCase() : t;
}

export function worktreePath(root, task) {
  return path.join(path.dirname(root), `${path.basename(root)}-wt-${task}`);
}

// Look up the task title in docs/specs/*/tasks.md (or a given spec dir) to build the branch slug.
export function findTaskTitle(root, task, specDir) {
  const dirs = [];
  if (specDir) dirs.push(path.resolve(root, specDir));
  else {
    const specsRoot = path.join(root, 'docs', 'specs');
    if (exists(specsRoot)) {
      for (const e of readdirSync(specsRoot, { withFileTypes: true })) if (e.isDirectory()) dirs.push(path.join(specsRoot, e.name));
    }
  }
  const titles = [];
  for (const d of dirs) {
    const text = readText(path.join(d, 'tasks.md'));
    if (!text) continue;
    const t = parseTasks(text).tasks.find((x) => x.id === task);
    if (t) titles.push(t.title);
  }
  return titles.length === 1 ? titles[0] : null;
}

export function portOffset(task) {
  const m = String(task).match(/\d+/);
  const n = m ? Number(m[0]) : 1;
  return (((n - 1) % 50) + 1) * 10;
}

function copyEnvFiles(root, dest) {
  const copied = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isFile() || !/^\.env/.test(e.name)) continue;
    const target = path.join(dest, e.name);
    if (exists(target)) continue;
    copyFileSync(path.join(root, e.name), target);
    copied.push(e.name);
  }
  return copied;
}

export function addWorktree(root, taskArg, { base, slug, title, spec } = {}) {
  const task = normalizeTaskId(taskArg);
  const baseBranch = base && base !== true ? base : defaultBranch(root);
  const name = slug && slug !== true ? slugify(slug) : slugify(title && title !== true ? title : findTaskTitle(root, task, spec) || '');
  const branch = name ? `rb/${task}-${name}` : `rb/${task}`;
  const dest = worktreePath(root, task);
  if (exists(dest)) throw new CliError(`worktree path already exists: ${dest}`);

  const branchExists = git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
  const args = branchExists ? ['worktree', 'add', dest, branch] : ['worktree', 'add', '-b', branch, dest, baseBranch];
  const r = git(root, args);
  if (!r.ok) throw new CliError(`git worktree add failed: ${r.stderr || r.stdout}`);
  git(dest, ['config', 'core.longpaths', 'true']);
  const envCopied = copyEnvFiles(root, dest);
  return { task, path: dest, branch, base: baseBranch, reusedBranch: branchExists, envCopied, portOffset: portOffset(task) };
}

export function listWorktrees(root) {
  const r = git(root, ['worktree', 'list', '--porcelain']);
  if (!r.ok) throw new CliError(`git worktree list failed: ${r.stderr}`);
  const out = [];
  let cur = null;
  for (const line of r.stdout.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice(9), branch: null, head: null };
      out.push(cur);
    } else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (cur && line.startsWith('HEAD ')) cur.head = line.slice(5);
  }
  const marker = `${path.basename(root)}-wt-`;
  return out
    .filter((w) => path.basename(w.path).startsWith(marker))
    .map((w) => ({ ...w, task: path.basename(w.path).slice(marker.length) }));
}

export function removeWorktree(root, taskArg, { force = false } = {}) {
  const task = normalizeTaskId(taskArg);
  const expected = toPosix(worktreePath(root, task)).toLowerCase();
  const match = listWorktrees(root).find((w) => toPosix(path.resolve(w.path)).toLowerCase() === expected || w.task === task);
  if (!match) throw new CliError(`no rockbuilt worktree for ${task}`);
  const args = ['worktree', 'remove', match.path];
  if (force) args.push('--force');
  const r = git(root, args);
  if (!r.ok) throw new CliError(`git worktree remove failed: ${r.stderr || r.stdout}`);
  git(root, ['worktree', 'prune']);
  return { task, path: match.path, branch: match.branch, branchKept: true };
}

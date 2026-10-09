// Git facts shared by several commands.
import path from 'node:path';
import { headerField, readContractText } from './contract.mjs';
import { git } from './util.mjs';

// Contract "Default branch:" wins, then origin/HEAD, then an existing main/master, then the current branch.
export function defaultBranch(root) {
  const fromDoc = headerField(readContractText(root), 'Default branch');
  if (fromDoc && !fromDoc.includes('<')) return fromDoc;
  const sym = git(root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (sym.ok) return sym.stdout.replace(/^refs\/remotes\/origin\//, '');
  for (const b of ['main', 'master']) {
    if (git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]).ok) return b;
  }
  return currentBranch(root) || 'main';
}

export function currentBranch(root) {
  const r = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.ok && r.stdout !== 'HEAD' ? r.stdout : null;
}

export function headSha(root, ref = 'HEAD') {
  const r = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return r.ok ? r.stdout : null;
}

// "owner/repo" from a remote URL: https, ssh (scp and ssh://) and proxy forms ending in /git/owner/repo.
export function slugFromUrl(url) {
  const u = String(url || '').trim();
  let m = u.match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (!m) m = u.match(/\/git\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export function originSlug(root) {
  const r = git(root, ['remote', 'get-url', 'origin']);
  return r.ok ? slugFromUrl(r.stdout) : null;
}

// The main checkout of a repo (differs from root inside a linked worktree).
export function mainCheckoutRoot(root) {
  const r = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!r.ok) return root;
  const common = path.resolve(root, r.stdout);
  return path.basename(common) === '.git' ? path.dirname(common) : root;
}

export function isLinkedWorktree(root) {
  return path.resolve(mainCheckoutRoot(root)).toLowerCase() !== path.resolve(root).toLowerCase();
}

// A ref usable as the diff base: the local branch, else origin/<branch>.
export function resolveBaseRef(root, branch) {
  if (headSha(root, branch)) return branch;
  if (headSha(root, `origin/${branch}`)) return `origin/${branch}`;
  return null;
}

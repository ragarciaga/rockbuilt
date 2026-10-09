// Git facts shared by several commands.
import { headerField, readClaudeMd } from './claudemd.mjs';
import { git } from './util.mjs';

// CLAUDE.md "Default branch:" wins, then origin/HEAD, then an existing main/master, then the current branch.
export function defaultBranch(root) {
  const fromDoc = headerField(readClaudeMd(root), 'Default branch');
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

// "owner/repo" from the origin remote, or null.
export function originSlug(root) {
  const r = git(root, ['remote', 'get-url', 'origin']);
  if (!r.ok) return null;
  const m = r.stdout.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

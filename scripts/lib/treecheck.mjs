// rb tree-check (PLAN-1.0 F4, DESIGN 32.4): after each reviewer the working tree must equal the
// reviewed head. A verifier mutant left in place was seen by the next reviewer, and probe files
// ended up in commits, in three projects. Bookkeeping files and .rockbuilt/ do not count.
import { git, gitRaw } from './util.mjs';
import { BOOKKEEPING_FILE } from './bookkeeping.mjs';

export function treeCheck(root, { restore = false } = {}) {
  const r = gitRaw(root, ['-c', 'core.quotepath=false', 'status', '--porcelain', '--untracked-files=all']);
  const entries = r.stdout.split(/\r?\n/).filter(Boolean).map((l) => ({ code: l.slice(0, 2), path: l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop() }));
  const dirty = entries.filter((e) => !BOOKKEEPING_FILE.test(e.path) && !e.path.startsWith('.rockbuilt/'));
  const modified = dirty.filter((e) => e.code !== '??');
  const untracked = dirty.filter((e) => e.code === '??').map((e) => e.path);
  let restored = [];
  if (restore && modified.length) {
    const paths = modified.map((e) => e.path);
    git(root, ['restore', '--staged', '--worktree', '--', ...paths]);
    restored = paths;
  }
  return { clean: dirty.length === 0, modified: modified.map((e) => e.path), untracked, restored };
}

export function treeText(t) {
  if (t.clean) return 'tree clean: it matches the reviewed head';
  const lines = [];
  if (t.modified.length) lines.push(`${t.restored.length ? 'restored' : 'modified'} (a reviewer left a change): ${t.modified.join(', ')}`);
  if (t.untracked.length) lines.push(`untracked (probe files? never commit them; delete them by hand after reading): ${t.untracked.join(', ')}`);
  return lines.join('\n');
}

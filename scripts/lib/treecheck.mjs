// rb tree-check (PLAN-1.0 F4, DESIGN 32.4): after each reviewer the working tree must equal the
// reviewed head. A verifier mutant left in place was seen by the next reviewer, and probe files
// ended up in commits, in three projects. Bookkeeping files and .rockbuilt/ do not count.
// Nothing is ever deleted: only tracked modifications are restored; new files are listed.
import { BOOKKEEPING_FILE } from './bookkeeping.mjs';
import { gitRaw } from './util.mjs';

const ignored = (p) => BOOKKEEPING_FILE.test(p) || p.startsWith('.rockbuilt/');

// `git status --porcelain=v1 -z`: "XY path\0", renames "R  new\0old\0". Exact paths, no quoting.
export function parseStatusZ(out) {
  const parts = String(out || '').split('\0');
  const entries = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    const code = rec.slice(0, 2);
    const p = rec.slice(3);
    if (code[0] === 'R' || code[0] === 'C') entries.push({ code, path: p, from: parts[++i] || null });
    else entries.push({ code, path: p, from: null });
  }
  return entries;
}

export function treeCheck(root, { restore = false } = {}) {
  const st = gitRaw(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!st.ok) return { clean: false, error: `git status failed: ${String(st.stderr || '').trim()}`, modified: [], added: [], untracked: [], restored: [], failed: [] };
  const entries = parseStatusZ(st.stdout).filter((e) => !(ignored(e.path) && (!e.from || ignored(e.from))));
  const untracked = entries.filter((e) => e.code === '??').map((e) => e.path);
  // A staged new file is listed like an untracked one: restoring it would delete it.
  const added = entries.filter((e) => e.code[0] === 'A').map((e) => e.path);
  const modified = entries.filter((e) => e.code !== '??' && e.code[0] !== 'A');
  const restored = [];
  const failed = [];
  if (restore) {
    for (const e of modified) {
      // A rename restores both sides: the old path comes back, the new one is listed, not deleted.
      const paths = e.from ? [e.from] : [e.path];
      const r = gitRaw(root, ['restore', '--staged', '--worktree', '--source=HEAD', '--', ...paths]);
      if (r.ok) restored.push(...paths); else failed.push(...paths);
      if (e.from) added.push(e.path);
    }
  }
  const remaining = restore ? failed : modified.map((e) => e.from || e.path);
  return {
    clean: entries.length === 0,
    modified: modified.map((e) => (e.from ? `${e.from} -> ${e.path}` : e.path)),
    added,
    untracked,
    restored,
    failed: restore ? failed : [],
    remaining,
  };
}

export function treeText(t) {
  if (t.error) return t.error;
  if (t.clean) return 'tree clean: it matches the reviewed head';
  const lines = [];
  if (t.restored.length) lines.push(`restored (a reviewer left a change): ${t.restored.join(', ')}`);
  if (t.failed.length) lines.push(`could not restore: ${t.failed.join(', ')}`);
  if (!t.restored.length && !t.failed.length && t.modified.length) lines.push(`modified (a reviewer left a change): ${t.modified.join(', ')}`);
  const loose = [...t.added, ...t.untracked];
  if (loose.length) lines.push(`new files (probe files? never commit them; read, then delete by hand): ${loose.join(', ')}`);
  return lines.join('\n');
}

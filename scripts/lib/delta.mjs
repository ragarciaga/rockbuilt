// rb review-delta (DESIGN 8.3): what changed in the task between the reviewed head and the current
// head? Compared by content, not by diff text: for every path the task touched before or touches
// now, the file at the reviewed head and at the current head must be the same blob (and mode).
// That survives base merges, and a stacked base task that was squash-merged into the default
// branch (its files then equal the reviewed content and drop out of the new diff).
//
// Classes: identical (no touched file differs), test-only (only test files differ: the app the
// auditor and the security reviewer saw is unchanged), different (any other file differs).
// `rb merge-gate` re-checks the same rule through GitHub; it never trusts this output.
import { matchAny, normalizePath } from './glob.mjs';
import { git, gitRaw } from './util.mjs';

// Files whose content cannot change what the running app does. Anything not listed counts as app.
export const TEST_GLOBS = ['**/*.test.*', '**/*.spec.*', 'tests/**', 'test/**', 'e2e/**', '__tests__/**', '**/__tests__/**'];
// File-routed directories publish every file in them (Next.js pages/, Nuxt server/, serverless
// api/ and functions/): a `x.test.ts` there can be a live route, so it counts as app.
export const ROUTED_GLOBS = ['pages/**', 'src/pages/**', 'server/**', 'src/server/**', 'api/**', 'functions/**', 'netlify/functions/**', 'supabase/functions/**'];

export const isTestPath = (p) => {
  const n = normalizePath(p);
  return matchAny(n, TEST_GLOBS) && !matchAny(n, ROUTED_GLOBS);
};

// { identical | test-only | different } from the paths whose content differs. Task status
// (tasks.md) and progress notes never change what the app does or what CI runs: a difference only
// there is identical (3d_brain #228, rockbuilt #24). LESSONS.md is not exempt: every agent reads it
// as binding, so a change to it after the review is a change the reviewers did not see.
const NOTES_FILE = /^(docs\/specs\/[^/]+\/tasks\.md|docs\/progress\.md)$/;
export function classify(differing) {
  const rest = differing.filter((p) => !NOTES_FILE.test(normalizePath(p)));
  if (!rest.length) return 'identical';
  return rest.every(isTestPath) ? 'test-only' : 'different';
}

// A diff as comparable text per file: hunk line numbers and index lines dropped, so the same
// change on a base that moved elsewhere compares equal.
export function normalizePatch(patch) {
  return String(patch || '').split('\n')
    .filter((l) => !/^index [0-9a-f]+\.\.[0-9a-f]+/.test(l))
    .map((l) => l.replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/, '@@'))
    .join('\n').trimEnd();
}

// True when two per-file patch maps hold the same change (same files, same normalized patches).
export function samePatches(a, b) {
  const ka = [...a.keys()].filter((p) => !NOTES_FILE.test(p)).sort();
  const kb = [...b.keys()].filter((p) => !NOTES_FILE.test(p)).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => a.get(k) !== null && a.get(k) === b.get(k));
}

// Per-file patches between two commits. File names come from `-z` (spaces, non-ASCII), and each
// patch is read on its own, so a content line that starts with `--- ` is never taken for a header
// (0.10.0 review).
function localPatches(root, from, to) {
  const list = names(root, from, to);
  if (list === null) return null;
  const out = new Map();
  for (const p of list) {
    const r = gitRaw(root, ['diff', '--no-renames', '--no-color', '--binary', from, to, '--', p]);
    if (!r.ok) return null;
    if (/^GIT binary patch$|^Binary files /m.test(r.stdout)) { out.set(p, null); continue; }
    const lines = r.stdout.split('\n');
    const first = lines.findIndex((l) => l.startsWith('@@'));
    const head = lines.slice(0, first === -1 ? lines.length : first).filter((l) => /^(old mode|new mode|new file mode|deleted file mode) /.test(l));
    out.set(p, normalizePatch([...head, ...(first === -1 ? [] : lines.slice(first))].join('\n')));
  }
  return out;
}

function names(root, from, to) {
  const r = gitRaw(root, ['diff', '--name-only', '--no-renames', '-z', from, to]);
  return r.ok ? r.stdout.split('\0').filter(Boolean) : null;
}

// path -> "mode sha" at a commit, for the given paths (absent paths are missing from the map).
function entries(root, commit, paths) {
  const out = new Map();
  for (let i = 0; i < paths.length; i += 200) {
    const chunk = paths.slice(i, i + 200);
    const r = gitRaw(root, ['ls-tree', '-z', commit, '--', ...chunk]);
    if (!r.ok) return null;
    for (const rec of r.stdout.split('\0').filter(Boolean)) {
      const m = rec.match(/^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s);
      if (m) out.set(m[4], `${m[1]} ${m[3]}`);
    }
  }
  return out;
}

export function reviewDelta(root, { base, reviewed, head = 'HEAD' }) {
  const fail = (detail, extra = {}) => ({ identical: false, class: 'different', detail, base, reviewed, head, ...extra });
  const resolve = (ref) => { const r = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); return r.ok ? r.stdout : null; };
  const b = resolve(base);
  const old = resolve(reviewed);
  const now = resolve(head);
  if (!b) return fail(`unknown base ${base} (fetch it first)`);
  if (!old) return fail(`unknown reviewed commit ${reviewed} (fetch it first)`);
  if (!now) return fail(`unknown head ${head}`);
  if (!git(root, ['merge-base', '--is-ancestor', b, now]).ok) return fail(`${head} does not contain ${base}: update the branch first`);
  const oldBase = git(root, ['merge-base', b, old]);
  if (!oldBase.ok) return fail('no merge base between the reviewed commit and the base');
  const before = names(root, oldBase.stdout, old);
  const after = names(root, b, now);
  if (before === null || after === null) return fail('git diff failed');
  if (!before.length) return fail('the reviewed commit has no diff against its base');
  const touched = [...new Set([...before, ...after])].sort();
  const atOld = entries(root, old, touched);
  const atNow = entries(root, now, touched);
  if (!atOld || !atNow) return fail('git ls-tree failed');
  const differing = touched.filter((p) => (atOld.get(p) || '') !== (atNow.get(p) || ''));
  let cls = classify(differing);
  // The task's own diff unchanged while the base moved files it does not change (a stacked base
  // squash-merged with later edits; 3d_brain #248): the same review holds.
  if (cls !== 'identical') {
    const was = localPatches(root, oldBase.stdout, old);
    const is = localPatches(root, b, now);
    if (was && is && samePatches(was, is)) return { identical: true, class: 'identical', detail: 'same task diff as reviewed (the base changed other parts of the touched files)', base: b, reviewed: old, head: now, files: touched.length, differing };
  }
  const base_ = { base: b, reviewed: old, head: now, files: touched.length, differing };
  if (cls === 'identical') return { identical: true, class: cls, detail: `${touched.length} touched file(s), same content as reviewed`, ...base_ };
  if (cls === 'test-only') return { identical: false, class: cls, detail: `only test files changed: ${differing.slice(0, 5).join(', ')}`, ...base_ };
  return { identical: false, class: cls, detail: `app files changed: ${differing.filter((p) => !isTestPath(p)).slice(0, 5).join(', ')}`, ...base_ };
}

// The mechanical identity check (DESIGN 8.3, 3d_brain 2026-10-15): after `rb gh pr-update-branch`
// added only base merges, the verifier line for the new head comes from here, not from an agent.
// It holds when the task content is identical and every first-parent commit after the reviewed
// head is a merge. CI on the new head runs the Verification (and E2E) the merged result needs, and
// the gate re-checks identity through GitHub before it trusts the line.
export function identityLine(root, { base, reviewed, task, head = 'HEAD' }) {
  const d = reviewDelta(root, { base, reviewed, head });
  if (d.class !== 'identical') return { ok: false, ...d };
  if (!git(root, ['merge-base', '--is-ancestor', d.reviewed, d.head]).ok) return { ok: false, ...d, class: 'different', detail: `${reviewed} is not an ancestor of ${head}: the branch was rebuilt` };
  const log = git(root, ['log', '--first-parent', '--format=%H %P', `${d.reviewed}..${d.head}`]);
  if (!log.ok) return { ok: false, ...d, class: 'different', detail: 'git log failed' };
  const single = log.stdout.split(/\r?\n/).filter(Boolean).filter((l) => l.trim().split(/\s+/).length < 3);
  if (single.length) return { ok: false, ...d, class: 'different', detail: `commit ${single[0].slice(0, 7)} after the reviewed head is not a merge: review it` };
  const id = /^[A-Za-z0-9_-]+$/.test(String(task || '')) ? String(task) : null;
  const line = `<!-- rockbuilt:status stage=rb-verifier${id ? ` task=${id}` : ''} outcome=pass head=${d.head} identical-to=${d.reviewed} by=rb-review-delta -->`;
  return { ok: true, ...d, line };
}

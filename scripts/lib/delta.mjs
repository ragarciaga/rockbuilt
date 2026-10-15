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

// { identical | test-only | different } from the paths whose content differs.
export function classify(differing) {
  if (!differing.length) return 'identical';
  return differing.every(isTestPath) ? 'test-only' : 'different';
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
  const cls = classify(differing);
  const base_ = { base: b, reviewed: old, head: now, files: touched.length, differing };
  if (cls === 'identical') return { identical: true, class: cls, detail: `${touched.length} touched file(s), same content as reviewed`, ...base_ };
  if (cls === 'test-only') return { identical: false, class: cls, detail: `only test files changed: ${differing.slice(0, 5).join(', ')}`, ...base_ };
  return { identical: false, class: cls, detail: `app files changed: ${differing.filter((p) => !isTestPath(p)).slice(0, 5).join(', ')}`, ...base_ };
}

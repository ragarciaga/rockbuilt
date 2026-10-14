// rb review-delta (DESIGN 8.3): is the task diff after an update-branch byte-identical to the diff
// the reviewers saw? Local git only; `rb merge-gate` re-checks the same thing through GitHub.
import { gitRaw, git } from './util.mjs';

// `git diff` text with each `index <pre>..<post> [mode]` line reduced to the post-image blob and
// mode: the pre-image changes when the base moves, the post-image is the content the reviewers saw
// (the only trace of a binary file's content, whose diff has no hunks).
function normalizedDiff(root, from, to) {
  const r = gitRaw(root, ['diff', '--no-color', '--no-ext-diff', '--full-index', from, to]);
  if (!r.ok) return null;
  return r.stdout.split('\n').map((l) => (l.startsWith('index ') ? `post ${l.replace(/^index [0-9a-f]+\.\./, '')}` : l)).join('\n');
}

export function reviewDelta(root, { base, reviewed, head = 'HEAD' }) {
  const fail = (detail) => ({ identical: false, detail, base, reviewed, head });
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
  const before = normalizedDiff(root, oldBase.stdout, old);
  const after = normalizedDiff(root, b, now);
  if (before === null || after === null) return fail('git diff failed');
  if (!before.trim()) return fail('the reviewed commit has no diff against its base');
  if (before !== after) {
    const files = (t) => new Set([...t.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]));
    const fb = files(before);
    const fa = files(after);
    const changed = [...new Set([...fa, ...fb])].filter((f) => {
      const pick = (t) => (t.split(/^diff --git /m).find((x) => x.startsWith(`a/${f} `)) || '');
      return pick(before) !== pick(after);
    });
    return fail(`diff changed in ${changed.slice(0, 5).join(', ') || 'unknown files'}`);
  }
  const n = (after.match(/^diff --git /gm) || []).length;
  return { identical: true, detail: `${n} file(s), identical (patches and resulting blobs)`, base: b, reviewed: old, head: now };
}

// Secret-shaped literals in a branch's commits, before they leave the machine (rockbuilt #44).
// gitleaks in CI scans every commit of a PR, not only the final tree, so a fixture fixed in a later
// commit still fails, and replacing the commit needs a force push the harness denies. The guard
// runs this on `git push`; `rb secrets` runs it on demand. Rules follow the gitleaks defaults that
// fire on test fixtures in practice (generic-api-key and the well-known token formats). A line with
// `gitleaks:allow` is skipped, as gitleaks does. Node builtins only: the guard imports this file
// from the plugin (scripts/lib) and from a vendored project (tools/rockbuilt/lib).
import { spawnSync } from 'node:child_process';

const RULES = [
  ['private-key', /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY( BLOCK)?-----/],
  ['aws-access-token', /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_\w{82})\b/],
  ['slack-token', /\bxox[baprs]-[0-9A-Za-z-]{10,}/],
  ['stripe-access-token', /\b(?:sk|rk)_(?:live|test|prod)_[0-9a-zA-Z]{10,99}\b/],
  ['gcp-api-key', /\bAIza[\w-]{35}\b/],
  ['anthropic-api-key', /\bsk-ant-(?:api|admin)\d{2}-[\w-]{20,}/],
  ['openai-api-key', /\bsk-(?:proj|svcacct|admin)-[\w-]{20,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
];

// gitleaks generic-api-key: an identifier with a secret keyword, an assignment, and a value that
// looks random (Shannon entropy above 3.5).
const GENERIC = /[\w.-]{0,50}?(?:access|auth|api|API|credential|creds|key|KEY|passw(?:or)?d|secret|SECRET|token|TOKEN)(?:[ \t\w.-]{0,20})[\s'"`]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[`'"\s=]{0,5}([\w.=-]{10,150}|[a-z0-9][a-z0-9+/]{11,}={0,3}|[A-Za-z0-9+/]{20,}={0,3})(?:[`'"\s;]|\\[nr]|$)/i;

export function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}

// Findings in one added line: [{ rule, match }].
export function scanLine(line) {
  if (/gitleaks:allow/.test(line)) return [];
  const out = [];
  for (const [rule, re] of RULES) { const m = line.match(re); if (m) out.push({ rule, match: m[0] }); }
  if (!out.length) {
    const m = line.match(GENERIC);
    if (m && entropy(m[1]) > 3.5 && /\d/.test(m[1]) && !/^[a-z]+(?:[._-][a-z]+)*$/.test(m[1])) out.push({ rule: 'generic-api-key', match: m[1] });
  }
  return out;
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout || '' };
}

// Added lines of a unified diff: [{ file, line, text }].
export function addedLines(patch) {
  const out = [];
  let file = null;
  let n = 0;
  for (const l of String(patch).split('\n')) {
    if (l.startsWith('+++ ')) { file = l.slice(4).replace(/^b\//, ''); continue; }
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { n = Number(h[1]); continue; }
    if (file && l.startsWith('+')) { out.push({ file, line: n, text: l.slice(1) }); n++; }
    else if (file && !l.startsWith('-') && !l.startsWith('\\')) n++;
  }
  return out;
}

function scanPatch(patch, commit) {
  const hits = [];
  for (const a of addedLines(patch)) for (const f of scanLine(a.text)) hits.push({ commit, file: a.file, line: a.line, rule: f.rule });
  return hits;
}

// Every commit between the base and `ref` that no remote has yet (gitleaks scans each of them in
// CI), plus, with `worktree`, what is staged or modified. Returns { commits, findings } or null when
// git cannot answer.
export function scanBranch(cwd, { base, ref = 'HEAD', worktree = false } = {}) {
  const list = git(cwd, ['rev-list', '--no-merges', ref, ...(base ? [`^${base}`] : []), '--not', '--remotes']);
  if (!list.ok) return null;
  const commits = list.stdout.split('\n').filter(Boolean).slice(0, 200);
  const findings = [];
  for (const c of commits) {
    const show = git(cwd, ['-c', 'core.quotepath=false', 'show', '--format=', '--no-color', '--no-renames', '-U0', c]);
    if (show.ok) findings.push(...scanPatch(show.stdout, c.slice(0, 7)));
  }
  if (worktree) {
    const diff = git(cwd, ['-c', 'core.quotepath=false', 'diff', 'HEAD', '--no-color', '--no-renames', '-U0']);
    if (diff.ok) findings.push(...scanPatch(diff.stdout, 'worktree'));
  }
  return { commits: commits.length, findings };
}

export function findingsText(findings) {
  return findings.slice(0, 10).map((f) => `${f.file}:${f.line} (${f.rule}, ${f.commit})`).join('; ');
}

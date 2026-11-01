// Secret-shaped literals in a branch's commits, before they leave the machine (rockbuilt #44).
// gitleaks in CI scans every commit of a PR, not only the final tree, so a fixture fixed in a later
// commit still fails, and replacing the commit needs a force push the harness denies. The guard
// runs this on `git push`; `rb secrets` runs it on demand. Rules follow the gitleaks defaults that
// fire on test fixtures in practice (generic-api-key and the well-known token formats). A line with
// `gitleaks:allow` is skipped, as gitleaks does. Node builtins only: the guard imports this file
// from the plugin (scripts/lib) and from a vendored project (tools/rockbuilt/lib).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RULES = [
  // The header with a key body after it, not code that looks for the header (an ssh installer).
  ['private-key', /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY( BLOCK)?-----[\s'"`]*(\\n)?[A-Za-z0-9+/=]{40,}/],
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
// gitleaks' generic-api-key stopwords and allowed values: placeholders that are not secrets.
const STOPWORD = /(example|sample|dummy|placeholder|changeme|change_me|your[_-]|xxxx|test_?(api_?)?key|fake|mock|redacted|<[^>]+>|\$\{|\{\{)/i;
const GENERIC = /[\w.-]{0,50}?(?:access|auth|api|API|credential|creds|key|KEY|passw(?:or)?d|secret|SECRET|token|TOKEN)(?:[ \t\w.-]{0,20})[\s'"`]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[`'"\s=]{0,5}([\w.=-]{10,150}|[a-z0-9][a-z0-9+/]{11,}={0,3}|[A-Za-z0-9+/]{20,}={0,3})(?:[`'"\s;,}]|\\[nr]|$)/gi;

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
    // Every match on the line, as gitleaks does (a low-entropy first value must not hide a key).
    for (const m of line.matchAll(GENERIC)) {
      const v = m[1];
      if (entropy(v) > 3.5 && /\d/.test(v) && !/^[a-z]+(?:[._-][a-z]+)*$/.test(v) && !STOPWORD.test(v)) { out.push({ rule: 'generic-api-key', match: v }); break; }
    }
  }
  return out;
}

// The guard runs this inside a hook, on a repository a command names: nothing the repository's
// own config or attributes define may run (rockbuilt #52). Textconv drivers and external diff tools
// come from .gitattributes plus config, fsmonitor from config, a pager from config: all off.
const SAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-c', 'diff.external=', '-c', 'core.quotepath=false', '-c', 'log.showSignature=false', '-c', 'gpg.program=false', '-c', 'gpg.ssh.program=false', '-c', 'gpg.x509.program=false'];
const NO_EXEC_DIFF = ['--no-textconv', '--no-ext-diff'];

function git(cwd, args) {
  const r = spawnSync('git', [...SAFE, ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_EXTERNAL_DIFF: '', GIT_PAGER: 'cat', PAGER: 'cat' }, windowsHide: true });
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

// gitleaks' default path allowlist (lockfiles, media, vendored code) and the project's
// .gitleaksignore (fingerprints `commit:file:rule:line` or `file:rule:line`).
const PEM_HEADER = /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY( BLOCK)?-----\s*["'`]?\s*$/;
const SKIP_PATH = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock)$|\.(png|jpe?g|gif|svg|ico|webp|pdf|woff2?|ttf|eot|mp4|mp3|zip|gz|lock)$|(^|\/)(node_modules|vendor|dist|build)\//i;

function ignored(cwd) {
  const r = git(cwd, ['cat-file', 'blob', 'HEAD:.gitleaksignore']);
  let text = r.ok ? r.stdout : '';
  try { text += `\n${readFileSync(path.join(cwd, '.gitleaksignore'), 'utf8')}`; } catch { /* none */ }
  return new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
}

function scanPatch(patch, commit, skip = new Set()) {
  const hits = [];
  let prev = null;
  for (const a of addedLines(patch)) {
    if (SKIP_PATH.test(a.file)) continue;
    // A PEM block spans lines: the header followed by a key body on the next added line.
    const pem = prev && prev.file === a.file && prev.line === a.line - 1 && PEM_HEADER.test(prev.text) && /^\s*["'`]?[A-Za-z0-9+/=]{40,}/.test(a.text);
    prev = a;
    for (const f of [...scanLine(a.text), ...(pem ? [{ rule: 'private-key' }] : [])]) {
      const fp = `${a.file}:${f.rule}:${a.line}`;
      if ([...skip].some((x) => x === fp || x.endsWith(`:${fp}`))) continue;
      hits.push({ commit, file: a.file, line: a.line, rule: f.rule });
    }
  }
  return hits;
}

// Every commit between the base and `ref` that no remote has yet (gitleaks scans each of them in
// CI), plus, with `worktree`, what is staged or modified. Returns { commits, findings } or null when
// git cannot answer.
export function scanBranch(cwd, { base, ref = 'HEAD', worktree = false } = {}) {
  if (String(ref).startsWith('-') || (base && String(base).startsWith('-'))) return null;
  // No remote-tracking refs at all (a repo not pushed yet): scan from the merge-base with the
  // default branch, not the whole history (an old key long removed must not block every push).
  const hasRemotes = git(cwd, ['for-each-ref', '--count=1', 'refs/remotes']).stdout.trim() !== '';
  let from = base;
  if (!from && !hasRemotes) {
    for (const b of ['main', 'master']) {
      if (git(cwd, ['rev-parse', '--verify', '--quiet', `${b}^{commit}`]).ok) {
        const mb = git(cwd, ['merge-base', b, ref]);
        if (mb.ok && mb.stdout.trim() !== git(cwd, ['rev-parse', ref]).stdout.trim()) from = mb.stdout.trim();
        break;
      }
    }
  }
  const list = git(cwd, ['rev-list', '--no-merges', ref, ...(from ? [`^${from}`] : []), ...(hasRemotes ? ['--not', '--remotes'] : [])]);
  if (!list.ok) return null;
  const skip = ignored(cwd);
  const commits = list.stdout.split('\n').filter(Boolean).slice(0, 200);
  const findings = [];
  for (const c of commits) {
    const show = git(cwd, ['show', ...NO_EXEC_DIFF, '--no-show-signature', '--format=', '--no-color', '--no-renames', '-U0', c]);
    if (show.ok) findings.push(...scanPatch(show.stdout, c.slice(0, 7), skip));
  }
  if (worktree) {
    const diff = git(cwd, ['diff', ...NO_EXEC_DIFF, 'HEAD', '--no-color', '--no-renames', '-U0']);
    if (diff.ok) findings.push(...scanPatch(diff.stdout, 'worktree', skip));
    // New files are not in `git diff HEAD` until staged: read them whole.
    const untracked = git(cwd, ['ls-files', '-z', '--others', '--exclude-standard']);
    for (const f of untracked.stdout.split('\0').filter(Boolean)) {
      if (SKIP_PATH.test(f)) continue;
      let text;
      try { text = readFileSync(path.join(cwd, f), 'utf8'); } catch { continue; }
      if (text.length > 2_000_000 || text.includes('\0')) continue;
      text.split(/\r?\n/).forEach((l, i) => { for (const hit of scanLine(l)) if (!skip.has(`${f}:${hit.rule}:${i + 1}`)) findings.push({ commit: 'untracked', file: f, line: i + 1, rule: hit.rule }); });
    }
  }
  return { commits: commits.length, findings };
}

export function findingsText(findings) {
  return findings.slice(0, 10).map((f) => `${f.file}:${f.line} (${f.rule}, ${f.commit})`).join('; ');
}

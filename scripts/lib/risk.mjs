// rb risk: mechanical autonomy tier from a diff (DESIGN.md section 6). A model may raise it, never lower it.
import path from 'node:path';
import { contractInfo } from './contract.mjs';
import { matchAny, normalizePath } from './glob.mjs';
import { ops } from './gh.mjs';
import { defaultBranch, resolveBaseRef } from './repo.mjs';
import { CliError, git, gitRaw, readText } from './util.mjs';

export const TIERS = ['A', 'B', 'C'];
export const maxTier = (...ts) => ts.filter(Boolean).reduce((a, b) => (TIERS.indexOf(b) > TIERS.indexOf(a) ? b : a), 'A');
export const tierRank = (t) => TIERS.indexOf(String(t || '').toUpperCase());

export const FLOOR_PATHS = [
  { rule: 'data-schema', globs: ['**/migrations/**', 'prisma/schema.prisma', 'drizzle/**', 'supabase/**', '**/*.sql'] },
  { rule: 'auth-permissions-payments', globs: ['**/auth/**', '**/middleware.*', '**/permissions/**', '**/payments/**', '**/billing/**', '**/*stripe*', '**/*policy*', '**/rls*'] },
  { rule: 'infra-deploy-ci', globs: ['.github/**', 'vercel.json', 'netlify.toml', 'Dockerfile*', 'docker-compose*', 'fly.toml', 'render.yaml', 'wrangler.toml', '**/*.tf', 'supabase/config.toml'] },
  { rule: 'harness-secrets', globs: ['AGENTS.md', 'CLAUDE.md', '.claude/**', '.cursor/**', '.codex/**', '.agents/**', 'tools/rockbuilt/**', 'docs/rockbuilt/**', '.env*', '**/*.env', '.mcp.json', '.npmrc', '.yarnrc*', '.gitleaks*', '.gitattributes', '.husky/**'] },
  { rule: 'architecture', globs: ['docs/adr/**', '**/design.md'] },
  { rule: 'spec', globs: ['docs/specs/*/requirements.md', 'docs/brief.md'] },
];

export const TIER_A_GLOBS = ['**/*.test.*', '**/*.spec.*', 'tests/**', 'e2e/**', 'docs/**', '*.md', '*.css', '*.scss', '**/locales/**', '**/i18n/**', '**/messages/**/*.json'];
// Never tier A even when a tier A glob matches.
export const NOT_TIER_A = ['docs/adr/**', 'docs/specs/**', 'docs/brief.md'];

// Manifests and lockfiles other than package.json: any change is tier C.
const OTHER_MANIFESTS = ['**/requirements*.txt', '**/pyproject.toml', '**/Cargo.toml', '**/go.mod', '**/go.sum', '**/Pipfile', '**/Pipfile.lock', '**/setup.py', '**/setup.cfg', '**/Gemfile', '**/Gemfile.lock', '**/composer.json', '**/composer.lock', '**/package-lock.json', '**/npm-shrinkwrap.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/pnpm-workspace.yaml', '**/bun.lockb', '**/bun.lock', '**/poetry.lock', '**/uv.lock', '**/Cargo.lock'];
// package.json fields compared entry by entry. scripts are included: a changed "test" script can make CI green by construction.
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides', 'resolutions', 'scripts', 'bundleDependencies', 'bundledDependencies', 'workspaces', 'pnpm', 'packageManager', 'engines'];

// Paid SDKs: [module pattern, service key]. Trailing "/*" means any subpath of a scope.
export const PAID_JS = [
  ['openai', 'openai'], ['@anthropic-ai/sdk', 'anthropic'], ['stripe', 'stripe'], ['twilio', 'twilio'],
  ['@sendgrid/*', 'sendgrid'], ['resend', 'resend'], ['@aws-sdk/*', 'aws'], ['aws-sdk', 'aws'],
  ['@google-cloud/*', 'google-cloud'], ['googleapis', 'google'], ['@google/generative-ai', 'google'], ['@google/genai', 'google'],
  ['firebase-admin', 'firebase'], ['replicate', 'replicate'], ['elevenlabs', 'elevenlabs'], ['@elevenlabs/*', 'elevenlabs'],
  ['@mistralai/*', 'mistral'], ['cohere-ai', 'cohere'], ['openrouter', 'openrouter'], ['@openrouter/*', 'openrouter'],
  ['@ai-sdk/*', 'ai-provider'], ['@langchain/openai', 'openai'], ['@langchain/anthropic', 'anthropic'],
  ['@langchain/google-genai', 'google'], ['@langchain/mistralai', 'mistral'], ['@langchain/groq', 'groq'], ['groq-sdk', 'groq'],
  ['together-ai', 'together'], ['@pinecone-database/*', 'pinecone'], ['@deepgram/*', 'deepgram'], ['assemblyai', 'assemblyai'],
  ['@fal-ai/*', 'fal'], ['@huggingface/inference', 'huggingface'],
];
export const PAID_PY = [
  ['openai', 'openai'], ['anthropic', 'anthropic'], ['stripe', 'stripe'], ['twilio', 'twilio'], ['sendgrid', 'sendgrid'],
  ['resend', 'resend'], ['boto3', 'aws'], ['botocore', 'aws'], ['google.cloud', 'google-cloud'], ['googleapiclient', 'google'],
  ['google.generativeai', 'google'], ['firebase_admin', 'firebase'], ['replicate', 'replicate'], ['elevenlabs', 'elevenlabs'],
  ['mistralai', 'mistral'], ['cohere', 'cohere'], ['langchain_openai', 'openai'], ['langchain_anthropic', 'anthropic'],
  ['groq', 'groq'], ['together', 'together'], ['pinecone', 'pinecone'], ['litellm', 'ai-provider'],
];

const SOURCE_EXT = /\.(c|m)?[jt]sx?$|\.(py|go|rb|rs|java|kt|php|cs|swift|vue|svelte|astro)$/i;
// Base lookups ignore the harness and prose: a string in a README or in the vendored rb tables is not prior use.
const BASE_EXCLUDES = [':(exclude)tools/rockbuilt', ':(exclude).claude', ':(exclude).agents', ':(exclude).codex', ':(exclude).cursor', ':(exclude)docs', ':(exclude)*.md'];
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|example\.(com|org|net)|.*\.example\.(com|org|net)|.*\.local|.*\.test|.*\.localhost)$/i;
const SECRET_NAME = /(_KEY|_SECRET|_TOKEN)$|_API/;
const ENV_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*['"`]([A-Z][A-Z0-9_]*)['"`]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g,
  /os\.environ\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  /os\.environ\.get\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  /os\.getenv\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  /Deno\.env\.get\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  /os\.Getenv\(\s*"([A-Z][A-Z0-9_]*)"/g,
  /env::var\(\s*"([A-Z][A-Z0-9_]*)"/g,
];
const ENV_DESTRUCTURE = /\{([^}]*)\}\s*=\s*(?:process\.env|import\.meta\.env|Deno\.env\.toObject\(\))/g;

// Cost scanning covers every code file, tests and evals included: they run in CI with real secrets.
function isSource(p) {
  return SOURCE_EXT.test(p);
}

function envNames(line) {
  const out = [];
  for (const re of ENV_PATTERNS) for (const m of line.matchAll(re)) out.push(m[1]);
  for (const m of line.matchAll(ENV_DESTRUCTURE)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':')[0].replace(/=.*$/, '').trim();
      if (/^[A-Z][A-Z0-9_]*$/.test(name)) out.push(name);
    }
  }
  return out;
}

function isComment(line) {
  return /^\s*(\/\/|#|\*|\/\*|<!--)/.test(line);
}

function jsModules(line) {
  const out = [];
  const re = /(?:\bfrom\s+|\brequire\(\s*|\bimport\(\s*|^\s*import\s+)['"]([^'"]+)['"]/g;
  for (const m of line.matchAll(re)) out.push(m[1]);
  return out;
}

function pyModules(line) {
  const m = line.match(/^\s*(?:from\s+([\w.]+)\s+import\b|import\s+([\w.]+(?:\s*,\s*[\w.]+)*))/);
  if (!m) return [];
  if (m[1]) return [m[1]];
  return m[2].split(',').map((s) => s.trim().split(/\s+/)[0]);
}

function paidService(moduleId, table, py) {
  for (const [pat, svc] of table) {
    if (pat.endsWith('/*')) {
      if (moduleId.startsWith(pat.slice(0, -1))) return { pkg: pat, svc };
    } else if (py ? moduleId === pat || moduleId.startsWith(`${pat}.`) : moduleId === pat || moduleId.startsWith(`${pat}/`)) {
      return { pkg: pat, svc };
    }
  }
  return null;
}

// Exact service keys only: "Google Maps" in Paid services does not approve "google" (Gemini).
function approved(svc, paidServices) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = norm(svc);
  return paidServices.some((s) => norm(s.split(/[(:]/)[0]) === key);
}

// Per-file added lines from a unified diff.
export function parseUnifiedDiff(text) {
  const files = new Map();
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) { cur = null; continue; }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      if (p === '/dev/null') { cur = null; continue; }
      cur = normalizePath(p.replace(/^"?b\//, '').replace(/"$/, ''));
      if (!files.has(cur)) files.set(cur, []);
      continue;
    }
    if (line.startsWith('--- ')) continue;
    if (cur && line.startsWith('+')) files.get(cur).push(line.slice(1));
  }
  return files;
}

function patchAdded(patch) {
  if (!patch) return [];
  return patch.split(/\r?\n/).filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
}

function depMap(text) {
  if (text === null || text === undefined) return null;
  try {
    const pkg = JSON.parse(text);
    const out = {};
    for (const f of DEP_FIELDS) for (const [k, v] of Object.entries(pkg[f] || {})) out[`${f}:${k}`] = String(v);
    return out;
  } catch {
    return undefined;
  }
}

// Differences between two package.json texts (null = file absent, undefined = invalid JSON).
export function packageDepChanges(oldText, newText) {
  const a = depMap(oldText);
  const b = depMap(newText);
  if (a === undefined || b === undefined) return ['package.json is not valid JSON'];
  const before = a || {};
  const after = b || {};
  const changes = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const [field, name] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    if (!(k in before)) changes.push(`added ${name}@${after[k]} (${field})`);
    else if (!(k in after)) changes.push(`removed ${name} (${field})`);
    else if (before[k] !== after[k]) changes.push(`${name} ${before[k]} -> ${after[k]} (${field})`);
  }
  return changes;
}

// Core classifier. input: { files: [{ path, status, previousPath, additions, deletions, added: [lines] | null }],
// contentKnown, packageJson(path) -> { old, new }, baseHas(str) -> bool|null, autonomy }.
export function classify({ files, contentKnown = true, packageJson = () => null, baseHas = () => null, autonomy = {} }) {
  const reasons = [];
  const add = (rule, p, detail) => reasons.push({ rule, path: p, detail });
  const sensitive = autonomy.sensitivePaths || [];
  const tierAExtra = autonomy.tierAPaths || [];
  const paid = autonomy.paidServices || [];
  let floor = false;

  for (const f of files) {
    const paths = [f.path, f.previousPath].filter(Boolean).map(normalizePath);
    for (const p of paths) {
      for (const group of FLOOR_PATHS) {
        const g = matchAny(p, group.globs);
        if (g) { add(group.rule, p, `matches ${g}`); floor = true; }
      }
      const s = matchAny(p, sensitive);
      if (s) { add('sensitive-path', p, `project Sensitive paths: ${s}`); floor = true; }
    }
    const p = normalizePath(f.path);
    const base = path.posix.basename(p);
    if (base === 'package.json') {
      if (!contentKnown) { add('dependency', p, 'dependency manifest in the file list (content not inspected)'); floor = true; } else {
        const pj = packageJson(p);
        const changes = pj ? packageDepChanges(pj.old, pj.new) : ['could not read package.json versions'];
        if (changes.length) { add('dependency', p, changes.slice(0, 5).join('; ')); floor = true; }
      }
    } else if (matchAny(p, OTHER_MANIFESTS)) {
      add('dependency', p, 'dependency manifest or lockfile changed'); floor = true;
    }
    // A code or config file whose added lines are unknown (GitHub omits large patches) cannot be scanned.
    if (contentKnown && f.added === null && (f.additions || 0) > 0 && (isSource(p) || /\.(ya?ml|toml|json)$/i.test(p))) {
      add('cost', p, 'diff content not available (patch too large); not scanned'); floor = true;
    }
  }

  // Cost: paid SDK imports, new secret-like env names, new external hosts (added lines only).
  if (contentKnown) {
    const seen = new Set();
    for (const f of files) {
      if (!f.added || !f.added.length) continue;
      const p = normalizePath(f.path);
      const source = isSource(p);
      const py = /\.py$/i.test(p);
      for (const line of f.added) {
        if (source && !isComment(line)) {
          for (const mod of py ? pyModules(line) : jsModules(line)) {
            const hit = paidService(mod, py ? PAID_PY : PAID_JS, py);
            if (!hit || seen.has(`sdk:${hit.pkg}`)) continue;
            seen.add(`sdk:${hit.pkg}`);
            if (approved(hit.svc, paid)) continue;
            const inBase = baseHas(py ? mod : `'${mod}'`) || (!py && baseHas(`"${mod}"`));
            if (inBase === true) continue;
            add('cost', p, `imports paid SDK ${mod}`); floor = true;
          }
          for (const m of line.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|\[::1\]|\d+\.\d+\.\d+\.\d+)(?::\d+)?/gi)) {
            const host = m[1].toLowerCase();
            if (LOCAL_HOSTS.test(host) || seen.has(`host:${host}`)) continue;
            seen.add(`host:${host}`);
            if (baseHas(host) === true) continue;
            add('cost', p, `new external host ${host}`); floor = true;
          }
        }
        if (!isComment(line) && (source || /\.(ya?ml|toml|json)$/i.test(p))) {
          for (const name of envNames(line)) {
            if (!SECRET_NAME.test(name) || seen.has(`env:${name}`)) continue;
            seen.add(`env:${name}`);
            if (baseHas(name) === true) continue;
            add('cost', p, `new secret-like env var ${name}`); floor = true;
          }
        }
      }
    }
  }

  // Deletions and size.
  const deleted = files.filter((f) => f.status === 'deleted');
  if (deleted.length > 10) { add('deletions', '', `${deleted.length} files deleted`); floor = true; }
  const srcDeleted = deleted.filter((f) => normalizePath(f.path).startsWith('src/')).reduce((s, f) => s + (f.deletions || 0), 0);
  if (srcDeleted > 300) { add('deletions', 'src/', `${srcDeleted} lines deleted with files under src/`); floor = true; }
  const changed = files.reduce((s, f) => s + (f.additions || 0) + (f.deletions || 0), 0);
  if (changed > 800) { add('size', '', `${changed} changed lines (> 800)`); floor = true; }

  if (floor) return { tier: 'C', reasons, changedLines: changed };
  const notA = files.map((f) => normalizePath(f.path)).filter((p) => matchAny(p, NOT_TIER_A) || !matchAny(p, [...TIER_A_GLOBS, ...tierAExtra]));
  if (!notA.length) {
    return { tier: 'A', reasons: files.length ? [{ rule: 'tier-a', path: '', detail: 'every changed file is tests, docs, styles or copy' }] : [{ rule: 'tier-a', path: '', detail: 'no changed files' }], changedLines: changed };
  }
  for (const p of notA.slice(0, 20)) add('tier-b', p, 'outside the tier A list');
  return { tier: 'B', reasons, changedLines: changed };
}

const STATUS = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'modified', U: 'modified' };

function baseGrepper(root, ref) {
  if (!ref) return () => null;
  const cache = new Map();
  return (s) => {
    if (cache.has(s)) return cache.get(s);
    const r = git(root, ['grep', '-q', '-F', '-e', s, ref, '--', '.', ...BASE_EXCLUDES]);
    const v = r.status === 0 ? true : r.status === 1 ? false : null;
    cache.set(s, v);
    return v;
  };
}

// Diff of the working tree (committed and uncommitted, plus untracked files) against merge-base(base, HEAD).
export function gitDiffFiles(root, baseRef) {
  const mb = git(root, ['merge-base', baseRef, 'HEAD']);
  const from = mb.ok ? mb.stdout : baseRef;
  const ns = git(root, ['-c', 'core.quotepath=false', 'diff', '--name-status', '-M', from]);
  if (!ns.ok) throw new CliError(`git diff failed: ${ns.stderr}`);
  const num = git(root, ['-c', 'core.quotepath=false', 'diff', '--numstat', '-M', from]);
  const patch = gitRaw(root, ['-c', 'core.quotepath=false', 'diff', '-U0', '--no-color', '-M', from]);
  const added = parseUnifiedDiff(patch.stdout);
  const counts = new Map();
  for (const line of num.stdout.split(/\r?\n/).filter(Boolean)) {
    const [a, d, ...rest] = line.split('\t');
    const p = rest[rest.length - 1];
    counts.set(normalizePath(p), { additions: Number(a) || 0, deletions: Number(d) || 0 });
  }
  const files = [];
  for (const line of ns.stdout.split(/\r?\n/).filter(Boolean)) {
    const parts = line.split('\t');
    const code = parts[0][0];
    const p = normalizePath(parts[parts.length - 1]);
    const prev = parts.length > 2 ? normalizePath(parts[1]) : null;
    const c = counts.get(p) || { additions: 0, deletions: 0 };
    files.push({ path: p, previousPath: prev, status: STATUS[code] || 'modified', ...c, added: added.get(p) || [] });
  }
  const untracked = git(root, ['-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard']);
  for (const p of untracked.stdout.split(/\r?\n/).filter(Boolean)) {
    const text = readText(path.join(root, p)) ?? '';
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    files.push({ path: normalizePath(p), previousPath: null, status: 'added', additions: lines.length, deletions: 0, added: lines });
  }
  return { from, files };
}

// rb risk entry point. mode: { files } | { pr } | { base }.
export function computeRisk(root, { files: fileList, pr, base, gh } = {}) {
  const autonomy = contractInfo(root);
  if (fileList && fileList.length) {
    const files = fileList.map((p) => ({ path: normalizePath(p), status: 'modified', additions: 0, deletions: 0, added: null }));
    return { source: 'files', ...classify({ files, contentKnown: false, autonomy }), files: files.map((f) => f.path) };
  }
  if (pr) {
    if (!gh) throw new CliError('rb risk --pr needs GitHub access');
    const view = ops.prView(gh, pr);
    const prFiles = ops.prFiles(gh, pr);
    const files = prFiles.map((f) => ({ path: f.path, previousPath: f.previous_path, status: f.status === 'removed' ? 'deleted' : f.status, additions: f.additions, deletions: f.deletions, added: f.patch == null ? null : patchAdded(f.patch) }));
    const local = view.base && git(root, ['cat-file', '-e', `${view.base.sha}^{commit}`]).ok ? view.base.sha : resolveBaseRef(root, view.base ? view.base.ref : defaultBranch(root));
    const packageJson = (p) => {
      const f = files.find((x) => x.path === p);
      return { old: f && f.status === 'added' ? null : ops.fileAt(gh, p, view.base.sha), new: f && f.status === 'deleted' ? null : ops.fileAt(gh, p, view.head.sha) };
    };
    const r = classify({ files, packageJson, baseHas: baseGrepper(root, local), autonomy });
    return { source: 'pr', pr: view.number, head: view.head ? view.head.sha : null, ...r, files: summary(files) };
  }
  const branch = base && base !== true ? base : defaultBranch(root);
  const baseRef = git(root, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`]).ok ? branch : resolveBaseRef(root, branch);
  if (!baseRef) throw new CliError(`base ref "${branch}" not found; pass --base <ref> or --files a,b`);
  const { from, files } = gitDiffFiles(root, baseRef);
  const packageJson = (p) => {
    const old = git(root, ['show', `${from}:${p}`]);
    return { old: old.ok ? old.stdout : null, new: readText(path.join(root, p)) };
  };
  const r = classify({ files, packageJson, baseHas: baseGrepper(root, from), autonomy });
  return { source: 'git', base: baseRef, mergeBase: from, ...r, files: summary(files) };
}

function summary(files) {
  return files.map((f) => ({ path: f.path, status: f.status, additions: f.additions, deletions: f.deletions }));
}

export function riskText(r) {
  const lines = [`tier ${r.tier}  (${r.source}${r.pr ? ` #${r.pr}` : ''}${r.base ? ` vs ${r.base}` : ''}, ${r.files.length} file(s), ${r.changedLines} changed lines)`];
  for (const x of r.reasons) lines.push(`  ${x.rule.padEnd(26)} ${x.path || '-'}  ${x.detail}`);
  return lines.join('\n');
}

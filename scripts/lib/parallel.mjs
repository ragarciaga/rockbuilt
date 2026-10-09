// Parallel batching of ready tasks (DESIGN.md section 21, rb parallel).
import { toPosix } from './util.mjs';

// Paths that many tasks tend to touch; a task that lists one of them runs alone.
const SHARED_PATTERNS = [
  { re: /(^|\/)package\.json$/, why: 'package.json' },
  { re: /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|deno\.lock|cargo\.lock|poetry\.lock|uv\.lock|pipfile\.lock|go\.sum|gemfile\.lock|composer\.lock)$/, why: 'lockfile' },
  { re: /(^|\/)(pnpm-workspace\.yaml|go\.mod|cargo\.toml|pyproject\.toml|requirements[^/]*\.txt|gemfile|composer\.json|pipfile)$/, why: 'dependency manifest' },
  { re: /(^|\/)migrations?(\/|$)/, why: 'migrations' },
  { re: /(^|\/)prisma\/schema/, why: 'prisma schema' },
  { re: /(^|\/)supabase(\/|$)/, why: 'supabase/' },
  { re: /(^|\/)drizzle(\/|$)/, why: 'drizzle/' },
  { re: /(^|\/)drizzle\.config\./, why: 'drizzle config' },
  { re: /(^|\/)\.env[^/]*$/, why: '.env file' },
  { re: /(^|\/)[^/]+\.config\.(c|m)?(js|ts)$|(^|\/)[^/]+\.config\.json$/, why: 'config file' },
  { re: /(^|\/)(tsconfig[^/]*\.json|jsconfig\.json|\.eslintrc[^/]*|eslint\.config\.[^/]+|\.prettierrc[^/]*|babel\.config\.[^/]+|\.babelrc|\.npmrc|\.nvmrc|\.editorconfig|dockerfile|docker-compose[^/]*\.ya?ml|compose\.ya?ml|makefile|vercel\.json|netlify\.toml|turbo\.json|nx\.json|setup\.cfg|tox\.ini|pytest\.ini)$/, why: 'config file' },
  { re: /(^|\/)\.github\//, why: '.github/' },
  { re: /(^|\/)claude\.md$/, why: 'CLAUDE.md' },
];

function norm(p) {
  return toPosix(p).replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
}

export function sharedReason(file) {
  const p = norm(file);
  for (const { re, why } of SHARED_PATTERNS) if (re.test(p)) return why;
  return null;
}

// Strip glob parts so "src/foo/**" conflicts with "src/foo/a.ts".
function stem(p) {
  const n = norm(p);
  const star = n.search(/[*?[{]/);
  if (star === -1) return n;
  return n.slice(0, star).replace(/\/[^/]*$/, '').replace(/\/+$/, '');
}

export function pathsConflict(a, b) {
  const x = stem(a);
  const y = stem(b);
  if (x === '' || y === '') return true;
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

function filesConflict(filesA, filesB) {
  for (const a of filesA) for (const b of filesB) if (pathsConflict(a, b)) return [a, b];
  return null;
}

// Returns { ready, excluded, batches, reasons }.
export function planBatches(tasks, { ids = null, max = 3 } = {}) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const excluded = [];
  const ready = [];
  const wanted = ids ? ids.map((s) => s.trim().toUpperCase()).filter(Boolean) : null;

  for (const id of wanted || []) {
    if (!byId.has(id)) excluded.push({ id, reason: 'unknown task id' });
  }
  for (const t of tasks) {
    if (wanted && !wanted.includes(t.id)) continue;
    if (t.status !== 'todo') { excluded.push({ id: t.id, reason: `status is ${t.status}` }); continue; }
    const pending = t.depends.filter((d) => byId.get(d)?.status !== 'done');
    if (pending.length) { excluded.push({ id: t.id, reason: `waits on ${pending.join(', ')}` }); continue; }
    ready.push(t);
  }

  const reasons = [];
  const serial = [];
  const pool = [];
  for (const t of ready) {
    if (t.files.length === 0) {
      serial.push(t);
      reasons.push(`${t.id} runs alone: no Files list`);
      continue;
    }
    const shared = t.files.map((f) => [f, sharedReason(f)]).find(([, why]) => why);
    if (shared) {
      serial.push(t);
      reasons.push(`${t.id} runs alone: touches shared path ${shared[0]} (${shared[1]})`);
      continue;
    }
    pool.push(t);
  }

  const cap = Math.max(1, Number(max) || 1);
  const batches = [];
  for (const t of pool) {
    let placed = false;
    for (const b of batches) {
      if (b.length >= cap) continue;
      const clash = b.map((o) => [o, filesConflict(t.files, o.files)]).find(([, c]) => c);
      if (clash) {
        reasons.push(`${t.id} not with ${clash[0].id}: both touch ${clash[1][0]}`);
        continue;
      }
      b.push(t);
      placed = true;
      break;
    }
    if (!placed) batches.push([t]);
  }
  for (const t of serial) batches.push([t]);

  return {
    max: cap,
    ready: ready.map((t) => t.id),
    excluded,
    batches: batches.map((b) => b.map((t) => t.id)),
    reasons: [...new Set(reasons)],
  };
}

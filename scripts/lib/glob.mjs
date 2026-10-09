// Minimal glob matcher: `**` (any depth, including none), `*` (within a segment), `?` (one char).
// Patterns without a slash match the basename at any depth (gitignore style); patterns with a
// slash are anchored at the repo root. Paths and patterns use forward slashes.
import { toPosix } from './util.mjs';

const cache = new Map();

function escapeChar(c) {
  return /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
}

export function globToRegExp(pattern) {
  const key = pattern;
  if (cache.has(key)) return cache.get(key);
  let p = toPosix(String(pattern).trim()).replace(/^\.\//, '');
  if (p.endsWith('/')) p = `${p}**`;
  const anchored = p.includes('/');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        const before = i === 0 || p[i - 1] === '/';
        const after = p[i + 2] === '/' || i + 2 === p.length;
        if (before && after) {
          if (p[i + 2] === '/') { re += '(?:[^/]*/)*'; i += 2; } else { re += '.*'; i += 1; }
          continue;
        }
        re += '[^/]*';
        i += 1;
        continue;
      }
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += escapeChar(c);
    }
  }
  const full = new RegExp(anchored ? `^${re}$` : `^(?:.*/)?${re}$`);
  cache.set(key, full);
  return full;
}

export function normalizePath(p) {
  return toPosix(String(p)).replace(/^\.\//, '').replace(/^\/+/, '');
}

export function matchGlob(file, pattern) {
  return globToRegExp(pattern).test(normalizePath(file));
}

// First matching pattern, or null.
export function matchAny(file, patterns) {
  for (const p of patterns) if (matchGlob(file, p)) return p;
  return null;
}

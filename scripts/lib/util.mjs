import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.exitCode = code;
  }
}

// Minimal flag parser: --flag value, --flag=value, boolean --flag. Positionals kept in order.
export function parseArgs(argv, booleans = []) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const name = a.slice(2);
      if (booleans.includes(name) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) flags[name] = true;
      else flags[name] = argv[++i];
      continue;
    }
    positionals.push(a);
  }
  return { flags, positionals };
}

export function run(cmd, args, opts = {}) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts });
    if (r.error) return { ok: false, status: null, stdout: '', stderr: String(r.error.message), missing: r.error.code === 'ENOENT' };
    return { ok: r.status === 0, status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim(), missing: false };
  } catch (e) {
    return { ok: false, status: null, stdout: '', stderr: String(e.message), missing: true };
  }
}

export function git(cwd, args) {
  return run('git', args, { cwd });
}

export function gh(cwd, args) {
  return run('gh', args, { cwd });
}

export function repoRoot(cwd) {
  const r = git(cwd, ['rev-parse', '--show-toplevel']);
  return r.ok ? path.resolve(r.stdout) : null;
}

export function requireRepoRoot(cwd) {
  const root = repoRoot(cwd);
  if (!root) throw new CliError('not inside a git repository');
  return root;
}

// Project root: git toplevel when available, otherwise cwd.
export function projectRoot(cwd) {
  return repoRoot(cwd) || path.resolve(cwd);
}

export function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function exists(file) {
  return existsSync(file);
}

export function slugify(text, max = 40) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function toPosix(p) {
  return p.replace(/\\/g, '/');
}

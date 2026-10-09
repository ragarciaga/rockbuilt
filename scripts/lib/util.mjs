import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Directory holding rb.mjs: scripts/ in the plugin source, tools/rockbuilt/ when vendored.
export const CODE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Plugin source root when running from the plugin (scripts/ next to .claude-plugin/), else null.
export function pluginRoot() {
  const candidates = [];
  if (process.env.CLAUDE_PLUGIN_ROOT) candidates.push(path.resolve(process.env.CLAUDE_PLUGIN_ROOT));
  if (path.basename(CODE_DIR) === 'scripts') candidates.push(path.dirname(CODE_DIR));
  for (const c of candidates) if (existsSync(path.join(c, '.claude-plugin', 'plugin.json'))) return c;
  return null;
}

// Kept for v0.2 callers: the plugin root when known, otherwise the parent of CODE_DIR.
export const PLUGIN_ROOT = pluginRoot() || path.dirname(CODE_DIR);

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
    const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...opts });
    if (r.error) return { ok: false, status: null, stdout: '', stderr: String(r.error.message), missing: r.error.code === 'ENOENT' };
    return { ok: r.status === 0, status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim(), missing: false };
  } catch (e) {
    return { ok: false, status: null, stdout: '', stderr: String(e.message), missing: true };
  }
}

export function git(cwd, args) {
  return run('git', args, { cwd });
}

// Untrimmed variant for outputs where leading whitespace matters (diffs).
export function gitRaw(cwd, args) {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
    return { ok: r.status === 0, status: r.status, stdout: r.stdout || '', stderr: (r.stderr || '').trim() };
  } catch (e) {
    return { ok: false, status: null, stdout: '', stderr: String(e.message) };
  }
}

export function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Comma or newline separated list flag ("a,b" or true/undefined -> []).
export function listFlag(value) {
  if (value === undefined || value === true || value === null) return [];
  return String(value).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

// Flag that must carry a value.
export function stringFlag(flags, name, { required = false } = {}) {
  const v = flags[name];
  if (v === undefined) {
    if (required) throw new CliError(`--${name} is required`, 2);
    return undefined;
  }
  if (v === true) throw new CliError(`--${name} needs a value`, 2);
  return String(v);
}

// Synchronous sleep without busy waiting.
export function sleepMs(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Current time, overridable for tests with RB_NOW (ISO string).
export function now() {
  return process.env.RB_NOW ? new Date(process.env.RB_NOW) : new Date();
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

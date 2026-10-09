#!/usr/bin/env node
// Rockbuilt PreToolUse guard (DESIGN.md section 9).
// A tripwire, not a sandbox: anything it cannot parse is allowed (exit 0).
// Deny = exit 2 with one stderr line "rockbuilt guard: <rule>".

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NO_GIT_ROLES = new Set(['implementer', 'e2e-writer']);
const READONLY_GIT_ROLES = new Set([
  'verifier', 'healer', 'scout', 'security-reviewer', 'planner', 'task-reviewer',
]);
const NO_WRITE_ROLES = new Set(['scout', 'planner', 'task-reviewer', 'healer', 'security-reviewer']);
const READONLY_GIT_SUBCOMMANDS = new Set([
  'status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'merge-base', 'blame', 'grep', 'restore',
]);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// Words that run the rest of the line as a command.
const PREFIX_COMMANDS = new Set(['env', 'command', 'exec', 'sudo', 'nohup', 'time', 'nice', 'xargs', 'builtin', 'stdbuf']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const SHELL_KEYWORDS = new Set(['{', '}', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until']);

// git global options that consume the following word.
const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
// git push options that consume the following word.
const PUSH_OPTS_WITH_VALUE = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo']);

const MAX_DEPTH = 5;

// ---------- role ----------

export function roleOf(agentType) {
  if (typeof agentType !== 'string' || agentType.trim() === '') return null;
  const parts = agentType.trim().split(':');
  return parts[parts.length - 1].toLowerCase();
}

// ---------- shell tokenizer ----------

// Splits a shell string into simple commands (arrays of words).
// Separators: ; & | && || newline ( ) and backticks. Quotes and backslashes are honored.
export function splitCommands(src) {
  const commands = [];
  let words = [];
  let word = '';
  let inWord = false;
  const pushWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const pushCommand = () => {
    pushWord();
    if (words.length) commands.push(words);
    words = [];
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'") {
      const end = src.indexOf("'", i + 1);
      const stop = end === -1 ? src.length : end;
      word += src.slice(i + 1, stop);
      inWord = true;
      i = stop + 1;
      continue;
    }
    if (ch === '"') {
      i++;
      inWord = true;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length && '"\\$`'.includes(src[i + 1])) {
          word += src[i + 1];
          i += 2;
          continue;
        }
        word += src[i];
        i++;
      }
      i++;
      continue;
    }
    if (ch === '\\') {
      if (src[i + 1] === '\n') { i += 2; continue; }
      if (i + 1 < src.length) { word += src[i + 1]; inWord = true; }
      i += 2;
      continue;
    }
    if (ch === '&' && (src[i - 1] === '>' || src[i + 1] === '>')) {
      word += ch;
      inWord = true;
      i++;
      continue;
    }
    if (ch === '$' && src[i + 1] === '(') {
      pushCommand();
      i += 2;
      continue;
    }
    if (';&|\n\r()`'.includes(ch)) {
      pushCommand();
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      pushWord();
      i++;
      continue;
    }
    if (ch === '#' && !inWord) {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    word += ch;
    inWord = true;
    i++;
  }
  pushCommand();
  return commands;
}

// Command substitutions inside double quotes survive tokenizing as plain text,
// so they are extracted from the raw string and scanned separately.
function embeddedSubstitutions(src) {
  const found = [];
  for (const m of src.matchAll(/\$\(([^()]*)\)/g)) found.push(m[1]);
  for (const m of src.matchAll(/`([^`]*)`/g)) found.push(m[1]);
  return found;
}

function isRedirect(w) {
  return /^\d*(>>?|<<?|>&|<&|&>>?)/.test(w);
}

function stripRedirects(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (isRedirect(w)) {
      // Operator alone ("2>", ">") takes the next word as its target.
      if (/^\d*(>>?|<<?|&>>?)$/.test(w)) i++;
      continue;
    }
    out.push(w);
  }
  return out;
}

function commandName(word) {
  let w = word.replace(/^\\/, '');
  w = w.replace(/\\/g, '/');
  w = w.slice(w.lastIndexOf('/') + 1).toLowerCase();
  return w.replace(/\.(exe|cmd|bat)$/, '');
}

// Removes env assignments and wrapper commands; returns { words } or { inner } for sh -c.
function unwrap(words) {
  let w = stripRedirects(words);
  for (let guard = 0; guard < 10 && w.length; guard++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || SHELL_KEYWORDS.has(w[0])) { w = w.slice(1); continue; }
    const name = commandName(w[0]);
    if (PREFIX_COMMANDS.has(name)) {
      w = w.slice(1);
      // Skip the wrapper's own options (env -i, nice -n 5, xargs -n1, ...).
      while (w.length && w[0].startsWith('-')) {
        const opt = w[0];
        w = w.slice(1);
        if ((opt === '-n' || opt === '-u' || opt === '-I' || opt === '-C') && w.length) w = w.slice(1);
      }
      continue;
    }
    if (name === 'timeout') {
      w = w.slice(1);
      while (w.length && w[0].startsWith('-')) w = w.slice(1);
      w = w.slice(1); // duration
      continue;
    }
    if (SHELLS.has(name)) {
      const idx = w.findIndex((x, k) => k > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(x));
      if (idx !== -1 && w[idx + 1] !== undefined) return { inner: w[idx + 1] };
      return { words: w };
    }
    if (name === 'eval') return { inner: w.slice(1).join(' ') };
    break;
  }
  return { words: w };
}

// ---------- git / gh parsing ----------

export function parseGit(words) {
  let cPath = null;
  let i = 1;
  while (i < words.length) {
    const w = words[i];
    if (GIT_OPTS_WITH_VALUE.has(w)) {
      if (w === '-C') cPath = cPath ? path.join(cPath, words[i + 1] || '') : words[i + 1];
      i += 2;
      continue;
    }
    if (w.startsWith('-')) { i++; continue; }
    break;
  }
  return { sub: words[i] ? words[i].toLowerCase() : null, args: words.slice(i + 1), cPath };
}

function ghPositionals(words) {
  const out = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w === '-R' || w === '--repo') { i++; continue; }
    if (w.startsWith('-')) continue;
    out.push(w.toLowerCase());
  }
  return out;
}

export function isGhPrMerge(words) {
  const pos = ghPositionals(words);
  return pos[0] === 'pr' && pos[1] === 'merge';
}

function normalizeBranch(ref) {
  let r = ref.trim();
  if (r.startsWith('refs/heads/')) r = r.slice('refs/heads/'.length);
  return r;
}

// Returns null when allowed, or a denial reason.
export function checkPush(args, ctx) {
  const positionals = [];
  let force = false;
  let all = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { positionals.push(...args.slice(i + 1)); break; }
    if (PUSH_OPTS_WITH_VALUE.has(a)) { i++; continue; }
    if (a === '--force' || a === '--force-with-lease' || a.startsWith('--force-with-lease=')) { force = true; continue; }
    if (a === '--all' || a === '--mirror') { all = true; continue; }
    if (a.startsWith('--')) continue;
    if (a.startsWith('-')) {
      if (a.slice(1).includes('f')) force = true;
      continue;
    }
    positionals.push(a);
  }
  if (force) return 'force push is not allowed';
  const refspecs = positionals.slice(1);
  if (refspecs.some((r) => r.startsWith('+'))) return 'force push (+refspec) is not allowed';

  const defaults = ctx.defaultBranches().map((b) => b.toLowerCase());
  if (all) return `git push --all/--mirror would push the default branch (${defaults.join('/')})`;

  const destinations = [];
  if (refspecs.length === 0) {
    destinations.push(ctx.currentBranch());
  } else {
    for (const spec of refspecs) {
      const colon = spec.indexOf(':');
      const src = colon === -1 ? spec : spec.slice(0, colon);
      const dst = colon === -1 ? spec : spec.slice(colon + 1);
      if (colon === -1 && (src === 'HEAD' || src === '@')) destinations.push(ctx.currentBranch());
      else destinations.push(dst);
    }
  }
  for (const d of destinations) {
    if (!d) continue; // unknown current branch: no opinion
    const branch = normalizeBranch(d).toLowerCase();
    if (defaults.includes(branch)) return `push to the default branch (${branch}) is not allowed; open a PR`;
  }
  return null;
}

// ---------- bash decision ----------

function checkWords(words, role, ctx, depth) {
  const u = unwrap(words);
  if (u.inner !== undefined) return checkCommandString(u.inner, role, ctx, depth + 1);
  const w = u.words;
  if (!w.length) return null;
  const name = commandName(w[0]);

  if (name === 'gh') {
    if (role && (NO_GIT_ROLES.has(role) || READONLY_GIT_ROLES.has(role))) return `gh is not allowed for ${role}`;
    if (role && isGhPrMerge(w)) return 'gh pr merge is not allowed for subagents; merging is a human gate';
    return null;
  }
  if (name !== 'git') return null;

  if (role && NO_GIT_ROLES.has(role)) return `git is not allowed for ${role}`;
  const g = parseGit(w);
  if (role && READONLY_GIT_ROLES.has(role) && g.sub && !READONLY_GIT_SUBCOMMANDS.has(g.sub)) {
    return `git ${g.sub} is not allowed for ${role} (read-only git only)`;
  }
  if (g.sub === 'push') {
    const dir = g.cPath ? path.resolve(ctx.cwd, g.cPath) : ctx.cwd;
    return checkPush(g.args, ctx.at(dir));
  }
  return null;
}

function checkCommandString(src, role, ctx, depth = 0) {
  if (depth > MAX_DEPTH || typeof src !== 'string') return null;
  let cwdCtx = ctx;
  for (const words of splitCommands(src)) {
    // Track "cd dir" so a later "git push" is resolved in the right repo.
    if (commandName(words[0]) === 'cd' && words[1]) {
      cwdCtx = cwdCtx.at(path.resolve(cwdCtx.cwd, words[1]));
      continue;
    }
    const reason = checkWords(words, role, cwdCtx, depth);
    if (reason) return reason;
  }
  for (const inner of embeddedSubstitutions(src)) {
    const reason = checkCommandString(inner, role, cwdCtx, depth + 1);
    if (reason) return reason;
  }
  return null;
}

// ---------- edit/write decision ----------

export function protectedPathReason(filePath, cwd) {
  if (typeof filePath !== 'string' || !filePath) return null;
  let p = filePath.replace(/\\/g, '/');
  const base = (cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  // Judge the path relative to the project so a project living under ~/.claude is not blocked.
  if (base && p.toLowerCase().startsWith(base.toLowerCase() + '/')) p = p.slice(base.length + 1);
  const segs = p.split('/').filter((s) => s && s !== '.').map((s) => s.toLowerCase());
  if (segs.includes('.claude')) return '.claude/';
  if (segs.includes('.rockbuilt')) return '.rockbuilt/';
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === '.github' && segs[i + 1] === 'workflows') return '.github/workflows/';
  }
  if (segs[segs.length - 1] === 'claude.md') return 'CLAUDE.md';
  return null;
}

function checkWrite(toolName, toolInput, role, cwd) {
  if (!role) return null;
  if (NO_WRITE_ROLES.has(role)) return `${toolName} is not allowed for ${role} (read-only role)`;
  const target = toolInput.file_path ?? toolInput.notebook_path ?? toolInput.path;
  const prot = protectedPathReason(target, cwd);
  if (prot) return `subagents may not edit ${prot} (orchestrator-owned)`;
  return null;
}

// ---------- git lookups (injectable) ----------

function runGit(dir, args) {
  try {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 3000, windowsHide: true });
    if (r.status !== 0) return null;
    return r.stdout.trim();
  } catch {
    return null;
  }
}

function claudeMdDefaultBranch(dir) {
  const top = runGit(dir, ['rev-parse', '--show-toplevel']) || dir;
  try {
    const text = readFileSync(path.join(top, 'CLAUDE.md'), 'utf8');
    const m = text.match(/^Default branch:\s*([^\s#]+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export const realGitEnv = {
  currentBranch(dir) {
    const b = runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (b && b !== 'HEAD') return b;
    // Unborn branch (no commits yet): rev-parse fails but symbolic-ref still names it.
    return runGit(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  },
  defaultBranches(dir) {
    const fromDoc = claudeMdDefaultBranch(dir);
    if (fromDoc) return [fromDoc];
    const ref = runGit(dir, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
    if (ref) return [ref.replace(/^refs\/remotes\/origin\//, '')];
    return ['main', 'master'];
  },
};

function makeCtx(cwd, env) {
  const memo = new Map();
  const cached = (key, fn) => {
    if (!memo.has(key)) memo.set(key, fn());
    return memo.get(key);
  };
  const at = (dir) => ({
    cwd: dir,
    at,
    currentBranch: () => cached(`cur:${dir}`, () => env.currentBranch(dir)),
    defaultBranches: () => cached(`def:${dir}`, () => env.defaultBranches(dir) || ['main', 'master']),
  });
  return at(cwd);
}

// ---------- entry points ----------

export function decide(input, env = realGitEnv) {
  if (!input || typeof input !== 'object') return { deny: false, reason: null };
  const role = roleOf(input.agent_type);
  const toolName = input.tool_name;
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  let reason = null;
  if (toolName === 'Bash') reason = checkCommandString(toolInput.command, role, makeCtx(cwd, env));
  else if (WRITE_TOOLS.has(toolName)) reason = checkWrite(toolName, toolInput, role, cwd);
  return reason ? { deny: true, reason } : { deny: false, reason: null };
}

function main() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    process.exit(0);
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  let result;
  try {
    result = decide(input);
  } catch {
    process.exit(0);
  }
  if (result.deny) {
    process.stderr.write(`rockbuilt guard: ${result.reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

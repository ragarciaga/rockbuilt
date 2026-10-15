#!/usr/bin/env node
// Rockbuilt guard (DESIGN.md section 13). One script for Claude Code, Cursor and Codex.
// A tripwire, not a sandbox: anything it cannot parse is allowed (exit 0).
// Deny: Claude Code and Codex get exit 2 with one stderr line "rockbuilt guard: <rule>";
// Cursor gets {"permission":"deny",...} on stdout and exit 2.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- roles ----------

export const WRITE_ROLES = new Set(['implementer', 'e2e-writer']);
export const READONLY_ROLES = new Set([
  'scout', 'planner', 'task-reviewer', 'verifier', 'auditor', 'security-reviewer', 'healer',
]);
// Read-only roles that may still use Edit (transient mutation probes, DESIGN 4).
const READONLY_EDITORS = new Set(['verifier']);

// rb subcommands no subagent may run (orchestrator only).
const PRIVILEGED_RB = new Set([
  'merge-gate', 'gh', 'lock', 'control', 'digest', 'escalate', 'revert', 'protect', 'vendor', 'init', 'flaky', 'hours',
]);
// rb subcommands a read-only role may run (they only read).
const READONLY_RB = new Set(['verify-cmds', 'tasks', 'parallel', 'risk', 'doctor', 'stop', 'help', '--help', 'review-delta', 'e2e-plan']);

// "rb-implementer", "rockbuilt:rb-implementer", "implementer" -> "implementer".
export function roleOf(agentType) {
  if (typeof agentType !== 'string' || agentType.trim() === '') return null;
  const parts = agentType.trim().split(':');
  return parts[parts.length - 1].trim().toLowerCase().replace(/^rb-/, '') || null;
}

// ---------- payload normalizers ----------

const CURSOR_EVENTS = new Set([
  'preToolUse', 'beforeShellExecution', 'beforeReadFile', 'afterFileEdit', 'beforeMCPExecution',
  'postToolUse', 'afterShellExecution',
]);
export const CURSOR_PERMISSION_EVENTS = new Set(['preToolUse', 'beforeShellExecution', 'beforeReadFile', 'beforeMCPExecution']);

export function detectTool(input, envVars = process.env) {
  const forced = String(envVars?.ROCKBUILT_TOOL || '').toLowerCase();
  if (forced === 'claude' || forced === 'cursor' || forced === 'codex') return forced;
  if (!input || typeof input !== 'object') return 'claude';
  if (CURSOR_EVENTS.has(input.hook_event_name) || 'cursor_version' in input || 'workspace_roots' in input) return 'cursor';
  if (input.tool_name === 'apply_patch' || 'turn_id' in input) return 'codex';
  return 'claude';
}

// Paths named in a Codex apply_patch body.
export function patchPaths(patch) {
  if (typeof patch !== 'string') return [];
  const out = [];
  for (const m of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$/gm)) out.push(m[1]);
  for (const m of patch.matchAll(/^\*\*\* Move to:\s*(.+?)\s*$/gm)) out.push(m[1]);
  return out;
}

const CLAUDE_WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const CURSOR_WRITE_TOOLS = new Set(['Write', 'Edit', 'Delete', 'StrReplace', 'MultiEdit', 'EditNotebook']);

function filePathOf(ti) {
  return ti.file_path ?? ti.notebook_path ?? ti.path ?? ti.target_file ?? ti.filePath ?? null;
}

// -> { tool, kind: 'shell'|'write'|'read'|'other', command, paths, role, cwd, event }
export function normalize(input, envVars = process.env) {
  const tool = detectTool(input, envVars);
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const roleSource = input.agent_type ?? input.subagent_type ?? envVars?.ROCKBUILT_ROLE;
  const role = roleOf(roleSource);
  const roots = Array.isArray(input.workspace_roots) ? input.workspace_roots : [];
  let cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : roots[0] || process.cwd();
  const n = { tool, kind: 'other', command: null, paths: [], role, cwd, event: input.hook_event_name || null, name: input.tool_name || null };
  const name = input.tool_name;

  if (tool === 'cursor') {
    const ev = input.hook_event_name;
    if (ev === 'beforeShellExecution') {
      n.kind = 'shell';
      n.command = input.command;
    } else if (ev === 'beforeReadFile') {
      n.kind = 'read';
      n.paths = [input.file_path];
    } else if (ev === 'preToolUse') {
      if (name === 'Shell') {
        n.kind = 'shell';
        n.command = ti.command;
        if (typeof ti.working_directory === 'string' && ti.working_directory) n.cwd = ti.working_directory;
      } else if (name === 'Read') {
        n.kind = 'read';
        n.paths = [filePathOf(ti)];
      } else if (CURSOR_WRITE_TOOLS.has(name)) {
        n.kind = 'write';
        n.paths = [filePathOf(ti)];
      }
    }
  } else if (name === 'Bash') {
    n.kind = 'shell';
    n.command = ti.command;
  } else if (name === 'apply_patch') {
    n.kind = 'write';
    n.paths = patchPaths(ti.command ?? ti.patch ?? ti.input);
  } else if (CLAUDE_WRITE_TOOLS.has(name)) {
    n.kind = 'write';
    n.paths = [filePathOf(ti)];
  } else if (name === 'Read') {
    n.kind = 'read';
    n.paths = [filePathOf(ti)];
  } else if (name === 'Grep' || name === 'Glob') {
    n.kind = 'read';
    n.paths = [ti.path, ti.glob, ti.pattern && name === 'Glob' ? ti.pattern : null];
  }
  n.paths = n.paths.filter((p) => typeof p === 'string' && p);
  return n;
}

// ---------- shell tokenizer ----------

const REDIRECT_RE = /^(\d*)(<<<|<<-|<<|<>|>>|>\||>&|<&|&>>|&>|>|<)(\S*)$/;

// Splits a shell string into simple commands (arrays of words). Separators: ; & | && || newline
// ( ) and backticks. Quotes and backslashes are honored. Redirection operators become their own
// words ("2>&1", ">>", "<") so they can be inspected.
export function splitCommands(src) {
  const commands = [];
  let words = [];
  let word = '';
  let inWord = false;
  let expectDelim = null; // '<<' or '<<-' waiting for its delimiter word
  let heredocs = []; // [{ delim, strip, owner }]
  const pushWord = () => {
    if (inWord) {
      words.push(word);
      if (expectDelim) {
        heredocs.push({ delim: word, strip: expectDelim === '<<-', owner: words });
        expectDelim = null;
      }
    }
    word = '';
    inWord = false;
  };
  const pushCommand = () => {
    pushWord();
    if (words.length) commands.push(words);
    words = [];
  };
  // Here-document bodies are data, not commands; they are attached to the owning command as
  // `.heredoc` so a shell reading them (bash <<EOF) can still be inspected.
  const skipHeredocs = () => {
    for (const h of heredocs) {
      const body = [];
      while (i < src.length) {
        const nl = src.indexOf('\n', i);
        const line = src.slice(i, nl === -1 ? src.length : nl);
        i = nl === -1 ? src.length : nl + 1;
        if ((h.strip ? line.replace(/^\t+/, '') : line).replace(/\r$/, '') === h.delim) break;
        body.push(line);
      }
      h.owner.heredoc = (h.owner.heredoc ? `${h.owner.heredoc}\n` : '') + body.join('\n');
    }
    heredocs = [];
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
    if (ch === '<' || ch === '>' || (ch === '&' && src[i + 1] === '>')) {
      if (ch === '<' && src[i + 1] === '(') { pushCommand(); i += 2; continue; } // process substitution
      const fd = inWord && /^\d+$/.test(word) ? word : '';
      if (fd) { word = ''; inWord = false; } else pushWord();
      const m = src.slice(i).match(/^(<<<|<<-|<<|<>|>>|>\||>&|<&|&>>|&>|>|<)/);
      let op = m[1];
      i += op.length;
      if (op.endsWith('&')) {
        const t = src.slice(i).match(/^(\d+|-)/);
        if (t) { op += t[1]; i += t[1].length; }
      }
      words.push(fd + op);
      if (op === '<<' || op === '<<-') expectDelim = op;
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
      if (ch === '\n' && heredocs.length) skipHeredocs();
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

// Command substitutions inside double quotes survive tokenizing as plain text.
function embeddedSubstitutions(src) {
  const found = [];
  for (const m of src.matchAll(/\$\(([^()]*)\)/g)) found.push(m[1]);
  for (const m of src.matchAll(/`([^`]*)`/g)) found.push(m[1]);
  return found;
}

// Separates redirections from words: { words, redirects: [{ op, target, output }] }.
function parseSegment(raw) {
  const words = [];
  const redirects = [];
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i].match(REDIRECT_RE);
    if (!m) { words.push(raw[i]); continue; }
    const op = m[2];
    let target = m[3] || '';
    const dup = (op === '>&' || op === '<&') && /^(\d+|-)$/.test(target);
    if (!target && !dup) { target = raw[i + 1] ?? ''; i++; }
    const output = op.includes('>') && !dup;
    redirects.push({ op, target, output });
  }
  return { words, redirects };
}

const DEV_NULL = new Set(['/dev/null', 'nul', '$null', '/dev/stdout', '/dev/stderr']);
const isDevNull = (t) => DEV_NULL.has(String(t).toLowerCase());

export function commandName(word) {
  let w = String(word || '').replace(/^\\/, '');
  w = w.replace(/\\/g, '/');
  w = w.slice(w.lastIndexOf('/') + 1).toLowerCase();
  return w.replace(/\.(exe|cmd|bat|ps1)$/, '');
}

// Words that run the rest of the line as a command.
const PREFIX_COMMANDS = new Set(['env', 'command', 'exec', 'sudo', 'nohup', 'time', 'nice', 'xargs', 'builtin', 'stdbuf', 'doas']);
const POSIX_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const SHELL_KEYWORDS = new Set(['{', '}', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', 'fi', 'done']);

// Removes env assignments and wrapper commands. Returns { words, wrappers } or { inner, via }.
function unwrap(words) {
  let w = words;
  const wrappers = [];
  for (let guard = 0; guard < 10 && w.length; guard++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || SHELL_KEYWORDS.has(w[0])) { w = w.slice(1); continue; }
    const name = commandName(w[0]);
    if (PREFIX_COMMANDS.has(name)) {
      wrappers.push(name);
      w = w.slice(1);
      while (w.length && w[0].startsWith('-')) {
        const opt = w[0];
        w = w.slice(1);
        if (['-n', '-u', '-I', '-C', '-L', '-P', '-s', '-d'].includes(opt) && w.length) w = w.slice(1);
      }
      continue;
    }
    if (name === 'timeout') {
      wrappers.push(name);
      w = w.slice(1);
      while (w.length && w[0].startsWith('-')) w = w.slice(1);
      w = w.slice(1); // duration
      continue;
    }
    if (POSIX_SHELLS.has(name)) {
      const idx = w.findIndex((x, k) => k > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(x));
      if (idx !== -1 && w[idx + 1] !== undefined) return { inner: w[idx + 1], via: name };
      return { words: w, wrappers };
    }
    if (name === 'cmd') {
      const idx = w.findIndex((x, k) => k > 0 && /^\/[ck]$/i.test(x));
      if (idx !== -1) return { inner: w.slice(idx + 1).join(' '), via: name };
      return { words: w, wrappers };
    }
    if (name === 'pwsh' || name === 'powershell') {
      const idx = w.findIndex((x, k) => k > 0 && /^-(c|command)$/i.test(x));
      if (idx !== -1) return { inner: w.slice(idx + 1).join(' '), via: name };
      return { words: w, wrappers };
    }
    if (name === 'eval') return { inner: w.slice(1).join(' '), via: name };
    break;
  }
  return { words: w, wrappers };
}

// ---------- path rules ----------

// .git and .husky hold hooks and config that run with the orchestrator's credentials on its next commit or push.
const PROTECTED_DIRS = new Set(['.claude', '.cursor', '.codex', '.agents', '.github', '.rockbuilt', '.git', '.husky']);
const PROTECTED_FILES = new Set(['agents.md', 'claude.md', '.mcp.json']);

export function isEnvName(p) {
  const s = String(p || '').replace(/\\/g, '/');
  const base = s.slice(s.lastIndexOf('/') + 1).toLowerCase();
  if (!base.startsWith('.env') && !base.endsWith('.env')) return false;
  if (/\.(example|sample|template|dist)$/.test(base)) return false;
  return true;
}

function segmentsReason(segs) {
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (PROTECTED_DIRS.has(s)) return `${s}/`;
    if ((s === 'tools' || s === 'docs') && segs[i + 1] === 'rockbuilt') return `${s}/rockbuilt/`;
  }
  const last = segs[segs.length - 1] || '';
  if (PROTECTED_FILES.has(last)) return last === 'agents.md' ? 'AGENTS.md' : last === 'claude.md' ? 'CLAUDE.md' : last;
  if (last.startsWith('.env') || last.endsWith('.env')) return '.env*';
  return null;
}

function splitSegs(p) {
  return p.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.').map((s) => s.toLowerCase());
}

function lexicalReason(filePath, cwd) {
  let p = filePath.replace(/\\/g, '/');
  const base = (cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  // Judge the path relative to the project so a project living under ~/.claude is not blocked.
  if (base && p.toLowerCase().startsWith(base.toLowerCase() + '/')) p = p.slice(base.length + 1);
  return segmentsReason(splitSegs(p));
}

// Resolves symlinks through the nearest existing ancestor.
function realResolve(abs) {
  let cur = abs;
  const rest = [];
  for (let k = 0; k < 64; k++) {
    if (existsSync(cur)) {
      try {
        return path.join(realpathSync(cur), ...rest);
      } catch {
        return null;
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  return null;
}

function realReason(filePath, cwd) {
  try {
    const abs = path.resolve(cwd || process.cwd(), filePath);
    const real = realResolve(abs);
    if (!real) return null;
    const realBase = realResolve(path.resolve(cwd || process.cwd()));
    if (realBase) {
      const rel = path.relative(realBase, real);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return segmentsReason(splitSegs(rel));
      if (rel === '') return null;
    }
    return segmentsReason(splitSegs(real));
  } catch {
    return null;
  }
}

// Reason when a subagent may not write this path, else null. Symlinks are resolved.
export function protectedPathReason(filePath, cwd) {
  if (typeof filePath !== 'string' || !filePath) return null;
  return lexicalReason(filePath, cwd) || realReason(filePath, cwd);
}

// Text mentions of protected paths (for shell commands and inline code).
const MENTION_RES = [
  /(^|[^\w.-])\.(claude|cursor|codex|agents|github|rockbuilt)(?![\w.-])/i,
  /(^|[^\w.-])(agents|claude)\.md(?![\w.-])/i,
  /(^|[^\w.-])(tools|docs)\/rockbuilt(?![\w.-])/i,
  /\.mcp\.json(?![\w.-])/i,
  /(^|[^\w.-])\.env(?![\w-])/i,
];
export function mentionsProtected(text) {
  const t = String(text || '').replace(/\\/g, '/');
  return MENTION_RES.some((re) => re.test(t));
}

// Text mentions of a secret env file (".env", ".env.local"; not ".env.example").
const ENV_MENTION_RE = /(^|[^\w.-])\.env(\.(?!example\b|sample\b|template\b|dist\b)[\w.-]+)?(?![\w-])/i;
export function mentionsEnvFile(text) {
  return ENV_MENTION_RE.test(String(text || ''));
}

// ---------- git / gh / rb parsing ----------

const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix']);
const PUSH_OPTS_WITH_VALUE = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo']);

export function parseGit(words) {
  let cPath = null;
  const globals = [];
  let i = 1;
  while (i < words.length) {
    const w = words[i];
    if (GIT_OPTS_WITH_VALUE.has(w)) {
      globals.push(w);
      if (w === '-C') cPath = cPath ? path.join(cPath, words[i + 1] || '') : words[i + 1];
      i += 2;
      continue;
    }
    if (w.startsWith('-')) { globals.push(w); i++; continue; }
    break;
  }
  return { sub: words[i] ? words[i].toLowerCase() : null, args: words.slice(i + 1), cPath, globals };
}

function ghPositionals(words) {
  const out = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w === '-R' || w === '--repo' || w === '-X' || w === '--method') { i++; continue; }
    if (w.startsWith('-')) continue;
    out.push(w.toLowerCase());
  }
  return out;
}

export function isGhMerge(words) {
  const pos = ghPositionals(words);
  if (pos[0] === 'pr' && pos[1] === 'merge') return true;
  if (pos[0] === 'api' && pos.some((p) => /pulls\/\d+\/merge\b/.test(p))) return true;
  return false;
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
    if (a === '--force' || a === '--force-with-lease' || a.startsWith('--force-with-lease=') || a === '--force-if-includes') { force = true; continue; }
    if (a === '--all' || a === '--mirror' || a === '--branches') { all = true; continue; }
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
  if (all) return 'git push --all/--mirror is not allowed (it would push the default branch)';

  const defaults = ctx.defaultBranches().map((b) => b.toLowerCase());
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

// rb invocation in a segment: `rb <sub>` or `node .../rb.mjs <sub>`. Returns the subcommand or null.
function rbSubcommand(w) {
  let i;
  if (commandName(w[0]) === 'rb') i = 1;
  else if (commandName(w[0]) === 'node') {
    const k = w.findIndex((x, j) => j > 0 && /(^|[\\/])rb\.mjs$/i.test(x));
    if (k === -1) return null;
    i = k + 1;
  } else return null;
  while (i < w.length && w[i].startsWith('-')) i++;
  return w[i] ? w[i].toLowerCase() : '';
}

const PRIVILEGED_RB_TEXT = new RegExp(
  `(^|[^\\w-])rb(\\.mjs)?['"]?\\s+(--\\S+\\s+)*(${[...PRIVILEGED_RB].join('|')})(?![\\w-])`, 'i',
);
// "git"/"gh" as a command word anywhere (also git.exe); not .github, git-foo, src/git/.
const GIT_WORD_RE = /(^|[^\w.-])(git|gh)(\.exe)?(?![\w./\\-])/i;

// ---------- per-segment rules ----------

const INTERPRETERS = new Set([
  'node', 'nodejs', 'python', 'python3', 'python2', 'py', 'perl', 'ruby', 'deno', 'bun', 'php',
  'pwsh', 'powershell', 'cmd', 'osascript', 'lua', 'tclsh', 'awk', 'gawk',
]);
const INLINE_FLAGS = /^(-e|-p|-c|-pe|-ne|-E|--eval|--print|-command|-encodedcommand|-ec|\/c|\/k|eval)$/i;

// Commands that read a file named as an argument.
const ENV_READERS = new Set([
  'cat', 'less', 'more', 'head', 'tail', 'type', 'bat', 'nl', 'od', 'xxd', 'hexdump', 'strings',
  'sed', 'awk', 'gawk', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'cut', 'sort', 'uniq', 'base64',
  'source', '.', 'cp', 'scp', 'rsync', 'curl', 'wget', 'get-content', 'gc', 'select-string', 'sls',
  'diff', 'cmp', 'vim', 'vi', 'nano', 'emacs', 'code', 'tac', 'column', 'jq', 'yq', 'dotenv',
  'openssl', 'gpg', 'zip', 'tar', 'gzip', 'xargs', 'tee', 'paste', 'fold', 'rev', 'mv', 'ln',
]);

function envReadReason(seg) {
  const { words, redirects } = seg;
  for (const r of redirects) if (!r.output && r.op.startsWith('<') && !r.op.startsWith('<<') && isEnvName(r.target)) return 'reading .env files is not allowed';
  if (!words.length) return null;
  const name = commandName(words[0]);
  const args = words.slice(1);
  if (ENV_READERS.has(name)) {
    let sources = args.filter((a) => !a.startsWith('-') || /[=@]/.test(a));
    if (name === 'cp' || name === 'mv' || name === 'scp' || name === 'rsync' || name === 'ln') sources = sources.slice(0, -1);
    if (sources.some((a) => isEnvName(a) || /[=@]\S*\.env/i.test(a) && isEnvName(a.split(/[=@]/).pop()))) {
      return 'reading .env files is not allowed';
    }
  }
  if (INTERPRETERS.has(name) && args.some((a) => INLINE_FLAGS.test(a)) && mentionsEnvFile(args.join(' '))) {
    return 'reading .env files through an interpreter is not allowed';
  }
  return null;
}

function devNullOnly(redirects) {
  return redirects.every((r) => !r.output || isDevNull(r.target));
}

const FIND_BAD = new Set(['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls']);
const SIMPLE_READ = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'pwd', 'echo', 'true', 'false', 'test',
  '[', 'cut', 'diff', 'basename', 'dirname', 'realpath', 'stat', 'file', 'cd', 'tr', 'nl', 'dir',
]);
const READ_GIT = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'merge-base', 'blame', 'grep']);

function restoreReason(args, ctx) {
  const paths = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { paths.push(...args.slice(i + 1)); break; }
    if (a === '-s' || a === '--source') { i++; continue; }
    if (/^(--worktree|-W|--staged|-S|--source=.+|--quiet|-q)$/.test(a)) continue;
    if (a.startsWith('-')) return `git restore ${a} is not allowed`;
    paths.push(a);
  }
  if (paths.length !== 1) return 'git restore takes exactly one tracked file for the verifier';
  const p = paths[0];
  if (p === '.' || p === '..' || /[*?[\]]/.test(p) || p.startsWith(':') || /[\\/]$/.test(p)) {
    return 'git restore of a directory, a glob or a pathspec is not allowed';
  }
  try {
    if (statSync(path.resolve(ctx.cwd, p)).isDirectory()) return 'git restore of a directory is not allowed';
  } catch { /* missing or unreadable: git decides */ }
  return null;
}

function readonlySegmentReason(seg, role, ctx) {
  const { words, redirects } = seg;
  if (!devNullOnly(redirects)) return `output redirection is not allowed for ${role} (read-only role)`;
  if (!words.length) return null;
  const u = unwrap(words);
  if (u.inner !== undefined) return `${u.via} is not allowed for ${role} (read-only role)`;
  if (u.wrappers.some((x) => x === 'sudo' || x === 'doas')) return `sudo is not allowed for ${role}`;
  const w = u.words;
  if (!w.length) return null;
  const name = commandName(w[0]);
  const args = w.slice(1);
  const lower = args.map((a) => a.toLowerCase());

  if (SIMPLE_READ.has(name)) return null;
  if (name === 'rg') return lower.some((a) => a === '--pre' || a.startsWith('--pre=') || a === '--search-zip' || a === '-z') ? 'rg --pre is not allowed' : null;
  if (name === 'find') return lower.some((a) => FIND_BAD.has(a)) ? 'find with -exec/-delete/-fprint is not allowed' : null;
  if (name === 'sort') return lower.some((a) => a === '-o' || a.startsWith('--output') || /^-[a-z]*o/.test(a)) ? 'sort -o is not allowed' : null;
  if (name === 'git') {
    const g = parseGit(w);
    if (g.globals.some((x) => x === '-c' || x === '--config-env' || x.startsWith('--exec-path') || x.startsWith('--config-env='))) {
      return `git -c is not allowed for ${role}`;
    }
    if (g.sub === 'restore' && role === 'verifier') return restoreReason(g.args, ctx);
    if (!g.sub || !READ_GIT.has(g.sub)) return `git ${g.sub || ''} is not allowed for ${role} (read-only git only)`.replace('  ', ' ');
    const ga = g.args.map((a) => a.toLowerCase());
    if (ga.some((a) => a.startsWith('--output') || a === '--ext-diff')) return `git ${g.sub} --output/--ext-diff is not allowed`;
    if (g.sub === 'grep' && g.args.some((a) => /^-[A-Za-z]*O/.test(a) || a.startsWith('--open-files-in-pager'))) {
      return 'git grep --open-files-in-pager is not allowed';
    }
    return null;
  }
  if (name === 'npm') {
    const pos = args.filter((a) => !a.startsWith('-'));
    if (pos[0] === 'test' || pos[0] === 't') return null;
    if ((pos[0] === 'run' || pos[0] === 'run-script') && pos[1] && pos[1].startsWith('test')) return null;
    if (pos[0] === 'audit' && pos[1] !== 'fix' && !lower.includes('--fix')) return null;
  }
  if (name === 'npx') {
    const pos = args.filter((a) => a !== '--no-install' && a !== '--no');
    if (pos[0] === 'playwright' && pos[1] === 'test') return null;
  }
  if (name === 'node' && args[0] === '--test') {
    if (lower.some((a) => /^(-e|-p|--eval|--print|-r|--require|--import|--loader|--experimental-loader)(=|$)/.test(a))) {
      return 'node --test with code-loading flags is not allowed';
    }
    return null;
  }
  if (name === 'pytest') return null;
  const rbSub = rbSubcommand(w);
  if (rbSub !== null && READONLY_RB.has(rbSub)) {
    if (rbSub === 'stop' && args.filter((a) => !a.startsWith('-')).pop() !== 'status') return 'rb stop is read-only status only';
    return null;
  }
  if (ctx.contractCommand(seg.text)) return null;
  if (INTERPRETERS.has(name) || POSIX_SHELLS.has(name)) return `interpreter ${name} is not allowed for ${role} (read-only role)`;
  if (name === 'tee') return `tee is not allowed for ${role} (read-only role)`;
  return `${name} is not on the read-only allowlist for ${role}`;
}

const SAFE_READERS = new Set(['cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'ls', 'wc', 'diff', 'find', 'stat', 'file', 'cd']);
const WRITERS = new Set(['cp', 'mv', 'tee', 'touch', 'ln', 'rm', 'mkdir', 'install', 'rsync', 'dd', 'truncate', 'chmod', 'sed', 'perl']);

function writeRoleSegmentReason(seg, role, ctx) {
  const { words, redirects } = seg;
  for (const r of redirects) {
    if (r.output && !isDevNull(r.target) && protectedPathReason(r.target, ctx.cwd)) {
      return `shell writes to ${protectedPathReason(r.target, ctx.cwd)} are not allowed for ${role}`;
    }
  }
  if (!words.length) return null;
  const u = unwrap(words);
  const w = u.words || words;
  const name = commandName(w[0]);
  const rbSub = rbSubcommand(w);
  if (rbSub !== null && !PRIVILEGED_RB.has(rbSub) && !redirects.some((r) => r.output && !isDevNull(r.target))) return null;
  const mentions = words.some((x) => mentionsProtected(x)) || redirects.some((r) => mentionsProtected(r.target));
  if (mentions) {
    const pureRead = SAFE_READERS.has(name) && devNullOnly(redirects) && !(name === 'find' && w.some((x) => FIND_BAD.has(x.toLowerCase())));
    if (!pureRead) return `${role} may not touch protected paths from the shell (.claude/, .cursor/, .codex/, .agents/, .github/, AGENTS.md, CLAUDE.md, tools/rockbuilt/, .env*)`;
  }
  if (WRITERS.has(name)) {
    for (const a of w.slice(1)) {
      if (a.startsWith('-')) continue;
      const why = protectedPathReason(a, ctx.cwd);
      if (why) return `shell writes to ${why} are not allowed for ${role}`;
    }
  }
  return null;
}

// Deploy and cloud CLIs spend money or change live systems: a tier C decision for the human (DESIGN 14).
// Values: subcommands that stay allowed (local or read-only); null means the whole CLI is denied.
const COST_CLIS = new Map([
  ['vercel', new Set(['dev', 'whoami', 'help', 'ls', 'list', 'inspect', 'logs', '--version', '-v', '--help', '-h'])],
  ['netlify', new Set(['dev', 'status', 'help', 'build', 'serve', '--version', '--help'])],
  ['fly', new Set(['status', 'logs', 'version', 'help', 'auth'])],
  ['flyctl', new Set(['status', 'logs', 'version', 'help', 'auth'])],
  ['wrangler', new Set(['dev', 'whoami', 'help', 'tail', '--version', '--help'])],
  ['supabase', new Set(['start', 'stop', 'status', 'init', 'help', 'migration', 'gen', 'test', '--version', '--help'])],
  ['railway', new Set(['status', 'logs', 'help', 'whoami', '--version'])],
  ['heroku', null], ['aws', null], ['gcloud', null], ['az', null], ['doctl', null], ['firebase', new Set(['emulators:start', 'emulators:exec', 'help', '--version'])],
  ['terraform', new Set(['fmt', 'validate', 'init', 'plan', 'version', 'show', 'output'])],
  ['pulumi', new Set(['preview', 'version', 'about', 'whoami'])],
]);
const RUNNERS = new Set(['npx', 'bunx', 'pnpx']);
// CLIs judged by their arguments: a denied pattern on the joined arguments.
const COST_ARG_RULES = new Map([
  ['prisma', /^(db\s+(push|execute|seed)|migrate\s+(deploy|reset|resolve))\b/],
  ['drizzle-kit', /^(push|migrate|drop)\b/],
  ['stripe', /^(?!(--version|-v|--help|-h|help|listen|login|version)\b)/],
  ['twilio', /^(?!(--version|--help|help)\b)/],
]);
const PKG_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const PKG_SUBCOMMANDS = new Set(['install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'update', 'up', 'test', 't', 'run', 'run-script', 'exec', 'x', 'dlx', 'init', 'create', 'list', 'ls', 'outdated', 'audit', 'why', 'pack', 'publish', 'link', 'config', 'cache', 'version', 'view', 'info', 'help', 'start', 'build', 'dev', 'install-test', 'it']);

function readScripts(cwd) {
  try { return JSON.parse(readFileSync(path.join(cwd || '.', 'package.json'), 'utf8')).scripts || {}; } catch { return {}; }
}

function costCliReason(w, cwd, depth = 0) {
  let words = w;
  let name = commandName(words[0]);
  // npx vercel, bunx vercel, pnpm dlx/exec vercel, yarn dlx/exec vercel, yarn vercel, npm exec vercel,
  // node node_modules/.bin/vercel
  if (RUNNERS.has(name)) words = words.slice(1);
  else if ((name === 'pnpm' || name === 'yarn' || name === 'bun') && (words[1] === 'dlx' || words[1] === 'exec' || words[1] === 'x')) words = words.slice(2);
  else if (name === 'npm' && (words[1] === 'exec' || words[1] === 'x')) words = words.slice(2);
  else if (name === 'node' && words[1] && /(^|[\\/])node_modules[\\/]\.bin[\\/]/.test(words[1])) words = words.slice(1);
  else if (PKG_MANAGERS.has(name)) {
    // npm run <script>, pnpm <script>, yarn <script or bin>: judge what the script runs.
    const rest = words.slice(1).filter((x) => !/^-/.test(x));
    let script = null;
    if (rest[0] === 'run' || rest[0] === 'run-script') script = rest[1];
    else if (name !== 'npm' && rest[0] && !PKG_SUBCOMMANDS.has(rest[0])) script = rest[0];
    else if (rest[0] === 'start' || rest[0] === 'test' || rest[0] === 't') script = rest[0] === 't' ? 'test' : rest[0];
    if (!script) return null;
    const body = readScripts(cwd)[script];
    if (typeof body !== 'string') {
      // yarn vercel / pnpm vercel with no such script runs the binary.
      return name !== 'npm' ? costCliReason([script, ...rest.slice(1)], cwd, depth + 1) : null;
    }
    if (depth > 3) return null;
    for (const seg of splitCommands(body)) {
      const r = costCliReason(seg.filter((x) => typeof x === 'string'), cwd, depth + 1);
      if (r) return `script "${script}" runs ${r}`;
    }
    return null;
  }
  words = words.filter((x, i) => i === 0 || !/^-(y|-yes|-package=.*)$/.test(x));
  while (words.length && /^-/.test(words[0])) words = words.slice(1);
  if (!words.length) return null;
  name = commandName(words[0]).replace(/@.*$/, '');
  if (COST_ARG_RULES.has(name)) {
    const args = words.slice(1).join(' ');
    return COST_ARG_RULES.get(name).test(args) ? `${name} ${args}`.trim() + ' changes live data or spends money: escalate it to the human (tier C)' : null;
  }
  if (!COST_CLIS.has(name)) return null;
  const allowed = COST_CLIS.get(name);
  const sub = words.slice(1).find((x) => !/^-/.test(x) || x === '--version' || x === '-v' || x === '--help' || x === '-h');
  if (allowed && sub && allowed.has(sub) && !words.some((x) => /^--prod(uction)?$|^--linked$|^--project-ref/.test(x))) return null;
  return `${name} ${sub || ''}`.trim() + ' can deploy, spend money or change live systems: escalate it to the human (tier C)';
}

// Rules for everyone (main session included) on one segment.
function everyoneSegmentReason(seg, role, ctx) {
  const env = envReadReason(seg);
  if (env) return env;
  const w = seg.words;
  if (!w.length) return null;
  const cost = costCliReason(w, ctx.cwd);
  if (cost) return cost;
  const name = commandName(w[0]);
  if (name === 'git') {
    const g = parseGit(w);
    // Everyone: no per-command config (-c alias.x='!cmd', core.sshCommand, core.hooksPath) and no
    // config writes. Either turns git into a way around every other rule (aliases that push to
    // main or deploy, hooks that run on the next commit).
    if (g.globals.some((x) => x === '-c' || x === '--config-env' || x.startsWith('--config-env=') || x.startsWith('--exec-path'))) {
      return 'git -c / --config-env / --exec-path is not allowed: run plain git commands';
    }
    if (g.sub === 'config') {
      const ga = g.args.map((a) => a.toLowerCase());
      const readOnly = ga.some((a) => /^--(get|get-all|get-regexp|get-urlmatch|list)$/.test(a) || a === '-l');
      if (!readOnly) return 'git config writes are not allowed (read with --get or --list)';
    }
    if (g.sub === 'push') {
      const dir = g.cPath ? path.resolve(ctx.cwd, g.cPath) : ctx.cwd;
      return checkPush(g.args, ctx.at(dir));
    }
  }
  if (role) {
    if (name === 'gh' && isGhMerge(w)) return 'subagents may not merge; merges go through rb merge-gate';
    const sub = rbSubcommand(w);
    if (sub && PRIVILEGED_RB.has(sub)) return `rb ${sub} is orchestrator-only; subagents may not run it`;
    if (sub === 'baseline' && w.some((x) => x === '--accept')) return 'rb baseline --accept is a human decision';
  }
  return null;
}

// ---------- shell decision ----------

function checkCommandString(src, role, ctx, depth = 0) {
  if (depth > 5 || typeof src !== 'string') return null;
  const isWrite = role && WRITE_ROLES.has(role);
  const isRead = role && READONLY_ROLES.has(role);

  if (depth === 0 && role) {
    if (isWrite) {
      const m = src.match(GIT_WORD_RE);
      if (m) return `${m[2].toLowerCase()} is not allowed for ${role} (no git, no gh)`;
    }
    if (PRIVILEGED_RB_TEXT.test(src)) return 'privileged rb subcommands are orchestrator-only; subagents may not run them';
    if (isRead && ctx.contractCommand(src.trim())) {
      // A declared Verification/E2E command runs as written; still apply the everyone rules below.
      ctx = ctx.withContractWhole();
    }
  }

  let cur = ctx;
  for (const raw of splitCommands(src)) {
    const seg = parseSegment(raw);
    seg.text = raw.join(' ');
    if (commandName(seg.words[0]) === 'cd' && seg.words[1]) cur = cur.at(path.resolve(cur.cwd, seg.words[1]));
    const u = unwrap(seg.words);
    if (u.inner !== undefined) {
      if (isRead && !cur.contractWhole) return `${u.via} is not allowed for ${role} (read-only role)`;
      const r = checkCommandString(u.inner, role, cur, depth + 1);
      if (r) return r;
      continue;
    }
    if (raw.heredoc && u.words.length) {
      const hName = commandName(u.words[0]);
      if (POSIX_SHELLS.has(hName)) {
        const r = checkCommandString(raw.heredoc, role, cur, depth + 1);
        if (r) return r;
      } else if (INTERPRETERS.has(hName) && mentionsEnvFile(raw.heredoc)) {
        return 'reading .env files through an interpreter is not allowed';
      }
    }
    // Token-level twin of the GIT_WORD_RE text check: quotes or escapes spliced into the word
    // (g''it, g\\it) survive the text regex but not the tokenizer (3d_brain T10, 2026-10-14).
    const gitWord = isWrite ? u.words.find((x) => ['git', 'gh'].includes(commandName(x))) : null;
    if (gitWord) return `${commandName(gitWord)} is not allowed for ${role} (no git, no gh)`;
    const inner = { words: u.words, redirects: seg.redirects, text: seg.text };
    let reason = everyoneSegmentReason(inner, role, cur);
    if (!reason && isWrite) reason = writeRoleSegmentReason(inner, role, cur);
    if (!reason && isRead && !cur.contractWhole) reason = readonlySegmentReason(seg, role, cur);
    if (reason) return reason;
  }
  for (const sub of embeddedSubstitutions(src)) {
    const reason = checkCommandString(sub, role, cur, depth + 1);
    if (reason) return reason;
  }
  return null;
}

// ---------- write and read decisions ----------

function e2eWriterAllowed(p, cwd) {
  const rel = p.replace(/\\/g, '/');
  const base = (cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const r = base && rel.toLowerCase().startsWith(base.toLowerCase() + '/') ? rel.slice(base.length + 1) : rel;
  const segs = splitSegs(r);
  if (segs.includes('..')) return false;
  if (path.isAbsolute(r) && !(base && rel.toLowerCase().startsWith(base.toLowerCase()))) return false;
  return segs[0] === 'e2e' || (segs.length === 1 && /^playwright\.config\.[cm]?[jt]s$/.test(segs[0]));
}

// The blind auditor may write throwaway checks only under .rockbuilt/audit/ (DESIGN 4).
function auditScratch(p, cwd) {
  const rel = p.replace(/\\/g, '/');
  const base = (cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const r = base && rel.toLowerCase().startsWith(base.toLowerCase() + '/') ? rel.slice(base.length + 1) : rel;
  if (path.isAbsolute(r)) return false;
  const segs = splitSegs(r);
  if (segs.includes('..')) return false;
  if (!(segs[0] === '.rockbuilt' && segs[1] === 'audit' && segs.length > 2)) return false;
  // Resolve symlinks: the real path must stay inside .rockbuilt/audit.
  try {
    const expected = path.join(realpathSync(cwd || '.'), '.rockbuilt', 'audit');
    if (!existsSync(expected)) return true; // not created yet: the lexical check above holds
    const realBase = realpathSync(expected);
    const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
    if (!same(realBase, expected)) return false; // .rockbuilt/audit itself is a symlink elsewhere
    let probe = path.resolve(cwd || '.', r);
    while (!existsSync(probe)) probe = path.dirname(probe);
    const real = realpathSync(probe);
    const r2 = process.platform === 'win32' ? real.toLowerCase() : real;
    const b2 = process.platform === 'win32' ? realBase.toLowerCase() : realBase;
    return r2 === b2 || r2.startsWith(b2 + path.sep);
  } catch {
    return true; // audit dir not created yet: the lexical check above already holds
  }
}

function checkWrite(n) {
  const { role, paths, cwd } = n;
  if (!role) return null;
  if (role === 'auditor') {
    return paths.every((p) => auditScratch(p, cwd)) ? null : 'rb-auditor may only write throwaway checks under .rockbuilt/audit/';
  }
  if (READONLY_ROLES.has(role) && !READONLY_EDITORS.has(role)) return `writing files is not allowed for ${role} (read-only role)`;
  // The verifier only patches existing files for a transient mutation probe; it never creates files.
  if (role === 'verifier' && n.name && !['Edit', 'MultiEdit', 'StrReplace'].includes(n.name)) return 'rb-verifier may only Edit an existing file for a transient mutation probe';
  for (const p of paths) {
    const prot = protectedPathReason(p, cwd);
    if (prot) return `subagents may not edit ${prot} (orchestrator-owned)`;
    if (role === 'e2e-writer' && !e2eWriterAllowed(p, cwd)) return 'rb-e2e-writer may only write under e2e/ (and playwright.config.*)';
  }
  return null;
}

function checkRead(n) {
  for (const p of n.paths) if (isEnvName(p)) return 'reading .env files is not allowed';
  return null;
}

// ---------- environment lookups (injectable) ----------

function runGit(dir, args) {
  try {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 3000, windowsHide: true });
    if (r.status !== 0) return null;
    return r.stdout.trim();
  } catch {
    return null;
  }
}

// AGENTS.md (fallback CLAUDE.md) at the nearest ancestor, stopping at the repo root.
function contractText(dir) {
  let cur = path.resolve(dir);
  for (let k = 0; k < 40; k++) {
    for (const f of ['AGENTS.md', 'CLAUDE.md']) {
      try {
        return readFileSync(path.join(cur, f), 'utf8');
      } catch { /* try next */ }
    }
    if (existsSync(path.join(cur, '.git'))) return null;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

export function sectionCommands(text, section) {
  if (typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${section}\\s*$`, 'i').test(l.trim()));
  if (start === -1) return [];
  const out = [];
  let inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^##\s/.test(l) && !inFence) break;
    if (/^\s*```/.test(l)) {
      if (inFence) break;
      inFence = true;
      continue;
    }
    if (inFence && l.trim() && !l.trim().startsWith('#')) out.push(l.trim());
  }
  return out;
}

export const realEnv = {
  currentBranch(dir) {
    const b = runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (b && b !== 'HEAD') return b;
    return runGit(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  },
  defaultBranches(dir) {
    const m = (contractText(dir) || '').match(/^Default branch:\s*([^\s#]+)/m);
    if (m) return [m[1]];
    const ref = runGit(dir, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
    if (ref) return [ref.replace(/^refs\/remotes\/origin\//, '')];
    return ['main', 'master'];
  },
  // Commands declared in the contract that read-only roles may run verbatim.
  contractCommands(dir) {
    const text = contractText(dir);
    return [...sectionCommands(text, 'Verification'), ...sectionCommands(text, 'E2E')];
  },
};
export const realGitEnv = realEnv; // v0.2 name

const squash = (s) => String(s || '').trim().replace(/\s+/g, ' ');

function makeCtx(cwd, env) {
  const memo = new Map();
  const cached = (key, fn) => {
    if (!memo.has(key)) memo.set(key, fn());
    return memo.get(key);
  };
  const build = (dir, contractWhole) => ({
    cwd: dir,
    contractWhole,
    at: (d) => build(d, contractWhole),
    withContractWhole: () => build(dir, true),
    currentBranch: () => cached(`cur:${dir}`, () => env.currentBranch(dir)),
    defaultBranches: () => cached(`def:${dir}`, () => env.defaultBranches(dir) || ['main', 'master']),
    contractCommand: (text) => {
      if (typeof env.contractCommands !== 'function') return false;
      const cmds = cached(`contract:${cwd}`, () => (env.contractCommands(cwd) || []).map(squash));
      return cmds.includes(squash(text));
    },
  });
  return build(cwd, false);
}

// ---------- entry points ----------

export function decide(input, env = realEnv, envVars = process.env) {
  if (!input || typeof input !== 'object') return { deny: false, reason: null };
  const n = normalize(input, envVars);
  let reason = null;
  if (n.kind === 'shell') reason = checkCommandString(n.command, n.role, makeCtx(n.cwd, env));
  else if (n.kind === 'write') reason = checkWrite(n);
  else if (n.kind === 'read') reason = checkRead(n);
  return reason ? { deny: true, reason, tool: n.tool, event: n.event } : { deny: false, reason: null, tool: n.tool, event: n.event };
}

// What the process prints and its exit code, per tool.
export function render(result) {
  const msg = `rockbuilt guard: ${result.reason}`;
  if (result.tool === 'cursor') {
    if (result.deny) {
      const out = result.event === 'beforeReadFile'
        ? { permission: 'deny', user_message: msg }
        : { permission: 'deny', user_message: msg, agent_message: msg };
      return { code: 2, stdout: `${JSON.stringify(out)}\n`, stderr: '' };
    }
    if (CURSOR_PERMISSION_EVENTS.has(result.event)) return { code: 0, stdout: '{"permission":"allow"}\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  }
  if (result.deny) return { code: 2, stdout: '', stderr: `${msg}\n` };
  return { code: 0, stdout: '', stderr: '' };
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
  let out;
  try {
    out = render(decide(input));
  } catch {
    process.exit(0);
  }
  if (out.stdout) process.stdout.write(out.stdout);
  if (out.stderr) process.stderr.write(out.stderr);
  process.exitCode = out.code;
}

// Compare real paths: on macOS /var is /private/var, on Windows case and short names differ.
// A false negative here would make the script exit without doing anything.
const realOrSelf = (p) => { try { return realpathSync.native(p); } catch { return path.resolve(p); } };
const sameFile = (a, b) => { const x = realOrSelf(a); const y = realOrSelf(b); return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y; };
const isMain = Boolean(process.argv[1]) && sameFile(process.argv[1], fileURLToPath(import.meta.url));
if (isMain) main();

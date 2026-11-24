// Permission prompts (PLAN-1.0 C3, DESIGN 30.2). A PermissionRequest hook logs every prompt Claude
// Code shows in the project to .rockbuilt/permissions.jsonl (tool and the command's first words,
// never file contents); `rb permissions report` groups them and proposes allow rules for the
// project's .claude/settings.json, leaving out anything destructive.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readText } from './util.mjs';

const FILE = (root) => path.join(root, '.rockbuilt', 'permissions.jsonl');
// Never proposed for the allow list, however often it was asked.
const RISKY = /^(rm|sudo|chmod|chown|dd|mkfs|curl|wget|ssh|scp|kill|pkill|killall|bash|sh|zsh|env|xargs|find|mv|cp|python\d?|perl|ruby|node -e|node --eval|git -C|git push|git reset|git clean|git rebase|git checkout|git branch|git stash|git config|gh|npm publish|npx|docker|kubectl)\b|[|;&`$<>]/;

export function permissionKey(input) {
  const tool = String(input.tool_name || input.tool || 'unknown');
  const ti = input.tool_input || {};
  if (tool === 'Bash') {
    // Only the first words, never values: leading VAR=value assignments are dropped (they can hold
    // a key), and everything from a quote, a redirection or a heredoc on is cut (file bodies).
    const full = String(ti.command || '').trim().replace(/\s+/g, ' ');
    let cmd = full;
    const cut = cmd.search(/["'`<>]|<<|\$\(/);
    if (cut !== -1) cmd = cmd.slice(0, cut).trim();
    const words = cmd.split(' ').filter((w) => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    const prefix = words.slice(0, /^(git|npm|node|npx|pnpm|yarn)$/.test(words[0]) ? 2 : 1).join(' ');
    const shape = words.slice(0, 4).map((w) => (/^[\w./-]+$/.test(w) ? w : '…')).join(' ');
    return { tool, prefix, command: shape, risky: RISKY.test(full) || RISKY.test(words.join(' ')) };
  }
  if (ti.file_path) return { tool, prefix: path.posix.dirname(String(ti.file_path).replace(/\\/g, '/')), command: null };
  return { tool, prefix: '', command: null };
}

export function logPermission(root, input, at = new Date().toISOString()) {
  mkdirSync(path.join(root, '.rockbuilt'), { recursive: true });
  appendFileSync(FILE(root), `${JSON.stringify({ at, ...permissionKey(input) })}\n`);
}

export function permissionReport(root) {
  const lines = String(readText(FILE(root)) || '').split('\n').filter(Boolean);
  const groups = new Map();
  for (const l of lines) {
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    const k = `${e.tool}\u0000${e.prefix}`;
    const g = groups.get(k) || { tool: e.tool, prefix: e.prefix, count: 0, last: null, example: e.command, all: [] };
    g.count++;
    g.all.push(e.risky ? '|' : e.command || '');
    g.last = e.at;
    groups.set(k, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.count - a.count);
  for (const r of rows) {
    if (r.tool !== 'Bash' || !r.prefix) r.rule = null;
    else if (RISKY.test(r.prefix) || r.all.some((c) => RISKY.test(c))) r.rule = null;
    else r.rule = `Bash(${r.prefix} *)`;
  }
  for (const r of rows) delete r.all;
  return { total: lines.length, rows };
}

export function permissionText(r) {
  if (!r.total) return 'no permission prompts logged';
  const out = [`${r.total} permission prompt(s):`];
  for (const x of r.rows) out.push(`  ${String(x.count).padStart(4)}  ${x.tool} ${x.prefix}${x.rule ? `  -> allow: ${x.rule}` : '  (not proposed)'}`);
  const rules = r.rows.filter((x) => x.rule).map((x) => x.rule);
  if (rules.length) out.push(`Proposed for .claude/settings.json permissions.allow: ${JSON.stringify(rules)}`);
  return out.join('\n');
}

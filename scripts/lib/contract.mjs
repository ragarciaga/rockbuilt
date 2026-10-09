// Project contract parsing (DESIGN.md section 5): AGENTS.md first, CLAUDE.md fallback (v0.2).
import path from 'node:path';
import { readText } from './util.mjs';

export const HEADER_FIELDS = ['Docs language', 'Project type', 'Default branch', 'Autonomy', 'Parallel', 'Max parallel', 'Max tasks per run'];
export const REQUIRED_SECTIONS = ['Goal', 'Stack', 'Conventions', 'Verification', 'Out of scope'];
export const COMMAND_SECTIONS = ['Verification', 'E2E', 'Evals', 'Setup'];
export const CONTRACT_FILES = ['AGENTS.md', 'CLAUDE.md'];
export const PROJECT_TYPES = ['web', 'ai', 'automation'];
export const AUTONOMY_MODES = ['auto', 'supervised'];

// { file, text } for the first contract file present, or { file: null, text: null }.
export function readContract(root) {
  for (const f of CONTRACT_FILES) {
    const text = readText(path.join(root, f));
    if (text !== null) return { file: f, text };
  }
  return { file: null, text: null };
}

export function readContractText(root) {
  return readContract(root).text;
}

// "Key: value   # comment" lines (first match wins).
export function headerField(text, name) {
  if (!text) return null;
  const re = new RegExp(`^${escapeRe(name).replace(/ /g, '\\s+')}:[ \\t]*(.*)$`, 'mi');
  const m = text.match(re);
  if (!m) return null;
  return m[1].replace(/\s+#.*$/, '').trim();
}

export function sectionHeadings(text) {
  if (!text) return [];
  const out = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) out.push(m[1]);
  }
  return out;
}

// Body lines of a "## <name>" section (case-insensitive), up to the next heading outside fences.
export function sectionBody(text, name) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  let start = -1;
  let inFence = false;
  const heading = new RegExp(`^##\\s+${escapeRe(name)}\\s*$`, 'i');
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (!inFence && heading.test(lines[i])) { start = i + 1; break; }
  }
  if (start === -1) return null;
  const body = [];
  inFence = false;
  for (let i = start; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (!inFence && /^#{1,2}\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body;
}

// Commands from the first fenced block in a section: one per non-empty, non-comment line.
export function sectionCommands(text, name) {
  const body = sectionBody(text, name);
  if (!body) return null;
  const open = body.findIndex((l) => /^\s*(```|~~~)/.test(l));
  if (open === -1) return [];
  const commands = [];
  for (let i = open + 1; i < body.length; i++) {
    const line = body[i];
    if (/^\s*(```|~~~)/.test(line)) break;
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    commands.push(t);
  }
  return commands;
}

const AUTONOMY_KEYS = { 'sensitive paths': 'sensitivePaths', 'tier a paths': 'tierAPaths', 'paid services': 'paidServices' };

function splitValues(value) {
  return value
    .split(/[,\n]/)
    .map((s) => s.replace(/^\s*[-*]\s+/, '').replace(/`/g, '').trim())
    .filter((s) => s && !/^(none|ninguno|ninguna|n\/a|-)$/i.test(s) && !s.startsWith('#') && !s.startsWith('<'));
}

// "## Autonomy" keys: values on the same line and/or following bullet lines until the next key.
export function parseAutonomy(text) {
  const out = { sensitivePaths: [], tierAPaths: [], paidServices: [] };
  const body = sectionBody(text, 'Autonomy');
  if (!body) return out;
  let current = null;
  for (const raw of body) {
    const line = raw.replace(/\s+#.*$/, '');
    const m = line.match(/^\s*(?:[-*]\s+)?([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/);
    const key = m ? AUTONOMY_KEYS[m[1].toLowerCase()] : null;
    if (key) {
      current = key;
      out[key].push(...splitValues(m[2]));
      continue;
    }
    if (!line.trim()) continue;
    if (current && /^\s*([-*]\s+|\s{2,})/.test(line)) out[current].push(...splitValues(line));
  }
  return out;
}

function intField(text, name, fallback) {
  const v = headerField(text, name);
  const n = v === null ? NaN : Number.parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function projectTypesFrom(text) {
  const v = headerField(text, 'Project type');
  if (!v) return [];
  return v.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter((t) => PROJECT_TYPES.includes(t));
}

// Everything rb needs from the contract, with defaults.
export function contractInfo(root) {
  const { file, text } = readContract(root);
  const autonomyRaw = (headerField(text, 'Autonomy') || '').toLowerCase();
  return {
    file,
    docsLanguage: headerField(text, 'Docs language'),
    projectTypes: projectTypesFrom(text),
    defaultBranch: headerField(text, 'Default branch'),
    autonomy: AUTONOMY_MODES.includes(autonomyRaw) ? autonomyRaw : 'auto',
    parallel: headerField(text, 'Parallel') || 'auto',
    maxParallel: intField(text, 'Max parallel', 3),
    maxTasksPerRun: intField(text, 'Max tasks per run', 6),
    ...parseAutonomy(text),
  };
}

// A contract that still holds template placeholders must not drive commands.
export function isTemplate(text) {
  return text !== null && (/^#\s*<Project name>/m.test(text) || /^Project type:\s*</m.test(text));
}

export function setHeaderField(text, name, value) {
  const re = new RegExp(`^(${escapeRe(name).replace(/ /g, '\\s+')}:)[^\\n\\r]*`, 'mi');
  if (re.test(text)) return text.replace(re, `$1 ${value}`);
  const lines = text.split('\n');
  const h1 = lines.findIndex((l) => /^#\s/.test(l));
  lines.splice(h1 === -1 ? 0 : h1 + 2, 0, `${name}: ${value}`);
  return lines.join('\n');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

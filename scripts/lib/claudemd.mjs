// CLAUDE.md contract parsing (DESIGN.md section 5).
import path from 'node:path';
import { readText } from './util.mjs';

export const HEADER_FIELDS = ['Docs language', 'Project type', 'Parallel', 'Max parallel', 'Default branch'];
export const REQUIRED_SECTIONS = ['Goal', 'Stack', 'Conventions', 'Verification', 'Out of scope'];
export const COMMAND_SECTIONS = ['Verification', 'E2E', 'Evals', 'Setup'];

export function readClaudeMd(root) {
  return readText(path.join(root, 'CLAUDE.md'));
}

// "Key: value   # comment" lines before the first "## " heading (and anywhere, first wins).
export function headerField(text, name) {
  if (!text) return null;
  const re = new RegExp(`^${name.replace(/ /g, '\\s+')}:\\s*(.*)$`, 'mi');
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

// Body lines of a "## <name>" section (case-insensitive), up to the next "## " heading outside fences.
export function sectionBody(text, name) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  let start = -1;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (!inFence && new RegExp(`^##\\s+${escapeRe(name)}\\s*$`, 'i').test(lines[i])) {
      start = i + 1;
      break;
    }
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

export function setHeaderField(text, name, value) {
  const re = new RegExp(`^(${name.replace(/ /g, '\\s+')}:)[^\\n\\r]*`, 'mi');
  if (re.test(text)) return text.replace(re, `$1 ${value}`);
  // Insert after the H1 title when the field is missing.
  const lines = text.split('\n');
  const h1 = lines.findIndex((l) => /^#\s/.test(l));
  lines.splice(h1 === -1 ? 0 : h1 + 2, 0, `${name}: ${value}`);
  return lines.join('\n');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

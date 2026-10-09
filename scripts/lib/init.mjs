// rb init: install templates/project into the target repo without overwriting.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setHeaderField } from './claudemd.mjs';
import { CliError, PLUGIN_ROOT, exists, readText, toPosix } from './util.mjs';

export const PROJECT_TYPES = ['web', 'ai', 'automation'];
const GITIGNORE_ADDITIONS = 'gitignore-additions.txt';
const REQUIRED_IGNORES = ['.rockbuilt/'];

export function templatesDir() {
  return process.env.RB_TEMPLATES_DIR || path.join(PLUGIN_ROOT, 'templates', 'project');
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out.sort();
}

export function normalizeTypes(value) {
  const types = String(value).split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = types.filter((t) => !PROJECT_TYPES.includes(t));
  if (bad.length) throw new CliError(`unknown project type: ${bad.join(', ')} (use ${PROJECT_TYPES.join(', ')})`);
  if (!types.length) throw new CliError('--type needs at least one of web, ai, automation');
  return [...new Set(types)];
}

// Appends lines missing from .gitignore; returns the lines added.
export function appendGitignore(root, lines) {
  const file = path.join(root, '.gitignore');
  const current = readText(file) ?? '';
  const have = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const missing = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const alt = t.endsWith('/') ? t.slice(0, -1) : `${t}/`;
    if (have.has(t) || have.has(alt) || missing.includes(t)) continue;
    missing.push(t);
  }
  if (missing.length) {
    const sep = current === '' || current.endsWith('\n') ? '' : '\n';
    const header = current === '' ? '' : '\n';
    writeFileSync(file, `${current}${sep}${header}# Added by rb init\n${missing.join('\n')}\n`);
  }
  return missing;
}

export function initProject(root, { type, lang } = {}) {
  const src = templatesDir();
  if (!exists(src) || !statSync(src).isDirectory()) throw new CliError(`templates not found at ${src}`);
  const types = type !== undefined && type !== true ? normalizeTypes(type) : null;
  if (lang === true) throw new CliError('--lang needs a value, e.g. --lang es');

  const created = [];
  const skipped = [];
  let ignoreLines = [...REQUIRED_IGNORES];
  for (const rel of walk(src)) {
    const relPosix = toPosix(rel);
    if (relPosix === GITIGNORE_ADDITIONS) {
      ignoreLines = [...readFileSync(path.join(src, rel), 'utf8').split(/\r?\n/), ...REQUIRED_IGNORES];
      continue;
    }
    const dest = path.join(root, rel);
    if (exists(dest)) { skipped.push(relPosix); continue; }
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(src, rel), dest);
    created.push(relPosix);
  }

  const gitignoreAdded = appendGitignore(root, ignoreLines);

  const customized = [];
  if (created.includes('CLAUDE.md') && (types || lang)) {
    const file = path.join(root, 'CLAUDE.md');
    let text = readFileSync(file, 'utf8');
    if (types) { text = setHeaderField(text, 'Project type', types.join(', ')); customized.push('Project type'); }
    if (lang) { text = setHeaderField(text, 'Docs language', String(lang)); customized.push('Docs language'); }
    writeFileSync(file, text);
  }
  return { root, templates: src, created, skipped, gitignoreAdded, customized };
}

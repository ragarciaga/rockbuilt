// rb init: install templates/project into the target repo without overwriting.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setHeaderField } from './claudemd.mjs';
import { CliError, PLUGIN_ROOT, exists, readText, toPosix } from './util.mjs';

export const PROJECT_TYPES = ['web', 'ai', 'automation'];
const GITIGNORE_ADDITIONS = 'gitignore-additions.txt';
const REQUIRED_IGNORES = ['.rockbuilt/'];

export function templatesDir() {
  return process.env.RB_TEMPLATES_DIR || path.join(PLUGIN_ROOT, 'harness', 'project');
}

// Overlay applied when the project type includes web (Playwright E2E + Playwright MCP).
export function webTemplatesDir() {
  return process.env.RB_WEB_TEMPLATES_DIR || path.join(PLUGIN_ROOT, 'harness', 'web');
}

export const PLAYWRIGHT_DEV_DEPS = ['@playwright/test', '@playwright/mcp'];

function hasPlaywrightConfig(root) {
  return readdirSync(root).some((f) => /^playwright\.config\.(ts|js|mjs|cjs|mts|cts)$/.test(f));
}

// Adds the playwright server to an existing .mcp.json without touching other servers.
function mergeMcp(root, templateText) {
  const file = path.join(root, '.mcp.json');
  let current;
  try {
    current = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return 'invalid';
  }
  const servers = current.mcpServers && typeof current.mcpServers === 'object' ? current.mcpServers : {};
  if (servers.playwright) return 'present';
  servers.playwright = JSON.parse(templateText).mcpServers.playwright;
  current.mcpServers = servers;
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
  return 'merged';
}

// Adds "test:e2e": "playwright test" to package.json when the script is missing.
function ensureE2eScript(root) {
  const file = path.join(root, 'package.json');
  const text = readText(file);
  if (text === null) return 'no-package-json';
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return 'invalid';
  }
  pkg.scripts = pkg.scripts || {};
  if (pkg.scripts['test:e2e']) return 'present';
  pkg.scripts['test:e2e'] = 'playwright test';
  const indent = (text.match(/^[ \t]+(?=")/m) || ['  '])[0];
  writeFileSync(file, `${JSON.stringify(pkg, null, indent)}\n`);
  return 'added';
}

export function missingPlaywrightDeps(root) {
  const text = readText(path.join(root, 'package.json'));
  if (text === null) return [...PLAYWRIGHT_DEV_DEPS];
  try {
    const pkg = JSON.parse(text);
    const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    return PLAYWRIGHT_DEV_DEPS.filter((d) => !all[d]);
  } catch {
    return [...PLAYWRIGHT_DEV_DEPS];
  }
}

export function applyWebOverlay(root) {
  const src = webTemplatesDir();
  const result = { created: [], skipped: [], mcp: null, e2eScript: null, missingDeps: [] };
  if (!exists(src)) return { ...result, unavailable: true };
  for (const rel of walk(src)) {
    const relPosix = toPosix(rel);
    const dest = path.join(root, rel);
    if (relPosix === '.mcp.json' && exists(dest)) {
      result.mcp = mergeMcp(root, readFileSync(path.join(src, rel), 'utf8'));
      continue;
    }
    if (/^playwright\.config\./.test(relPosix) && hasPlaywrightConfig(root)) { result.skipped.push(relPosix); continue; }
    if (exists(dest)) { result.skipped.push(relPosix); continue; }
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(src, rel), dest);
    result.created.push(relPosix);
    if (relPosix === '.mcp.json') result.mcp = 'created';
  }
  result.e2eScript = ensureE2eScript(root);
  result.missingDeps = missingPlaywrightDeps(root);
  return result;
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

  // Web projects get Playwright from day one. The type comes from --type, or from an
  // existing CLAUDE.md so `rb init` stays idempotent on adopted repos.
  const effectiveTypes = types || projectTypesFromClaudeMd(root);
  const web = effectiveTypes.includes('web') ? applyWebOverlay(root) : null;
  return { root, templates: src, created, skipped, gitignoreAdded, customized, web };
}

export function projectTypesFromClaudeMd(root) {
  const text = readText(path.join(root, 'CLAUDE.md'));
  if (text === null) return [];
  const m = text.match(/^Project type:\s*(.+)$/m);
  if (!m) return [];
  return m[1].replace(/\s+#.*$/, '').split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter((t) => PROJECT_TYPES.includes(t));
}

// rb vendor (alias init): install or update the harness in a project (DESIGN.md section 3.2).
// Project-owned files are never overwritten, harness-owned files always are, JSON configs merge.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_TYPES, isTemplate, projectTypesFrom, readContract, sectionCommands, setHeaderField } from './contract.mjs';
import { CliError, exists, pluginRoot, readText, toPosix } from './util.mjs';

export { PROJECT_TYPES };
export const TOOLS = ['claude', 'cursor', 'codex'];
export const PLAYWRIGHT_DEV_DEPS = ['@playwright/test', '@playwright/mcp'];
const GITIGNORE_ADDITIONS = 'gitignore-additions.txt';
const REQUIRED_IGNORES = ['.rockbuilt/'];

export function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out.sort();
}

const isDir = (p) => exists(p) && statSync(p).isDirectory();

export function normalizeTypes(value) {
  const types = String(value).split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = types.filter((t) => !PROJECT_TYPES.includes(t));
  if (bad.length) throw new CliError(`unknown project type: ${bad.join(', ')} (use ${PROJECT_TYPES.join(', ')})`);
  if (!types.length) throw new CliError('--type needs at least one of web, ai, automation');
  return [...new Set(types)];
}

export function normalizeTools(value) {
  if (value === undefined) return ['claude'];
  if (value === true) throw new CliError('--tools needs a value, e.g. --tools claude,cursor');
  const tools = String(value).split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = tools.filter((t) => !TOOLS.includes(t));
  if (bad.length) throw new CliError(`unknown tool: ${bad.join(', ')} (use ${TOOLS.join(', ')})`);
  return [...new Set(['claude', ...tools])];
}

// ---------- JSON merge ----------

function hookKey(h) {
  if (h && typeof h === 'object' && typeof h.command === 'string') return `cmd:${h.command} ${JSON.stringify(h.args || [])}`;
  return null;
}

function mergeArray(user, tpl) {
  const out = [...user];
  const userStr = new Set(user.map((x) => JSON.stringify(x)));
  for (const item of tpl) {
    if (typeof item !== 'object' || item === null) {
      if (!userStr.has(JSON.stringify(item))) { out.push(item); userStr.add(JSON.stringify(item)); }
      continue;
    }
    // Hook groups ({ matcher, hooks: [...] }): merge into the group with the same matcher, by command.
    if (Array.isArray(item.hooks)) {
      const existingCmds = new Set(out.flatMap((g) => (g && Array.isArray(g.hooks) ? g.hooks.map(hookKey) : [])).filter(Boolean));
      const fresh = item.hooks.filter((h) => !existingCmds.has(hookKey(h)));
      if (!fresh.length) continue;
      const same = out.find((g) => g && Array.isArray(g.hooks) && g.matcher === item.matcher);
      if (same) same.hooks = [...same.hooks, ...fresh];
      else out.push({ ...item, hooks: fresh });
      continue;
    }
    const key = hookKey(item);
    if (key) {
      if (!out.some((x) => hookKey(x) === key)) out.push(item);
      continue;
    }
    if (typeof item.name === 'string') {
      if (!out.some((x) => x && x.name === item.name)) out.push(item);
      continue;
    }
    if (!userStr.has(JSON.stringify(item))) out.push(item);
  }
  return out;
}

// User values win; missing keys come from the template; arrays are unioned.
export function mergeJson(user, tpl) {
  if (Array.isArray(user) && Array.isArray(tpl)) return mergeArray(user, tpl);
  if (user && tpl && typeof user === 'object' && typeof tpl === 'object' && !Array.isArray(user) && !Array.isArray(tpl)) {
    const out = { ...user };
    for (const [k, v] of Object.entries(tpl)) out[k] = k in user ? mergeJson(user[k], v) : v;
    return out;
  }
  return user === undefined ? tpl : user;
}

// Writes the merged JSON when it differs: 'created' | 'merged' | 'unchanged' | 'invalid'.
export function mergeJsonFile(dest, templateText) {
  const tpl = JSON.parse(templateText);
  const current = readText(dest);
  if (current === null) {
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, `${JSON.stringify(tpl, null, 2)}\n`);
    return 'created';
  }
  let user;
  try {
    user = JSON.parse(current);
  } catch {
    return 'invalid';
  }
  const merged = mergeJson(user, tpl);
  if (JSON.stringify(merged) === JSON.stringify(user)) return 'unchanged';
  writeFileSync(dest, `${JSON.stringify(merged, null, 2)}\n`);
  return 'merged';
}

// ---------- gitignore ----------

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
    writeFileSync(file, `${current}${sep}${header}# Added by rb vendor\n${missing.join('\n')}\n`);
  }
  return missing;
}

// ---------- web overlay (v0.2 logic) ----------

function hasPlaywrightConfig(root) {
  return readdirSync(root).some((f) => /^playwright\.config\.(ts|js|mjs|cjs|mts|cts)$/.test(f));
}

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

export function applyWebOverlay(root, src) {
  const result = { created: [], skipped: [], mcp: null, e2eScript: null, missingDeps: [] };
  if (!isDir(src)) return { ...result, unavailable: true };
  for (const rel of walk(src)) {
    const relPosix = toPosix(rel);
    const dest = path.join(root, rel);
    if (relPosix === '.mcp.json') {
      const had = exists(dest);
      const before = had ? readText(dest) : null;
      const r = mergeJsonFile(dest, readFileSync(path.join(src, rel), 'utf8'));
      if (r === 'created') result.created.push(relPosix);
      let hasPw = false;
      try { hasPw = Boolean(JSON.parse(before ?? '{}').mcpServers?.playwright); } catch { /* invalid */ }
      result.mcp = r === 'created' ? 'created' : r === 'invalid' ? 'invalid' : hasPw ? 'present' : 'merged';
      continue;
    }
    if (/^playwright\.config\./.test(relPosix) && hasPlaywrightConfig(root)) { result.skipped.push(relPosix); continue; }
    if (exists(dest)) { result.skipped.push(relPosix); continue; }
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(src, rel), dest);
    result.created.push(relPosix);
  }
  result.e2eScript = ensureE2eScript(root);
  result.missingDeps = missingPlaywrightDeps(root);
  return result;
}

// ---------- codex agents ----------

// Frontmatter scalars (plain, quoted, or folded/literal blocks) and the body.
export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v === '>' || v === '|' || v === '>-' || v === '|-') {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) block.push(lines[++i].trim());
      v = v.startsWith('>') ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim();
    } else if (/^".*"$/.test(v)) {
      try { v = JSON.parse(v); } catch { v = v.slice(1, -1); }
    } else if (/^'.*'$/.test(v)) {
      v = v.slice(1, -1).replace(/''/g, "'");
    }
    data[kv[1]] = v;
  }
  return { data, body: m[2] };
}

function tomlMultiline(s) {
  const esc = s
    .replace(/\\/g, '\\\\')
    .replace(/"""/g, '""\\"')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `"""\n${esc}"""`;
}

export function agentToToml(text, fallbackName) {
  const { data, body } = parseFrontmatter(text);
  const name = data.name || fallbackName;
  return [
    '# Generated by rb vendor from .claude/agents. Do not edit; edit the source agent.',
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(data.description || '')}`,
    `developer_instructions = ${tomlMultiline(body.replace(/^\s+/, ''))}`,
    '',
  ].join('\n');
}

// ---------- main ----------

function readVersion(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

// Files under .github/workflows/ named rockbuilt* are harness-owned; other templates are project-owned.
function harnessOwnedTemplate(relPosix) {
  return /^\.github\/workflows\/rockbuilt[^/]*$/.test(relPosix);
}

const JSON_MERGED = new Set(['.claude/settings.json', '.mcp.json']);

// A CLAUDE.md that holds a real v0.2 contract (Verification commands, not the template).
function v02Contract(root) {
  const text = readText(path.join(root, 'CLAUDE.md'));
  if (text === null || isTemplate(text)) return false;
  const cmds = sectionCommands(text, 'Verification');
  return Boolean(cmds && cmds.length);
}

export function vendorProject(root, { from, type, lang, tools } = {}) {
  const src = from && from !== true ? path.resolve(from) : pluginRoot();
  if (!src) throw new CliError('cannot locate the Rockbuilt source: run from the plugin or pass --from <harness root>');
  if (!isDir(src)) throw new CliError(`harness root not found: ${src}`);
  const types = type !== undefined && type !== true ? normalizeTypes(type) : null;
  if (lang === true) throw new CliError('--lang needs a value, e.g. --lang es');
  const toolList = normalizeTools(tools);

  const r = { root, source: src, version: readVersion(src), tools: toolList, created: [], updated: [], unchanged: [], skipped: [], merged: [], missing: [], warnings: [], pending: [], customized: [], gitignoreAdded: [], web: null };
  const note = (list, rel) => r[list].push(toPosix(rel));

  // Harness-owned copy: overwrite when different.
  const putOwned = (srcFile, rel) => {
    const dest = path.join(root, rel);
    const data = readFileSync(srcFile);
    const had = exists(dest);
    if (had && readFileSync(dest).equals(data)) { note('unchanged', rel); return; }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, data);
    note(had ? 'updated' : 'created', rel);
  };
  const putOwnedText = (rel, text) => {
    const dest = path.join(root, rel);
    const had = exists(dest);
    if (had && readText(dest) === text) { note('unchanged', rel); return; }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, text);
    note(had ? 'updated' : 'created', rel);
  };
  // Replace a harness-owned directory wholesale (removes files dropped upstream).
  const replaceDir = (srcDir, relDir, transform = null) => {
    const destDir = path.join(root, relDir);
    const wanted = new Set(walk(srcDir).map(toPosix));
    if (isDir(destDir)) {
      for (const f of walk(destDir).map(toPosix)) {
        if (!wanted.has(f)) { rmSync(path.join(destDir, f)); note('updated', `${toPosix(relDir)}/${f} (removed)`); }
      }
    }
    for (const f of wanted) {
      const s = path.join(srcDir, f);
      if (transform && /\.(md|txt|json|toml|ya?ml)$/i.test(f)) putOwnedText(path.posix.join(toPosix(relDir), f), transform(readFileSync(s, 'utf8')));
      else putOwned(s, path.posix.join(toPosix(relDir), f));
    }
  };
  const need = (rel) => {
    const p = path.join(src, rel);
    if (exists(p)) return p;
    r.missing.push(toPosix(rel));
    return null;
  };

  // 1. tools/rockbuilt: rb.mjs, lib/, guard.mjs, VERSION.
  const rbSrc = need('scripts/rb.mjs');
  if (rbSrc) putOwned(rbSrc, 'tools/rockbuilt/rb.mjs');
  const libSrc = need('scripts/lib');
  if (libSrc) replaceDir(libSrc, 'tools/rockbuilt/lib');
  const guardSrc = need('hooks/guard.mjs');
  if (guardSrc) putOwned(guardSrc, 'tools/rockbuilt/guard.mjs');
  putOwnedText('tools/rockbuilt/VERSION', `${r.version}\n`);

  // 2. Skills and agents (Claude Code and Cursor read .claude/).
  const skillsSrc = need('harness/skills');
  const skillDirs = skillsSrc ? readdirSync(skillsSrc, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('rb-')).map((e) => e.name) : [];
  for (const s of skillDirs) replaceDir(path.join(skillsSrc, s), path.join('.claude', 'skills', s));
  const agentsSrc = need('harness/agents');
  const agentFiles = agentsSrc ? readdirSync(agentsSrc).filter((f) => /^rb-.*\.md$/.test(f)).sort() : [];
  for (const a of agentFiles) putOwned(path.join(agentsSrc, a), path.join('.claude', 'agents', a));
  for (const dir of ['skills', 'agents']) {
    const d = path.join(root, '.claude', dir);
    if (!isDir(d)) continue;
    const have = readdirSync(d).filter((n) => n.startsWith('rb-'));
    const known = dir === 'skills' ? skillDirs : agentFiles;
    for (const n of have) if (!known.includes(n) && (skillsSrc || agentsSrc)) r.warnings.push(`.claude/${dir}/${n} is not in this harness version; delete it if unused`);
  }

  // 3. Project templates.
  let ignoreLines = [...REQUIRED_IGNORES];
  const projectSrc = need('harness/project');
  let createdAgents = false;
  if (projectSrc) {
    for (const rel of walk(projectSrc)) {
      const relPosix = toPosix(rel);
      const s = path.join(projectSrc, rel);
      const dest = path.join(root, rel);
      if (relPosix === GITIGNORE_ADDITIONS) {
        ignoreLines = [...readFileSync(s, 'utf8').split(/\r?\n/), ...REQUIRED_IGNORES];
        continue;
      }
      if (JSON_MERGED.has(relPosix)) {
        const res = mergeJsonFile(dest, readFileSync(s, 'utf8'));
        if (res === 'invalid') r.warnings.push(`${relPosix} is not valid JSON; merge the harness entries by hand`);
        else note(res === 'merged' ? 'merged' : res === 'created' ? 'created' : 'unchanged', relPosix);
        continue;
      }
      if (harnessOwnedTemplate(relPosix)) { putOwned(s, relPosix); continue; }
      if (relPosix === 'AGENTS.md' && !exists(dest) && v02Contract(root)) {
        r.pending.push('AGENTS.md not created: CLAUDE.md holds the v0.2 contract; move it to AGENTS.md and leave "@AGENTS.md" in CLAUDE.md (rb-adopt does this)');
        continue;
      }
      if (exists(dest)) { note('skipped', relPosix); continue; }
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(s, dest);
      note('created', relPosix);
      if (relPosix === 'AGENTS.md') createdAgents = true;
    }
  }
  r.gitignoreAdded = appendGitignore(root, ignoreLines);

  // Header fields only on a newly created contract.
  const contractFile = createdAgents ? 'AGENTS.md' : r.created.includes('CLAUDE.md') && !exists(path.join(root, 'AGENTS.md')) ? 'CLAUDE.md' : null;
  if (contractFile && (types || lang)) {
    const file = path.join(root, contractFile);
    let text = readFileSync(file, 'utf8');
    if (types) { text = setHeaderField(text, 'Project type', types.join(', ')); r.customized.push('Project type'); }
    if (lang) { text = setHeaderField(text, 'Docs language', String(lang)); r.customized.push('Docs language'); }
    writeFileSync(file, text);
  }

  // 4. Web overlay when the project type includes web.
  const effectiveTypes = types || projectTypesFrom(readContract(root).text);
  if (effectiveTypes.includes('web')) {
    const webSrc = path.join(src, 'harness', 'web');
    if (isDir(webSrc)) r.web = applyWebOverlay(root, webSrc);
    else r.missing.push('harness/web');
  }

  // 5. Tool adapters.
  const copyAdapter = (name) => {
    const dir = need(`harness/adapters/${name}`);
    if (!dir) return;
    for (const rel of walk(dir)) {
      const relPosix = toPosix(rel);
      const s = path.join(dir, rel);
      // The adapter README documents the adapter for maintainers; it must never land on the project's README.
      if (relPosix === 'README.md') continue;
      if (relPosix === '.codex/config.toml' && exists(path.join(root, rel))) {
        r.skipped.push(relPosix);
        r.pending.push('.codex/config.toml exists; merge the Rockbuilt entries from harness/adapters/codex/.codex/config.toml by hand');
        continue;
      }
      if (relPosix.endsWith('.json')) {
        const res = mergeJsonFile(path.join(root, rel), readFileSync(s, 'utf8'));
        if (res === 'invalid') r.warnings.push(`${relPosix} is not valid JSON; merge the harness entries by hand`);
        else note(res === 'merged' ? 'merged' : res === 'created' ? 'created' : 'unchanged', relPosix);
      } else {
        putOwned(s, relPosix);
      }
    }
  };
  if (toolList.includes('cursor')) copyAdapter('cursor');
  if (toolList.includes('codex')) {
    const rewrite = (t) => t.replace(/\.claude\/skills\//g, '.agents/skills/');
    for (const s of skillDirs) replaceDir(path.join(skillsSrc, s), path.join('.agents', 'skills', s), rewrite);
    copyAdapter('codex');
    for (const a of agentFiles) {
      const toml = agentToToml(readFileSync(path.join(agentsSrc, a), 'utf8'), a.replace(/\.md$/, ''));
      putOwnedText(`.codex/agents/${a.replace(/\.md$/, '.toml')}`, toml);
    }
  }
  return r;
}

export function vendorText(r) {
  const lines = [`Rockbuilt ${r.version} from ${r.source} (tools: ${r.tools.join(', ')})`];
  const group = (label, list) => { for (const f of list) lines.push(`${label.padEnd(9)}${f}`); };
  group('created', r.created);
  group('updated', r.updated);
  group('merged', r.merged);
  group('skipped', r.skipped.map((f) => `${f} (project-owned, exists)`));
  if (r.unchanged.length) lines.push(`unchanged ${r.unchanged.length} harness file(s)`);
  lines.push(r.gitignoreAdded.length ? `.gitignore += ${r.gitignoreAdded.join(', ')}` : '.gitignore already complete');
  if (r.customized.length) lines.push(`contract set: ${r.customized.join(', ')}`);
  for (const m of r.missing) lines.push(`MISSING  ${m} not found in the source; skipped`);
  for (const w of r.warnings) lines.push(`WARN     ${w}`);
  for (const p of r.pending) lines.push(`PENDING  ${p}`);
  if (r.web) {
    const w = r.web;
    lines.push('web (Playwright):');
    lines.push(...w.created.map((f) => `created  ${f}`), ...w.skipped.map((f) => `skipped  ${f} (exists)`));
    if (w.mcp === 'merged') lines.push('merged   .mcp.json (added the playwright server)');
    if (w.mcp === 'invalid') lines.push('WARN     .mcp.json is not valid JSON; add the playwright server by hand');
    if (w.e2eScript === 'added') lines.push('package.json += scripts.test:e2e = "playwright test"');
    if (w.e2eScript === 'no-package-json') lines.push('WARN     no package.json yet; add "test:e2e": "playwright test" once the app exists');
    if (w.missingDeps.length) {
      lines.push(`next: npm install -D -E ${w.missingDeps.join(' ')}`);
      lines.push('next: npx playwright install chromium');
    }
  }
  return lines.join('\n');
}

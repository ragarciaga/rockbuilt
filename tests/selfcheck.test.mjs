// Plugin-wide invariants. Written to pass with zero skills/agents; rerun as they land.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../scripts/rb.mjs';
import { LABELS } from '../scripts/lib/gh.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const EM_DASH = String.fromCharCode(0x2014);
const MODELS = new Set(['opus', 'sonnet', 'haiku']);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

// Minimal YAML frontmatter reader: top-level "key: value" pairs, plus block scalars and lists as raw text.
export function frontmatter(text) {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return null;
  const data = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      data[key] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    } else if (key && /^\s+\S/.test(line)) {
      data[key] = `${data[key]} ${line.trim()}`.trim();
    }
  }
  return data;
}

function listDir(sub) {
  const dir = path.join(ROOT, sub);
  return existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir) : [];
}

test('no file contains the em dash character', () => {
  const offenders = [];
  for (const f of walk(ROOT)) {
    const buf = readFileSync(f);
    if (buf.includes(0)) continue; // binary
    const text = buf.toString('utf8');
    const idx = text.indexOf(EM_DASH);
    if (idx !== -1) offenders.push(`${rel(f)}:${text.slice(0, idx).split('\n').length}`);
  }
  assert.deepEqual(offenders, []);
});

// e2e-writer deliberately has no `tools:` line so Playwright MCP tools are reachable (DESIGN.md section 3).
const AGENTS_WITHOUT_TOOLS = new Set(['e2e-writer']);

test('agents have frontmatter with name, description, tools (except e2e-writer) and a valid model', () => {
  const problems = [];
  for (const name of listDir('agents').filter((n) => n.endsWith('.md'))) {
    const fm = frontmatter(readFileSync(path.join(ROOT, 'agents', name), 'utf8'));
    if (!fm) { problems.push(`${name}: no frontmatter`); continue; }
    const base = name.replace(/\.md$/, '');
    for (const k of ['name', 'description', 'model']) if (!fm[k]) problems.push(`${name}: missing ${k}`);
    if (AGENTS_WITHOUT_TOOLS.has(base)) {
      if ('tools' in fm) problems.push(`${name}: must not declare tools (Playwright MCP must stay reachable)`);
    } else if (!fm.tools) problems.push(`${name}: missing tools`);
    if (fm.name && fm.name !== base) problems.push(`${name}: name "${fm.name}" does not match the file name`);
    if (fm.model && !MODELS.has(fm.model)) problems.push(`${name}: model "${fm.model}" not in opus/sonnet/haiku`);
  }
  assert.deepEqual(problems, []);
});

test('e2e-writer states its write limits and the git/gh ban', () => {
  const file = path.join(ROOT, 'agents', 'e2e-writer.md');
  if (!existsSync(file)) return;
  const body = readFileSync(file, 'utf8');
  for (const needle of ['e2e/', 'playwright.config', 'test:e2e', '.gitignore', 'No git, no gh', 'guard']) {
    assert.ok(body.includes(needle), `e2e-writer.md should mention ${needle}`);
  }
});

test('every agent output template ends with a rockbuilt:status line', () => {
  const missing = [];
  for (const name of listDir('agents').filter((n) => n.endsWith('.md'))) {
    const base = name.replace(/\.md$/, '');
    const body = readFileSync(path.join(ROOT, 'agents', name), 'utf8');
    if (!body.includes(`<!-- rockbuilt:status stage=${base} task=`)) missing.push(name);
  }
  assert.deepEqual(missing, []);
});

test('skills and agents use only the rb:* labels from DESIGN.md section 10', () => {
  const known = new Set(LABELS.map((l) => l.name));
  const unknown = [];
  for (const dir of ['skills', 'agents']) {
    if (!existsSync(path.join(ROOT, dir))) continue;
    for (const f of walk(path.join(ROOT, dir)).filter((x) => x.endsWith('.md'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\brb:([a-z][a-z-]*)/g)) {
        if (m[1] === 'timing') continue; // progress.md timing markers, not a label
        if (!known.has(`rb:${m[1]}`)) unknown.push(`${rel(f)}: rb:${m[1]}`);
      }
    }
  }
  assert.deepEqual(unknown, []);
});

test('skills dispatch only real agents as rockbuilt:<name> and state the language rule', () => {
  const agents = new Set(listDir('agents').filter((n) => n.endsWith('.md')).map((n) => n.replace(/\.md$/, '')));
  const problems = [];
  for (const dir of listDir('skills')) {
    const file = path.join(ROOT, 'skills', dir, 'SKILL.md');
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/subagent_type:\s*"([^"]+)"/g)) {
      const v = m[1];
      if (v === 'rockbuilt:<name>') continue;
      const name = v.replace(/^rockbuilt:/, '');
      if (!v.startsWith('rockbuilt:') || !agents.has(name)) problems.push(`${dir}: subagent_type "${v}"`);
    }
    if (!/Docs language|conversation language/.test(text)) problems.push(`${dir}: no language rule`);
    if (!/em\s+dash/.test(text)) problems.push(`${dir}: no em dash rule`);
  }
  assert.deepEqual(problems, []);
});

test('skills have frontmatter with name and description', () => {
  const problems = [];
  for (const dir of listDir('skills')) {
    const file = path.join(ROOT, 'skills', dir, 'SKILL.md');
    if (!existsSync(file)) continue;
    const fm = frontmatter(readFileSync(file, 'utf8'));
    if (!fm) { problems.push(`${dir}: no frontmatter`); continue; }
    for (const k of ['name', 'description']) if (!fm[k]) problems.push(`${dir}: missing ${k}`);
  }
  assert.deepEqual(problems, []);
});

test('plugin.json, marketplace.json and hooks.json parse; plugin name is rockbuilt', () => {
  const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
  const plugin = read('.claude-plugin/plugin.json');
  const market = read('.claude-plugin/marketplace.json');
  const hooks = read('hooks/hooks.json');
  assert.equal(plugin.name, 'rockbuilt');
  assert.equal(market.name, 'rockbuilt');
  assert.ok(market.plugins.some((p) => p.name === 'rockbuilt'));
  const pre = hooks.hooks.PreToolUse;
  assert.ok(Array.isArray(pre) && pre.length > 0);
  assert.equal(pre[0].matcher, 'Bash|Edit|Write|MultiEdit|NotebookEdit');
  assert.equal(pre[0].hooks[0].command, 'node');
});

test('every `rb <subcommand>` mentioned in skills is a known CLI command', () => {
  const known = new Set(Object.keys(COMMANDS));
  const unknown = [];
  const files = existsSync(path.join(ROOT, 'skills')) ? walk(path.join(ROOT, 'skills')).filter((f) => f.endsWith('.md')) : [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    // "rb <word>" at a command position: line start, after a backtick, or after a shell separator.
    const re = /(?:^|[`$(]|&&\s*|\|\|\s*|;\s*)\s*rb\s+([a-z][a-z-]*)/gm;
    for (const m of text.matchAll(re)) if (!known.has(m[1])) unknown.push(`${rel(f)}: rb ${m[1]}`);
    const fallback = /scripts\/rb\.mjs"?\s+([a-z][a-z-]*)/g;
    for (const m of text.matchAll(fallback)) if (!known.has(m[1])) unknown.push(`${rel(f)}: rb.mjs ${m[1]}`);
  }
  assert.deepEqual(unknown, []);
});

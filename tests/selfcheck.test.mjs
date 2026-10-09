// Harness-wide invariants for the v0.3 layout (DESIGN.md sections 2, 3, 4, 7, 21).
//   harness/skills/rb-*/SKILL.md   canonical skills (vendored into projects)
//   harness/agents/rb-*.md         canonical agents
//   skills/*/SKILL.md              plugin skills (only /rockbuilt:install)
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../scripts/rb.mjs';
import { GH_OPS, LABELS } from '../scripts/lib/gh.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const EM_DASH = String.fromCharCode(0x2014);
const AGENT_MODELS = new Set(['opus', 'sonnet']);
const MAX_SKILL_LINES = 260;

const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    // evals/results/<run>/ holds raw model transcripts (gitignored), not harness files.
    if (e.isDirectory() && /^evals\/results\/./.test(rel(full))) continue;
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

// Minimal YAML frontmatter reader: top-level "key: value" pairs, block scalars folded into one line.
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

function subdirs(sub) {
  const dir = path.join(ROOT, sub);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function skillFiles() {
  const out = [];
  for (const base of ['harness/skills', 'skills']) {
    for (const d of subdirs(base)) {
      const file = path.join(ROOT, base, d, 'SKILL.md');
      if (existsSync(file)) out.push({ base, dir: d, file, text: readFileSync(file, 'utf8') });
    }
  }
  return out;
}

const AGENTS_DIR = path.join(ROOT, 'harness', 'agents');
const agentFiles = () => (existsSync(AGENTS_DIR) ? readdirSync(AGENTS_DIR).filter((n) => n.endsWith('.md')).sort() : []);
const agentNames = () => new Set(agentFiles().map((n) => n.replace(/\.md$/, '')));

// Markdown that documents the harness: canonical skills and agents, plugin skills, docs, README.
function docFiles() {
  return [
    ...walk(path.join(ROOT, 'harness')),
    ...walk(path.join(ROOT, 'skills')),
    ...walk(path.join(ROOT, 'docs')),
    path.join(ROOT, 'README.md'),
  ].filter((f) => f.endsWith('.md') && existsSync(f));
}

// ---------- layout ----------

test('the v0.3 layout exists: harness skills and agents, one plugin skill (install)', () => {
  assert.ok(subdirs('harness/skills').length > 0, 'harness/skills is empty');
  assert.ok(agentFiles().length > 0, 'harness/agents is empty');
  assert.deepEqual(subdirs('skills'), ['install']);
  assert.ok(!existsSync(path.join(ROOT, 'agents')), 'top-level agents/ is the v0.2 layout; agents live in harness/agents');
});

// ---------- skills ----------

test('harness skills have frontmatter: name rb-* equal to the folder, and a description', () => {
  const problems = [];
  for (const s of skillFiles().filter((x) => x.base === 'harness/skills')) {
    const fm = frontmatter(s.text);
    if (!fm) { problems.push(`${s.dir}: no frontmatter`); continue; }
    if (!fm.description) problems.push(`${s.dir}: missing description`);
    if (!/^rb-[a-z][a-z0-9-]*$/.test(fm.name || '')) problems.push(`${s.dir}: name "${fm.name}" is not rb-*`);
    if (fm.name !== s.dir) problems.push(`${s.dir}: name "${fm.name}" does not match the folder`);
  }
  assert.deepEqual(problems, []);
});

test('plugin skills have frontmatter: name equal to the folder, and a description', () => {
  const problems = [];
  for (const s of skillFiles().filter((x) => x.base === 'skills')) {
    const fm = frontmatter(s.text);
    if (!fm) { problems.push(`${s.dir}: no frontmatter`); continue; }
    if (!fm.description) problems.push(`${s.dir}: missing description`);
    if (fm.name !== s.dir) problems.push(`${s.dir}: name "${fm.name}" does not match the folder`);
  }
  assert.deepEqual(problems, []);
});

test('every SKILL.md states the language rule, the tú register and the em dash rule', () => {
  const problems = [];
  for (const s of skillFiles()) {
    const id = `${s.base}/${s.dir}`;
    if (!/Docs language/.test(s.text)) problems.push(`${id}: no Docs language rule`);
    if (!/(^|[^\p{L}])tú([^\p{L}]|$)/u.test(s.text) || !/\bvos\b/.test(s.text)) problems.push(`${id}: no tú/vos register line`);
    if (!/em\s+dash/i.test(s.text)) problems.push(`${id}: no em dash rule`);
  }
  assert.deepEqual(problems, []);
});

test(`every SKILL.md stays under ${MAX_SKILL_LINES} lines`, () => {
  const long = skillFiles()
    .map((s) => ({ id: `${s.base}/${s.dir}`, n: s.text.split('\n').length }))
    .filter((x) => x.n >= MAX_SKILL_LINES)
    .map((x) => `${x.id}: ${x.n} lines`);
  assert.deepEqual(long, []);
});

test('skills dispatch only existing harness agents (subagent_type "rb-<x>")', () => {
  const agents = agentNames();
  const problems = [];
  for (const f of [...walk(path.join(ROOT, 'harness', 'skills')), ...walk(path.join(ROOT, 'skills'))].filter((x) => x.endsWith('.md'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/subagent_type:\s*"([^"]+)"/g)) {
      const v = m[1];
      if (/^rb-<[a-z]+>$/.test(v)) continue; // documented placeholder
      if (!v.startsWith('rb-') || !agents.has(v)) problems.push(`${rel(f)}: subagent_type "${v}"`);
    }
  }
  assert.deepEqual(problems, []);
});

// ---------- agents ----------

// rb-e2e-writer deliberately has no `tools:` line so Playwright MCP tools stay reachable (DESIGN.md section 4).
const AGENTS_WITHOUT_TOOLS = new Set(['rb-e2e-writer']);

test('harness agents: name rb-* equal to the file, description, model opus|sonnet, tools (except rb-e2e-writer)', () => {
  const problems = [];
  for (const name of agentFiles()) {
    const base = name.replace(/\.md$/, '');
    const fm = frontmatter(readFileSync(path.join(AGENTS_DIR, name), 'utf8'));
    if (!fm) { problems.push(`${name}: no frontmatter`); continue; }
    if (!/^rb-[a-z][a-z0-9-]*$/.test(base)) problems.push(`${name}: file name is not rb-*`);
    if (fm.name !== base) problems.push(`${name}: name "${fm.name}" does not match the file name`);
    if (!fm.description) problems.push(`${name}: missing description`);
    if (!AGENT_MODELS.has(fm.model)) problems.push(`${name}: model "${fm.model}" not in opus|sonnet`);
    if (AGENTS_WITHOUT_TOOLS.has(base)) {
      if ('tools' in fm) problems.push(`${name}: must not declare tools (Playwright MCP must stay reachable)`);
    } else if (!fm.tools) problems.push(`${name}: missing tools`);
  }
  assert.deepEqual(problems, []);
});

test('every agent ends its output with its rockbuilt:status line', () => {
  const missing = [];
  for (const name of agentFiles()) {
    const base = name.replace(/\.md$/, '');
    const body = readFileSync(path.join(AGENTS_DIR, name), 'utf8');
    if (!body.includes(`<!-- rockbuilt:status stage=${base} `)) missing.push(name);
  }
  assert.deepEqual(missing, []);
});

test('rb-e2e-writer states its write limits and the git/gh ban', () => {
  const file = path.join(AGENTS_DIR, 'rb-e2e-writer.md');
  assert.ok(existsSync(file), 'harness/agents/rb-e2e-writer.md is missing');
  const body = readFileSync(file, 'utf8');
  for (const needle of ['e2e/', 'playwright.config', 'git', 'gh', 'guard']) {
    assert.ok(body.includes(needle), `rb-e2e-writer.md should mention ${needle}`);
  }
});

// ---------- rb commands, gh ops, labels ----------

test('every rb command mentioned in skills, agents and docs is a real CLI command', () => {
  const known = new Set(Object.keys(COMMANDS));
  const ghOps = new Set(Object.keys(GH_OPS));
  const unknown = [];
  // "rb <word>" at a command position: line start, after a backtick, $( or a shell separator.
  const short = /(?:^|`|\$\(|&&\s*|\|\|\s*|;\s*)\s*rb\s+([a-z][a-z-]*)/gm;
  // node tools/rockbuilt/rb.mjs <cmd>, node scripts/rb.mjs <cmd>, "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" <cmd>
  const full = /rb\.mjs"?\s+([a-z][a-z-]*)/g;
  const gh = /(?:(?:^|`|\$\(|&&\s*|\|\|\s*|;\s*)\s*rb|rb\.mjs"?)\s+gh\s+([a-z][a-z-]*)/gm;
  for (const f of docFiles()) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(short)) if (!known.has(m[1])) unknown.push(`${rel(f)}: rb ${m[1]}`);
    for (const m of text.matchAll(full)) if (!known.has(m[1])) unknown.push(`${rel(f)}: rb.mjs ${m[1]}`);
    for (const m of text.matchAll(gh)) if (!ghOps.has(m[1])) unknown.push(`${rel(f)}: rb gh ${m[1]}`);
  }
  assert.deepEqual([...new Set(unknown)], []);
});

test('every rb:* label mentioned in the harness, plugin skills and docs exists in scripts/lib/gh.mjs', () => {
  const known = new Set(LABELS.map((l) => l.name));
  const unknown = [];
  for (const f of docFiles()) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\brb:([a-z][a-z-]*)(<)?/g)) {
      if (m[1] === 'timing') continue; // progress.md timing markers, not a label
      if (m[1].endsWith('-') && m[2]) continue; // placeholder such as rb:tier-<x>
      if (!known.has(`rb:${m[1]}`)) unknown.push(`${rel(f)}: rb:${m[1]}`);
    }
  }
  assert.deepEqual([...new Set(unknown)], []);
});

test('harness markdown never uses gh issue/pr/label directly (REST only through rb gh)', () => {
  // DESIGN.md section 7. A line that forbids the command ("never `gh pr merge`") is not usage.
  const forbids = /\b(never|not|no|forbidden|denied|deny|instead of)\b/i;
  const usage = [];
  for (const f of walk(path.join(ROOT, 'harness')).filter((x) => x.endsWith('.md'))) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/\bgh (issue|pr|label) /.test(line) && !forbids.test(line)) usage.push(`${rel(f)}:${i + 1}`);
    });
  }
  assert.deepEqual(usage, []);
});

test('the project settings template never allows gh issue/pr/label', () => {
  const file = path.join(ROOT, 'harness', 'project', '.claude', 'settings.json');
  if (!existsSync(file)) return;
  const perms = JSON.parse(readFileSync(file, 'utf8')).permissions || {};
  const bad = [...(perms.allow || []), ...(perms.ask || [])].filter((r) => /\bgh (issue|pr|label)\b/.test(r));
  assert.deepEqual(bad, []);
});

// ---------- manifests and versions ----------

test('plugin.json, marketplace.json and hooks.json parse; matcher covers Read, Grep and Glob', () => {
  const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
  const plugin = read('.claude-plugin/plugin.json');
  const market = read('.claude-plugin/marketplace.json');
  const hooks = read('hooks/hooks.json');
  assert.equal(plugin.name, 'rockbuilt');
  assert.equal(market.name, 'rockbuilt');
  assert.ok(market.plugins.some((p) => p.name === 'rockbuilt'));
  const pre = hooks.hooks.PreToolUse;
  assert.ok(Array.isArray(pre) && pre.length > 0);
  assert.equal(pre[0].matcher, 'Bash|Edit|Write|MultiEdit|NotebookEdit|Read|Grep|Glob');
  assert.equal(pre[0].hooks[0].command, 'node');
});

test('plugin.json and package.json versions match the top CHANGELOG entry', () => {
  const plugin = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const top = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').match(/^## (\d+\.\d+\.\d+)/m);
  assert.ok(top, 'CHANGELOG.md has no "## x.y.z" entry');
  assert.equal(plugin.version, pkg.version, 'plugin.json and package.json versions differ');
  assert.equal(plugin.version, top[1], 'plugin.json version is not the top CHANGELOG entry');
});

// ---------- style ----------

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

test('cloud front doors in .claude/skills point to the real skill and copy its frontmatter', () => {
  for (const name of ['rb-kickoff', 'rb-adopt']) {
    const front = (p) => readFileSync(path.join(ROOT, p), 'utf8').match(/^---\n([\s\S]*?)\n---\n/)[1];
    assert.equal(front(`.claude/skills/${name}/SKILL.md`), front(`harness/skills/${name}/SKILL.md`), `${name}: frontmatter drifted from harness/skills`);
    assert.match(readFileSync(path.join(ROOT, `.claude/skills/${name}/SKILL.md`), 'utf8'), new RegExp(`harness/skills/${name}/SKILL\\.md`));
  }
});

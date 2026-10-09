import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main } from '../scripts/rb.mjs';
import { sectionCommands } from '../scripts/lib/claudemd.mjs';
import { runDoctor } from '../scripts/lib/doctor.mjs';
import { planBatches } from '../scripts/lib/parallel.mjs';
import { coverage, parseRequirements, parseTasks } from '../scripts/lib/spec.mjs';
import { aggregate, renderTable } from '../scripts/lib/timing.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RB_BIN = path.join(HERE, '..', 'bin', 'rb');
const temps = [];
after(() => { for (const t of temps) rmSync(t, { recursive: true, force: true }); });

function tmp(prefix = 'rb-test-') {
  const d = mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(d);
  return d;
}

function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const FENCE = '```';
const CLAUDE_MD = `# Demo

Docs language: es
Project type: web, ai            # any of: web, ai, automation
Parallel: auto
Max parallel: 3
Default branch: main

## Goal
Demo goal.

## Stack
Node.

## Conventions
None.

## Verification
${FENCE}bash
# comment line is skipped
node -e "process.exit(0)"

node -e "console.log('a\\nb\\nc\\nd')"
${FENCE}

## E2E
${FENCE}bash
npm run test:e2e
${FENCE}

## Setup
${FENCE}bash
npm install
${FENCE}

## Out of scope
Nothing.
`;

const REQUIREMENTS = `# Login
Status: approved

## Context
Users log in.

## R1: Log in
- R1.1: When a user submits valid credentials, the system shall create a session. [integration]
- R1.2: If the password is wrong, then the system shall show an error. [e2e]

## R2: Log out
- R2.1: When the user logs out, the system shall end the session. [unit]
- R2.2: The system shall expire sessions after 30 minutes. [unit]
`;

const TASKS = `# Tasks: Login
Spec: docs/specs/01-login/  |  Status: approved  |  Converged: 2026-10-01, 2 rounds

## T1: Create session store
- Purpose: Sessions persist.
- Covers: R1.1
- Size: S
- Depends on: none
- Files: src/session.ts, src/session.test.ts           (expected touch list, used for parallel batching)
- Verify: \`npm test -- session.test.ts\`
- Issue: #12
- Status: done

### Decision log
- 2026-10-01: Covers: R9.9 in a log line is ignored, because logs are prose. Outcome: green.

## T2: Login form
- Purpose: Users can log in.
- Covers: R1.1, R1.2
- Size: M
- Depends on: T1
- Files: src/login.tsx, src/login.test.tsx
- Verify: \`npm test -- login\`; E2E case 1
- Issue: #13
- Status: todo

## T3: Logout button
- Purpose: Users can log out.
- Covers: R2.1, R7.1
- Size: S
- Depends on: T1
- Files: src/logout.tsx
- Verify: \`npm test -- logout\`
- Issue: #14
- Status: todo

## T4: Add dependency
- Purpose: Needed lib.
- Covers: R2.1
- Size: S
- Depends on: none
- Files: package.json, src/lib.ts
- Verify: \`npm test\`
- Status: todo

## T5: Shares login file
- Purpose: Tweak login.
- Covers: R1.2
- Size: S
- Depends on: T1
- Files: src/login.tsx
- Verify: \`npm test -- login\`
- Status: todo

## T6: Blocked by T2
- Purpose: Later.
- Covers: R1.2
- Size: S
- Depends on: T2
- Files: src/later.ts
- Verify: \`npm test -- later\`
- Status: todo

## T7: Directory scope
- Purpose: Utilities.
- Covers: R1.1
- Size: S
- Depends on: none
- Files: src/utils/**
- Verify: \`npm test -- utils\`
- Status: todo

## T8: In utils
- Purpose: One util.
- Covers: R1.1
- Size: S
- Depends on: none
- Files: src/utils/date.ts
- Verify: \`npm test -- date\`
- Status: todo
`;

function makeRepo({ claudeMd = CLAUDE_MD, spec = true } = {}) {
  const root = tmp();
  sh(root, 'git', ['init', '-q', '-b', 'main']);
  sh(root, 'git', ['config', 'user.email', 't@example.com']);
  sh(root, 'git', ['config', 'user.name', 'Test']);
  sh(root, 'git', ['config', 'commit.gpgsign', 'false']);
  if (claudeMd !== null) writeFileSync(path.join(root, 'CLAUDE.md'), claudeMd);
  if (spec) {
    const dir = path.join(root, 'docs', 'specs', '01-login');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'requirements.md'), REQUIREMENTS);
    writeFileSync(path.join(dir, 'tasks.md'), TASKS);
  }
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  sh(root, 'git', ['add', '-A']);
  sh(root, 'git', ['commit', '-q', '-m', 'init']);
  return root;
}

async function rb(cwd, ...argv) {
  const out = [];
  const err = [];
  const code = await main(argv, { cwd, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

async function rbJson(cwd, ...argv) {
  const r = await rb(cwd, ...argv, '--json');
  return { ...r, json: JSON.parse(r.out) };
}

// ---------- verify-cmds ----------

test('verify-cmds: parses the first fenced block, skipping comments and blanks', async () => {
  const root = makeRepo();
  const r = await rbJson(root, 'verify-cmds');
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.commands, ['node -e "process.exit(0)"', `node -e "console.log('a\\nb\\nc\\nd')"`]);
});

test('verify-cmds: other sections, case-insensitive, and missing section', async () => {
  const root = makeRepo();
  assert.equal((await rb(root, 'verify-cmds', 'e2e')).out, 'npm run test:e2e');
  assert.equal((await rb(root, 'verify-cmds', 'Setup')).out, 'npm install');
  const missing = await rb(root, 'verify-cmds', 'Evals');
  assert.equal(missing.code, 1);
  assert.match(missing.err, /not found/);
});

test('verify-cmds: works from a subdirectory and fails without CLAUDE.md', async () => {
  const root = makeRepo();
  const sub = path.join(root, 'docs');
  assert.equal((await rb(sub, 'verify-cmds', 'E2E')).code, 0);
  const bare = makeRepo({ claudeMd: null, spec: false });
  assert.equal((await rb(bare, 'verify-cmds')).code, 1);
});

test('sectionCommands ignores headings inside fences and handles CRLF', () => {
  const text = CLAUDE_MD.replace(/\n/g, '\r\n');
  assert.equal(sectionCommands(text, 'Verification').length, 2);
  assert.deepEqual(sectionCommands('## Verification\nno fence here\n', 'Verification'), []);
});

// ---------- tasks ----------

test('parseTasks: fields, decision log ignored, header', () => {
  const p = parseTasks(TASKS);
  assert.equal(p.feature, 'Login');
  assert.equal(p.status, 'approved');
  assert.equal(p.tasks.length, 8);
  const t1 = p.tasks[0];
  assert.deepEqual(t1, {
    id: 'T1',
    title: 'Create session store',
    purpose: 'Sessions persist.',
    covers: ['R1.1'],
    size: 'S',
    depends: [],
    files: ['src/session.ts', 'src/session.test.ts'],
    verify: ['npm test -- session.test.ts'],
    issue: 12,
    status: 'done',
  });
  assert.deepEqual(p.tasks[1].verify, ['npm test -- login', 'E2E case 1']);
  assert.deepEqual(p.tasks[1].depends, ['T1']);
  assert.equal(p.tasks[3].issue, null);
});

test('parseRequirements and coverage: uncovered and unknown IDs', () => {
  const criteria = parseRequirements(REQUIREMENTS);
  assert.deepEqual(criteria.map((c) => c.id), ['R1.1', 'R1.2', 'R2.1', 'R2.2']);
  assert.equal(criteria[1].verifyBy, 'e2e');
  const cov = coverage(criteria, parseTasks(TASKS).tasks);
  assert.deepEqual(cov.uncovered, ['R2.2']);
  assert.deepEqual(cov.unknown, [{ task: 'T3', id: 'R7.1' }]);
});

test('rb tasks: JSON output and non-zero exit on coverage gaps', async () => {
  const root = makeRepo();
  const r = await rbJson(root, 'tasks', 'docs/specs/01-login');
  assert.equal(r.code, 1);
  assert.equal(r.json.tasks.length, 8);
  assert.deepEqual(r.json.coverage.uncovered, ['R2.2']);
  assert.equal(r.json.coverage.unknown[0].id, 'R7.1');
});

test('rb tasks: full coverage exits 0; missing requirements.md still parses', async () => {
  const root = makeRepo();
  const dir = path.join(root, 'docs', 'specs', '01-login');
  writeFileSync(path.join(dir, 'tasks.md'), TASKS.replace('R2.1, R7.1', 'R2.1, R2.2'));
  assert.equal((await rb(root, 'tasks', dir)).code, 0);
  rmSync(path.join(dir, 'requirements.md'));
  const r = await rbJson(root, 'tasks', dir);
  assert.equal(r.code, 0);
  assert.equal(r.json.coverage, undefined);
});

test('rb tasks: missing tasks.md and missing argument fail cleanly', async () => {
  const root = makeRepo();
  assert.equal((await rb(root, 'tasks', 'nope')).code, 1);
  assert.equal((await rb(root, 'tasks')).code, 1);
});

// ---------- parallel ----------

test('parallel: depends, status, shared path, file clash, directory clash', () => {
  const r = planBatches(parseTasks(TASKS).tasks, { max: 3 });
  assert.deepEqual(r.ready, ['T2', 'T3', 'T4', 'T5', 'T7', 'T8']);
  assert.deepEqual(r.batches, [['T2', 'T3', 'T7'], ['T5', 'T8'], ['T4']]);
  assert.ok(r.excluded.find((e) => e.id === 'T1' && /done/.test(e.reason)));
  assert.ok(r.excluded.find((e) => e.id === 'T6' && /T2/.test(e.reason)));
  assert.ok(r.reasons.some((x) => /T4 runs alone: touches shared path package\.json/.test(x)));
  assert.ok(r.reasons.some((x) => /T5 not with T2/.test(x)));
  const wide = planBatches(parseTasks(TASKS).tasks, { max: 10 });
  assert.deepEqual(wide.batches, [['T2', 'T3', 'T7'], ['T5', 'T8'], ['T4']]);
  assert.ok(wide.reasons.some((x) => /T8 not with T7: both touch src\/utils\/date\.ts/.test(x)));
});

test('parallel: max batch size and --ids filter', () => {
  const tasks = parseTasks(TASKS).tasks;
  assert.deepEqual(planBatches(tasks, { max: 1 }).batches, [['T2'], ['T3'], ['T5'], ['T7'], ['T8'], ['T4']]);
  assert.deepEqual(planBatches(tasks, { max: 2 }).batches, [['T2', 'T3'], ['T5', 'T7'], ['T8'], ['T4']]);
  const r = planBatches(tasks, { ids: ['T3', 'T8', 'T6', 'T99'] });
  assert.deepEqual(r.batches, [['T3', 'T8']]);
  assert.ok(r.excluded.some((e) => e.id === 'T99' && /unknown/.test(e.reason)));
});

test('parallel: other shared paths force serial', () => {
  const mk = (id, files) => ({ id, status: 'todo', depends: [], files });
  for (const f of ['pnpm-lock.yaml', 'db/migrations/001.sql', 'prisma/schema.prisma', 'supabase/config.toml', 'drizzle/0001.sql', '.env.local', 'vite.config.ts', 'tsconfig.json']) {
    const r = planBatches([mk('T1', ['src/a.ts']), mk('T2', [f])], { max: 3 });
    assert.deepEqual(r.batches, [['T1'], ['T2']], f);
  }
});

test('parallel: deterministic CLI output', async () => {
  const root = makeRepo();
  const a = await rb(root, 'parallel', 'docs/specs/01-login', '--max', '3');
  const b = await rb(root, 'parallel', 'docs/specs/01-login', '--max', '3');
  assert.equal(a.code, 0);
  assert.equal(a.out, b.out);
  assert.match(a.out, /^Batch 1: T2, T3, T7$/m);
  const j = await rbJson(root, 'parallel', 'docs/specs/01-login', '--ids', 'T2,T3', '--max', '2');
  assert.deepEqual(j.json.batches, [['T2', 'T3']]);
  assert.equal((await rb(root, 'parallel', 'docs/specs/01-login', '--max', '0')).code, 1);
});

// ---------- timing ----------

test('timing: aggregate pairs start/end and reports open phases', () => {
  const ev = (event, task, phase, min) => ({ event, task, phase, ts: new Date(Date.UTC(2026, 0, 1, 0, min)).toISOString() });
  const report = aggregate([
    ev('start', 'T1', 'plan', 0), ev('end', 'T1', 'plan', 5),
    ev('start', 'T1', 'implement', 5), ev('end', 'T1', 'implement', 25),
    ev('start', 'T1', 'plan', 30), ev('end', 'T1', 'plan', 32),
    ev('start', 'T2', 'plan', 0), ev('end', 'T2', 'verify', 3),
    ev('start', 'T2', 'verify', 4),
  ]);
  assert.equal(report.tasks[0].phases.plan, 7 * 60000);
  assert.equal(report.tasks[0].totalMs, 27 * 60000);
  assert.deepEqual(report.open.map((o) => `${o.task}/${o.phase}`).sort(), ['T2/plan', 'T2/verify']);
  const table = renderTable(report);
  assert.match(table, /^\| Task \| plan \| implement \| Total \|$/m);
  assert.match(table, /^\| T1 \| 7\.0 \| 20\.0 \| 27\.0 \|$/m);
  assert.match(table, /Open \(started, not ended\): T2\/plan, T2\/verify\./);
});

test('rb timing start/end/report --write replaces the marked block', async () => {
  const root = makeRepo();
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  const progress = path.join(root, 'docs', 'progress.md');
  writeFileSync(progress, '# Progress\n\n## Timing\n<!-- rb:timing:start -->\nold\n<!-- rb:timing:end -->\n\n## After\nkeep\n');
  assert.equal((await rb(root, 'timing', 'start', 'T1', 'plan')).code, 0);
  assert.equal((await rb(root, 'timing', 'end', 'T1', 'plan')).code, 0);
  const lines = readFileSync(path.join(root, '.rockbuilt', 'timing.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).event, 'start');
  const r = await rb(root, 'timing', 'report', '--write');
  assert.equal(r.code, 0);
  const text = readFileSync(progress, 'utf8');
  assert.doesNotMatch(text, /\nold\n/);
  assert.match(text, /\| T1 \| 0\.0 \| 0\.0 \|/);
  assert.match(text, /## After\nkeep\n$/);
  assert.equal(text.match(/rb:timing:start/g).length, 1);
});

test('rb timing report --write appends the block when markers are missing', async () => {
  const root = makeRepo();
  const progress = path.join(root, 'docs', 'progress.md');
  writeFileSync(progress, '# Progress\n\nNo timing yet.\n');
  await rb(root, 'timing', 'start', 'T2', 'verify');
  await rb(root, 'timing', 'end', 'T2', 'verify');
  await rb(root, 'timing', 'report', '--write');
  const text = readFileSync(progress, 'utf8');
  assert.match(text, /No timing yet\.\n\n## Timing\n<!-- rb:timing:start -->\n\| Task \| verify \| Total \|/);
  assert.match(text, /<!-- rb:timing:end -->\n$/);
});

test('rb timing: invalid phase and missing args fail', async () => {
  const root = makeRepo();
  assert.equal((await rb(root, 'timing', 'start', 'T1', 'coding')).code, 1);
  assert.equal((await rb(root, 'timing', 'start')).code, 1);
  assert.equal((await rb(root, 'timing', 'bogus')).code, 1);
  assert.match((await rb(root, 'timing', 'report')).out, /No timing data/);
});

// ---------- init ----------

function fakeTemplates() {
  const dir = tmp('rb-tpl-');
  mkdirSync(path.join(dir, '.claude'), { recursive: true });
  mkdirSync(path.join(dir, 'docs'), { recursive: true });
  writeFileSync(path.join(dir, 'CLAUDE.md'), '# <Project name>\n\nDocs language: <es|en>\nProject type: <web, ai, automation>\n\n## Goal\nx\n');
  writeFileSync(path.join(dir, '.claude', 'settings.json'), '{}\n');
  writeFileSync(path.join(dir, 'docs', 'progress.md'), 'template progress\n');
  writeFileSync(path.join(dir, 'gitignore-additions.txt'), '# comment\n.rockbuilt/\ncoverage/\nnode_modules\n');
  return dir;
}

async function withTemplates(dir, fn) {
  const prev = process.env.RB_TEMPLATES_DIR;
  process.env.RB_TEMPLATES_DIR = dir;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.RB_TEMPLATES_DIR;
    else process.env.RB_TEMPLATES_DIR = prev;
  }
}

test('rb init: copies, skips existing, appends .gitignore, sets type and lang', async () => {
  const root = makeRepo({ claudeMd: null, spec: false });
  writeFileSync(path.join(root, 'docs-keep.txt'), '');
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'progress.md'), 'mine\n');
  const tpl = fakeTemplates();
  const r = await withTemplates(tpl, () => rbJson(root, 'init', '--type', 'web,ai', '--lang', 'es'));
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.created.sort(), ['.claude/settings.json', 'CLAUDE.md']);
  assert.deepEqual(r.json.skipped, ['docs/progress.md']);
  assert.ok(!existsSync(path.join(root, 'gitignore-additions.txt')));
  assert.equal(readFileSync(path.join(root, 'docs', 'progress.md'), 'utf8'), 'mine\n');
  const claude = readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /^Project type: web, ai$/m);
  assert.match(claude, /^Docs language: es$/m);
  const gi = readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.deepEqual(r.json.gitignoreAdded, ['.rockbuilt/', 'coverage/']);
  assert.equal(gi, 'node_modules/\n\n# Added by rb init\n.rockbuilt/\ncoverage/\n');

  const again = await withTemplates(tpl, () => rbJson(root, 'init', '--type', 'automation'));
  assert.deepEqual(again.json.created, []);
  assert.equal(again.json.skipped.length, 3);
  assert.deepEqual(again.json.gitignoreAdded, []);
  assert.match(readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), /^Project type: web, ai$/m);
});

test('rb init: rejects unknown type and missing templates dir', async () => {
  const root = makeRepo({ claudeMd: null, spec: false });
  const tpl = fakeTemplates();
  assert.equal((await withTemplates(tpl, () => rb(root, 'init', '--type', 'mobile'))).code, 1);
  assert.equal((await withTemplates(path.join(tpl, 'nope'), () => rb(root, 'init'))).code, 1);
});

test('rb init: works with the real plugin templates when present', async (t) => {
  const real = path.join(HERE, '..', 'templates', 'project');
  if (!existsSync(real)) { t.skip('templates/project not written yet'); return; }
  const root = makeRepo({ claudeMd: null, spec: false });
  const r = await withTemplates(real, () => rbJson(root, 'init', '--lang', 'en'));
  assert.equal(r.code, 0);
  assert.ok(r.json.gitignoreAdded.includes('.rockbuilt/') || readFileSync(path.join(root, '.gitignore'), 'utf8').includes('.rockbuilt/'));
});

test('rb init --type web: Playwright config, smoke spec, MCP server and test:e2e script', async () => {
  const root = makeRepo({ claudeMd: null, spec: false });
  writeFileSync(path.join(root, 'package.json'), '{\n  "name": "demo",\n  "scripts": { "dev": "next dev" }\n}\n');
  const r = await withTemplates(fakeTemplates(), () => rbJson(root, 'init', '--type', 'web'));
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.web.created.sort(), ['.mcp.json', 'e2e/smoke.spec.ts', 'playwright.config.ts']);
  assert.equal(r.json.web.mcp, 'created');
  assert.equal(r.json.web.e2eScript, 'added');
  assert.deepEqual(r.json.web.missingDeps, ['@playwright/test', '@playwright/mcp']);
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:e2e'], 'playwright test');
  assert.equal(pkg.scripts.dev, 'next dev');
  const mcp = JSON.parse(readFileSync(path.join(root, '.mcp.json'), 'utf8'));
  assert.equal(mcp.mcpServers.playwright.command, 'node');
  assert.match(mcp.mcpServers.playwright.args[0], /node_modules\/@playwright\/mcp\/cli\.js$/);

  // Idempotent: second run creates nothing and keeps the script.
  const again = await withTemplates(fakeTemplates(), () => rbJson(root, 'init'));
  assert.deepEqual(again.json.web.created, []);
  assert.equal(again.json.web.mcp, 'present');
  assert.equal(again.json.web.e2eScript, 'present');
});

test('rb init web overlay: merges into an existing .mcp.json and respects a playwright.config.js', async () => {
  const root = makeRepo({ claudeMd: null, spec: false });
  writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'node', args: ['db.js'] } } }));
  writeFileSync(path.join(root, 'playwright.config.js'), 'module.exports = {};\n');
  const r = await withTemplates(fakeTemplates(), () => rbJson(root, 'init', '--type', 'web,ai'));
  assert.equal(r.json.web.mcp, 'merged');
  assert.ok(r.json.web.skipped.includes('playwright.config.ts'));
  assert.ok(!existsSync(path.join(root, 'playwright.config.ts')));
  assert.equal(r.json.web.e2eScript, 'no-package-json');
  const mcp = JSON.parse(readFileSync(path.join(root, '.mcp.json'), 'utf8'));
  assert.deepEqual(Object.keys(mcp.mcpServers).sort(), ['db', 'playwright']);
});

test('rb init: non-web projects get no Playwright overlay', async () => {
  const root = makeRepo({ claudeMd: null, spec: false });
  const r = await withTemplates(fakeTemplates(), () => rbJson(root, 'init', '--type', 'automation'));
  assert.equal(r.json.web, null);
  assert.ok(!existsSync(path.join(root, '.mcp.json')));
});

test('doctor: web project reports missing Playwright pieces as WARN, then PASS once wired', async () => {
  const root = makeRepo({ claudeMd: null, spec: false });
  writeFileSync(path.join(root, 'CLAUDE.md'), CLAUDE_MD);
  const gh = () => ({ installed: true, authenticated: true, detail: 'ok' });
  const names = (r) => Object.fromEntries(r.checks.map((c) => [c.name, c.status]));
  let r = runDoctor(root, { ghStatusFn: gh });
  assert.equal(names(r)['playwright deps'], 'WARN');
  assert.equal(names(r)['playwright config'], 'WARN');
  assert.equal(names(r)['playwright MCP'], 'WARN');
  assert.equal(names(r)['E2E commands'], 'PASS');
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { '@playwright/test': '1.64.0', '@playwright/mcp': '0.0.83' } }));
  await withTemplates(fakeTemplates(), () => rbJson(root, 'init'));
  mkdirSync(path.join(root, 'node_modules', '@playwright', 'mcp'), { recursive: true });
  writeFileSync(path.join(root, 'node_modules', '@playwright', 'mcp', 'cli.js'), '');
  r = runDoctor(root, { ghStatusFn: gh });
  for (const n of ['playwright deps', 'playwright config', 'playwright MCP']) assert.equal(names(r)[n], 'PASS', n);
  assert.equal(names(r)['playwright MCP install'], undefined);
});

// ---------- baseline ----------

test('rb baseline: records sha, branch, commands and green', async () => {
  const root = makeRepo();
  const sha = sh(root, 'git', ['rev-parse', 'HEAD']);
  const r = await rbJson(root, 'baseline');
  assert.equal(r.code, 0);
  const saved = JSON.parse(readFileSync(path.join(root, '.rockbuilt', 'baseline.json'), 'utf8'));
  assert.equal(saved.sha, sha);
  assert.equal(saved.branch, 'main');
  assert.equal(saved.green, true);
  assert.equal(saved.commands.length, 2);
  assert.equal(saved.commands[0].exitCode, 0);
  assert.equal(typeof saved.commands[0].durationMs, 'number');
  assert.deepEqual(saved.commands[1].summary, ['b', 'c', 'd']);
  assert.ok(!Number.isNaN(Date.parse(saved.date)));
});

test('rb baseline: red run exits 1; --check reuses green and re-runs after HEAD moves', async () => {
  const red = makeRepo({ claudeMd: CLAUDE_MD.replace('process.exit(0)', 'process.exit(3)') });
  const r = await rbJson(red, 'baseline');
  assert.equal(r.code, 1);
  assert.equal(r.json.green, false);
  assert.equal(r.json.commands[0].exitCode, 3);

  const root = makeRepo();
  await rb(root, 'baseline');
  const c1 = await rbJson(root, 'baseline', '--check');
  assert.equal(c1.code, 0);
  assert.equal(c1.json.reran, false);
  writeFileSync(path.join(root, 'x.txt'), 'x');
  sh(root, 'git', ['add', 'x.txt']);
  sh(root, 'git', ['commit', '-q', '-m', 'x']);
  const c2 = await rbJson(root, 'baseline', '--check');
  assert.equal(c2.code, 0);
  assert.equal(c2.json.reran, true);
  assert.equal(c2.json.moved, true);
});

test('rb baseline: refuses a CLAUDE.md that is still the rb init template', async () => {
  const root = makeRepo({ claudeMd: null, spec: false });
  writeFileSync(path.join(root, 'CLAUDE.md'), '# <Project name>\n\nProject type: <web, ai, automation>\n\n## Verification\n```bash\nnpm run typecheck\n```\n');
  const r = await rbJson(root, 'baseline');
  assert.equal(r.code, 1);
  assert.match(JSON.stringify(r.json), /still the rb init template/);
  assert.ok(!existsSync(path.join(root, '.rockbuilt', 'baseline.json')));
});

test('rb baseline: fails without Verification commands or outside a repo', async () => {
  const root = makeRepo({ claudeMd: '# X\n\n## Goal\nx\n' });
  assert.equal((await rb(root, 'baseline')).code, 1);
  assert.equal((await rb(tmp(), 'baseline')).code, 1);
});

// ---------- worktree ----------

test('rb worktree add/list/remove', async () => {
  const root = makeRepo();
  writeFileSync(path.join(root, '.env.local'), 'A=1\n');
  const r = await rbJson(root, 'worktree', 'add', 't2');
  assert.equal(r.code, 0, r.err);
  temps.push(r.json.path);
  assert.equal(r.json.branch, 'rb/T2-login-form');
  assert.equal(path.basename(r.json.path), `${path.basename(root)}-wt-T2`);
  assert.deepEqual(r.json.envCopied, ['.env.local']);
  assert.equal(r.json.portOffset, 20);
  assert.equal(sh(r.json.path, 'git', ['config', 'core.longpaths']), 'true');
  const list = await rbJson(root, 'worktree', 'list');
  assert.deepEqual(list.json.worktrees.map((w) => w.task), ['T2']);
  assert.equal((await rb(root, 'worktree', 'add', 'T2')).code, 1);
  const rm = await rbJson(root, 'worktree', 'remove', 'T2', '--force');
  assert.equal(rm.code, 0, rm.err);
  assert.ok(!existsSync(r.json.path));
  assert.deepEqual((await rbJson(root, 'worktree', 'list')).json.worktrees, []);
  assert.equal((await rb(root, 'worktree', 'remove', 'T2')).code, 1);
  assert.equal((await rb(root, 'worktree', 'bogus')).code, 1);
});

// ---------- gh degradation ----------

// Directory holding git, so a PATH of node + git dirs usually excludes gh.
function gitDir() {
  const out = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' }).stdout || '';
  return path.dirname(out.split(/\r?\n/)[0].trim());
}

test('doctor: gh missing is a FAIL line, not a crash', () => {
  const root = makeRepo();
  const r = runDoctor(root, { ghStatusFn: () => ({ installed: false, authenticated: false, detail: 'gh not found on PATH' }) });
  assert.equal(r.ok, false);
  assert.ok(r.checks.some((c) => c.status === 'FAIL' && c.name === 'gh'));
  assert.ok(r.checks.some((c) => c.name === 'CLAUDE.md sections' && c.status === 'PASS'));
});

test('doctor: gh unauthenticated is a FAIL line; CLAUDE.md problems are reported', () => {
  const root = makeRepo({ claudeMd: '# X\n\nDocs language: <es|en>\n\n## Goal\nx\n' });
  const r = runDoctor(root, { ghStatusFn: () => ({ installed: true, authenticated: false, detail: 'not logged in' }) });
  const byName = Object.fromEntries(r.checks.map((c) => [c.name, c.status]));
  assert.equal(byName['gh auth'], 'FAIL');
  assert.equal(byName['CLAUDE.md sections'], 'FAIL');
  assert.equal(byName['verification commands'], 'FAIL');
  assert.equal(byName['CLAUDE.md header'], 'WARN');
  assert.equal(byName['.gitignore'], 'WARN');
});

test('doctor: authenticated gh without a GitHub remote passes with a WARN', () => {
  const root = makeRepo();
  const r = runDoctor(root, { ghStatusFn: () => ({ installed: true, authenticated: true, detail: 'authenticated' }) });
  assert.equal(r.ok, true);
  assert.ok(r.checks.some((c) => c.name === 'github remote' && c.status === 'WARN'));
});

test('labels and doctor via the real binary degrade when gh is not on PATH', () => {
  const root = makeRepo();
  const env = { ...process.env, PATH: [path.dirname(process.execPath), gitDir()].join(path.delimiter) };
  // Only meaningful when gh does not live next to node or git.
  const ghVisible = spawnSync('gh', ['--version'], { env, encoding: 'utf8' }).status === 0;
  const labels = spawnSync(process.execPath, [RB_BIN, 'labels'], { cwd: root, env, encoding: 'utf8' });
  const doctor = spawnSync(process.execPath, [RB_BIN, 'doctor'], { cwd: root, env, encoding: 'utf8' });
  assert.ok(!/at .*\.mjs:\d+/.test(labels.stderr + doctor.stderr), 'no stack trace');
  if (!ghVisible) {
    assert.equal(labels.status, 1);
    assert.match(labels.stderr, /gh is not installed/);
    assert.equal(doctor.status, 1);
    assert.match(doctor.stdout, /^FAIL\s+gh\s/m);
  }
  assert.match(doctor.stdout, /^PASS\s+node\s/m);
});

// ---------- CLI surface ----------

test('help, unknown command, and --json errors', async () => {
  const root = makeRepo();
  const h = await rb(root, 'help');
  assert.equal(h.code, 0);
  assert.match(h.out, /verify-cmds/);
  assert.equal((await rb(root)).code, 0);
  assert.equal((await rb(root, 'frobnicate')).code, 2);
  const e = await rb(root, 'tasks', 'missing-dir', '--json');
  assert.equal(e.code, 1);
  assert.match(JSON.parse(e.out).error, /tasks\.md not found/);
});

test('bin/rb runs as a process', () => {
  const root = makeRepo();
  const r = spawnSync(process.execPath, [RB_BIN, 'verify-cmds', 'Setup'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'npm install');
});

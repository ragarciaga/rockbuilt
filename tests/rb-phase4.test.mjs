// PLAN-1.0 phase 4 (1.3.0).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { cleanup, repoWith } from './rb-helpers.mjs';

after(cleanup);
const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard.mjs');
const guard = (cwd, command, role) => spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, agent_type: role, cwd }), encoding: 'utf8' }).status;

test('F9: auditor and verifier may run the project program with arguments, never inline code or harness scripts', () => {
  const root = repoWith({ 'src/cli.js': 'console.log(1);\n', 'tools/rockbuilt/rb.mjs': '// vendored\n', 'AGENTS.md': '# App\n' });
  assert.equal(guard(root, 'node src/cli.js sample-expenses.json 2026-10', 'rb-auditor'), 0);
  assert.equal(guard(root, 'node ./src/cli.js --month 2026-10', 'rb-verifier'), 0);
  assert.equal(guard(root, 'node -e "process.exit(0)"', 'rb-auditor'), 2);
  assert.equal(guard(root, 'node tools/rockbuilt/rb.mjs merge-gate 3 --human-approved', 'rb-auditor'), 2);
  assert.equal(guard(root, 'node ../other/x.js', 'rb-auditor'), 2);
  assert.equal(guard(root, 'node src/missing.js', 'rb-auditor'), 2);
  assert.equal(guard(root, 'node src/cli.js > out.txt', 'rb-auditor'), 2, 'still read-only: no redirection');
});

test('F12: doctor warns about CI actions not pinned to a commit SHA', async () => {
  const { rbJson } = await import('./rb-helpers.mjs');
  const wf = (uses) => `name: ci\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ${uses}\n`;
  const root = repoWith({ 'AGENTS.md': '# App\n', '.github/workflows/rockbuilt-ci.yml': wf('actions/checkout@v4'), '.github/workflows/other.yml': wf('./local-action') });
  assert.match(JSON.stringify((await rbJson(root, ['doctor'])).json), /not pinned to a commit SHA: rockbuilt-ci.yml: actions\/checkout@v4/);
  const ok = repoWith({ 'AGENTS.md': '# App\n', '.github/workflows/rockbuilt-ci.yml': wf('actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0') });
  assert.doesNotMatch(JSON.stringify((await rbJson(ok, ['doctor'])).json), /not pinned/);
});

test('F7: rb timing report --write leaves progress.md alone when nothing was timed', async () => {
  const { rbJson } = await import('./rb-helpers.mjs');
  const { existsSync } = await import('node:fs');
  const root = repoWith({ 'AGENTS.md': '# App\n' });
  const r = await rbJson(root, ['timing', 'report', '--write']);
  assert.equal(r.code, 0, r.err);
  assert.equal(existsSync(path.join(root, 'docs', 'progress.md')), false);
});

test('F4: rb tree-check finds a mutant left behind and restores it; probe files are listed, never deleted', async () => {
  const { rbJson, write: w } = await import('./rb-helpers.mjs');
  const { readFileSync, existsSync } = await import('node:fs');
  const root = repoWith({ 'src/a.js': 'export const a = 1;\n', 'docs/progress.md': 'p\n' });
  assert.equal((await rbJson(root, ['tree-check'])).code, 0);
  w(root, 'src/a.js', 'export const a = 2; // mutant\n');
  w(root, 'probe.test.js', 'x\n');
  w(root, 'docs/progress.md', 'p2\n');
  let r = await rbJson(root, ['tree-check']);
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.modified, ['src/a.js']);
  assert.deepEqual(r.json.untracked, ['probe.test.js']);
  r = await rbJson(root, ['tree-check', '--restore']);
  assert.deepEqual(r.json.restored, ['src/a.js']);
  assert.equal(readFileSync(path.join(root, 'src/a.js'), 'utf8'), 'export const a = 1;\n');
  assert.ok(existsSync(path.join(root, 'probe.test.js')), 'never deleted');
  // Review of 1.3.0: tabs in names, renames, staged new files.
  const { sh } = await import('./rb-helpers.mjs');
  const r2 = repoWith({ 'src/tab\tx.js': 'a\n', 'src/old.js': 'o\n' });
  w(r2, 'src/tab\tx.js', 'mutant\n');
  sh(r2, 'git', ['mv', 'src/old.js', 'src/new.js']);
  w(r2, 'src/staged.js', 's\n');
  sh(r2, 'git', ['add', 'src/staged.js']);
  const t = await rbJson(r2, ['tree-check', '--restore']);
  assert.equal(t.code, 3);
  assert.deepEqual(t.json.failed, []);
  assert.equal(readFileSync(path.join(r2, 'src/tab\tx.js'), 'utf8'), 'a\n');
  assert.ok(existsSync(path.join(r2, 'src/old.js')), 'the renamed-away file is back');
  assert.ok(existsSync(path.join(r2, 'src/staged.js')), 'a staged new file is never deleted');
  assert.ok(t.json.added.includes('src/staged.js'));
});

test('F1: reviewers and the planner may Write only their own new report under .rockbuilt/reports/', async () => {
  const { decide } = await import('../hooks/guard.mjs');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const root = repoWith({ 'src/a.js': 'x\n' });
  const d = (tool, input, role) => decide({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, agent_type: role, cwd: root }).deny;
  const w = (file, role, name = 'Write') => d(name, { file_path: path.join(root, file), content: 'r' }, role);
  assert.equal(w('.rockbuilt/reports/T1-verifier-1.md', 'rb-verifier'), false);
  assert.equal(w('.rockbuilt/reports/T1-plan-1.md', 'rb-planner'), false);
  assert.equal(w('.rockbuilt/reports/T1-security-2.md', 'rb-security-reviewer'), false);
  assert.equal(w('.rockbuilt/reports/T1-audit-1.md', 'rb-auditor'), false);
  assert.equal(w('.rockbuilt/reports/T1-audit-1.md', 'rb-verifier'), true, 'never another role\'s report');
  assert.equal(w('.rockbuilt/reports/sub/T1-verifier-1.md', 'rb-verifier'), true, 'no subfolder');
  assert.equal(w('.rockbuilt/reports/T1-audit-1.js', 'rb-auditor'), true, 'markdown only');
  assert.equal(w('src/new.js', 'rb-verifier'), true);
  assert.equal(w('.rockbuilt/reports/../../src/x.md', 'rb-planner'), true);
  assert.equal(w('src/a.js', 'rb-planner', 'Edit'), true, 'the planner never edits code');
  mkdirSync(path.join(root, '.rockbuilt', 'reports'), { recursive: true });
  writeFileSync(path.join(root, '.rockbuilt', 'reports', 'T1-plan-1.md'), 'approved plan');
  assert.equal(w('.rockbuilt/reports/T1-plan-1.md', 'rb-planner'), true, 'never overwrites');
  // Reports are never run, and the auditor never reads the plan or other reports.
  assert.equal(d('Bash', { command: 'node --test .rockbuilt/reports/T1-plan-1.md' }, 'rb-security-reviewer'), true);
  assert.equal(d('Read', { file_path: path.join(root, '.rockbuilt/reports/T1-plan-1.md') }, 'rb-auditor'), true);
  assert.equal(d('Read', { file_path: path.join(root, '.rockbuilt/reports/T1-audit-1.md') }, 'rb-auditor'), false);
  // A project script only: not after a cd out of the project, not with code-loading env vars.
  assert.equal(d('Bash', { command: 'node src/a.js 1' }, 'rb-auditor'), false);
  assert.equal(d('Bash', { command: 'NODE_OPTIONS=--require=./x.js node src/a.js' }, 'rb-auditor'), true);
  assert.equal(d('Bash', { command: 'node ./.rockbuilt/reports/T1-plan-1.md' }, 'rb-auditor'), true);
});

test('F2: rb criteria prints the covered criteria verbatim with their Decisions', async () => {
  const { rbJson } = await import('./rb-helpers.mjs');
  const req = '# R\n\n## R1: Export\n- R1.1 When asked, the system shall write the CSV. `[unit]`\n- R1.2 If the path is missing, then the system shall exit 2. `[integration]`\n\n### Decisions\n- Numbers: one row per category (default)\n\n## R2: Other\n- R2.1 The system shall x. `[unit]`\n';
  const tasks = '# Tasks: x\n\n## T1: Export\n- Purpose: p\n- Covers: R1.1, R1.2, R1.9\n- Size: S\n- Depends on: none\n- Files: src/a.js\n- Verify: `npm test`\n- Status: todo\n';
  const root = repoWith({ 'docs/specs/01-x/requirements.md': req, 'docs/specs/01-x/tasks.md': tasks });
  const r = await rbJson(root, ['criteria', 'docs/specs/01-x', 'T1']);
  assert.equal(r.code, 3, 'R1.9 is missing');
  assert.deepEqual(r.json.criteria, ['- R1.1 When asked, the system shall write the CSV. `[unit]`', '- R1.2 If the path is missing, then the system shall exit 2. `[integration]`']);
  assert.deepEqual(r.json.missing, ['R1.9']);
  assert.deepEqual(r.json.decisions, [{ requirement: 'R1', lines: ['- Numbers: one row per category (default)'] }]);
});

test('F3: rb safety-check wants a test per Safety step and proof it fails without the step', async () => {
  const { rbJson } = await import('./rb-helpers.mjs');
  const plan = '<!-- rockbuilt:plan base=a level=3 approvals=none -->\n## Safety steps\n- Refuse a path outside the root (src/fs.js, safeJoin) | tests/fs.test.js: refuses ../\n- Skip symlinks (src/fs.js, walk) | tests/fs.test.js: skips symlinks\n\n## Risks\nNone\n';
  const root = repoWith({ 'tests/fs.test.js': "test('refuses ../', () => {});\n", 'plan.md': plan,
    'report.md': '## Evidence\n- Safety steps: Refuse a path outside the root | tests/fs.test.js: refuses ../: deleted, failed: yes\n' });
  let r = await rbJson(root, ['safety-check', '--plan', 'plan.md', '--report', 'report.md']);
  assert.equal(r.code, 3);
  assert.ok(r.json.problems.some((p) => /has no case "skips symlinks"/.test(p)));
  assert.ok(r.json.problems.some((p) => /Skip symlinks.*no deletion check/.test(p)));
  assert.ok(!r.json.problems.some((p) => /Refuse a path/.test(p)));
  const none = repoWith({ 'plan.md': '## Safety steps\nNone\n', 'report.md': '' });
  assert.equal((await rbJson(none, ['safety-check', '--plan', 'plan.md', '--report', 'report.md'])).code, 0);
  // Review of 1.3.0: nested evidence, one line for two steps, numbered steps, a "|" in a step.
  const plan2 = '## Safety steps\n1. Refuse a | pipe in names (src/n.js) | tests/n.test.js: refuses pipes\n2. Skip links (src/n.js) | tests/n.test.js: skips links\n';
  const two = repoWith({ 'tests/n.test.js': "test('refuses pipes', () => {});\ntest('skips links', () => {});\n", 'plan.md': plan2,
    'report.md': '- Safety steps:\n  - Refuse a | pipe in names | tests/n.test.js: refuses pipes: deleted, failed: yes\n  - Skip links | tests/n.test.js: skips links: deleted, failed: no; Refuse a | pipe: failed: yes\n' });
  r = await rbJson(two, ['safety-check', '--plan', 'plan.md', '--report', 'report.md']);
  assert.equal(r.json.steps.length, 2, 'numbered steps count');
  assert.deepEqual(r.json.problems.map((p) => p.slice(0, 12)), ['"Skip links ('.slice(0, 12)], JSON.stringify(r.json.problems));
  const missing = repoWith({ 'plan.md': '## Risks\nx\n', 'report.md': '' });
  assert.equal((await rbJson(missing, ['safety-check', '--plan', 'plan.md', '--report', 'report.md'])).code, 3);
});

test('review of 1.3.0: rb criteria reads bold and numbered criteria whole; quoted pinned actions are fine', async () => {
  const { rbJson } = await import('./rb-helpers.mjs');
  const req = '# R\n\n## R1: x\n- **R1.1** When asked, the system shall write\n  the CSV in one pass. `[unit]`\n1. R1.2 The system shall y. `[unit]`\n';
  const tasks = '# Tasks: x\n\n## T1: x\n- Purpose: p\n- Covers: R1.1, R1.2\n- Size: S\n- Depends on: none\n- Files: src/a.js\n- Verify: `npm test`\n- Status: todo\n';
  const root = repoWith({ 'docs/specs/01-x/requirements.md': req, 'docs/specs/01-x/tasks.md': tasks });
  const r = await rbJson(root, ['criteria', 'docs/specs/01-x', 'T1']);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.equal(r.json.criteria[0], '- **R1.1** When asked, the system shall write the CSV in one pass. `[unit]`');
  const wf = `name: ci\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262' # v4.4.0\n`;
  const ok = repoWith({ 'AGENTS.md': '# App\n', '.github/workflows/rockbuilt-ci.yml': wf });
  assert.doesNotMatch(JSON.stringify((await rbJson(ok, ['doctor'])).json), /not pinned/);
});

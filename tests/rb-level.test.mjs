// PLAN-1.0 A1 (#75): rb risk returns the review level (1 batch, 2 normal, 3 sensitive) and the
// owner-approval reasons from the closed list, computed from the same findings as the tier.
// Evidence: evals/results/2026-11-24-replay-levels.md.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { APPROVAL_REASONS, classify, riskText } from '../scripts/lib/risk.mjs';
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

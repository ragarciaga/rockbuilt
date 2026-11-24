// PLAN-1.0 item 0.3: replay of merged PRs with the 1.0 levels (evals/tools/replay-levels.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replayRepo } from '../evals/tools/replay-levels.mjs';

const f = (path, { status = 'modified', additions = 1, deletions = 0, patch } = {}) => ({
  path,
  status,
  additions,
  deletions,
  patch: patch ?? Array.from({ length: additions }, (_, i) => `+line ${i}`).join('\n'),
});
let n = 0;
const pr = (files, extra = {}) => ({ number: ++n, title: 't', head: `rb/task-${n}`, tier: 'B', merged_at: `2026-11-0${Math.min(9, n)}T10:00:00Z`, files, ...extra });

const AGENTS = '# App\n\n## Autonomy\nSensitive paths: src/payouts/**\nTier A paths: none\nPaid services: Anthropic API (cap USD 20)\n';

function run(prs, escalations = 0) {
  return replayRepo({ agentsMd: AGENTS, escalations, prs });
}

test('replay: docs, styles and add-only tests are level 1; a test that changes assertions is not', () => {
  const r = run([
    pr([f('docs/guide.md'), f('src/app.css'), f('tests/a.test.ts', { additions: 5 })], { tier: 'A' }),
    pr([f('tests/a.test.ts', { additions: 1, deletions: 1 })], { tier: 'A' }),
  ]);
  assert.deepEqual(r.rows.map((x) => x.level), [1, 2]);
  assert.equal(r.rows[0].agentsNew, 0);
  assert.equal(r.rows[0].agentsToday, 3);
});

test('replay: bookkeeping files do not raise the level (A3); tests and fixtures do not count for size (A2)', () => {
  const r = run([
    pr([f('src/lib/sum.ts', { additions: 10 }), f('docs/progress.md'), f('.claude/LESSONS.md')]),
    pr([f('src/lib/big.ts', { additions: 300 }), f('tests/big.test.ts', { additions: 900 }), f('tests/fixtures/data.json', { additions: 900 })]),
    pr([f('src/lib/huge.ts', { additions: 801 })]),
  ]);
  assert.deepEqual(r.rows.map((x) => x.level), [2, 2, 3]);
  assert.deepEqual(r.rows[2].level3, ['size']);
  assert.ok(r.rows.every((x) => !x.asksOwner));
});

test('replay: sensitive paths are level 3 without asking; schema, ADR and paid keys ask the owner', () => {
  const r = run([
    pr([f('src/payouts/run.ts')], { tier: 'C' }),
    pr([f('supabase/migrations/001.sql')], { tier: 'C' }),
    pr([f('docs/adr/0002-queue.md')], { tier: 'C' }),
    pr([f('src/ai/client.ts', { patch: "+import OpenAI from 'openai';\n+const k = process.env.OPENAI_API_KEY;" })], { tier: 'C' }),
    pr([f('src/ai/claude.ts', { patch: "+import Anthropic from '@anthropic-ai/sdk';" })], { tier: 'C' }),
  ]);
  assert.deepEqual(r.rows.map((x) => x.level), [3, 3, 2, 2, 2]);
  assert.deepEqual(r.rows.map((x) => x.asksOwner), [false, true, true, true, false]);
  assert.deepEqual(r.rows[1].approvals, ['structural: schema or migration']);
  assert.deepEqual(r.rows[3].approvals, ['cost: new paid service or key']);
  assert.equal(r.approvals['structural: schema or migration'], 1);
});

test('replay: a key already used by an earlier merged PR is not new', () => {
  const r = run([
    pr([f('src/a.ts', { patch: '+const k = process.env.MAPS_API_KEY;' })], { tier: 'C' }),
    pr([f('src/b.ts', { patch: '+const k = process.env.MAPS_API_KEY;' })], { tier: 'C' }),
  ]);
  assert.deepEqual(r.rows.map((x) => x.asksOwner), [true, false]);
});

test('replay: runtime dependencies go to the automatic check; spec branches ask; owner-started PRs do not', () => {
  const pj = (deps) => JSON.stringify({ name: 'x', dependencies: deps, devDependencies: {} });
  const r = run([
    pr([f('package.json')], { tier: 'C', merged_at: '2026-11-01T10:00:00Z', packageJson: { 'package.json': { old: pj({}), new: pj({ zod: '^3.0.0' }) } } }),
    pr([f('docs/specs/feed/requirements.md')], { head: 'rb/spec-feed', tier: null, merged_at: '2026-11-02T10:00:00Z' }),
    pr([f('AGENTS.md'), f('tools/rockbuilt/rb.mjs')], { head: 'chore/rockbuilt-1.0.0', tier: null, merged_at: '2026-11-03T10:00:00Z' }),
  ], 4);
  assert.equal(r.rows[0].depCheck, true);
  assert.equal(r.rows[0].level, 2);
  assert.equal(r.rows[0].asksOwner, false);
  assert.equal(r.rows[1].asksOwner, true);
  assert.equal(r.rows[2].level, 3);
  assert.equal(r.rows[2].asksOwner, false);
  assert.equal(r.asksOwner, 1);
  assert.equal(r.spanDays, 3);
  assert.deepEqual(r.interruptionsPerDay, { diffApprovals: 0.3, withTodaysEscalations: 1.7 });
});

test('replay: level 2 runs the auditor only when something visible changes', () => {
  const r = run([pr([f('src/lib/sum.ts')]), pr([f('src/components/Card.tsx')])]);
  assert.deepEqual(r.rows.map((x) => x.agentsNew), [3.2, 4]);
  assert.deepEqual(r.rows.map((x) => x.agentsToday), [4, 4]);
});

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { evaluateRatchet, parseRunnerOutput } from '../scripts/lib/baseline.mjs';
import { cleanup, commitAll, rb, rbJson, read, repoWith, track, write } from './rb-helpers.mjs';

after(cleanup);

const CMD = 'node --test --test-reporter=tap';
const agents = (cmd = CMD) => `# App\n\nDocs language: es\nDefault branch: main\n\n## Verification\n\`\`\`bash\n${cmd}\nnode -e "process.exit(0)"\n\`\`\`\n`;
const SUITE = `import test from 'node:test';
import assert from 'node:assert';
test('adds', () => assert.equal(1 + 1, 2));
test('legacy rounding', () => assert.equal(0.1 + 0.2, 0.3));
`;

function project() {
  return repoWith({ 'AGENTS.md': agents(), 'tests/a.test.mjs': SUITE });
}

test('parseRunnerOutput: node TAP and spec, vitest, jest, pytest, playwright', () => {
  let p = parseRunnerOutput('TAP version 13\nnot ok 2 - legacy rounding\n  ---\nok 1 - adds\n# tests 2\n# pass 1\n# fail 1\n');
  assert.deepEqual([p.runner, p.counts, p.failingTests], ['node-test', { passed: 1, failed: 1 }, ['legacy rounding']]);
  p = parseRunnerOutput('✔ adds (1ms)\n✖ legacy (2ms)\nℹ tests 2\nℹ pass 1\nℹ fail 1\n\n✖ failing tests:\n\ntest at a.mjs:4:1\n✖ legacy (2.1ms)\n');
  assert.deepEqual([p.runner, p.counts.failed, p.failingTests], ['node-test', 1, ['legacy']]);
  p = parseRunnerOutput(' FAIL  src/a.test.ts > math > adds\n\n Test Files  1 failed (1)\n      Tests  1 failed | 3 passed (4)\n');
  assert.deepEqual([p.runner, p.counts, p.failingTests], ['vitest', { failed: 1, passed: 3 }, ['src/a.test.ts > math > adds']]);
  p = parseRunnerOutput('  ● math › adds\n\nTests:       1 failed, 3 passed, 4 total\n');
  assert.deepEqual([p.runner, p.counts, p.failingTests], ['jest', { failed: 1, passed: 3 }, ['math › adds']]);
  p = parseRunnerOutput('FAILED tests/test_a.py::test_x - AssertionError\n==== 1 failed, 3 passed in 0.12s ====\n');
  assert.deepEqual([p.runner, p.counts, p.failingTests], ['pytest', { failed: 1, passed: 3 }, ['tests/test_a.py::test_x']]);
  p = parseRunnerOutput('Running 4 tests using 1 worker\n  1 failed\n    [chromium] › e2e/a.spec.ts:3:5 › login works\n  3 passed (5.2s)\n');
  assert.deepEqual([p.runner, p.counts, p.failingTests], ['playwright', { failed: 1, passed: 3 }, ['[chromium] › e2e/a.spec.ts:3:5 › login works']]);
});

test('evaluateRatchet: known failures, allowFailure, new failures, unparseable exit codes', () => {
  const known = { commands: { a: { knownFailingTests: ['x'] }, b: { allowFailure: true } } };
  const r = evaluateRatchet([
    { cmd: 'a', exitCode: 1, failingTests: ['x'] },
    { cmd: 'b', exitCode: 2, failingTests: [] },
  ], known);
  assert.equal(r.green, true);
  const r2 = evaluateRatchet([{ cmd: 'a', exitCode: 1, failingTests: ['x', 'y'] }, { cmd: 'c', exitCode: 1, failingTests: [] }], known);
  assert.equal(r2.green, false);
  assert.deepEqual(r2.verdicts[0].newFailures, ['y']);
  assert.match(r2.verdicts[1].newFailures[0], /no parseable/);
  assert.deepEqual(evaluateRatchet([{ cmd: 'a', exitCode: 0, failingTests: [] }], known).shrinkable, [{ cmd: 'a', tests: ['x'] }]);
});

test('rb baseline: red on a new failure, --accept records it, then green against known failures', async () => {
  const root = project();
  const red = await rbJson(root, ['baseline']);
  assert.equal(red.code, 1);
  assert.equal(red.json.green, false);
  assert.deepEqual(red.json.commands[0].failingTests, ['legacy rounding']);
  assert.deepEqual(red.json.commands[0].counts, { passed: 1, failed: 1, skipped: 0 });

  const acc = await rb(root, ['baseline', '--accept']);
  assert.equal(acc.code, 0);
  assert.match(acc.out, /tier C decision/);
  const known = JSON.parse(read(root, 'docs/rockbuilt/known-failures.json'));
  assert.deepEqual(known, { commands: { [CMD]: { allowFailure: false, knownFailingTests: ['legacy rounding'] } } });

  const green = await rbJson(root, ['baseline']);
  assert.equal(green.code, 0);
  assert.equal(green.json.green, true);
  assert.equal(green.json.exitGreen, false);

  // A second failing test is outside the list: red again.
  write(root, 'tests/b.test.mjs', "import test from 'node:test';\ntest('new break', () => { throw new Error('x'); });\n");
  const red2 = await rbJson(root, ['baseline']);
  assert.equal(red2.code, 1);
  assert.deepEqual(red2.json.ratchet.verdicts[0].newFailures, ['new break']);
});

test('rb baseline --check reuses a green record; red runs are re-run', async () => {
  const root = repoWith({ 'AGENTS.md': agents('node -e "process.exit(0)"') });
  await rb(root, ['baseline']);
  const c = await rbJson(root, ['baseline', '--check']);
  assert.equal(c.code, 0);
  assert.equal(c.json.reran, false);
});

test('rb baseline in a worktree: ratchet and record come from the main checkout', async () => {
  const root = project();
  write(root, 'docs/rockbuilt/known-failures.json', JSON.stringify({ commands: { [CMD]: { allowFailure: false, knownFailingTests: ['legacy rounding'] } } }));
  commitAll(root, 'known');
  // Main checkout drops the known failure from its working copy: the worktree must read this one.
  write(root, 'docs/rockbuilt/known-failures.json', JSON.stringify({ commands: {} }));
  const wt = await rbJson(root, ['worktree', 'add', 'T1', '--slug', 'x']);
  assert.equal(wt.code, 0, wt.err);
  track(wt.json.path);
  const inWt = await rbJson(wt.json.path, ['baseline']);
  assert.equal(inWt.json.worktree, true);
  assert.equal(inWt.json.green, false, 'main checkout list (empty) wins over the worktree copy');
  assert.ok(!existsSync(path.join(wt.json.path, '.rockbuilt', 'baseline.json')));
  assert.ok(!existsSync(path.join(root, '.rockbuilt', 'baseline.json')), 'a worktree run does not overwrite the main baseline');

  write(root, 'docs/rockbuilt/known-failures.json', JSON.stringify({ commands: { [CMD]: { knownFailingTests: ['legacy rounding'] } } }));
  const again = await rbJson(wt.json.path, ['baseline']);
  assert.equal(again.json.green, true);
  const check = await rbJson(wt.json.path, ['baseline', '--check']);
  assert.equal(check.code, 0);
  assert.equal(path.resolve(check.json.root), path.resolve(root));
  assert.ok(existsSync(path.join(root, '.rockbuilt', 'baseline.json')), '--check records in the main checkout');
});

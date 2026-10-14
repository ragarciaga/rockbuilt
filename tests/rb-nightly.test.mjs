// Fixes from the 3d_brain nights of 2026-10-14: E2E shards, review-delta, rb gh flags and labels.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { e2ePlan, shardCommands } from '../scripts/lib/e2e.mjs';
import { prLabels } from '../scripts/lib/gh.mjs';
import { REPO, cleanup, commitAll, fakeGh, rb, rbJson, repoWith, sh, write } from './rb-helpers.mjs';

after(cleanup);

const agents = (header, e2e) => `# App\n\nDocs language: es\nProject type: web\n${header}\n## Verification\n\`\`\`bash\nnpm test\n\`\`\`\n${e2e === null ? '' : `\n## E2E\n\`\`\`bash\n${e2e}\n\`\`\`\n`}`;

test('shardCommands: Playwright commands get --shard, setup lines run on every shard', () => {
  assert.deepEqual(shardCommands(['npm run build', 'npm run test:e2e'], 2, 3), ['npm run build', 'npm run test:e2e -- --shard=2/3']);
  assert.deepEqual(shardCommands(['npx playwright test --project=chromium'], 1, 2), ['npx playwright test --project=chromium --shard=1/2']);
  assert.deepEqual(shardCommands(['npm run e2e -- --reporter=line'], 1, 2), ['npm run e2e -- --reporter=line --shard=1/2']);
  assert.deepEqual(shardCommands(['pnpm test:e2e'], 3, 3), ['pnpm test:e2e --shard=3/3']);
  assert.deepEqual(shardCommands(['npm run test:e2e'], 1, 1), ['npm run test:e2e'], 'one shard: unchanged');
  assert.throws(() => shardCommands(['npm run build'], 1, 2), /no line under ## E2E runs the suite/);
  assert.throws(() => shardCommands(['./scripts/e2e.sh'], 1, 2), /no line under ## E2E runs the suite/);
  assert.deepEqual(shardCommands(['npm run e2e:seed', 'npm run build:e2e', 'CI=1 npx playwright test'], 1, 2), ['npm run e2e:seed', 'npm run build:e2e', 'CI=1 npx playwright test --shard=1/2'], 'only the suite command');
  assert.deepEqual(shardCommands(['npx playwright install --with-deps chromium', 'pnpm exec playwright test'], 2, 2), ['npx playwright install --with-deps chromium', 'pnpm exec playwright test --shard=2/2']);
  assert.throws(() => shardCommands(['npm run test:e2e && npm run report'], 1, 2), /own line/);
});

test('e2e-plan: header E2E shards, default 1, no section means nothing to run, bad values fail', async () => {
  assert.deepEqual(e2ePlan(agents('', 'npm run test:e2e')), { has: true, total: 1, shards: [1] });
  assert.deepEqual(e2ePlan(agents('E2E shards: 3', 'npm run test:e2e')), { has: true, total: 3, shards: [1, 2, 3] });
  assert.deepEqual(e2ePlan(agents('E2E shards: 3', null)), { has: false, total: 1, shards: [1] });
  assert.throws(() => e2ePlan(agents('E2E shards: 12', 'npm run test:e2e')), /1 to 8/);
  assert.throws(() => e2ePlan(agents('E2E shards: 2', './run.sh e2e')), /no line under ## E2E runs the suite/);
  const root = repoWith({ 'AGENTS.md': agents('E2E shards: 2', 'npm run build\nnpm run test:e2e') });
  const plan = await rb(root, ['e2e-plan']);
  assert.equal(plan.out, 'has=true\ntotal=2\nshards=[1,2]');
  const cmds = await rb(root, ['verify-cmds', 'E2E', '--shard', '2/2']);
  assert.equal(cmds.out, 'npm run build\nnpm run test:e2e -- --shard=2/2');
  assert.equal((await rb(root, ['verify-cmds', 'Verification', '--shard', '1/2'])).code, 2);
  assert.equal((await rb(root, ['verify-cmds', 'E2E', '--shard', '3/2'])).code, 2);
});

test('review-delta: identical after a clean base merge, different when the merge touched the task files', async () => {
  const lines = (over) => ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'].map((l, i) => over[i] ?? l).join('\n') + '\n';
  const root = repoWith({ 'src/a.js': lines({}), 'src/b.js': 'export const b = 1;\n' });
  sh(root, 'git', ['checkout', '-q', '-b', 'rb/T1-x']);
  write(root, 'src/a.js', lines({ 4: 'task' }));
  const reviewed = commitAll(root, 'task');
  sh(root, 'git', ['checkout', '-q', 'main']);
  write(root, 'src/b.js', 'export const b = 2;\n');
  commitAll(root, 'main moves');
  sh(root, 'git', ['checkout', '-q', 'rb/T1-x']);
  sh(root, 'git', ['merge', '-q', '--no-edit', 'main']);
  let r = await rbJson(root, ['review-delta', '--reviewed', reviewed, '--base', 'main']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.identical, true);

  // Main changes a line next to the task's change: the patch context differs, full review.
  sh(root, 'git', ['checkout', '-q', 'main']);
  write(root, 'src/a.js', lines({ 2: 'main' }));
  commitAll(root, 'main touches a.js near the task line');
  sh(root, 'git', ['checkout', '-q', 'rb/T1-x']);
  sh(root, 'git', ['merge', '-q', '--no-edit', 'main']);
  r = await rbJson(root, ['review-delta', '--reviewed', reviewed, '--base', 'main']);
  assert.equal(r.code, 3);
  assert.match(r.json.detail, /src\/a\.js/);

  // A head that does not contain the base is not identical by definition.
  sh(root, 'git', ['checkout', '-q', reviewed]);
  r = await rbJson(root, ['review-delta', '--reviewed', reviewed, '--base', 'main']);
  assert.equal(r.code, 3);
  assert.match(r.json.detail, /does not contain/);
});

test('rb gh: issue-edit --add-label works, unknown flags fail loudly, pr-create labels the tier from the body', async () => {
  const root = repoWith({ 'README.md': '# x\n' });
  sh(root, 'git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
  const gh = fakeGh();
  gh.state.issues[4] = { number: 4, title: 'PR', body: 'x', state: 'open', labels: ['rb:pr-open'], isPr: true };
  gh.state.nextNumber = 5;
  let r = await rbJson(root, ['gh', 'issue-edit', '4', '--add-label', 'rb:tier-c', '--remove-label', 'rb:pr-open'], { ghRunner: gh.runner });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(gh.state.issues[4].labels, ['rb:tier-c']);
  r = await rb(root, ['gh', 'issue-edit', '4', '--labels', 'rb:tier-b'], { ghRunner: gh.runner });
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown flag --labels/);

  write(root, 'body.md', 'Closes #3\n<!-- rockbuilt:tier B -->\n');
  r = await rbJson(root, ['gh', 'pr-create', '--head', 'rb/T1-x', '--base', 'main', '--title', 't', '--body-file', 'body.md'], { ghRunner: gh.runner });
  assert.equal(r.code, 0, r.err);
  assert.ok(gh.state.issues[r.json.number].labels.includes('rb:tier-b'));
  assert.deepEqual(prLabels('<!-- rockbuilt:tier C -->', ['rb:hold']), ['rb:hold', 'rb:tier-c']);
  assert.deepEqual(prLabels('no marker', ['rb:hold']), ['rb:hold']);
  assert.throws(() => prLabels('<!-- rockbuilt:tier C -->', ['rb:tier-b']), /declares tier C/);
});

test('review-delta: a binary file changed after review is not identical', async () => {
  const root = repoWith({ 'src/a.js': 'export const a = 1;\n' });
  sh(root, 'git', ['checkout', '-q', '-b', 'rb/T2-bin']);
  write(root, 'fixtures/x.bin', Buffer.from([0, 1, 2, 3, 0, 255]).toString('latin1'));
  const reviewed = commitAll(root, 'task adds a binary fixture');
  sh(root, 'git', ['checkout', '-q', 'main']);
  write(root, 'src/b.js', 'export const b = 1;\n');
  commitAll(root, 'main moves');
  sh(root, 'git', ['checkout', '-q', 'rb/T2-bin']);
  sh(root, 'git', ['merge', '-q', '--no-edit', 'main']);
  assert.equal((await rbJson(root, ['review-delta', '--reviewed', reviewed, '--base', 'main'])).json.identical, true);
  write(root, 'fixtures/x.bin', Buffer.from([0, 9, 9, 9, 0, 255]).toString('latin1'));
  commitAll(root, 'binary changes after review');
  const r = await rbJson(root, ['review-delta', '--reviewed', reviewed, '--base', 'main']);
  assert.equal(r.code, 3);
  assert.match(r.json.detail, /x\.bin/);
});

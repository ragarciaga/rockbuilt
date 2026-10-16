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

test('review-delta --line: the verifier identity line comes from rb when only base merges followed', async () => {
  const root = repoWith({ 'src/a.js': 'a\n', 'src/b.js': 'b\n' });
  sh(root, 'git', ['checkout', '-q', '-b', 'rb/T1-x']);
  write(root, 'src/a.js', 'task\n');
  const reviewed = commitAll(root, 'task');
  sh(root, 'git', ['checkout', '-q', 'main']);
  write(root, 'src/b.js', 'b2\n');
  commitAll(root, 'main moves');
  sh(root, 'git', ['checkout', '-q', 'rb/T1-x']);
  sh(root, 'git', ['merge', '-q', '--no-edit', 'main']);
  const head = sh(root, 'git', ['rev-parse', 'HEAD']);
  let r = await rb(root, ['review-delta', '--reviewed', reviewed, '--base', 'main', '--line', '--task', 'T1']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.out, `<!-- rockbuilt:status stage=rb-verifier task=T1 outcome=pass head=${head} identical-to=${reviewed} by=rb-review-delta -->`);
  // A non-merge commit after the review, even an empty one, needs a real review.
  sh(root, 'git', ['commit', '-q', '--allow-empty', '-m', 'sneaky']);
  r = await rbJson(root, ['review-delta', '--reviewed', reviewed, '--base', 'main', '--line']);
  assert.equal(r.code, 3);
  assert.match(r.json.detail, /not a merge/);
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

test('review-delta by content: a stacked base task squash-merged into main is still identical', async () => {
  const root = repoWith({ 'src/a.js': 'a0\n', 'src/b.js': 'b0\n' });
  // T7 (the base task) on its own branch; T8 stacked on top of it.
  sh(root, 'git', ['checkout', '-q', '-b', 'rb/T7-base']);
  write(root, 'src/a.js', 'a7\n');
  commitAll(root, 'T7');
  sh(root, 'git', ['checkout', '-q', '-b', 'rb/T8-top']);
  write(root, 'src/b.js', 'b8\n');
  const reviewed = commitAll(root, 'T8');
  // T7 is squash-merged into main; T8 is then updated with main.
  sh(root, 'git', ['checkout', '-q', 'main']);
  write(root, 'src/a.js', 'a7\n');
  commitAll(root, 'T7 squashed (#134)');
  sh(root, 'git', ['checkout', '-q', 'rb/T8-top']);
  sh(root, 'git', ['merge', '-q', '--no-edit', 'main']);
  const r = await rbJson(root, ['review-delta', '--reviewed', reviewed, '--base', 'main']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.json.class, 'identical');
});

test('review-delta: a kickback that changes only test files is test-only', async () => {
  const root = repoWith({ 'src/a.js': 'a0\n', 'e2e/a.spec.ts': 'test 0\n' });
  sh(root, 'git', ['checkout', '-q', '-b', 'rb/T10-x']);
  write(root, 'src/a.js', 'a1\n');
  write(root, 'e2e/a.spec.ts', 'test 1\n');
  const reviewed = commitAll(root, 'task');
  write(root, 'e2e/a.spec.ts', 'test 2\n');
  commitAll(root, 'kickback: fix the e2e spec');
  let r = await rbJson(root, ['review-delta', '--reviewed', reviewed, '--base', 'main']);
  assert.equal(r.code, 0);
  assert.equal(r.json.class, 'test-only');
  assert.deepEqual(r.json.differing, ['e2e/a.spec.ts']);
  write(root, 'src/a.js', 'a2\n');
  commitAll(root, 'and an app change');
  r = await rbJson(root, ['review-delta', '--reviewed', reviewed, '--base', 'main']);
  assert.equal(r.code, 3);
  assert.equal(r.json.class, 'different');
});

test('verify-cmds E2E --only/--grep runs only the touched specs locally', async () => {
  const { onlyCommands } = await import('../scripts/lib/e2e.mjs');
  assert.deepEqual(onlyCommands(['npm run build', 'npm run test:e2e'], ['e2e/revision-canal.spec.ts'], 'R3.1 marks as saved'), ['npm run build', 'npm run test:e2e -- e2e/revision-canal.spec.ts -g "R3.1 marks as saved"']);
  assert.deepEqual(onlyCommands(['npx playwright test'], [], 'T10'), ['npx playwright test -g T10']);
  const root = repoWith({ 'AGENTS.md': agents('', 'npm run test:e2e') });
  const r = await rb(root, ['verify-cmds', 'E2E', '--only', 'e2e/a.spec.ts,e2e/b.spec.ts']);
  assert.equal(r.out, 'npm run test:e2e -- e2e/a.spec.ts e2e/b.spec.ts');
  assert.equal((await rb(root, ['verify-cmds', 'E2E', '--only', 'e2e/a.spec.ts', '--shard', '1/2'])).code, 2);
  assert.equal((await rb(root, ['verify-cmds', 'Verification', '--grep', 'x'])).code, 2);
});

test('timing: kickback alias, and line --pr adds CI and re-review minutes to the published line once', async () => {
  const root = repoWith({ 'README.md': '# x\n' });
  sh(root, 'git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
  const { appendEvent } = await import('../scripts/lib/timing.mjs');
  appendEvent(root, 'start', 'T3', 'plan', new Date('2026-10-14T01:00:00Z'));
  appendEvent(root, 'end', 'T3', 'plan', new Date('2026-10-14T01:02:00Z'));
  appendEvent(root, 'start', 'T3', 'kickback', new Date('2026-10-14T01:10:00Z'));
  appendEvent(root, 'end', 'T3', 'kickback', new Date('2026-10-14T01:13:00Z'));
  let r = await rb(root, ['timing', 'line', 'T3', '--est', '4']);
  assert.equal(r.out, '<!-- rockbuilt:timing task=T3 plan=2.0 fix=3.0 est=4 -->');
  // Later the merge train waits on CI and re-verifies; the PR body holds the first line.
  appendEvent(root, 'start', 'T3', 'ci', new Date('2026-10-14T02:00:00Z'));
  appendEvent(root, 'end', 'T3', 'ci', new Date('2026-10-14T02:12:00Z'));
  appendEvent(root, 'start', 'T3', 'verify', new Date('2026-10-14T02:20:00Z'));
  appendEvent(root, 'end', 'T3', 'verify', new Date('2026-10-14T02:24:00Z'));
  const gh = fakeGh();
  gh.state.issues[9] = { number: 9, title: 'T3', body: `x\n${r.out}\n`, state: 'open', labels: [], isPr: true };
  gh.state.pulls[9] = { number: 9, head: 'rb/T3-x', base: 'main', headSha: 'f'.repeat(40) };
  r = await rb(root, ['timing', 'line', 'T3', '--pr', '9'], { ghRunner: gh.runner });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, '<!-- rockbuilt:timing task=T3 plan=2.0 verify=4.0 fix=3.0 ci=12.0 est=4 -->');
});

test('flaky: record candidates on the control issue and list them by count', async () => {
  const root = repoWith({ 'README.md': '# x\n' });
  sh(root, 'git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
  const gh = fakeGh();
  const io = { ghRunner: gh.runner };
  assert.equal((await rb(root, ['flaky', 'record', 'e2e/atlas.spec.ts:1256', '--pr', '134'], io)).code, 0);
  await rb(root, ['flaky', 'record', 'e2e/atlas.spec.ts:1256', '--pr', '140'], io);
  await rb(root, ['flaky', 'record', 'e2e/other.spec.ts:10'], io);
  const r = await rbJson(root, ['flaky', 'list'], io);
  assert.equal(r.json.flaky[0].test, 'e2e/atlas.spec.ts:1256');
  assert.equal(r.json.flaky[0].count, 2);
  assert.deepEqual(r.json.flaky[0].prs, [134, 140]);
  assert.equal(r.json.flaky.length, 2);
});

test('timing report: a PR merged in a later run keeps its earlier minutes and adds the new ones once', async () => {
  const { appendEvent } = await import('../scripts/lib/timing.mjs');
  const root = repoWith({ 'README.md': '# x\n' });
  sh(root, 'git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
  const gh = fakeGh();
  // Run 1 (another container) published plan and implement in the PR body.
  gh.state.issues[9] = { number: 9, title: 'T3', body: 'x\n<!-- rockbuilt:timing task=T3 plan=10.0 implement=20.0 -->\n', state: 'open', labels: [], isPr: true };
  gh.state.pulls[9] = { number: 9, head: 'rb/T3-x', base: 'main', headSha: 'f'.repeat(40) };
  // Run 2 (fresh clone): a CI wait, a phase still open when the line is printed, then report.
  appendEvent(root, 'start', 'T3', 'ci', new Date('2026-10-15T02:00:00Z'));
  appendEvent(root, 'end', 'T3', 'ci', new Date('2026-10-15T02:08:00Z'));
  appendEvent(root, 'start', 'T3', 'merge', new Date('2026-10-15T02:09:00Z'));
  const line = await rb(root, ['timing', 'line', 'T3', '--pr', '9'], { ghRunner: gh.runner });
  assert.equal(line.out, '<!-- rockbuilt:timing task=T3 plan=10.0 implement=20.0 ci=8.0 -->');
  appendEvent(root, 'end', 'T3', 'merge', new Date('2026-10-15T02:10:00Z'));
  gh.state.issues[9].body = `x\n${line.out}\n`;
  const r = await rbJson(root, ['timing', 'report'], { ghRunner: gh.runner });
  const t3 = r.json.tasks.find((t) => t.task === 'T3');
  assert.deepEqual(Object.fromEntries(Object.entries(t3.phases).map(([k, v]) => [k, v / 60000])), { plan: 10, implement: 20, ci: 8, merge: 1 });
  // Printing the line again with --pr adds only the merge minute, once.
  const again = await rb(root, ['timing', 'line', 'T3', '--pr', '9'], { ghRunner: gh.runner });
  assert.equal(again.out, '<!-- rockbuilt:timing task=T3 plan=10.0 implement=20.0 ci=8.0 merge=1.0 -->');
});

test('test paths: names inside file-routed directories are app; --only refuses unsafe input', async () => {
  const { isTestPath, classify } = await import('../scripts/lib/delta.mjs');
  assert.equal(isTestPath('e2e/atlas.spec.ts'), true);
  assert.equal(isTestPath('src/lib/a.test.ts'), true);
  assert.equal(isTestPath('pages/api/admin.test.ts'), false, 'Next.js pages router publishes it');
  assert.equal(isTestPath('server/api/x.test.ts'), false);
  assert.equal(classify(['pages/api/admin.test.ts']), 'different');
  const { onlyCommands } = await import('../scripts/lib/e2e.mjs');
  assert.throws(() => onlyCommands(['npx playwright test'], [], 'x\nrm -rf /tmp/zz #'), /single line/);
  assert.throws(() => onlyCommands(['npx playwright test'], ['--config=evil.mjs'], null), /not options/);
  assert.throws(() => onlyCommands(['npx playwright test e2e/'], ['e2e/a.spec.ts'], null), /already selects files/);
});

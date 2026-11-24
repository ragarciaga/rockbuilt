// PLAN-1.0 C1 and A6: rb state splits what waits for the owner from what the harness does alone;
// rb delegate records the owner's words on the control issue.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { REPO, cleanup, fakeGh, rbJson, repoWith, rb, sh } from './rb-helpers.mjs';

after(cleanup);

function project() {
  const root = repoWith({ 'AGENTS.md': '# App\n\nDefault branch: main\n' });
  sh(root, 'git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
  return root;
}

test('rb state: owner half and harness half; delegations in force', async () => {
  const root = project();
  const gh = fakeGh();
  const io = { ghRunner: gh.runner };
  const s = gh.state;
  s.issues[3] = { number: 3, title: 'T1 schema', body: '', state: 'open', labels: ['rb:task', 'rb:approval-pending'] };
  s.issues[4] = { number: 4, title: 'T2 copy', body: '', state: 'open', labels: ['rb:task'] };
  s.issues[5] = { number: 5, title: 'Which provider?', body: '', state: 'open', labels: ['rb:task', 'rb:needs-human'] };
  s.issues[6] = { number: 6, title: 'T3 api', body: '', state: 'open', labels: ['rb:task', 'rb:in-progress'] };
  const until = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const d = await rbJson(root, ['delegate', '--words', 'delego la 3 hasta el viernes', '--scope', 'issues:3', '--until', until], io);
  assert.equal(d.code, 0, d.err);
  const r = await rbJson(root, ['state'], io);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.complete, true);
  assert.deepEqual(r.json.waitingOnOwner.approvals.map((x) => x.number), [3]);
  assert.deepEqual(r.json.waitingOnOwner.questions.map((x) => x.number), [5]);
  assert.deepEqual(r.json.harnessWillDo.ready.map((x) => x.number), [4]);
  assert.deepEqual(r.json.harnessWillDo.inProgress.map((x) => x.number), [6]);
  assert.equal(r.json.delegations[0].scope, 'issues:3');
  assert.match(r.json.delegations[0].words, /delego la 3/);
  const t = await rb(root, ['state'], io);
  assert.match(t.out, /Waiting for the owner \(2\)/);
  assert.match(t.out, new RegExp(`Delegation in force: issues:3 until ${until}`));
  assert.equal((await rbJson(root, ['delegate', '--words', 'x', '--until', '2099-01-01'], io)).code, 2, 'more than 90 days away');
  assert.equal((await rbJson(root, ['delegate', '--words', 'x', '--until', '2020-01-01'], io)).code, 2, 'in the past');

  assert.equal((await rbJson(root, ['delegate', 'revoke'], io)).code, 0);
  assert.equal((await rbJson(root, ['delegate', 'list'], io)).json.length, 0);
});

test('rb delegate refuses a delegation without the owner\'s words or with a bad scope', async () => {
  const root = project();
  const gh = fakeGh();
  const io = { ghRunner: gh.runner };
  assert.equal((await rbJson(root, ['delegate', '--scope', 'all'], io)).code, 2);
  assert.equal((await rbJson(root, ['delegate', '--words', 'x', '--scope', 'everything'], io)).code, 2);
  assert.equal((await rbJson(root, ['delegate', '--words', 'x', '--include', 'schema'], io)).code, 2);
});

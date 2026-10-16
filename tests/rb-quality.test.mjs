// 0.8.0: lock renewal, rb gh pr-line, the tier C plan security check in rb escalate, task size
// limits and rb quality (issues #17 and #19, eval build-tier-c-escalates).
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { replaceMachineLine } from '../scripts/lib/gh.mjs';
import { parseKickbacks } from '../scripts/lib/quality.mjs';
import { parseTasks, taskProblems } from '../scripts/lib/spec.mjs';
import { REPO, cleanup, fakeGh, rb, rbJson, repoWith, sh, withEnv, write } from './rb-helpers.mjs';

after(cleanup);

function project() {
  const root = repoWith({ 'AGENTS.md': '# App\n\nDefault branch: main\n' });
  sh(root, 'git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
  return root;
}

test('lock: the same run renews after 30 min; the gate renews its own stale lock; run age survives renewals', async () => {
  const root = project();
  const gh = fakeGh();
  const io = { ghRunner: gh.runner };
  const at = (min) => new Date(Date.parse('2026-10-16T00:00:00Z') + min * 60000).toISOString();
  await withEnv({ RB_NOW: at(0) }, async () => assert.equal((await rbJson(root, ['lock', 'acquire', '--run', 'r1'], io)).code, 0));
  await withEnv({ RB_NOW: at(10) }, async () => {
    const r = await rbJson(root, ['lock', 'acquire', '--run', 'r1'], io);
    assert.equal(r.json.renewed, undefined, 'too early to renew');
  });
  await withEnv({ RB_NOW: at(40) }, async () => {
    const r = await rbJson(root, ['lock', 'acquire', '--run', 'r1'], io);
    assert.equal(r.json.renewed, true);
    const st = await rbJson(root, ['lock', 'status'], io);
    assert.equal(st.json.ageMinutes, 0);
    assert.equal(st.json.runMinutes, 40, 'the time budget counts from the first acquisition');
    assert.equal((await rbJson(root, ['lock', 'acquire', '--run', 'r2'], io)).code, 3, 'another run still cannot take it');
  });
  // 4 hours later the lock is stale; its own run renews it through the gate's check.
  await withEnv({ RB_NOW: at(280) }, async () => {
    const { holdsLock } = await import('../scripts/lib/control.mjs');
    const { makeGh } = await import('../scripts/lib/gh.mjs');
    const c = makeGh({ repo: REPO, runner: gh.runner });
    assert.equal(holdsLock(c, 'r1').held, false);
    assert.equal(holdsLock(c, 'r1', { renew: true }).held, true);
    assert.equal(holdsLock(c, 'r2', { renew: true }).held, false, 'renew never takes over for another run');
  });
});

test('rb gh pr-line replaces one machine line of the same stage or kind, never the tier', async () => {
  const body = ['Closes #3', '<!-- rockbuilt:timing task=T1 plan=3 -->', '<!-- rockbuilt:status stage=rb-verifier task=T1 outcome=pass head=aaa1111 -->', '<!-- rockbuilt:status stage=rb-auditor task=T1 outcome=pass head=aaa1111 -->', '<!-- rockbuilt:tier B -->'].join('\n');
  const v = '<!-- rockbuilt:status stage=rb-verifier task=T1 outcome=pass head=bbb2222 identical-to=aaa1111 by=rb-review-delta -->';
  const out = replaceMachineLine(body, v);
  assert.match(out, /head=bbb2222 identical-to=aaa1111/);
  assert.match(out, /stage=rb-auditor task=T1 outcome=pass head=aaa1111/, 'other stages untouched');
  assert.equal(out.split('\n').length, 5);
  const k = replaceMachineLine(out, '<!-- rockbuilt:kickbacks verifier=1 auditor=0 security=0 mechanical=0 ci=0 -->');
  assert.ok(k.split('\n').indexOf('<!-- rockbuilt:kickbacks verifier=1 auditor=0 security=0 mechanical=0 ci=0 -->') < k.split('\n').indexOf('<!-- rockbuilt:tier B -->'), 'new kinds go before the tier line');
  assert.throws(() => replaceMachineLine(body, '<!-- rockbuilt:tier A -->'), /tier line/);
  assert.throws(() => replaceMachineLine(body, 'plain text'), /one `<!-- rockbuilt/);

  const root = project();
  const gh = fakeGh();
  gh.state.issues[9] = { number: 9, title: 'feat', body, state: 'open', labels: [], isPr: true };
  gh.state.pulls[9] = { number: 9, head: 'rb/T1-x', base: 'main', headSha: 'b'.repeat(40) };
  const r = await rbJson(root, ['gh', 'pr-line', '9', '--line', v], { ghRunner: gh.runner });
  assert.equal(r.code, 0, r.err);
  assert.match(gh.state.issues[9].body, /head=bbb2222/);
});

test('rb escalate refuses a tier C plan without its security read (eval build-tier-c-escalates)', async () => {
  const root = project();
  const gh = fakeGh();
  const io = { ghRunner: gh.runner };
  gh.state.issues[4] = { number: 4, title: 'T2', body: '', state: 'open', labels: [] };
  gh.state.comments[4] = [{ id: 1, body: '<!-- rockbuilt:plan base=abc tier=C -->\nPlan', user: { login: 'rb-bot' }, author_association: 'OWNER', created_at: '2026-10-16T00:00:00Z' }];
  gh.state.nextComment = 2;
  write(root, 'q.md', 'Approve the new dependency?');
  let r = await rb(root, ['escalate', '4', '--kind', 'human', '--title', 'Dependency', '--body-file', 'q.md'], io);
  assert.equal(r.code, 3);
  assert.match(r.err, /security read/);
  assert.deepEqual(gh.state.issues[4].labels, [], 'nothing labelled');
  // needs-local never needs it; after the review is posted, human works.
  assert.equal((await rb(root, ['escalate', '4', '--kind', 'local', '--title', 'Browser', '--body-file', 'q.md'], io)).code, 0);
  gh.state.comments[4].push({ id: 9, body: '<!-- rockbuilt:status stage=rb-security-reviewer task=T2 outcome=pass mode=plan -->', user: { login: 'rb-bot' }, author_association: 'OWNER', created_at: '2026-10-16T00:05:00Z' });
  r = await rb(root, ['escalate', '4', '--kind', 'human', '--title', 'Dependency', '--body-file', 'q.md'], io);
  assert.equal(r.code, 0, r.err);
  // A newer tier B plan clears the requirement.
  gh.state.issues[5] = { number: 5, title: 'T3', body: '', state: 'open', labels: [] };
  gh.state.comments[5] = [
    { id: 20, body: '<!-- rockbuilt:plan base=abc tier=C -->', user: { login: 'rb-bot' }, author_association: 'OWNER', created_at: '2026-10-16T00:00:00Z' },
    { id: 21, body: '<!-- rockbuilt:plan base=abd tier=B -->', user: { login: 'rb-bot' }, author_association: 'OWNER', created_at: '2026-10-16T00:01:00Z' },
  ];
  assert.equal((await rb(root, ['escalate', '5', '--kind', 'human', '--title', 'Q', '--body-file', 'q.md'], io)).code, 0);
});

test('rb tasks: size L needs a reason, and too many files or criteria mean split it', () => {
  const block = (id, size, files, covers) => `## ${id}: x\n- Purpose: p\n- Covers: ${covers}\n- Size: ${size}\n- Depends on: none\n- Files: ${files}\n- Verify: \`npm test\`\n- Status: todo\n`;
  const many = Array.from({ length: 9 }, (_, i) => `src/f${i}.js`).join(', ');
  const t = parseTasks(`# Tasks: x\n\n${block('T1', 'L', 'src/a.js', 'R1.1')}\n${block('T2', 'L (one migration, cannot be split)', 'src/a.js', 'R1.1')}\n${block('T3', 'M', many, 'R1.1')}\n${block('T4', 'S', 'src/a.js', 'R1.1, R1.2, R1.3, R1.4, R1.5')}`);
  const p = taskProblems(t.tasks, t.errors);
  assert.ok(p.some((x) => /T1 is size L without a reason/.test(x)));
  assert.ok(!p.some((x) => /T2/.test(x)));
  assert.ok(p.some((x) => /T3 lists 9 files/.test(x)));
  assert.ok(p.some((x) => /T4 covers 5 criteria/.test(x)));
});

test('rb quality: kickbacks by source, reverts and bugs traced to merged PRs', async () => {
  assert.deepEqual(parseKickbacks('<!-- rockbuilt:kickbacks verifier=2 auditor=1 -->'), { mechanical: 0, verifier: 2, auditor: 1, security: 0, ci: 0 });
  const root = project();
  const gh = fakeGh();
  const s = gh.state;
  const pr = (n, head, body, merged) => {
    s.issues[n] = { number: n, title: `PR ${n}`, body, state: merged ? 'closed' : 'open', labels: [], isPr: true, created_at: '2026-10-10T00:00:00Z' };
    s.pulls[n] = { number: n, head, base: 'main', headSha: 'f'.repeat(40), merged_at: merged ? '2026-10-10T05:00:00Z' : null };
  };
  pr(10, 'rb/T1-a', '<!-- rockbuilt:kickbacks verifier=1 auditor=1 security=0 mechanical=0 ci=0 -->', true);
  pr(11, 'rb/T2-b', 'no line', true);
  pr(12, 'rb/bookkeeping-2026-10-10', '', true);
  pr(13, 'rb/revert-10', '', false);
  s.issues[20] = { number: 20, title: 'total wrong', body: 'Introduced by #10', state: 'open', labels: ['rb:bug'], created_at: '2026-10-11T00:00:00Z' };
  s.issues[21] = { number: 21, title: 'old', body: 'see #10', state: 'open', labels: ['rb:bug'], created_at: '2026-09-01T00:00:00Z' };
  const r = await rbJson(root, ['quality', '--since', '2026-10-01'], { ghRunner: gh.runner });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.merged, 2, 'bookkeeping is not a task PR');
  assert.equal(r.json.withKickbackLine, 1);
  assert.equal(r.json.kickbacks.auditor, 1);
  assert.deepEqual(r.json.reverts.map((x) => x.pr), [13]);
  assert.equal(r.json.bugs, 1, 'the September bug is outside the window');
  assert.deepEqual(r.json.escaped, [{ issue: 20, title: 'total wrong', prs: [10] }]);
  assert.equal(r.json.rates.escapedPerMerged, 0.5);
});

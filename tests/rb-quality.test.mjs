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
  s.issues[21] = { number: 21, title: 'old', body: 'Introduced by #10', state: 'open', labels: ['rb:bug'], created_at: '2026-09-01T00:00:00Z' };
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

test('review fixes: plan read only for a pending plan from trusted authors; limits skip done tasks; fenced lines stay', async () => {
  const root = project();
  const gh = fakeGh();
  const io = { ghRunner: gh.runner };
  write(root, 'q.md', 'Q');
  const plan = (id, extra = {}) => ({ id, body: '<!-- rockbuilt:plan base=abc tier=C -->', user: { login: 'rb-bot' }, author_association: 'OWNER', created_at: '2026-10-16T00:00:00Z', ...extra });
  // Already approved (a 0.7 plan with no mode=plan line): later escalations go through.
  gh.state.issues[6] = { number: 6, title: 'T6', body: '', state: 'open', labels: ['rb:approved'] };
  gh.state.comments[6] = [plan(1)];
  assert.equal((await rb(root, ['escalate', '6', '--kind', 'human', '--title', 'Blocked', '--body-file', 'q.md'], io)).code, 0);
  // A forged plan from an outside commenter does not block anything.
  gh.state.issues[7] = { number: 7, title: 'T7', body: '', state: 'open', labels: [] };
  gh.state.comments[7] = [plan(2, { author_association: 'NONE' })];
  assert.equal((await rb(root, ['escalate', '7', '--kind', 'human', '--title', 'Q', '--body-file', 'q.md'], io)).code, 0);
  // Plan and verdict in the same comment count.
  gh.state.issues[8] = { number: 8, title: 'T8', body: '', state: 'open', labels: [] };
  gh.state.comments[8] = [plan(3, { body: '<!-- rockbuilt:plan base=abc tier=C -->\n...\n<!-- rockbuilt:status stage=rb-security-reviewer task=T8 outcome=pass mode=plan -->' })];
  assert.equal((await rb(root, ['escalate', '8', '--kind', 'human', '--title', 'Q', '--body-file', 'q.md'], io)).code, 0);

  const t = parseTasks('# Tasks: x\n\n## T1: old\n- Purpose: p\n- Covers: R1.1, R1.2, R1.3, R1.4, R1.5\n- Size: L\n- Depends on: none\n- Files: a.js\n- Verify: `npm test`\n- Status: done\n');
  assert.deepEqual(taskProblems(t.tasks, t.errors), [], 'done tasks keep their old shape');

  const body = 'Example:\n```\n<!-- rockbuilt:status stage=rb-verifier outcome=pass head=old0000 -->\n```\n<!-- rockbuilt:status stage=rb-verifier outcome=pass head=aaa1111 -->\n<!-- rockbuilt:tier A -->';
  const out = replaceMachineLine(body, '<!-- rockbuilt:status stage=rb-verifier outcome=pass head=bbb2222 -->');
  assert.match(out, /```\n<!-- rockbuilt:status stage=rb-verifier outcome=pass head=old0000 -->\n```/, 'fenced example untouched');
  assert.match(out, /head=bbb2222 -->\n<!-- rockbuilt:tier A -->/);
});

test('merge-gate --dry-run never renews or takes a lock', async () => {
  const root = project();
  const gh = fakeGh();
  const io = { ghRunner: gh.runner };
  await withEnv({ RB_NOW: '2026-10-16T00:00:00Z' }, async () => assert.equal((await rbJson(root, ['lock', 'acquire', '--run', 'r1'], io)).code, 0));
  const before = Object.values(gh.state.comments).flat().length;
  await withEnv({ RB_NOW: '2026-10-16T05:00:00Z' }, async () => {
    gh.state.issues[9] = { number: 9, title: 'feat', body: '<!-- rockbuilt:tier A -->', state: 'open', labels: ['rb:tier-a'], isPr: true };
    gh.state.pulls[9] = { number: 9, head: 'rb/T1-x', base: 'main', headSha: 'b'.repeat(40) };
    await rbJson(root, ['merge-gate', '9', '--run', 'r1', '--dry-run'], io);
  });
  assert.equal(Object.values(gh.state.comments).flat().filter((c) => /rockbuilt:lock/.test(c.body)).length, 1, 'no renewal comment');
  assert.ok(Object.values(gh.state.comments).flat().length >= before);
});

test('rb quality (0.10.0): reviewer kickbacks and minutes from the verdicts on the task issue', async () => {
  const root = project();
  const gh = fakeGh();
  const s = gh.state;
  const cm = (id, at, body, assoc = 'OWNER') => ({ id, body, user: { login: 'rb-bot' }, author_association: assoc, created_at: at });
  // The PR line says nothing about reviewers (an interactive session forgot it); the issue has it all.
  s.issues[30] = { number: 30, title: 'PR 30', body: 'Closes #5\n<!-- rockbuilt:kickbacks mechanical=1 ci=1 -->', state: 'closed', labels: [], isPr: true, created_at: '2026-10-20T11:00:00Z' };
  s.pulls[30] = { number: 30, head: 'rb/T5-x', base: 'main', headSha: 'f'.repeat(40), merged_at: '2026-10-20T11:30:00Z' };
  s.issues[5] = { number: 5, title: 'T5', body: '', state: 'closed', labels: ['rb:task'] };
  s.comments[5] = [
    cm(1, '2026-10-20T09:00:00Z', '<!-- rockbuilt:claim run=s1 at=2026-10-20T09:00:00Z -->'),
    cm(2, '2026-10-20T09:20:00Z', '<!-- rockbuilt:plan base=abc1234 tier=B -->\nPlan'),
    cm(3, '2026-10-20T10:00:00Z', '<!-- rockbuilt:status stage=rb-verifier task=T5 outcome=fail head=aaaaaaa -->'),
    cm(4, '2026-10-20T10:20:00Z', '<!-- rockbuilt:status stage=rb-verifier task=T5 outcome=pass head=bbbbbbb -->'),
    cm(5, '2026-10-20T10:40:00Z', '<!-- rockbuilt:status stage=rb-auditor task=T5 outcome=fail head=bbbbbbb -->'),
    cm(6, '2026-10-20T10:50:00Z', '<!-- rockbuilt:status stage=rb-auditor task=T5 outcome=fail head=bbbbbbb -->', 'NONE'),
  ];
  const r = await rbJson(root, ['quality', '--since', '2026-10-01'], { ghRunner: gh.runner });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.kickbacks, { mechanical: 1, verifier: 1, auditor: 1, security: 0, ci: 1 }, 'an outsider comment does not count');
  assert.deepEqual(r.json.timing, [{ pr: 30, issue: 5, plan: 20, build: 40, review: 40, merge: 30 }]);
  assert.match((await rb(root, ['quality', '--since', '2026-10-01'], { ghRunner: gh.runner })).out, /to plan 20, plan to first review 40/);
});

// rb hours: attention marks, blocks, overlap split, attribution, hooks and the report.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  computeHours, makeResolver, manualComment, parseAttention, parseBaseline, refFromBranch, renderCsv, segmentsFor, sessionComments, splitOverlaps,
} from '../scripts/lib/hours.mjs';
import { parseTimingLines, timingLine } from '../scripts/lib/timing.mjs';
import { REPO, cleanup, fakeGh, rb, rbJson, repoWith, sh, tmp, withEnv } from './rb-helpers.mjs';

after(cleanup);

const T = (hhmm) => `2026-10-13T${hhmm}:00.000Z`;
const MIN = 60000;

test('segments: marks within the gap chain, the last one gets the tail, duplicates count once', () => {
  const segs = segmentsFor([
    { ts: T('10:00'), key: 'a' }, { ts: T('10:08'), key: 'a' }, { ts: T('10:08'), key: 'a' }, { ts: T('10:30'), key: 'b' },
  ], { gapMin: 10, tailMin: 5 });
  assert.deepEqual(segs.map((s) => [s.key, (s.end - s.start) / MIN]), [['a', 8], ['a', 5], ['b', 5]]);
});

test('overlap split: two hours jumping between three projects add up to two hours', () => {
  // Each project gets a mark every 6 minutes, interleaved, for two hours.
  const projects = ['x/a', 'x/b', 'x/c'].map((repo, k) => {
    const marks = [];
    for (let m = k * 2; m < 120; m += 6) marks.push({ ts: new Date(Date.parse(T('09:00')) + m * MIN).toISOString(), branch: null });
    return { repo, marks, comments: [] };
  });
  const r = computeHours(projects, { gapMin: 10, tailMin: 5 });
  const total = r.ownerMinutes;
  assert.ok(total >= 120 && total <= 126, `total ${total}`);
  for (const f of r.features) assert.ok(Math.abs(f.ownerMinutes - total / 3) < 3, `${f.repo} ${f.ownerMinutes}`);
});

test('splitOverlaps shares only the overlapping part', () => {
  const t = splitOverlaps([{ key: 'a', start: 0, end: 30 * MIN }, { key: 'b', start: 20 * MIN, end: 40 * MIN }]);
  assert.equal(t.get('a') / MIN, 25);
  assert.equal(t.get('b') / MIN, 15);
});

test('branch refs follow the harness conventions', () => {
  assert.deepEqual(refFromBranch('rb/T3-add-total'), { task: 'T3', spec: null });
  assert.deepEqual(refFromBranch('rb/B14-fix-r2'), { task: 'B14', spec: null });
  assert.deepEqual(refFromBranch('rb/spec-02-invoices'), { task: '(spec)', spec: 'docs/specs/02-invoices' });
  assert.equal(refFromBranch('main'), null);
  assert.equal(refFromBranch(null), null);
});

test('resolver: PR and issue markers decide task and spec; unknown work is general', () => {
  const r = makeResolver({
    prs: [{ number: 9, body: '<!-- rockbuilt:task T2 spec=docs/specs/02-inv -->', head: { ref: 'rb/T2-x' } }],
    issues: [{ number: 4, body: '<!-- rockbuilt:task T5 spec=docs/specs/02-inv/ -->' }, { number: 1, body: 'control' }],
  });
  assert.deepEqual(r.branch('rb/T2-x'), { task: 'T2', spec: 'docs/specs/02-inv' });
  assert.deepEqual(r.number(4), { task: 'T5', spec: 'docs/specs/02-inv' });
  assert.equal(r.number(1).task, '(general)');
  assert.equal(r.branch('main').task, '(general)');
});

test('session comments round-trip, split past 900 lines, and keep no prompt text', () => {
  const marks = Array.from({ length: 950 }, (_, i) => ({ ts: new Date(Date.parse(T('08:00')) + i * 1000).toISOString(), branch: i % 2 ? 'rb/T1-a' : null }));
  const bodies = sessionComments('s-1', marks);
  assert.equal(bodies.length, 2);
  assert.match(bodies[1], /session=s-1 part=2/);
  const back = parseAttention(bodies);
  assert.equal(back.marks.length, 950);
  assert.equal(back.marks[1].branch, 'rb/T1-a');
  assert.equal(back.marks[0].branch, null);
  const manual = parseAttention([manualComment({ minutes: 45, at: T('15:00'), ref: 'T3', spec: 'docs/specs/02-inv', note: 'call' })]).manual;
  assert.deepEqual(manual, [{ minutes: 45, at: T('15:00'), ref: 'T3', spec: 'docs/specs/02-inv' }]);
});

test('computeHours: attribution, manual entries, agent minutes, baselines and the window', () => {
  const resolver = makeResolver({ prs: [{ number: 9, body: '<!-- rockbuilt:task T2 spec=docs/specs/02-inv -->', head: { ref: 'rb/T2-x' } }] });
  const r = computeHours([{
    repo: 'x/a',
    marks: [{ ts: T('10:00'), branch: 'rb/T2-x' }, { ts: T('10:04'), branch: 'rb/T2-x' }, { ts: T('11:00'), branch: 'main' }],
    comments: [{ ts: T('12:00'), number: 9 }],
    manual: [{ minutes: 30, at: T('16:00'), ref: null, spec: 'docs/specs/02-inv' }],
    resolver,
    agent: [{ task: 'T2', spec: 'docs/specs/02-inv', minutes: 6.5, estHours: 3 }],
    baselines: { 'docs/specs/02-inv': 10 },
  }], { gapMin: 10, tailMin: 5, since: Date.parse(T('09:00')), until: Date.parse(T('23:00')) });
  const t2 = r.tasks.find((t) => t.task === 'T2');
  assert.equal(t2.ownerMinutes, 4 + 5 + 5); // 10:00-10:04, tail after 10:04, the PR comment
  assert.equal(t2.agentMinutes, 6.5);
  assert.equal(t2.estHours, 3);
  assert.equal(r.tasks.find((t) => t.task === '(general)').ownerMinutes, 5);
  assert.equal(r.tasks.find((t) => t.task === '(manual)').ownerMinutes, 30);
  const f = r.features.find((x) => x.spec === 'docs/specs/02-inv');
  assert.equal(f.baselineHours, 10);
  assert.equal(f.tasks, 1);
  const clipped = computeHours([{ repo: 'x/a', marks: [{ ts: T('10:00'), branch: null }], comments: [] }], { since: Date.parse(T('10:03')) });
  assert.equal(clipped.ownerMinutes, 2);
});

test('baseline line in English or Spanish; CSV quotes awkward cells', () => {
  assert.equal(parseBaseline('# Req\n\nBaseline: 12 h (owner estimate)\n'), 12);
  assert.equal(parseBaseline('- **Línea base:** 7,5 h'), 7.5);
  assert.equal(parseBaseline('nothing'), null);
  const csv = renderCsv(computeHours([{ repo: 'x/a', marks: [{ ts: T('10:00'), branch: 'rb/spec-01-a,b' }], comments: [] }]));
  assert.match(csv, /^level,repo,feature,task,your_hours/);
  assert.match(csv, /"01-a,b"/);
});

test('timing line carries the planner estimate and parses back', () => {
  const report = { tasks: [{ task: 'T1', phases: { plan: 60000 }, totalMs: 60000 }] };
  const line = timingLine(report, 'T1', { estHours: 2.5 });
  assert.equal(line, '<!-- rockbuilt:timing task=T1 plan=1.0 est=2.5 -->');
  const [t] = parseTimingLines(line);
  assert.equal(t.estHours, 2.5);
  assert.equal(t.totalMs, 60000);
  assert.equal(parseTimingLines('<!-- rockbuilt:timing task=T1 plan=1.0 -->')[0].estHours, null);
});

function project(extra = {}) {
  const root = repoWith({ 'README.md': '# app\n', 'tools/rockbuilt/rb.mjs': '// vendored\n', ...extra });
  sh(root, 'git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
  sh(root, 'git', ['checkout', '-q', '-b', 'rb/T2-x']);
  return root;
}

test('hooks: mark records time and branch, prints nothing, skips unattended runs; flush upserts one comment', async () => {
  const root = project();
  const gh = fakeGh();
  const io = (input) => ({ ghRunner: gh.runner, stdin: () => JSON.stringify({ session_id: 's1', cwd: root, ...input }) });
  const m = await rb(root, ['hours', 'mark', '--hook'], io({ prompt: 'hola' }));
  assert.equal(m.code, 0);
  assert.equal(m.out, '');
  const skipped = await rb(root, ['hours', 'mark', '--hook'], io({ prompt: 'Run /rb-cycle. [rockbuilt:unattended]' }));
  assert.equal(skipped.out, '');
  const lines = readFileSync(path.join(root, '.rockbuilt', 'attention.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).branch, 'rb/T2-x');
  assert.ok(!lines[0].includes('hola'), 'prompt text is never stored');

  assert.equal((await rb(root, ['hours', 'flush', '--hook'], io({}))).code, 0);
  const issue = Object.values(gh.state.issues).find((i) => i.title === 'Rockbuilt hours');
  assert.ok(issue);
  assert.equal(gh.state.comments[issue.number].length, 1);
  await rb(root, ['hours', 'mark', '--hook'], io({ prompt: 'otra' }));
  await rb(root, ['hours', 'flush', '--hook'], io({}));
  assert.equal(gh.state.comments[issue.number].length, 1, 'the session comment is edited, not duplicated');
  assert.equal(gh.state.edits, 1);
  assert.equal(parseAttention([gh.state.comments[issue.number][0].body]).marks.length, 2);
  const noop = gh.calls.length;
  await rb(root, ['hours', 'flush', '--hook'], io({}));
  assert.equal(gh.calls.length, noop, 'nothing new, no API call');
});

test('hooks never fail the session, even without GitHub', async () => {
  const root = project();
  const broken = () => ({ ok: false, status: 1, stdout: '', stderr: 'boom (HTTP 500)' });
  await rb(root, ['hours', 'mark', '--hook'], { stdin: () => JSON.stringify({ session_id: 's2', cwd: root, prompt: 'x' }) });
  const r = await rb(root, ['hours', 'flush', '--hook'], { ghRunner: broken, stdin: () => '{"session_id":"s2"}' });
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  const bad = await rb(root, ['hours', 'mark', '--hook'], { stdin: () => 'not json' });
  assert.equal(bad.code, 0);
  assert.equal((await rb(root, ['hours', 'mark'])).code, 2, 'without --hook it is a usage error');
});

test('report: GitHub marks, own comments, manual entries, agent minutes and the baseline, plus CSV', async () => {
  const root = project();
  const gh = fakeGh();
  const s = gh.state;
  const issue = (n, title, body, extra = {}) => { s.issues[n] = { number: n, title, body, state: 'open', labels: [], author: s.user, ...extra }; s.nextNumber = n + 1; };
  issue(1, 'Rockbuilt hours', '<!-- rockbuilt:hours -->');
  issue(3, 'T2: totals', '<!-- rockbuilt:task T2 spec=docs/specs/02-inv -->');
  issue(5, 'T2: totals', '<!-- rockbuilt:task T2 spec=docs/specs/02-inv -->\n<!-- rockbuilt:timing task=T2 plan=1.0 implement=2.0 est=4 -->', { isPr: true, state: 'closed' });
  s.pulls[5] = { number: 5, head: 'rb/T2-x', base: 'main', headSha: 'f'.repeat(40), merged_at: T('13:00') };
  s.comments[1] = [
    { id: 100, body: sessionComments('s9', [{ ts: T('10:00'), branch: 'rb/T2-x' }, { ts: T('10:06'), branch: 'rb/T2-x' }])[0], user: { login: s.user }, created_at: T('10:06') },
    { id: 101, body: manualComment({ minutes: 20, at: T('18:00'), spec: 'docs/specs/02-inv', note: 'client call' }), user: { login: s.user }, created_at: T('18:00') },
  ];
  s.comments[3] = [
    { id: 102, body: 'aprobado', user: { login: s.user }, created_at: T('12:00') },
    { id: 103, body: '<!-- rockbuilt:note -->\nharness text', user: { login: s.user }, created_at: T('12:30') },
    { id: 104, body: 'someone else', user: { login: 'other' }, created_at: T('12:31') },
  ];
  s.nextComment = 200;
  s.contents['main:docs/specs/02-inv/requirements.md'] = '# Req\n\nBaseline: 12 h\n';
  const csvPath = path.join(tmp(), 'hours.csv');
  const r = await rbJson(root, ['hours', '--repos', REPO, '--csv', csvPath], { ghRunner: gh.runner });
  assert.equal(r.code, 0, r.err);
  const f = r.json.features.find((x) => x.spec === 'docs/specs/02-inv');
  assert.equal(f.ownerMinutes, 6 + 5 + 5 + 20); // two marks, the "aprobado" comment, the manual entry
  assert.equal(f.agentMinutes, 3);
  assert.equal(f.estHours, 4);
  assert.equal(f.baselineHours, 12);
  assert.ok(existsSync(csvPath));
  assert.match(readFileSync(csvPath, 'utf8'), /^feature,acme\/app,02-inv,,0\.60,3\.0,12,4\.0$/m);
  const text = await rb(root, ['hours', '--repos', REPO], { ghRunner: gh.runner });
  assert.match(text.out, /\| acme\/app \| 02-inv \| 0\.60 \| 3\.0 \| 1 \| 12 \| 4\.0 \|/);
  assert.match(text.out, /## Method/);
});

test('log posts a manual entry; bad input is a usage error', async () => {
  const root = project();
  const gh = fakeGh();
  const r = await rbJson(root, ['hours', 'log', '45', '--ref', 'T2', '--note', 'call', '--at', T('15:00')], { ghRunner: gh.runner });
  assert.equal(r.code, 0, r.err);
  const body = gh.state.comments[r.json.issue][0].body;
  assert.deepEqual(parseAttention([body]).manual, [{ minutes: 45, at: T('15:00'), ref: 'T2', spec: null }]);
  assert.equal((await rb(root, ['hours', 'log', 'abc'], { ghRunner: gh.runner })).code, 2);
  assert.equal((await rb(root, ['hours', '--gap', '-1', '--repos', REPO], { ghRunner: gh.runner })).code, 2);
});

test('hooks write only to the session project, and only when it is vendored', async () => {
  const proj = project();
  const other = repoWith({ 'README.md': '# other\n' });
  await withEnv({ CLAUDE_PROJECT_DIR: proj }, () => rb(proj, ['hours', 'mark', '--hook'], { stdin: () => JSON.stringify({ session_id: 's', cwd: other, prompt: 'x' }) }));
  assert.ok(existsSync(path.join(proj, '.rockbuilt', 'attention.jsonl')), 'mark lands in the project dir');
  assert.ok(!existsSync(path.join(other, '.rockbuilt')), 'never in the shell cwd');
  await withEnv({ CLAUDE_PROJECT_DIR: other }, () => rb(other, ['hours', 'mark', '--hook'], { stdin: () => '{"session_id":"s"}' }));
  assert.ok(!existsSync(path.join(other, '.rockbuilt')), 'a repo without the harness is never written');
});

test('Hours: off records nothing; Hours: local never calls GitHub', async () => {
  const off = project({ 'AGENTS.md': '# p\n\nHours: off\n' });
  await rb(off, ['hours', 'mark', '--hook'], { stdin: () => JSON.stringify({ session_id: 's', cwd: off, prompt: 'x' }) });
  assert.ok(!existsSync(path.join(off, '.rockbuilt', 'attention.jsonl')));
  const local = project({ 'AGENTS.md': '# p\n\nHours: local\n' });
  const gh = fakeGh();
  const io = { ghRunner: gh.runner, stdin: () => JSON.stringify({ session_id: 's', cwd: local, prompt: 'x' }) };
  await rb(local, ['hours', 'mark', '--hook'], io);
  await rb(local, ['hours', 'flush', '--hook'], io);
  assert.ok(existsSync(path.join(local, '.rockbuilt', 'attention.jsonl')));
  assert.equal(gh.calls.length, 0);
});

test('manual entries add in full, even when they overlap marks or each other', () => {
  const r = computeHours([{
    repo: 'x/a',
    marks: [{ ts: T('15:00'), branch: null }, { ts: T('15:08'), branch: null }],
    comments: [],
    manual: [{ minutes: 60, at: T('16:00') }, { minutes: 30, at: T('16:00') }],
  }]);
  assert.equal(r.ownerMinutes, 8 + 5 + 90);
});

test('comment parts stay under the GitHub size limit with long branch names', () => {
  const branch = `rb/T12-${'x'.repeat(40)}-r2`;
  const marks = Array.from({ length: 2000 }, (_, i) => ({ ts: new Date(Date.parse(T('08:00')) + i * 1000).toISOString(), branch }));
  const bodies = sessionComments('s', marks);
  for (const b of bodies) assert.ok(b.length < 60000, `part of ${b.length} chars`);
  assert.equal(parseAttention(bodies).marks.length, 2000);
});

test('resolver completes task ids, issue numbers and verify branches', () => {
  const r = makeResolver({
    issues: [{ number: 4, body: '<!-- rockbuilt:task T5 spec=docs/specs/02-inv -->' }, { number: 6, body: '<!-- rockbuilt:task T1 spec=docs/specs/01-a -->' }, { number: 7, body: '<!-- rockbuilt:task T1 spec=docs/specs/02-inv -->' }],
  });
  assert.deepEqual(r.branch('rb/T5-early'), { task: 'T5', spec: 'docs/specs/02-inv' }, 'before its PR exists');
  assert.deepEqual(r.branch('rb/T1-x'), { task: 'T1', spec: null }, 'ambiguous id stays without spec');
  assert.deepEqual(r.branch('rb/verify-inv'), { task: '(verify)', spec: 'docs/specs/02-inv' });
  assert.deepEqual(r.manual('t5', null), { task: 'T5', spec: 'docs/specs/02-inv' });
  assert.deepEqual(r.manual('#4', null), { task: 'T5', spec: 'docs/specs/02-inv' });
  assert.deepEqual(r.manual(null, 'docs/specs/02-inv/'), { task: '(manual)', spec: 'docs/specs/02-inv' });
});

test('the overlap split scales (sweep line)', () => {
  const projects = ['x/a', 'x/b'].map((repo, k) => ({
    repo,
    marks: Array.from({ length: 20000 }, (_, i) => ({ ts: new Date(Date.parse(T('00:00')) + (i * 2 + k) * 30000).toISOString(), branch: null })),
    comments: [],
  }));
  const t0 = Date.now();
  computeHours(projects);
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
});

test('report: a retried task counts its newest PR once; repo names are case-insensitive; rotated issues are read', async () => {
  const root = project();
  const gh = fakeGh();
  const s = gh.state;
  const issue = (n, title, body, extra = {}) => { s.issues[n] = { number: n, title, body, state: 'open', labels: [], author: s.user, ...extra }; s.nextNumber = n + 1; };
  issue(1, 'Rockbuilt hours', '<!-- rockbuilt:hours -->', { state: 'closed' });
  issue(2, 'Rockbuilt hours', '<!-- rockbuilt:hours -->');
  issue(5, 'T2', '<!-- rockbuilt:task T2 spec=docs/specs/02-inv -->\n<!-- rockbuilt:timing task=T2 plan=1.0 est=4 -->', { isPr: true, state: 'closed' });
  issue(6, 'T2', '<!-- rockbuilt:task T2 spec=docs/specs/02-inv -->\n<!-- rockbuilt:timing task=T2 plan=1.0 implement=2.0 est=4 -->', { isPr: true, state: 'closed' });
  s.pulls[5] = { number: 5, head: 'rb/T2-x', base: 'main', headSha: 'f'.repeat(40) };
  s.pulls[6] = { number: 6, head: 'rb/T2-x-r2', base: 'main', headSha: 'f'.repeat(40) };
  s.comments[1] = [{ id: 100, body: sessionComments('old', [{ ts: T('09:00'), branch: null }])[0], user: { login: s.user }, created_at: T('09:00') }];
  s.comments[2] = [{ id: 101, body: sessionComments('new', [{ ts: T('11:00'), branch: null }])[0], user: { login: s.user }, created_at: T('11:00') }];
  s.nextComment = 200;
  const r = await rbJson(root, ['hours', '--repos', `${REPO},ACME/APP`], { ghRunner: gh.runner });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.repos.length, 1);
  const f = r.json.features.find((x) => x.spec === 'docs/specs/02-inv');
  assert.equal(f.agentMinutes, 3);
  assert.equal(f.estHours, 4);
  assert.equal(r.json.ownerMinutes, 10, 'both hours issues read, each mark 5 min');
});

test('flush rotates a full hours issue', async () => {
  const root = project();
  const gh = fakeGh();
  gh.state.issues[1] = { number: 1, title: 'Rockbuilt hours', body: '<!-- rockbuilt:hours -->', state: 'open', labels: [], author: gh.state.user };
  gh.state.comments[1] = Array.from({ length: 1500 }, (_, i) => ({ id: 1000 + i, body: 'x', user: { login: gh.state.user }, created_at: T('01:00') }));
  gh.state.nextNumber = 2;
  gh.state.nextComment = 5000;
  const io = { ghRunner: gh.runner, stdin: () => JSON.stringify({ session_id: 'r', cwd: root, prompt: 'x' }) };
  await rb(root, ['hours', 'mark', '--hook'], io);
  await rb(root, ['hours', 'flush', '--hook'], io);
  assert.equal(gh.state.issues[1].state, 'closed');
  const fresh = Object.values(gh.state.issues).find((i) => i.number !== 1 && i.title === 'Rockbuilt hours');
  assert.equal(fresh.state, 'open');
  assert.equal(gh.state.comments[fresh.number].length, 1);
});

test('only the owner counts: collaborators and strangers on the hours issue are ignored', async () => {
  const root = project();
  const gh = fakeGh();
  const s = gh.state;
  s.issues[1] = { number: 1, title: 'Rockbuilt hours', body: '', state: 'open', labels: [], author: s.user };
  s.issues[2] = { number: 2, title: 'Rockbuilt hours', body: '', state: 'open', labels: [], author: 'stranger' };
  s.comments[1] = [
    { id: 10, body: sessionComments('mine', [{ ts: T('10:00'), branch: null }])[0], user: { login: s.user }, created_at: T('10:00') },
    { id: 11, body: sessionComments('colleague', [{ ts: T('12:00'), branch: null }])[0], user: { login: 'colleague' }, created_at: T('12:00') },
    { id: 12, body: manualComment({ minutes: 1440, at: T('20:00') }), user: { login: 'stranger' }, created_at: T('20:00') },
  ];
  s.comments[2] = [{ id: 13, body: manualComment({ minutes: 600, at: T('21:00') }), user: { login: 'stranger' }, created_at: T('21:00') }];
  s.nextNumber = 3;
  s.nextComment = 100;
  const r = await rbJson(root, ['hours', '--repos', REPO], { ghRunner: gh.runner });
  assert.equal(r.json.ownerMinutes, 5);
});

test('public repo without an Hours line keeps marks local; log in local mode stays on the machine', async () => {
  const root = project();
  const gh = fakeGh();
  gh.state.public = true;
  const io = { ghRunner: gh.runner, stdin: () => JSON.stringify({ session_id: 'p', cwd: root, prompt: 'x' }) };
  await rb(root, ['hours', 'mark', '--hook'], io);
  await rb(root, ['hours', 'flush', '--hook'], io);
  assert.ok(!Object.values(gh.state.issues).some((i) => i.title === 'Rockbuilt hours'), 'nothing published');
  const calls = gh.calls.length;
  await rb(root, ['hours', 'mark', '--hook'], io);
  await rb(root, ['hours', 'flush', '--hook'], io);
  assert.equal(gh.calls.length, calls, 'decided once per session');
  const pub = await rbJson(root, ['hours', 'log', '45', '--at', T('15:00')], { ghRunner: gh.runner });
  assert.equal(pub.json.local, true, 'a manual entry on a public repo stays local too');
  assert.ok(!Object.values(gh.state.issues).some((i) => i.title === 'Rockbuilt hours'));

  const local = project({ 'AGENTS.md': '# p\n\nHours: local\n' });
  const gh2 = fakeGh();
  const r = await rbJson(local, ['hours', 'log', '30', '--at', T('15:00')], { ghRunner: gh2.runner });
  assert.equal(r.json.local, true);
  assert.equal(gh2.calls.length, 0);
  const rep = await rbJson(local, ['hours', '--repos', REPO], { ghRunner: gh2.runner });
  assert.equal(rep.json.ownerMinutes, 30, 'the local entry is in the report');
});

test('unmarked verify and task PRs still find their feature', () => {
  const r = makeResolver({
    issues: [{ number: 3, body: '<!-- rockbuilt:task T3 spec=docs/specs/02-x -->' }],
    prs: [{ number: 9, body: '', head: { ref: 'rb/verify-x' } }, { number: 10, body: '', head: { ref: 'rb/T3-foo' } }],
  });
  assert.deepEqual(r.number(9), { task: '(verify)', spec: 'docs/specs/02-x' });
  assert.deepEqual(r.branch('rb/T3-foo'), { task: 'T3', spec: 'docs/specs/02-x' });
  assert.deepEqual(r.number(10), { task: 'T3', spec: 'docs/specs/02-x' });
});

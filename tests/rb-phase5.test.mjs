// PLAN-1.0 phase 5 (1.4.0): exploration, calibration, review per feature, profiles (DESIGN 33).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { prKind, profileOf, requiredReviews } from '../scripts/lib/merge.mjs';
import { REPO, cleanup, fakeGh, rbJson, repoWith, sh, withEnv } from './rb-helpers.mjs';

after(cleanup);

const HEAD = 'a1b2c3d3e5f60718293a4b5c6d7e8f9012345678';
const AGENTS = (extra = '') => `# App\n\nDocs language: es\nProject type: web\nDefault branch: main\nAutonomy: auto\n${extra}\n## Verification\n\`\`\`bash\nnode -e "0"\n\`\`\`\n`;

function project(extra = '') {
  const root = repoWith({ 'AGENTS.md': AGENTS(extra), 'src/app.js': 'export const a = 1;\n' });
  sh(root, 'git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
  return root;
}

const line = (stage, head = HEAD, task = 'T1') => `<!-- rockbuilt:status stage=${stage} task=${task} outcome=pass head=${head} -->`;
const GREEN = [{ name: 'rockbuilt-ci', status: 'completed', conclusion: 'success', started_at: '2026-10-09T00:00:00Z' }];

function post(gh, issue, body) {
  const s = gh.state;
  s.comments[issue] = (s.comments[issue] || []).concat([...String(body).matchAll(/<!--\s*rockbuilt:status[^>]*-->/g)].map((m, i) => ({ id: 2000 + i + (s.comments[issue] || []).length, body: m[0], user: { login: 'rb-bot' }, author_association: 'OWNER', created_at: '2026-10-16T00:00:00Z' })));
}

// A task PR #10 for issue #3 on head rb/T1-feature with the given base, labels and lines.
function seedTask(gh, { base = 'main', labels = ['rb:level-2', 'rb:pr-open'], stages = ['rb-verifier'], head = 'rb/T1-feature', file = 'src/feature.js' } = {}) {
  const s = gh.state;
  s.issues[3] = { number: 3, title: 'T1: feature', body: '<!-- rockbuilt:task T1 spec=docs/specs/01-x -->', state: 'open', labels: ['rb:task', 'rb:in-progress', 'rb:pr-open'] };
  const body = `Closes #3\n\n${stages.map((st) => line(st)).join('\n')}\n`;
  s.issues[10] = { number: 10, title: 'feat: T1', body, state: 'open', labels, isPr: true };
  s.pulls[10] = { number: 10, head, base, headSha: HEAD };
  s.files[10] = [{ filename: file, status: 'added', additions: 3, deletions: 0, patch: '@@\n+export const f = 1;' }];
  s.checkRuns[HEAD] = GREEN;
  post(gh, 3, body);
}

const gate = (root, gh, extra = ['--human-approved', '--dry-run']) => rbJson(root, ['merge-gate', '10', ...extra], { ghRunner: gh.runner });
const rules = (r) => r.json.reasons.map((x) => x.rule);

test('G1: an exploration branch never merges, not even with the owner', async () => {
  assert.equal(prKind('rb/explore-pdf-import'), 'explore');
  const root = project();
  const gh = fakeGh();
  seedTask(gh, { head: 'rb/explore-pdf-import' });
  const r = await gate(root, gh);
  assert.equal(r.code, 3);
  assert.ok(rules(r).includes('explore'), JSON.stringify(r.json.reasons));
});

test('G1: rb explore start needs the branch, keeps a clock, check exits 3 when the time is up', async () => {
  const root = project();
  const wrong = await rbJson(root, ['explore', 'start', 'pdf-import']);
  assert.equal(wrong.code, 2);
  sh(root, 'git', ['checkout', '-b', 'rb/explore-pdf-import']);
  const bad = await rbJson(root, ['explore', 'start', 'pdf-import', '--hours', '9']);
  assert.equal(bad.code, 2, 'more than 8 hours is refused');
  await withEnv({ RB_NOW: '2026-11-25T10:00:00Z' }, async () => {
    const s = await rbJson(root, ['explore', 'start', 'pdf-import']);
    assert.equal(s.code, 0, s.err);
    assert.equal(s.json.hours, 2);
    assert.equal(s.json.until, '2026-11-25T12:00:00.000Z');
    assert.equal(s.json.conclusion, 'docs/research/pdf-import.md');
    assert.equal((await rbJson(root, ['explore', 'start', 'pdf-import'])).code, 3, 'one clock per exploration');
  });
  await withEnv({ RB_NOW: '2026-11-25T11:30:00Z' }, async () => {
    const c = await rbJson(root, ['explore', 'check', 'pdf-import']);
    assert.equal(c.code, 0);
    assert.equal(c.json.minutesLeft, 30);
  });
  await withEnv({ RB_NOW: '2026-11-25T12:01:00Z' }, async () => {
    const c = await rbJson(root, ['explore', 'check', 'pdf-import']);
    assert.equal(c.code, 3);
    assert.equal(c.json.over, true);
  });
  assert.equal((await rbJson(root, ['explore', 'start', '../x'])).code, 2, 'the slug is validated');
});

test('G2: rb calibration keeps only improvements and stops after three without one', async () => {
  const root = project();
  const add = (score, cost, extra = []) => rbJson(root, ['calibration', 'add', 'T4', '--score', String(score), '--cost', String(cost), '--cap', '5', ...extra]);
  let r = await add(0.7, 0.5, ['--ref', 'abc1234']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.kept, true);
  r = await add(0.65, 0.5);
  assert.equal(r.json.kept, false);
  assert.equal(r.json.best.score, 0.7);
  assert.equal(r.json.best.ref, 'abc1234');
  r = await add(0.7, 0.5);
  assert.equal(r.json.kept, false, 'a tie does not improve');
  r = await add(0.8, 0.5);
  assert.equal(r.json.kept, true);
  assert.equal(r.json.sinceImprovement, 0);
  await add(0.6, 0.1);
  await add(0.6, 0.1);
  r = await add(0.6, 0.1);
  assert.equal(r.code, 3);
  assert.equal(r.json.stop, 'plateau');
  assert.equal(r.json.best.score, 0.8);
  assert.equal((await add(0.9, 0.1)).code, 3, 'a stopped calibration takes no more iterations');
  const show = await rbJson(root, ['calibration', 'show', 'T4']);
  assert.equal(show.json.iterations, 7);
  assert.ok(existsSync(path.join(root, '.rockbuilt', 'calibration', 'T4.jsonl')));
});

test('G2: rb calibration stops at the cost cap, fixes cap and direction, validates numbers', async () => {
  const root = project();
  const add = (task, score, cost, cap = '1', extra = []) => rbJson(root, ['calibration', 'add', task, '--score', String(score), '--cost', String(cost), '--cap', cap, ...extra]);
  let r = await add('T5', 120, 0.6, '1', ['--lower-is-better']);
  assert.equal(r.json.kept, true);
  r = await add('T5', 100, 0.3, '1', ['--lower-is-better']);
  assert.equal(r.json.kept, true, 'lower is better');
  assert.equal(r.json.remaining, 0.1);
  assert.equal((await add('T5', 90, 0.1, '2', ['--lower-is-better'])).code, 2, 'the cap cannot be raised');
  assert.equal((await add('T5', 90, 0.1, '1')).code, 2, 'the direction cannot change');
  r = await add('T5', 110, 0.1, '1', ['--lower-is-better']);
  assert.equal(r.code, 3);
  assert.equal(r.json.stop, 'cap');
  assert.equal(r.json.best.score, 100);
  for (const bad of [['x', '1'], ['1', '-1'], ['1', 'abc']]) assert.equal((await add('T6', bad[0], bad[1])).code, 2, bad.join(' '));
  assert.equal((await add('T6', 1, 0, '0')).code, 2, 'a zero cap is refused');
  assert.equal((await add('../x', 1, 0)).code, 2, 'the task id is validated');
  assert.equal(readFileSync(path.join(root, '.rockbuilt', 'calibration', 'T5.jsonl'), 'utf8').trim().split('\n').length, 3);
});

test('G3: a level 2 task into a feature branch needs the verifier only, with the default branch rules', async () => {
  const root = project();
  const gh = fakeGh();
  seedTask(gh, { base: 'rb/feature-01-budgets' });
  gh.state.contents['main:AGENTS.md'] = AGENTS();
  const r = await gate(root, gh);
  assert.equal(r.code, 0, JSON.stringify(r.json.reasons));
  assert.deepEqual(r.json.needs, ['rb-verifier']);
  assert.equal(r.json.featureBase, true);
  assert.ok(gh.calls.some((c) => /contents\/AGENTS\.md\?ref=main/.test(c.path)), 'rules read at the default branch');
  const other = fakeGh();
  seedTask(other, { base: 'release-1' });
  assert.ok(rules(await gate(root, other)).includes('base'), 'only rb/feature-* bases');
});

test('G3: a level 3 task never goes through a feature branch', async () => {
  const root = project();
  const gh = fakeGh();
  seedTask(gh, { base: 'rb/feature-01-budgets', labels: ['rb:level-3'], stages: ['rb-verifier', 'rb-auditor', 'rb-security-reviewer'] });
  const r = await gate(root, gh);
  assert.ok(rules(r).includes('feature-base'), JSON.stringify(r.json.reasons));
});

// Feature PR #20 rb/feature-01-budgets -> main, closing feature issue #5, built from task PR #11.
function seedFeature(gh, { commits, gateComment = true, auditor = true } = {}) {
  const s = gh.state;
  const ref = 'rb/feature-01-budgets';
  s.issues[5] = { number: 5, title: 'Feature 01 budgets', body: 'feature review', state: 'open', labels: ['rb:task'] };
  const lines = [auditor ? line('rb-auditor', HEAD, 'F01') : '', line('rb-security-reviewer', HEAD, 'F01')].filter(Boolean);
  const body = `Closes #5\n\n${lines.join('\n')}\n`;
  s.issues[20] = { number: 20, title: 'feat: budgets (feature 01)', body, state: 'open', labels: ['rb:pr-open'], isPr: true };
  s.pulls[20] = { number: 20, head: ref, base: 'main', headSha: HEAD };
  s.files[20] = [{ filename: 'src/budgets.js', status: 'added', additions: 900, deletions: 0, patch: '@@\n+x' }];
  s.issues[11] = { number: 11, title: 'feat: T1', body: 'Closes #3', state: 'closed', labels: [], isPr: true };
  s.pulls[11] = { number: 11, head: 'rb/T1-budgets', base: ref, headSha: 'd'.repeat(40), merged_at: '2026-11-20T00:00:00Z', merge_commit_sha: '1'.repeat(40) };
  s.comments[11] = gateComment ? [{ id: 9001, body: 'Merged by `rb merge-gate` (level 2, into rb/feature-01-budgets). To undo: ...', user: { login: 'rb-bot' }, author_association: 'OWNER', created_at: '2026-11-20T00:00:00Z' }] : [];
  s.compare = { [HEAD]: { behind_by: 0, ahead_by: commits.length, total_commits: commits.length, commits: commits.map((c) => ({ sha: c.sha, parents: c.parents.map((p) => ({ sha: p })) })) } };
  s.checkRuns[HEAD] = GREEN;
  post(gh, 5, body);
}

test('G3: the feature PR needs the auditor and the security review, and only gate-merged commits', async () => {
  const root = project();
  const gh = fakeGh();
  seedFeature(gh, { commits: [{ sha: '1'.repeat(40), parents: ['0'.repeat(40)] }, { sha: '2'.repeat(40), parents: ['1'.repeat(40), '9'.repeat(40)] }] });
  gh.state.pulls[20].number = 20;
  const r = await rbJson(root, ['merge-gate', '20', '--human-approved', '--dry-run'], { ghRunner: gh.runner });
  assert.equal(r.code, 0, JSON.stringify(r.json.reasons));
  assert.deepEqual(r.json.needs, ['rb-auditor', 'rb-security-reviewer']);
  assert.equal(r.json.kind, 'feature');

  const direct = fakeGh();
  seedFeature(direct, { commits: [{ sha: '1'.repeat(40), parents: ['0'.repeat(40)] }, { sha: '3'.repeat(40), parents: ['1'.repeat(40)] }] });
  const d = await rbJson(root, ['merge-gate', '20', '--human-approved', '--dry-run'], { ghRunner: direct.runner });
  assert.match(JSON.stringify(d.json.reasons), /feature-provenance.*3333333 .*not a task PR merged by the gate/);

  const byHand = fakeGh();
  seedFeature(byHand, { commits: [{ sha: '1'.repeat(40), parents: ['0'.repeat(40)] }], gateComment: false });
  assert.match(JSON.stringify((await rbJson(root, ['merge-gate', '20', '--human-approved', '--dry-run'], { ghRunner: byHand.runner })).json.reasons), /#11 was merged into rb\/feature-01-budgets outside rb merge-gate/);

  const foreign = fakeGh();
  seedFeature(foreign, { commits: [{ sha: '1'.repeat(40), parents: ['0'.repeat(40)] }, { sha: '2'.repeat(40), parents: ['1'.repeat(40), '9'.repeat(40)] }] });
  foreign.state.compare.main = { status: 'diverged' };
  assert.match(JSON.stringify((await rbJson(root, ['merge-gate', '20', '--human-approved', '--dry-run'], { ghRunner: foreign.runner })).json.reasons), /merge 2222222 .*does not bring in main/);

  const noAudit = fakeGh();
  seedFeature(noAudit, { commits: [{ sha: '1'.repeat(40), parents: ['0'.repeat(40)] }], auditor: false });
  assert.match(JSON.stringify((await rbJson(root, ['merge-gate', '20', '--human-approved', '--dry-run'], { ghRunner: noAudit.runner })).json.reasons), /missing rb-auditor line/);
});

test('G4: profile minimal: levels 1 and 2 on CI alone, level 3 verifier and security, read at the base', async () => {
  assert.equal(profileOf('Profile: minimal  # CI and tests'), 'minimal');
  assert.equal(profileOf('Profile: none'), 'full');
  assert.equal(profileOf(null), 'full');
  assert.deepEqual(requiredReviews({ level: 2, profile: 'minimal', userVisible: true }), []);
  assert.deepEqual(requiredReviews({ level: 3, profile: 'minimal' }), ['rb-verifier', 'rb-security-reviewer']);
  assert.deepEqual(requiredReviews({ level: 2, userVisible: true }), ['rb-verifier', 'rb-auditor']);
  assert.deepEqual(requiredReviews({ level: 2, userVisible: true, featureBase: true }), ['rb-verifier']);
  assert.deepEqual(requiredReviews({ level: 1 }), []);

  const root = project();
  const gh = fakeGh();
  seedTask(gh, { stages: [] });
  gh.state.contents[`${'b'.repeat(40)}:AGENTS.md`] = AGENTS('Profile: minimal\n');
  const r = await gate(root, gh);
  assert.equal(r.code, 0, JSON.stringify(r.json.reasons));
  assert.deepEqual(r.json.needs, []);
  assert.equal(r.json.profile, 'minimal');

  // The head cannot pick its own profile: only the base counts.
  const head = fakeGh();
  seedTask(head, { stages: [] });
  const root2 = project('Profile: minimal\n');
  const h = await gate(root2, head);
  assert.match(JSON.stringify(h.json.reasons), /missing rb-verifier line/);
});

test('G4: doctor warns about an unknown profile', async () => {
  const root = project('Profile: light\n');
  const r = await rbJson(root, ['doctor']);
  assert.match(JSON.stringify(r.json), /Profile: light is not full, minimal or none/);
});


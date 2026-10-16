// 0.9.0: the merge queue (rb queue build, and the gate accepting a queued PR behind its base).
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { makeGh } from '../scripts/lib/gh.mjs';
import { queuedBehind } from '../scripts/lib/merge.mjs';
import { REPO, cleanup, commitAll, fakeGh, rbJson, repoWith, sh, tmp, write } from './rb-helpers.mjs';

after(cleanup);

// A project with a bare origin and two PR branches touching different files.
function project() {
  const root = repoWith({ 'AGENTS.md': '# App\n\nDefault branch: main\n', 'src/a.js': 'a\n', 'src/b.js': 'b\n', '.gitignore': '.rockbuilt/\n' });
  const bare = tmp();
  sh(bare, 'git', ['init', '-q', '--bare', '-b', 'main']);
  sh(root, 'git', ['remote', 'add', 'origin', bare]);
  sh(root, 'git', ['push', '-q', 'origin', 'main']);
  const branch = (name, file, text) => {
    sh(root, 'git', ['checkout', '-q', '-b', name, 'main']);
    write(root, file, text);
    const sha = commitAll(root, name);
    sh(root, 'git', ['push', '-q', 'origin', name]);
    return sha;
  };
  const h10 = branch('rb/T1-a', 'src/a.js', 'a2\n');
  const h11 = branch('rb/T2-b', 'src/b.js', 'b2\n');
  const h12 = branch('rb/T3-clash', 'src/a.js', 'a3\n');
  sh(root, 'git', ['checkout', '-q', 'main']);
  sh(root, 'git', ['fetch', '-q', 'origin']);
  const gh = fakeGh();
  const pr = (n, head, sha) => {
    gh.state.issues[n] = { number: n, title: `PR ${n}`, body: '', state: 'open', labels: [], isPr: true };
    gh.state.pulls[n] = { number: n, head, base: 'main', headSha: sha };
  };
  pr(10, 'rb/T1-a', h10);
  pr(11, 'rb/T2-b', h11);
  pr(12, 'rb/T3-clash', h12);
  return { root, bare, gh, h10, h11, h12 };
}

const info = (bare, ref) => {
  const sha = sh(bare, 'git', ['rev-parse', ref]);
  const parents = sh(bare, 'git', ['rev-list', '--parents', '-n', '1', sha]).split(' ').slice(1);
  return { sha, tree: sh(bare, 'git', ['rev-parse', `${sha}^{tree}`]), parents };
};

test('rb queue build merges PRs in order on the base tip, skips a conflicting one, records each position', async () => {
  const { root, bare, gh, h10, h11 } = project();
  const r = await rbJson(root, ['queue', 'build', '--run', 'cycle-x', '--prs', '10,12,11', '--repo', REPO], { ghRunner: gh.runner });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.included.map((x) => x.pr), [10, 11]);
  assert.deepEqual(r.json.skipped, [{ pr: 12, reason: 'conflicts with the PRs before it' }]);
  assert.match(r.json.branch, /^rb\/queue-cycle-x-/);
  assert.equal(sh(bare, 'git', ['rev-parse', r.json.branch]), r.json.head);
  // Each queue step is a merge of the previous step and the PR head.
  const [s1, s2] = r.json.included;
  assert.deepEqual(info(bare, s1.step).parents, [r.json.base, h10]);
  assert.deepEqual(info(bare, s2.step).parents, [s1.step, h11]);
  assert.match(gh.state.comments[10][0].body, new RegExp(`rockbuilt:queue run=cycle-x branch=\\S+ head=${r.json.head} base=${r.json.base} prefix=${r.json.base} step=${s1.step} pr-head=${h10}`));
  assert.equal(gh.state.comments[12], undefined, 'no record on a skipped PR');
  assert.equal((await rbJson(root, ['queue', 'build', '--run', 'cycle-x', '--prs', '10', '--repo', REPO], { ghRunner: gh.runner })).code, 2, 'one PR is not a queue');
});

test('the gate accepts a queued PR behind its base only when every link checks out through GitHub', async () => {
  const { root, bare, gh, h11 } = project();
  const q = (await rbJson(root, ['queue', 'build', '--run', 'cycle-y', '--prs', '10,11', '--repo', REPO], { ghRunner: gh.runner })).json;
  const [s1, s2] = q.included;
  const s = gh.state;
  const ci = [{ name: 'rockbuilt-ci', status: 'completed', conclusion: 'success', started_at: '2026-10-16T00:00:00Z' }];
  s.checkRuns[q.head] = ci;
  s.compare = { [q.head]: { behind_by: 0, ahead_by: 1 } };
  // PR 10 merged as tested: main now has the tree of the first step.
  const clone = tmp();
  sh(clone, 'git', ['clone', '-q', bare, '.']);
  sh(clone, 'git', ['config', 'user.email', 't@example.com']);
  sh(clone, 'git', ['config', 'user.name', 'T']);
  sh(clone, 'git', ['merge', '-q', '--squash', 'origin/rb/T1-a']);
  sh(clone, 'git', ['commit', '-q', '-m', 'PR 10 (#10)']);
  sh(clone, 'git', ['push', '-q', 'origin', 'main']);
  const setInfo = () => { s.commitInfo = Object.fromEntries([s1.step, s2.step, q.base, 'main'].map((ref) => [ref, info(bare, ref)])); };
  setInfo();
  const c = makeGh({ repo: REPO, runner: gh.runner });
  const view = { number: 11, base: { ref: 'main' } };
  let r = queuedBehind(root, c, view, h11);
  assert.equal(r.ok, true, r.detail);

  s.checkRuns[q.head] = [{ ...ci[0], conclusion: 'failure' }];
  r = queuedBehind(root, c, view, h11);
  assert.equal(r.ok, false);
  s.checkRuns[q.head] = ci;

  assert.equal(queuedBehind(root, c, view, 'e'.repeat(40)).ok, false, 'the PR head moved after queueing');

  // Something else merged into main first: its tree is no longer the queue's previous step.
  sh(clone, 'git', ['commit', '-q', '--allow-empty', '-m', 'other']);
  write(clone, 'src/c.js', 'c\n');
  commitAll(clone, 'other change');
  sh(clone, 'git', ['push', '-q', 'origin', 'main']);
  setInfo();
  r = queuedBehind(root, c, view, h11);
  assert.equal(r.ok, false);
  assert.match(r.detail, /not the queue's previous step/);

  // A record written by an outside commenter is ignored.
  s.comments[10] = [{ id: 99, body: s.comments[11][0].body, user: { login: 'x' }, author_association: 'NONE' }];
  assert.equal(queuedBehind(root, c, { number: 10, base: { ref: 'main' } }, h11), null);

  const done = await rbJson(root, ['queue', 'done', '--run', 'cycle-y', '--repo', REPO], { ghRunner: gh.runner });
  assert.deepEqual(done.json.deleted, [q.branch]);
});

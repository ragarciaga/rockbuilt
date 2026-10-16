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

// GitHub's test merge of a PR head into the base tip, built in the bare repo.
const testMerge = (bare, base, head) => {
  const tree = sh(bare, 'git', ['merge-tree', '--write-tree', base, head]).split('\n')[0];
  return sh(bare, 'git', ['-c', 'user.name=G', '-c', 'user.email=g@x', 'commit-tree', tree, '-p', sh(bare, 'git', ['rev-parse', base]), '-p', head, '-m', 'test merge']);
};

test('rb queue build merges PRs in order on the base tip, one branch per step, skips conflicts and stacks', async () => {
  const { root, bare, gh, h10, h11 } = project();
  const r = await rbJson(root, ['queue', 'build', '--run', 'cycle-x', '--prs', '10,12,11', '--repo', REPO], { ghRunner: gh.runner });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.included.map((x) => x.pr), [10, 11]);
  assert.deepEqual(r.json.skipped, [{ pr: 12, reason: 'conflicts with the PRs before it' }]);
  const [s1, s2] = r.json.included;
  assert.match(s1.branch, /^rb\/queue-cycle-x-[0-9a-z]+-1$/);
  assert.equal(sh(bare, 'git', ['rev-parse', s1.branch]), s1.step, 'every step is pushed for its own CI run');
  assert.equal(sh(bare, 'git', ['rev-parse', s2.branch]), s2.step);
  assert.deepEqual(info(bare, s1.step).parents, [r.json.base, h10]);
  assert.deepEqual(info(bare, s2.step).parents, [s1.step, h11]);
  assert.match(gh.state.comments[11][0].body, new RegExp(`rockbuilt:queue run=cycle-x branch=${s2.branch} step=${s2.step} prefix=${s1.step} base=${r.json.base} pr-head=${h11}`));
  assert.equal(gh.state.comments[12], undefined, 'no record on a skipped PR');
  assert.equal((await rbJson(root, ['queue', 'build', '--run', 'cycle-x', '--prs', '10', '--repo', REPO], { ghRunner: gh.runner })).code, 2, 'one PR is not a queue');
  assert.equal((await rbJson(root, ['queue', 'build', '--run', 'a:b', '--prs', '10,11', '--repo', REPO], { ghRunner: gh.runner })).code, 2, 'run ids become branch names');

  // A PR stacked on a queued one is never queued (its queue merge and GitHub's squash differ).
  sh(root, 'git', ['checkout', '-q', '-b', 'rb/T4-stacked', 'origin/rb/T1-a']);
  write(root, 'src/a.js', 'a2-more\n');
  const h13 = commitAll(root, 'stacked');
  sh(root, 'git', ['push', '-q', 'origin', 'rb/T4-stacked']);
  sh(root, 'git', ['checkout', '-q', 'main']);
  gh.state.issues[13] = { number: 13, title: 'PR 13', body: '', state: 'open', labels: [], isPr: true };
  gh.state.pulls[13] = { number: 13, head: 'rb/T4-stacked', base: 'main', headSha: h13 };
  const st = await rbJson(root, ['queue', 'build', '--run', 'cycle-z', '--prs', '10,13,11', '--repo', REPO], { ghRunner: gh.runner });
  assert.deepEqual(st.json.skipped, [{ pr: 13, reason: 'stacked on #10: merge it serially' }]);
});

test('the gate accepts a queued PR behind its base only when GitHub would land the tested step', async () => {
  const { root, bare, gh, h11 } = project();
  const q = (await rbJson(root, ['queue', 'build', '--run', 'cycle-y', '--prs', '10,11', '--repo', REPO], { ghRunner: gh.runner })).json;
  const [s1, s2] = q.included;
  const s = gh.state;
  const run = (over = {}) => [{ id: 1, name: 'rockbuilt-ci', event: 'push', head_branch: s2.branch, head_sha: s2.step, status: 'completed', conclusion: 'success', created_at: '2026-10-16T00:00:00Z', ...over }];
  s.workflowRuns = run();
  // PR 10 merged as tested: squash with the tree of the first step.
  const squash = sh(bare, 'git', ['-c', 'user.name=G', '-c', 'user.email=g@x', 'commit-tree', `${s1.step}^{tree}`, '-p', q.base, '-m', 'PR 10 (#10)']);
  sh(bare, 'git', ['update-ref', 'refs/heads/main', squash]);
  const c = makeGh({ repo: REPO, runner: gh.runner });
  const at = (tm) => {
    s.commitInfo = Object.fromEntries([s1.step, s2.step, q.base, 'main', tm].map((ref) => [ref, info(bare, ref)]));
    return { number: 11, base: { ref: 'main' }, mergeable: true, merge_commit_sha: tm };
  };
  let view = at(testMerge(bare, 'main', h11));
  let r = queuedBehind(root, c, view, h11);
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.record.stepTree, info(bare, s2.step).tree);

  s.workflowRuns = run({ conclusion: 'failure' });
  assert.equal(queuedBehind(root, c, view, h11).ok, false);
  s.workflowRuns = run({ status: 'in_progress', conclusion: null });
  r = queuedBehind(root, c, view, h11);
  assert.equal(r.retry, true, 'pending CI on the step is a retry, not a failure');
  // A green pull_request run on the same sha tested another tree: it never counts.
  s.workflowRuns = [...run({ conclusion: 'failure' }), ...run({ id: 2, event: 'pull_request', head_branch: 'evil', created_at: '2026-10-16T01:00:00Z' })];
  assert.equal(queuedBehind(root, c, view, h11).ok, false);
  s.workflowRuns = run({ head_branch: 'rb/queue-other-1' });
  assert.equal(queuedBehind(root, c, view, h11).retry, true, 'a run on another branch does not count');
  s.workflowRuns = run();

  assert.equal(queuedBehind(root, c, view, 'e'.repeat(40)).ok, false, 'the PR head moved after queueing');
  assert.equal(queuedBehind(root, c, { ...view, mergeable: null }, h11).retry, true, 'test merge not computed yet');

  // Something else merged into main first: GitHub's test merge no longer has the step's tree.
  const clone = tmp();
  sh(clone, 'git', ['clone', '-q', bare, '.']);
  sh(clone, 'git', ['config', 'user.email', 't@example.com']);
  sh(clone, 'git', ['config', 'user.name', 'T']);
  write(clone, 'src/c.js', 'c\n');
  commitAll(clone, 'other change');
  sh(clone, 'git', ['push', '-q', 'origin', 'main']);
  view = at(testMerge(bare, 'main', h11));
  r = queuedBehind(root, c, view, h11);
  assert.equal(r.ok, false);
  assert.match(r.detail, /differs from the tested queue step/);

  // A record written by an outside commenter is ignored.
  s.comments[10] = [{ id: 99, body: s.comments[11][0].body, user: { login: 'x' }, author_association: 'NONE' }];
  assert.equal(queuedBehind(root, c, { number: 10, base: { ref: 'main' } }, h11), null);

  const done = await rbJson(root, ['queue', 'done', '--run', 'cycle-y', '--repo', REPO], { ghRunner: gh.runner });
  assert.deepEqual(done.json.deleted.sort(), [s1.branch, s2.branch].sort());
});

// rb bookkeeping carry|save (0.7.0, from the 3d_brain run of 2026-10-15).
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { REPO, cleanup, commitAll, fakeGh, read, rbJson, repoWith, sh, tmp, withEnv, write } from './rb-helpers.mjs';

after(cleanup);

const TASKS = '# Tasks\n\n## T1: One\n- Status: todo\n\n### Decision log\n';

function project() {
  const root = repoWith({ 'AGENTS.md': '# App\n\nDefault branch: main\n', 'docs/specs/01-x/tasks.md': TASKS, 'docs/progress.md': '# Progress\n', '.claude/LESSONS.md': '# Lessons\n', '.gitignore': '.rockbuilt/\n' });
  const bare = tmp();
  sh(bare, 'git', ['init', '-q', '--bare', '-b', 'main']);
  sh(root, 'git', ['remote', 'add', 'origin', bare]);
  sh(root, 'git', ['push', '-q', 'origin', 'main']);
  sh(root, 'git', ['fetch', '-q', 'origin']);
  return { root, bare };
}

const io = (gh) => ({ ghRunner: gh.runner });
const args = (more) => [...more, '--repo', REPO];

test('bookkeeping save: pushes the day branch from a temporary worktree, opens one PR, keeps the checkout as it is', async () => {
  const { root, bare } = project();
  const gh = fakeGh();
  await withEnv({ RB_NOW: '2026-10-15T12:00:00Z' }, async () => {
    write(root, 'docs/specs/01-x/tasks.md', TASKS.replace('todo', 'in-progress'));
    let r = await rbJson(root, args(['bookkeeping', 'save', '--run', 'cycle-a']), io(gh));
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.branch, 'rb/bookkeeping-2026-10-15');
    assert.equal(r.json.created, true);
    assert.deepEqual(r.json.files, ['docs/specs/01-x/tasks.md']);
    assert.match(sh(bare, 'git', ['show', 'rb/bookkeeping-2026-10-15:docs/specs/01-x/tasks.md']), /in-progress/);
    assert.match(read(root, 'docs/specs/01-x/tasks.md'), /in-progress/, 'the run keeps reading its edits');
    assert.equal(sh(root, 'git', ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');

    // Second save in the same run: same branch, same PR, a fast-forward on the remote.
    const before = sh(bare, 'git', ['rev-parse', 'rb/bookkeeping-2026-10-15']);
    write(root, 'docs/progress.md', '# Progress\n\n- 2026-10-15: T1 in review.\n');
    write(root, '.claude/LESSONS.md', '# Lessons\n\n- new\n');
    write(root, 'docs/specs/02-draft/tasks.md', '# Draft\n');
    r = await rbJson(root, args(['bookkeeping', 'save', '--run', 'cycle-a', '--final']), io(gh));
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.created, false);
    assert.equal(Object.values(gh.state.pulls).length, 1);
    sh(bare, 'git', ['merge-base', '--is-ancestor', before, 'rb/bookkeeping-2026-10-15']);
    assert.match(sh(bare, 'git', ['show', 'rb/bookkeeping-2026-10-15:.claude/LESSONS.md']), /new/);
    assert.match(sh(bare, 'git', ['show', 'rb/bookkeeping-2026-10-15:docs/specs/01-x/tasks.md']), /in-progress/, 'earlier edits stay');
    // --final leaves the tracked files clean (cloud stop hooks ask for one); an untracked draft is
    // the user's: never pushed, never deleted.
    assert.equal(sh(root, 'git', ['status', '--porcelain']), '?? docs/specs/02-draft/');
    assert.equal(read(root, 'docs/specs/02-draft/tasks.md'), '# Draft\n');
    // Nothing else entered the branch.
    assert.deepEqual(sh(bare, 'git', ['diff', '--name-only', 'main...rb/bookkeeping-2026-10-15']).split('\n').sort(), ['.claude/LESSONS.md', 'docs/progress.md', 'docs/specs/01-x/tasks.md']);

    // Nothing changed: no push, no PR.
    r = await rbJson(root, args(['bookkeeping', 'save', '--run', 'cycle-a']), io(gh));
    assert.equal(r.json.saved, false);
  });
});

test('bookkeeping carry: applies the open PR and the next save lands on top of it (one PR per day)', async () => {
  const { root, bare } = project();
  const gh = fakeGh();
  await withEnv({ RB_NOW: '2026-10-16T03:00:00Z' }, async () => {
    // Yesterday's run left an open bookkeeping PR.
    sh(root, 'git', ['checkout', '-q', '-b', 'rb/bookkeeping-2026-10-15']);
    write(root, 'docs/progress.md', '# Progress\n\n- 2026-10-15: night one.\n');
    commitAll(root, 'docs: progress');
    sh(root, 'git', ['push', '-q', 'origin', 'rb/bookkeeping-2026-10-15']);
    sh(root, 'git', ['checkout', '-q', 'main']);
    gh.state.issues[5] = { number: 5, title: 'docs: progress', body: '', state: 'open', labels: [], isPr: true };
    gh.state.pulls[5] = { number: 5, head: 'rb/bookkeeping-2026-10-15', base: 'main', headSha: 'e'.repeat(40) };

    let r = await rbJson(root, args(['bookkeeping', 'carry', '--run', 'cycle-b']), io(gh));
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.carried, true);
    assert.match(read(root, 'docs/progress.md'), /night one/);

    write(root, 'docs/progress.md', `${read(root, 'docs/progress.md')}- 2026-10-16: night two.\n`);
    const old = sh(bare, 'git', ['rev-parse', 'rb/bookkeeping-2026-10-15']);
    r = await rbJson(root, args(['bookkeeping', 'save', '--run', 'cycle-b']), io(gh));
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.branch, 'rb/bookkeeping-2026-10-15');
    assert.equal(r.json.pr, 5);
    assert.equal(r.json.created, false);
    sh(bare, 'git', ['merge-base', '--is-ancestor', old, 'rb/bookkeeping-2026-10-15']);
    const text = sh(bare, 'git', ['show', 'rb/bookkeeping-2026-10-15:docs/progress.md']);
    assert.match(text, /night one[\s\S]*night two/);
  });
});

test('bookkeeping carry: a PR that does not apply is left alone and the run gets its own branch', async () => {
  const { root } = project();
  const gh = fakeGh();
  await withEnv({ RB_NOW: '2026-10-16T03:00:00Z' }, async () => {
    sh(root, 'git', ['checkout', '-q', '-b', 'rb/bookkeeping-2026-10-15']);
    write(root, 'docs/progress.md', '# Progress\n\n- old line\n');
    commitAll(root, 'docs: progress');
    sh(root, 'git', ['push', '-q', 'origin', 'rb/bookkeeping-2026-10-15']);
    sh(root, 'git', ['checkout', '-q', 'main']);
    write(root, 'docs/progress.md', '# Progress rewritten on main\n');
    commitAll(root, 'main rewrites progress');
    sh(root, 'git', ['push', '-q', 'origin', 'main']);
    gh.state.issues[5] = { number: 5, title: 'docs: progress', body: '', state: 'open', labels: [], isPr: true };
    gh.state.pulls[5] = { number: 5, head: 'rb/bookkeeping-2026-10-15', base: 'main', headSha: 'e'.repeat(40) };
    const r = await rbJson(root, args(['bookkeeping', 'carry', '--run', 'cycle-c']), io(gh));
    assert.equal(r.code, 3);
    assert.equal(r.json.carried, false);
    assert.equal(sh(root, 'git', ['status', '--porcelain']), '', 'checkout untouched');
    write(root, 'docs/progress.md', '# Progress rewritten on main\n\n- night three\n');
    const s = await rbJson(root, args(['bookkeeping', 'save', '--run', 'cycle-c']), io(gh));
    assert.equal(s.json.branch, 'rb/bookkeeping-2026-10-16');
  });
});

test('bookkeeping save: what main gained during the run stays (the patch is against HEAD, never whole files)', async () => {
  const { root } = project();
  const gh = fakeGh();
  await withEnv({ RB_NOW: '2026-10-15T12:00:00Z' }, async () => {
    write(root, 'docs/specs/01-x/tasks.md', TASKS.replace('todo', 'in-progress'));
    // Someone merges a progress line on GitHub; the checkout does not pull.
    const other = tmp();
    sh(other, 'git', ['clone', '-q', sh(root, 'git', ['remote', 'get-url', 'origin']), '.']);
    sh(other, 'git', ['config', 'user.email', 't@example.com']);
    sh(other, 'git', ['config', 'user.name', 'T']);
    write(other, 'docs/progress.md', '# Progress\n\n- merged elsewhere\n');
    commitAll(other, 'elsewhere');
    sh(other, 'git', ['push', '-q', 'origin', 'main']);
    const r = await rbJson(root, args(['bookkeeping', 'save', '--run', 'cycle-d']), io(gh));
    assert.equal(r.code, 0, r.err);
    const bare = sh(root, 'git', ['remote', 'get-url', 'origin']);
    assert.match(sh(bare, 'git', ['show', `${r.json.branch}:docs/progress.md`]), /merged elsewhere/, 'not reverted');
    assert.deepEqual(sh(bare, 'git', ['diff', '--name-only', `main...${r.json.branch}`]).split('\n'), ['docs/specs/01-x/tasks.md']);
    // Without GitHub nothing is pushed: a branch with no PR would never be carried.
    const off = await rbJson(root, ['bookkeeping', 'save', '--run', 'cycle-d']);
    assert.equal(off.code, 3);
  });
});

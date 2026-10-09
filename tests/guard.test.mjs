import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decide, protectedPathReason, roleOf, splitCommands } from '../hooks/guard.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard.mjs');

// Fake git: /repo is on a feature branch, /repo-main is on main, /other-repo uses "trunk".
function fakeEnv({ current = 'rb/T1-login', defaults = ['main'] } = {}) {
  return {
    currentBranch: (dir) => {
      if (dir.endsWith('repo-main')) return 'main';
      if (dir.endsWith('detached')) return null;
      return current;
    },
    defaultBranches: (dir) => (dir.endsWith('other-repo') ? ['trunk'] : defaults),
  };
}

const bash = (command, agent, cwd = '/repo') => ({ tool_name: 'Bash', tool_input: { command }, agent_type: agent, cwd });
const edit = (file_path, agent, tool = 'Edit', cwd = '/repo') => ({ tool_name: tool, tool_input: { file_path }, agent_type: agent, cwd });

// [label, input, expectDeny, env?]
const CASES = [
  // Main session: normal work allowed.
  ['main: git status', bash('git status'), false],
  ['main: npm test', bash('npm test'), false],
  ['main: commit', bash('git add -A && git commit -m "feat: x"'), false],
  ['main: push feature branch', bash('git push -u origin rb/T1-login'), false],
  ['main: bare push on feature branch', bash('git push'), false],
  ['main: push HEAD on feature branch', bash('git push origin HEAD'), false],
  ['main: gh pr create', bash('gh pr create --fill'), false],
  ['main: gh pr merge (ask rule, not hook)', bash('gh pr merge 12 --squash'), false],
  ['main: edit CLAUDE.md', edit('/repo/CLAUDE.md'), false],
  ['main: edit .claude/settings.json', edit('/repo/.claude/settings.json'), false],
  ['main: push branch named main-feature', bash('git push origin main-feature'), false],
  ['main: echo mentioning git push origin main', bash('echo "remember: git push origin main is denied"'), false],
  ['main: grep for push', bash("grep -rn 'git push' docs/"), false],
  ['main: git fetch', bash('git fetch origin main'), false],
  ['main: pull main', bash('git pull origin main'), false],
  ['main: push to non-default in other repo', bash('git push origin main', undefined, '/other-repo'), false],
  ['main: push to tag', bash('git push origin v1.0.0'), false],
  ['main: delete remote feature branch', bash('git push origin :rb/T1-login'), false],
  ['main: unknown current branch, bare push', bash('git push', undefined, '/detached'), false],

  // Push to default branch: everyone.
  ['push origin main', bash('git push origin main'), true],
  ['push origin master with fallback defaults', bash('git push origin master'), true, fakeEnv({ defaults: ['main', 'master'] })],
  ['push HEAD:main', bash('git push origin HEAD:main'), true],
  ['push refs/heads/main', bash('git push origin HEAD:refs/heads/main'), true],
  ['push feature:main', bash('git push origin rb/T1:main'), true],
  ['push MAIN uppercase', bash('git push origin MAIN'), true],
  ['bare push while on main', bash('git push', undefined, '/repo-main'), true],
  ['push origin HEAD while on main', bash('git push origin HEAD', undefined, '/repo-main'), true],
  ['push -u origin @ while on main', bash('git push -u origin @', undefined, '/repo-main'), true],
  ['push to trunk in repo whose default is trunk', bash('git push origin trunk', undefined, '/other-repo'), true],
  ['push --all', bash('git push --all origin'), true],
  ['env prefix', bash('FOO=1 BAR=2 git push origin main'), true],
  ['env command', bash('env GIT_TRACE=1 git push origin main'), true],
  ['git -C path push', bash('git -C /repo-main push'), true],
  ['git -C relative push', bash('git -C ../x push origin main'), true],
  ['cd into repo then push', bash('cd /repo-main && git push'), true],
  ['compound &&', bash('npm test && git push origin main'), true],
  ['compound ||', bash('false || git push origin main'), true],
  ['compound ;', bash('echo hi; git push origin main'), true],
  ['pipe', bash('echo y | git push origin main'), true],
  ['newline', bash('npm test\ngit push origin main'), true],
  ['bash -c', bash('bash -c "git push origin main"'), true],
  ['sh -c single quotes', bash("sh -c 'git status && git push origin main'"), true],
  ['nested bash -c', bash(`bash -c "sh -c 'git push origin main'"`), true],
  ['eval', bash('eval "git push origin main"'), true],
  ['subshell parens', bash('(git push origin main)'), true],
  ['command substitution', bash('echo $(git push origin main)'), true],
  ['substitution inside double quotes', bash('echo "$(git push origin main)"'), true],
  ['backticks', bash('echo `git push origin main`'), true],
  ['git.exe on windows', bash('git.exe push origin main'), true],
  ['absolute git path', bash('/usr/bin/git push origin main'), true],
  ['quoted refspec', bash('git push origin "HEAD:main"'), true],
  ['git -c option before push', bash('git -c core.x=y push origin main'), true],
  ['push with -o option', bash('git push -o ci.skip origin main'), true],
  ['line continuation', bash('git push \\\n  origin main'), true],

  // Force push: everyone.
  ['force -f', bash('git push -f origin rb/T1-login'), true],
  ['force --force', bash('git push --force origin rb/T1-login'), true],
  ['force-with-lease', bash('git push --force-with-lease origin rb/T1-login'), true],
  ['force-with-lease=ref', bash('git push --force-with-lease=rb/T1:abc origin rb/T1-login'), true],
  ['force combined -uf', bash('git push -uf origin rb/T1-login'), true],
  ['force +refspec', bash('git push origin +rb/T1-login'), true],
  ['force +main', bash('git push origin +main'), true],
  ['force inside bash -c', bash('bash -c "git push --force"'), true],

  // implementer, e2e-writer: no git, no gh.
  ['implementer npm test', bash('npm test', 'rockbuilt:implementer'), false],
  ['implementer node script', bash('node scripts/x.mjs && npx tsc --noEmit', 'implementer'), false],
  ['implementer rb timing', bash('rb verify-cmds', 'rockbuilt:implementer'), false],
  ['implementer git status', bash('git status', 'rockbuilt:implementer'), true],
  ['implementer git commit', bash('git commit -m x', 'implementer'), true],
  ['implementer gh', bash('gh issue list', 'rockbuilt:implementer'), true],
  ['implementer git via bash -c', bash('bash -c "git log"', 'rockbuilt:implementer'), true],
  ['implementer git via env prefix', bash('GIT_DIR=x git add .', 'implementer'), true],
  ['e2e-writer git', bash('git diff', 'rockbuilt:e2e-writer'), true],
  ['e2e-writer playwright', bash('npx playwright test', 'rockbuilt:e2e-writer'), false],
  ['implementer edits src', edit('/repo/src/a.ts', 'rockbuilt:implementer'), false],
  ['implementer writes test', edit('src/a.test.ts', 'implementer', 'Write'), false],

  // Read-only git roles.
  ['verifier git diff', bash('git diff main...HEAD', 'rockbuilt:verifier'), false],
  ['verifier git restore', bash('git restore src/a.ts', 'rockbuilt:verifier'), false],
  ['verifier git log', bash('git --no-pager log --oneline -5', 'verifier'), false],
  ['verifier npm test', bash('npm test', 'rockbuilt:verifier'), false],
  ['scout ls-files', bash('git ls-files | head', 'rockbuilt:scout'), false],
  ['scout git -C show', bash('git -C sub show HEAD', 'rockbuilt:scout'), false],
  ['security-reviewer blame', bash('git blame src/auth.ts', 'rockbuilt:security-reviewer'), false],
  ['healer merge-base', bash('git merge-base HEAD main', 'healer'), false],
  ['verifier git commit', bash('git commit -am x', 'rockbuilt:verifier'), true],
  ['verifier git checkout', bash('git checkout main', 'rockbuilt:verifier'), true],
  ['verifier git stash', bash('git status && git stash', 'rockbuilt:verifier'), true],
  ['verifier gh', bash('gh pr view 3', 'rockbuilt:verifier'), true],
  ['scout git push feature', bash('git push origin rb/x', 'rockbuilt:scout'), true],
  ['planner git reset', bash('git reset --hard', 'rockbuilt:planner'), true],
  ['task-reviewer gh api', bash('gh api repos/x/y', 'rockbuilt:task-reviewer'), true],
  ['healer git clean via sh -c', bash("sh -c 'git clean -fd'", 'rockbuilt:healer'), true],

  // No-write roles.
  ['scout Edit', edit('/repo/src/a.ts', 'rockbuilt:scout'), true],
  ['planner Write', edit('/repo/docs/plan.md', 'planner', 'Write'), true],
  ['task-reviewer MultiEdit', edit('/repo/x.ts', 'rockbuilt:task-reviewer', 'MultiEdit'), true],
  ['healer Write', edit('/repo/e2e/a.spec.ts', 'rockbuilt:healer', 'Write'), true],
  ['security-reviewer NotebookEdit', { tool_name: 'NotebookEdit', tool_input: { notebook_path: '/repo/n.ipynb' }, agent_type: 'rockbuilt:security-reviewer', cwd: '/repo' }, true],
  ['verifier may Edit src (mutation probe)', edit('/repo/src/a.ts', 'rockbuilt:verifier'), false],

  // Protected paths for every subagent.
  ['implementer edits CLAUDE.md', edit('/repo/CLAUDE.md', 'rockbuilt:implementer'), true],
  ['implementer edits nested claude.md lowercase', edit('/repo/pkg/claude.md', 'implementer'), true],
  ['implementer edits .claude/settings.json', edit('/repo/.claude/settings.json', 'rockbuilt:implementer', 'Write'), true],
  ['implementer edits .rockbuilt/baseline.json', edit('/repo/.rockbuilt/baseline.json', 'implementer'), true],
  ['implementer edits workflow', edit('/repo/.github/workflows/ci.yml', 'rockbuilt:implementer'), true],
  ['implementer edits relative ./.claude', edit('./.claude/LESSONS.md', 'implementer'), true],
  ['windows backslash .claude', edit('C:\\work\\repo\\.claude\\settings.json', 'rockbuilt:implementer', 'Edit', 'C:\\work\\repo'), true],
  ['windows mixed case .Claude', edit('C:\\work\\repo\\.Claude\\settings.json', 'implementer', 'Edit', 'C:\\work\\repo'), true],
  ['windows .GITHUB\\Workflows', edit('C:\\work\\repo\\.GITHUB\\Workflows\\ci.yml', 'rockbuilt:implementer', 'Write', 'C:\\work\\repo'), true],
  ['windows CLAUDE.MD', edit('C:\\work\\repo\\CLAUDE.MD', 'implementer', 'Edit', 'C:\\work\\repo'), true],
  ['windows src allowed', edit('C:\\work\\repo\\src\\a.ts', 'implementer', 'Edit', 'C:\\work\\repo'), false],
  ['verifier edits .rockbuilt', edit('/repo/.rockbuilt/timing.jsonl', 'rockbuilt:verifier'), true],
  ['e2e-writer edits workflow', edit('/repo/.github/workflows/e2e.yml', 'rockbuilt:e2e-writer', 'Write'), true],
  ['implementer edits .github non-workflow', edit('/repo/.github/pull_request_template.md', 'implementer'), false],
  ['implementer file named claude.md.bak', edit('/repo/docs/CLAUDE.md.bak', 'implementer'), false],
  ['project living under ~/.claude is fine', edit('/home/u/.claude/projects/app/src/a.ts', 'implementer', 'Edit', '/home/u/.claude/projects/app'), false],

  // gh pr merge for subagents (roles not otherwise limited).
  ['unknown subagent gh pr merge', bash('gh pr merge 5 --squash', 'rockbuilt:custom'), true],
  ['unknown subagent gh -R x pr merge', bash('gh -R o/r pr merge 5', 'custom'), true],
  ['unknown subagent gh pr view', bash('gh pr view 5', 'custom'), false],
  ['general-purpose agent edits CLAUDE.md', edit('/repo/CLAUDE.md', 'general-purpose'), true],

  // Robustness.
  ['non-Bash non-write tool', { tool_name: 'Read', tool_input: { file_path: '/repo/CLAUDE.md' }, agent_type: 'scout', cwd: '/repo' }, false],
  ['missing tool_input', { tool_name: 'Bash', agent_type: 'implementer' }, false],
  ['non-string command', { tool_name: 'Bash', tool_input: { command: 42 }, cwd: '/repo' }, false],
  ['empty agent_type is main session', bash('git push origin rb/x', ''), false],
  ['null input', null, false],
];

for (const [label, input, expectDeny, env] of CASES) {
  test(`guard: ${label}`, () => {
    const r = decide(input, env || fakeEnv());
    assert.equal(r.deny, expectDeny, `reason: ${r.reason}`);
    if (expectDeny) assert.match(r.reason, /\S/);
  });
}

test('guard: case count is at least 60', () => {
  assert.ok(CASES.length >= 60, `only ${CASES.length} cases`);
});

test('roleOf compares the part after the last colon', () => {
  assert.equal(roleOf('rockbuilt:implementer'), 'implementer');
  assert.equal(roleOf('implementer'), 'implementer');
  assert.equal(roleOf('a:b:Verifier'), 'verifier');
  assert.equal(roleOf(undefined), null);
});

test('splitCommands handles quotes and separators', () => {
  assert.deepEqual(splitCommands('a "b c" && d \'e;f\'|g'), [['a', 'b c'], ['d', 'e;f'], ['g']]);
});

test('protectedPathReason normalizes Windows separators', () => {
  assert.equal(protectedPathReason('C:\\r\\.github\\workflows\\x.yml', 'C:\\r'), '.github/workflows/');
  assert.equal(protectedPathReason('src/a.ts', '/r'), null);
});

test('git lookups are injectable and memoized', () => {
  let calls = 0;
  const env = { currentBranch: () => { calls++; return 'main'; }, defaultBranches: () => ['main'] };
  const r = decide(bash('git push; git push origin HEAD'), env);
  assert.equal(r.deny, true);
  assert.equal(calls, 1);
});

function spawnHook(stdin) {
  return spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8' });
}

test('hook process: deny exits 2 with one stderr line', () => {
  const r = spawnHook(JSON.stringify(bash('git push --force origin x', 'rockbuilt:implementer')));
  assert.equal(r.status, 2);
  const lines = r.stderr.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^rockbuilt guard: /);
});

test('hook process: allow exits 0 silently', () => {
  const r = spawnHook(JSON.stringify(bash('npm test', 'rockbuilt:implementer')));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('hook process: malformed JSON exits 0', () => {
  const r = spawnHook('{not json');
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('hook process: empty stdin exits 0', () => {
  assert.equal(spawnHook('').status, 0);
});

test('hook process: real git lookup in a non-repo cwd falls back to main/master', () => {
  const input = { tool_name: 'Bash', tool_input: { command: 'git push origin master' }, cwd: path.parse(process.cwd()).root };
  const r = spawnHook(JSON.stringify(input));
  assert.equal(r.status, 2);
});

test('hook process: real git, bare push on the default branch of a fresh repo is denied', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const os = await import('node:os');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rb-guard-'));
  try {
    spawnSync('git', ['init', '-q', '-b', 'trunk'], { cwd: dir });
    writeFileSync(path.join(dir, 'CLAUDE.md'), '# X\n\nDefault branch: trunk\n');
    const onTrunk = spawnHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: dir }));
    assert.equal(onTrunk.status, 2);
    spawnSync('git', ['checkout', '-q', '-b', 'rb/T1-x'], { cwd: dir });
    const onFeature = spawnHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push -u origin rb/T1-x' }, cwd: dir }));
    assert.equal(onFeature.status, 0);
    const toMain = spawnHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, cwd: dir }));
    assert.equal(toMain.status, 0, 'main is not the default branch here');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

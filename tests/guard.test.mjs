import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  decide, detectTool, normalize, patchPaths, protectedPathReason, render, roleOf, sectionCommands, splitCommands,
} from '../hooks/guard.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard.mjs');
const NO_ENV = {}; // no ROCKBUILT_TOOL / ROCKBUILT_ROLE overrides

// Fake env: /repo is on a feature branch, /repo-main is on main, /other-repo uses "trunk".
function fakeEnv({ current = 'rb/T1-login', defaults = ['main'] } = {}) {
  return {
    currentBranch: (dir) => {
      if (dir.endsWith('repo-main')) return 'main';
      if (dir.endsWith('detached')) return null;
      return current;
    },
    defaultBranches: (dir) => (dir.endsWith('other-repo') ? ['trunk'] : defaults),
    contractCommands: () => ['npm run typecheck', 'npm run lint', 'npm run build', 'cd web && npm run check'],
  };
}

const bash = (command, agent, cwd = '/repo') => ({ tool_name: 'Bash', tool_input: { command }, agent_type: agent, cwd });
const edit = (file_path, agent, tool = 'Edit', cwd = '/repo') => ({ tool_name: tool, tool_input: { file_path }, agent_type: agent, cwd });
const read = (file_path, agent) => ({ tool_name: 'Read', tool_input: { file_path }, agent_type: agent, cwd: '/repo' });
const cursorShell = (command, extra = {}) => ({ hook_event_name: 'beforeShellExecution', command, cwd: '/repo', cursor_version: '2.0', workspace_roots: ['/repo'], ...extra });
const cursorRead = (file_path) => ({ hook_event_name: 'beforeReadFile', file_path, content: '', workspace_roots: ['/repo'] });
const cursorTool = (tool_name, tool_input, extra = {}) => ({ hook_event_name: 'preToolUse', tool_name, tool_input, cwd: '/repo', workspace_roots: ['/repo'], ...extra });
const codexBash = (command, extra = {}) => ({ hook_event_name: 'PreToolUse', turn_id: 't1', tool_name: 'Bash', tool_input: { command }, cwd: '/repo', ...extra });
const codexPatch = (patch, extra = {}) => ({ hook_event_name: 'PreToolUse', turn_id: 't1', tool_name: 'apply_patch', tool_input: { command: patch }, cwd: '/repo', ...extra });

const IMPL = 'rb-implementer';
const PLUG_IMPL = 'rockbuilt:rb-implementer';
const E2E = 'rb-e2e-writer';
const VER = 'rb-verifier';

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
  ['main: gh pr merge (permissions deny, not the hook)', bash('gh pr merge 12 --squash'), false],
  ['main: rb merge-gate', bash('node tools/rockbuilt/rb.mjs merge-gate 12'), false],
  ['main: rb gh issue-list', bash('node tools/rockbuilt/rb.mjs gh issue-list --label rb:task'), false],
  ['main: rb lock acquire', bash('node tools/rockbuilt/rb.mjs lock acquire --run r1'), false],
  ['main: edit CLAUDE.md', edit('/repo/CLAUDE.md'), false],
  ['main: edit .claude/settings.json', edit('/repo/.claude/settings.json'), false],
  ['main: echo into AGENTS.md', bash('echo "x" >> AGENTS.md'), false],
  ['main: push branch named main-feature', bash('git push origin main-feature'), false],
  ['main: echo mentioning git push origin main', bash('echo "remember: git push origin main is denied"'), false],
  ['main: grep for push', bash("grep -rn 'git push' docs/"), false],
  ['main: git fetch', bash('git fetch origin main'), false],
  ['main: pull main', bash('git pull origin main'), false],
  ['main: push to non-default in other repo', bash('git push origin main', undefined, '/other-repo'), false],
  ['main: push to tag', bash('git push origin v1.0.0'), false],
  ['main: delete remote feature branch', bash('git push origin :rb/T1-login'), false],
  ['main: unknown current branch, bare push', bash('git push', undefined, '/detached'), false],
  ['main: copy env example', bash('cp .env.example .env'), false],
  ['main: cat .env.example', bash('cat .env.example'), false],
  ['main: process.env in node -e', bash('node -e "console.log(process.env.NODE_ENV)"'), false],
  ['main: Read .env.example', read('/repo/.env.example'), false],
  ['main: Read src', read('/repo/src/a.ts'), false],

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
  ['push --mirror', bash('git push --mirror origin'), true],
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
  ['cmd /c', bash('cmd /c git push origin main'), true],
  ['pwsh -Command', bash('pwsh -Command "git push origin main"'), true],
  ['powershell -c', bash('powershell -c git push --force'), true],
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
  ['git -C force', bash('git -C sub push -f origin rb/x'), true],

  // .env reads: everyone.
  ['main: cat .env', bash('cat .env'), true],
  ['main: cat .env.local', bash('cat ./config/.env.local'), true],
  ['main: grep in .env', bash('grep API_KEY .env'), true],
  ['main: source .env', bash('source .env && npm start'), true],
  ['main: dot .env', bash('. ./.env'), true],
  ['main: input redirect from .env', bash('while read l; do echo $l; done < .env'), true],
  ['main: Get-Content .env', bash('Get-Content .env'), true],
  ['main: type .env (cmd)', bash('cmd /c type .env'), true],
  ['main: node -e reads .env', bash(`node -e "console.log(require('fs').readFileSync('.env','utf8'))"`), true],
  ['main: python -c reads .env', bash(`python3 -c "print(open('.env').read())"`), true],
  ['main: node --env-file -p', bash('node --env-file=.env -p process.env'), true],
  ['main: cat .env inside bash -c', bash('bash -c "cat .env"'), true],
  ['main: cp .env elsewhere', bash('cp .env /tmp/x'), true],
  ['main: Read tool .env', read('/repo/.env'), true],
  ['subagent: Read tool .env.production', read('/repo/.env.production', IMPL), true],

  // Write roles: no git, no gh, anywhere.
  ['implementer npm test', bash('npm test', IMPL), false],
  ['implementer node script', bash('node scripts/x.mjs && npx tsc --noEmit', IMPL), false],
  ['implementer rb verify-cmds', bash('node tools/rockbuilt/rb.mjs verify-cmds', IMPL), false],
  ['implementer path with git dir', bash('npm test -- src/git/client.test.ts', IMPL), false],
  ['implementer mentions .github in url', bash('curl -s https://api.github.com/zen', IMPL), false],
  ['implementer npm install simple-git', bash('npm run build', IMPL), false],
  ['implementer git status', bash('git status', IMPL), true],
  ['implementer plugin-prefixed name', bash('git status', PLUG_IMPL), true],
  ['implementer legacy name', bash('git status', 'implementer'), true],
  ['implementer legacy plugin name', bash('git commit -m x', 'rockbuilt:implementer'), true],
  ['implementer gh', bash('gh issue list', IMPL), true],
  ['implementer GIT uppercase', bash('GIT status', IMPL), true],
  ['implementer git via bash -c', bash('bash -c "git log"', IMPL), true],
  ['implementer git via env prefix', bash('GIT_DIR=x git add .', IMPL), true],
  ['bypass: node -e execSync git push', bash(`node -e "require('child_process').execSync('git push origin main')"`, IMPL), true],
  ['bypass: node -e spawn git.exe', bash(`node -e "require('child_process').spawnSync('git.exe',['commit'])"`, IMPL), true],
  ['bypass: npm exec -c gh pr merge', bash(`npm exec -c 'gh pr merge 12'`, IMPL), true],
  ['bypass: cmd /c git push', bash('cmd /c git push', IMPL), true],
  ['bypass: pwsh -Command git push', bash('pwsh -Command "git push"', IMPL), true],
  ['bypass: python subprocess gh', bash(`python3 -c "import subprocess; subprocess.run(['gh','pr','merge','1'])"`, IMPL), true],
  ['e2e-writer git', bash('git diff', E2E), true],
  ['e2e-writer playwright', bash('npx playwright test', E2E), false],

  // Write roles: shell writes to protected paths.
  ['bypass: echo >> CLAUDE.md', bash('echo "rule" >> CLAUDE.md', IMPL), true],
  ['bypass: echo>AGENTS.md no spaces', bash('echo x>AGENTS.md', IMPL), true],
  ['bypass: sed -i .claude/settings.json', bash("sed -i 's/deny/allow/' .claude/settings.json", IMPL), true],
  ['bypass: cp into .claude/agents', bash('cp /tmp/a.md .claude/agents/rb-verifier.md', IMPL), true],
  ['bypass: tee tools/rockbuilt', bash('echo x | tee tools/rockbuilt/guard.mjs', IMPL), true],
  ['bypass: node -e writeFileSync CLAUDE.md', bash(`node -e "require('fs').writeFileSync('CLAUDE.md','x')"`, IMPL), true],
  ['bypass: write workflow via shell', bash('printf x > .github/workflows/ci.yml', IMPL), true],
  ['bypass: windows path .Claude', bash('copy x ".Claude\\settings.json"', IMPL), true],
  ['bypass: echo into .env', bash('echo KEY=1 >> .env', IMPL), true],
  ['bypass: rm .cursor', bash('rm -r .cursor', E2E), true],
  ['implementer may cat CLAUDE.md', bash('cat CLAUDE.md', IMPL), false],
  ['implementer may grep AGENTS.md', bash('grep -n Verification AGENTS.md', IMPL), false],
  ['implementer CLAUDE.md.bak via shell', bash('cp a docs/CLAUDE.md.bak', IMPL), false],

  // Every subagent: privileged rb subcommands.
  ['implementer rb merge-gate', bash('node tools/rockbuilt/rb.mjs merge-gate 12', IMPL), true],
  ['implementer rb gh', bash('node tools/rockbuilt/rb.mjs gh pr-create --head x', IMPL), true],
  ['verifier rb lock', bash('node tools/rockbuilt/rb.mjs lock release --run r', VER), true],
  ['scout rb control', bash('node tools/rockbuilt/rb.mjs control ensure', 'rb-scout'), true],
  ['auditor rb digest', bash('node tools/rockbuilt/rb.mjs --json digest post --file d.md', 'rb-auditor'), true],
  ['unknown subagent rb escalate', bash('node tools/rockbuilt/rb.mjs escalate 3 --kind human', 'general-purpose'), true],
  ['unknown subagent rb revert', bash('node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" revert 4', 'Explore'), true],
  ['unknown subagent rb protect', bash('rb protect', 'custom'), true],
  ['unknown subagent rb vendor', bash('node tools/rockbuilt/rb.mjs vendor --tools cursor', 'custom'), true],
  ['unknown subagent rb baseline --accept', bash('node tools/rockbuilt/rb.mjs baseline --accept', 'custom'), true],
  ['unknown subagent rb merge-gate via node -e', bash(`node -e "require('child_process').execSync('node tools/rockbuilt/rb.mjs merge-gate 3')"`, 'custom'), true],
  // v0.3 review: .git hooks and config, verifier Write, Grep/Glob on .env, deploy and cloud CLIs.
  ['implementer edit .git/hooks/pre-push', edit('/repo/.git/hooks/pre-push', IMPL, 'Write'), true],
  ['implementer edit .git/config', edit('.git/config', IMPL), true],
  ['implementer edit .husky/pre-commit', edit('.husky/pre-commit', IMPL), true],
  ['verifier Write a new file', edit('src/new.ts', VER, 'Write'), true],
  ['verifier Edit probe allowed', edit('src/app.ts', VER), false],
  ['Grep with .env glob', { tool_name: 'Grep', tool_input: { pattern: 'KEY', glob: '.env*' }, cwd: '/repo' }, true],
  ['Grep on config/prod.env', { tool_name: 'Grep', tool_input: { pattern: 'KEY', path: 'config/prod.env' }, cwd: '/repo' }, true],
  ['Glob for .env files', { tool_name: 'Glob', tool_input: { pattern: '**/.env' }, cwd: '/repo' }, true],
  ['Grep in src allowed', { tool_name: 'Grep', tool_input: { pattern: 'x', path: 'src' }, cwd: '/repo' }, false],
  ['read config/prod.env', { tool_name: 'Read', tool_input: { file_path: 'config/prod.env' }, cwd: '/repo' }, true],
  ['main session vercel --prod', bash('vercel --prod'), true],
  ['main session plain vercel deploys', bash('vercel'), true],
  ['implementer npx vercel deploy', bash('npx -y vercel deploy', IMPL), true],
  ['pnpm dlx wrangler deploy', bash('pnpm dlx wrangler deploy'), true],
  ['supabase db push', bash('supabase db push'), true],
  ['supabase start allowed', bash('supabase start'), false],
  ['supabase gen types --linked', bash('supabase gen types typescript --linked'), true],
  ['aws s3 ls', bash('aws s3 ls'), true],
  ['terraform apply', bash('terraform apply -auto-approve'), true],
  ['terraform plan allowed', bash('terraform plan'), false],
  ['vercel dev allowed', bash('npx vercel dev'), false],
  ['unknown subagent rb risk allowed', bash('node tools/rockbuilt/rb.mjs risk --files a.ts', 'custom'), false],

  // gh merges for subagents (roles not otherwise limited).
  ['unknown subagent gh pr merge', bash('gh pr merge 5 --squash', 'rockbuilt:custom'), true],
  ['unknown subagent gh -R x pr merge', bash('gh -R o/r pr merge 5', 'custom'), true],
  ['unknown subagent gh api merge', bash('gh api -X PUT repos/o/r/pulls/5/merge', 'custom'), true],
  ['unknown subagent gh pr view', bash('gh pr view 5', 'custom'), false],

  // Read-only roles: allowlist.
  ['verifier git diff', bash('git diff main...HEAD', VER), false],
  ['verifier git restore one file', bash('git restore src/a.ts', VER), false],
  ['verifier git restore --staged file', bash('git restore --staged -- src/a.ts', VER), false],
  ['verifier git log', bash('git --no-pager log --oneline -5', VER), false],
  ['verifier npm test', bash('npm test', VER), false],
  ['verifier npm run test:unit', bash('npm run test:unit -- --reporter dot', VER), false],
  ['verifier node --test', bash('node --test tests/', VER), false],
  ['verifier declared Verification command', bash('npm run typecheck', VER), false],
  ['verifier declared compound command', bash('cd web && npm run check', VER), false],
  ['verifier tests with 2>&1 | tail', bash('npm test 2>&1 | tail -20', VER), false],
  ['verifier output to /dev/null', bash('npm test > /dev/null 2>&1', VER), false],
  ['verifier rb verify-cmds', bash('node tools/rockbuilt/rb.mjs verify-cmds Verification', VER), false],
  ['scout ls-files | head', bash('git ls-files | head', 'rb-scout'), false],
  ['scout git -C show', bash('git -C sub show HEAD', 'rb-scout'), false],
  ['scout find without exec', bash('find src -name "*.ts" -type f', 'rb-scout'), false],
  ['scout rg', bash('rg -n "TODO" src', 'rb-scout'), false],
  ['scout cat and wc', bash('cat package.json && wc -l src/*.ts', 'rb-scout'), false],
  ['scout git grep', bash('git grep -n useState', 'rb-scout'), false],
  ['security-reviewer blame', bash('git blame src/auth.ts', 'rb-security-reviewer'), false],
  ['security-reviewer npm audit', bash('npm audit --omit=dev', 'rb-security-reviewer'), false],
  ['healer merge-base', bash('git merge-base HEAD main', 'rb-healer'), false],
  ['healer playwright', bash('npx playwright test e2e/login.spec.ts', 'rb-healer'), false],
  ['auditor pytest', bash('pytest -q', 'rb-auditor'), false],
  ['bypass: scout git restore .', bash('git restore .', 'rb-scout'), true],
  ['bypass: verifier git restore .', bash('git restore .', VER), true],
  ['verifier git restore glob', bash("git restore 'src/*.ts'", VER), true],
  ['verifier git restore two files', bash('git restore a.ts b.ts', VER), true],
  ['verifier git restore pathspec magic', bash('git restore :/', VER), true],
  ['bypass: git grep --open-files-in-pager', bash('git grep --open-files-in-pager=touch x', 'rb-scout'), true],
  ['bypass: git grep -O', bash('git grep -Ovim foo', 'rb-scout'), true],
  ['bypass: planner python3 -c', bash(`python3 -c "open('x','w').write('y')"`, 'rb-planner'), true],
  ['planner node -e', bash(`node -e "require('fs').writeFileSync('x','y')"`, 'rb-planner'), true],
  ['scout bash -c', bash('bash -c "ls"', 'rb-scout'), true],
  ['scout sh -c', bash("sh -c 'cat a'", 'rb-scout'), true],
  ['scout perl', bash('perl -e "print 1"', 'rb-scout'), true],
  ['scout pwsh', bash('pwsh -File x.ps1', 'rb-scout'), true],
  ['scout redirect >', bash('ls > files.txt', 'rb-scout'), true],
  ['scout redirect >>', bash('echo x >> notes.md', 'rb-scout'), true],
  ['scout tee', bash('ls | tee out.txt', 'rb-scout'), true],
  ['scout find -exec', bash('find . -name "*.js" -exec rm {} \\;', 'rb-scout'), true],
  ['scout find -delete', bash('find . -name "*.tmp" -delete', 'rb-scout'), true],
  ['scout rg --pre', bash('rg --pre ./x.sh foo', 'rb-scout'), true],
  ['scout sort -o', bash('sort -o a.txt a.txt', 'rb-scout'), true],
  ['scout rm', bash('rm -rf node_modules', 'rb-scout'), true],
  ['scout npm install', bash('npm install left-pad', 'rb-scout'), true],
  ['scout npm run build (not declared for read-only? declared)', bash('npm run build', 'rb-scout'), false],
  ['scout npm run dev (not declared)', bash('npm run dev', 'rb-scout'), true],
  ['scout npx arbitrary', bash('npx cowsay hi', 'rb-scout'), true],
  ['scout npm exec', bash('npm exec -- foo', 'rb-scout'), true],
  ['scout npm audit fix', bash('npm audit fix', 'rb-scout'), true],
  ['scout node --test --import', bash('node --test --import ./evil.mjs', 'rb-scout'), true],
  ['scout git -c pager', bash('git -c core.pager=touch log', 'rb-scout'), true],
  ['scout git diff --output', bash('git diff --output=x.patch', 'rb-scout'), true],
  ['scout xargs rm', bash('ls | xargs rm', 'rb-scout'), true],
  ['scout sudo', bash('sudo ls', 'rb-scout'), true],
  ['scout declared command plus extra segment', bash('npm run lint && curl x', 'rb-scout'), true],
  ['verifier git commit', bash('git commit -am x', VER), true],
  ['verifier git checkout', bash('git checkout main', VER), true],
  ['verifier git stash', bash('git status && git stash', VER), true],
  ['verifier gh', bash('gh pr view 3', VER), true],
  ['scout git push feature', bash('git push origin rb/x', 'rb-scout'), true],
  ['planner git reset', bash('git reset --hard', 'rb-planner'), true],
  ['task-reviewer gh api', bash('gh api repos/x/y', 'rb-task-reviewer'), true],
  ['healer git clean via sh -c', bash("sh -c 'git clean -fd'", 'rb-healer'), true],
  ['auditor cat .env', bash('cat .env', 'rb-auditor'), true],

  // No-write roles.
  ['scout Edit', edit('/repo/src/a.ts', 'rb-scout'), true],
  ['planner Write', edit('/repo/docs/plan.md', 'rb-planner', 'Write'), true],
  ['task-reviewer MultiEdit', edit('/repo/x.ts', 'rb-task-reviewer', 'MultiEdit'), true],
  ['healer Write', edit('/repo/e2e/a.spec.ts', 'rb-healer', 'Write'), true],
  ['auditor Write', edit('/repo/tmp/probe.test.ts', 'rb-auditor', 'Write'), true],
  ['security-reviewer NotebookEdit', { tool_name: 'NotebookEdit', tool_input: { notebook_path: '/repo/n.ipynb' }, agent_type: 'rb-security-reviewer', cwd: '/repo' }, true],
  ['verifier may Edit src (mutation probe)', edit('/repo/src/a.ts', VER), false],

  // Protected paths for every subagent.
  ['implementer edits src', edit('/repo/src/a.ts', IMPL), false],
  ['implementer writes test', edit('src/a.test.ts', IMPL, 'Write'), false],
  ['implementer edits CLAUDE.md', edit('/repo/CLAUDE.md', IMPL), true],
  ['implementer edits AGENTS.md', edit('/repo/AGENTS.md', IMPL), true],
  ['implementer edits nested claude.md lowercase', edit('/repo/pkg/claude.md', IMPL), true],
  ['implementer edits .claude/settings.json', edit('/repo/.claude/settings.json', IMPL, 'Write'), true],
  ['implementer edits .cursor/hooks.json', edit('/repo/.cursor/hooks.json', IMPL), true],
  ['implementer edits .codex/hooks.json', edit('/repo/.codex/hooks.json', IMPL), true],
  ['implementer edits .agents/skills', edit('/repo/.agents/skills/rb-build/SKILL.md', IMPL), true],
  ['implementer edits tools/rockbuilt', edit('/repo/tools/rockbuilt/guard.mjs', IMPL), true],
  ['implementer edits known-failures', edit('/repo/docs/rockbuilt/known-failures.json', IMPL), true],
  ['implementer edits .mcp.json', edit('/repo/.mcp.json', IMPL), true],
  ['implementer writes .env', edit('/repo/.env', IMPL, 'Write'), true],
  ['implementer edits .rockbuilt/baseline.json', edit('/repo/.rockbuilt/baseline.json', IMPL), true],
  ['implementer edits workflow', edit('/repo/.github/workflows/ci.yml', IMPL), true],
  ['implementer edits .github PR template', edit('/repo/.github/pull_request_template.md', IMPL), true],
  ['implementer edits relative ./.claude', edit('./.claude/LESSONS.md', IMPL), true],
  ['implementer dot-dot into .claude', edit('/repo/src/../.claude/x.md', IMPL), true],
  ['windows backslash .claude', edit('C:\\work\\repo\\.claude\\settings.json', IMPL, 'Edit', 'C:\\work\\repo'), true],
  ['windows mixed case .Claude', edit('C:\\work\\repo\\.Claude\\settings.json', IMPL, 'Edit', 'C:\\work\\repo'), true],
  ['windows .GITHUB\\Workflows', edit('C:\\work\\repo\\.GITHUB\\Workflows\\ci.yml', IMPL, 'Write', 'C:\\work\\repo'), true],
  ['windows CLAUDE.MD', edit('C:\\work\\repo\\CLAUDE.MD', IMPL, 'Edit', 'C:\\work\\repo'), true],
  ['windows src allowed', edit('C:\\work\\repo\\src\\a.ts', IMPL, 'Edit', 'C:\\work\\repo'), false],
  ['verifier edits .rockbuilt', edit('/repo/.rockbuilt/timing.jsonl', VER), true],
  ['e2e-writer edits workflow', edit('/repo/.github/workflows/e2e.yml', E2E, 'Write'), true],
  ['e2e-writer writes e2e spec', edit('/repo/e2e/login.spec.ts', E2E, 'Write'), false],
  ['e2e-writer writes playwright config', edit('/repo/playwright.config.ts', E2E), false],
  ['e2e-writer writes src', edit('/repo/src/app.ts', E2E, 'Write'), true],
  ['implementer file named claude.md.bak', edit('/repo/docs/CLAUDE.md.bak', IMPL), false],
  ['project living under ~/.claude is fine', edit('/home/u/.claude/projects/app/src/a.ts', IMPL, 'Edit', '/home/u/.claude/projects/app'), false],
  ['general-purpose agent edits CLAUDE.md', edit('/repo/CLAUDE.md', 'general-purpose'), true],

  // Cursor payloads.
  ['cursor: shell push to main', cursorShell('git push origin main'), true],
  ['cursor: shell npm test', cursorShell('npm test'), false],
  ['cursor: shell cat .env', cursorShell('cat .env'), true],
  ['cursor: read .env', cursorRead('/repo/.env'), true],
  ['cursor: read src', cursorRead('/repo/src/a.ts'), false],
  ['cursor: preToolUse Shell force push', cursorTool('Shell', { command: 'git push -f', working_directory: '/repo' }), true],
  ['cursor: preToolUse Read .env.local', cursorTool('Read', { file_path: '/repo/.env.local' }), true],
  ['cursor: preToolUse Write by subagent into .claude', cursorTool('Write', { file_path: '/repo/.claude/x.md' }, { subagent_type: 'rb-implementer' }), true],
  ['cursor: subagent shell git', cursorShell('git status', { subagent_type: 'rb-implementer' }), true],
  ['cursor: main Write to .claude allowed', cursorTool('Write', { file_path: '/repo/.claude/x.md' }), false],

  // Codex payloads.
  ['codex: Bash push to main', codexBash('git push origin main'), true],
  ['codex: Bash npm test', codexBash('npm test'), false],
  ['codex: apply_patch by implementer into AGENTS.md', codexPatch('*** Begin Patch\n*** Update File: AGENTS.md\n@@\n-a\n+b\n*** End Patch', { agent_type: 'rb-implementer' }), true],
  ['codex: apply_patch move into .codex', codexPatch('*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: .codex/a.ts\n*** End Patch', { agent_type: 'rb-implementer' }), true],
  ['codex: apply_patch by implementer into src', codexPatch('*** Begin Patch\n*** Add File: src/b.ts\n+x\n*** End Patch', { agent_type: 'rb-implementer' }), false],
  ['codex: apply_patch by planner', codexPatch('*** Begin Patch\n*** Add File: src/b.ts\n+x\n*** End Patch', { agent_type: 'rb-planner' }), true],

  // Here-documents: bodies are data unless a shell or interpreter reads them.
  ['scout cat heredoc body is data', bash('cat <<EOF\nhello world\nEOF', 'rb-scout'), false],
  ['main: commit message heredoc mentioning push', bash("git commit -F - <<'EOF'\ngit push origin main is denied\nEOF\ngit status"), false],
  ['main: bash heredoc pushes main', bash('bash <<EOF\ngit push origin main\nEOF'), true],
  ['main: node heredoc reads .env', bash("node <<'JS'\nconsole.log(require('fs').readFileSync('.env','utf8'))\nJS"), true],
  ['main: command after heredoc still checked', bash('cat <<EOF\nx\nEOF\ngit push origin main'), true],

  // Robustness.
  ['non-Bash non-write tool', { tool_name: 'Grep', tool_input: { pattern: 'x' }, agent_type: 'rb-scout', cwd: '/repo' }, false],
  ['Read CLAUDE.md by scout', read('/repo/CLAUDE.md', 'rb-scout'), false],
  ['missing tool_input', { tool_name: 'Bash', agent_type: IMPL }, false],
  ['non-string command', { tool_name: 'Bash', tool_input: { command: 42 }, cwd: '/repo' }, false],
  ['empty agent_type is main session', bash('git push origin rb/x', ''), false],
  ['null input', null, false],
];

for (const [label, input, expectDeny, env] of CASES) {
  test(`guard: ${label}`, () => {
    const r = decide(input, env || fakeEnv(), NO_ENV);
    assert.equal(r.deny, expectDeny, `reason: ${r.reason}`);
    if (expectDeny) assert.match(r.reason, /\S/);
  });
}

test('guard: case count is at least 200', () => {
  assert.ok(CASES.length >= 200, `only ${CASES.length} cases`);
});

test('roleOf takes the part after the last colon and strips rb-', () => {
  assert.equal(roleOf('rockbuilt:rb-implementer'), 'implementer');
  assert.equal(roleOf('rb-implementer'), 'implementer');
  assert.equal(roleOf('implementer'), 'implementer');
  assert.equal(roleOf('a:b:RB-Verifier'), 'verifier');
  assert.equal(roleOf(undefined), null);
  assert.equal(roleOf(''), null);
});

test('ROCKBUILT_ROLE sets the role when the payload carries none', () => {
  const r = decide(cursorShell('git status'), fakeEnv(), { ROCKBUILT_ROLE: 'rb-implementer' });
  assert.equal(r.deny, true);
});

test('detectTool reads the payload shape and ROCKBUILT_TOOL', () => {
  assert.equal(detectTool(bash('ls'), NO_ENV), 'claude');
  assert.equal(detectTool(cursorShell('ls'), NO_ENV), 'cursor');
  assert.equal(detectTool(codexBash('ls'), NO_ENV), 'codex');
  assert.equal(detectTool(codexPatch(''), NO_ENV), 'codex');
  assert.equal(detectTool(bash('ls'), { ROCKBUILT_TOOL: 'cursor' }), 'cursor');
  assert.equal(normalize(cursorTool('Shell', { command: 'ls', working_directory: '/w' }), NO_ENV).cwd, '/w');
});

test('patchPaths reads apply_patch headers', () => {
  const p = '*** Begin Patch\n*** Add File: a.ts\n+x\n*** Update File: b/c.ts\n*** Move to: d.ts\n*** Delete File: e.ts\n*** End Patch';
  assert.deepEqual(patchPaths(p).sort(), ['a.ts', 'b/c.ts', 'd.ts', 'e.ts']);
});

test('sectionCommands reads the first fenced block of a section', () => {
  const text = '# X\n\n## Verification\n```bash\n# comment\nnpm test\nnpm run lint\n```\n\n## E2E\n```\nnpm run test:e2e\n```\n';
  assert.deepEqual(sectionCommands(text, 'Verification'), ['npm test', 'npm run lint']);
  assert.deepEqual(sectionCommands(text, 'E2E'), ['npm run test:e2e']);
  assert.deepEqual(sectionCommands(text, 'Evals'), []);
});

test('splitCommands handles quotes, separators and redirections', () => {
  assert.deepEqual(splitCommands('a "b c" && d \'e;f\'|g'), [['a', 'b c'], ['d', 'e;f'], ['g']]);
  assert.deepEqual(splitCommands('echo x>>f 2>&1'), [['echo', 'x', '>>', 'f', '2>&1']]);
});

test('protectedPathReason normalizes Windows separators', () => {
  assert.equal(protectedPathReason('C:\\r\\.github\\workflows\\x.yml', 'C:\\r'), '.github/');
  assert.equal(protectedPathReason('src/a.ts', '/r'), null);
});

test('protectedPathReason resolves symlinks into .claude', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rb-guard-link-'));
  try {
    mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
    mkdirSync(path.join(dir, 'src'));
    let linked = true;
    try {
      symlinkSync(path.join(dir, '.claude'), path.join(dir, 'src', 'cfg'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      linked = false; // Windows without symlink rights
    }
    if (linked) {
      const r1 = decide(edit(path.join(dir, 'src', 'cfg', 'agents', 'rb-verifier.md'), IMPL, 'Write', dir), fakeEnv(), NO_ENV);
      assert.equal(r1.deny, true, 'Write through a symlinked dir');
      const r2 = decide(edit('src/cfg/new.md', IMPL, 'Write', dir), fakeEnv(), NO_ENV);
      assert.equal(r2.deny, true, 'relative path through a symlinked dir, file not yet existing');
      const r3 = decide(bash('echo x > src/cfg/settings.json', IMPL, dir), fakeEnv(), NO_ENV);
      assert.equal(r3.deny, true, 'shell redirect through a symlinked dir');
    }
    const ok = decide(edit(path.join(dir, 'src', 'a.ts'), IMPL, 'Write', dir), fakeEnv(), NO_ENV);
    assert.equal(ok.deny, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('git lookups are injectable and memoized', () => {
  let calls = 0;
  const env = { currentBranch: () => { calls++; return 'main'; }, defaultBranches: () => ['main'] };
  const r = decide(bash('git push; git push origin HEAD'), env, NO_ENV);
  assert.equal(r.deny, true);
  assert.equal(calls, 1);
});

test('render: cursor deny is JSON on stdout and exit 2; allow prints permission allow', () => {
  const deny = render(decide(cursorShell('git push origin main'), fakeEnv(), NO_ENV));
  assert.equal(deny.code, 2);
  const out = JSON.parse(deny.stdout);
  assert.equal(out.permission, 'deny');
  assert.match(out.user_message, /^rockbuilt guard: /);
  assert.match(out.agent_message, /^rockbuilt guard: /);
  const allow = render(decide(cursorShell('npm test'), fakeEnv(), NO_ENV));
  assert.equal(allow.code, 0);
  assert.deepEqual(JSON.parse(allow.stdout), { permission: 'allow' });
  const readDeny = JSON.parse(render(decide(cursorRead('/repo/.env'), fakeEnv(), NO_ENV)).stdout);
  assert.deepEqual(Object.keys(readDeny).sort(), ['permission', 'user_message']);
});

test('render: codex and claude deny via stderr and exit 2', () => {
  for (const input of [codexBash('git push -f'), bash('git push -f')]) {
    const r = render(decide(input, fakeEnv(), NO_ENV));
    assert.equal(r.code, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^rockbuilt guard: /);
  }
});

function spawnHook(stdin, env = {}) {
  const clean = { ...process.env };
  delete clean.ROCKBUILT_TOOL;
  delete clean.ROCKBUILT_ROLE;
  return spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8', env: { ...clean, ...env } });
}

test('hook process: deny exits 2 with one stderr line', () => {
  const r = spawnHook(JSON.stringify(bash('git push --force origin x', IMPL)));
  assert.equal(r.status, 2);
  const lines = r.stderr.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^rockbuilt guard: /);
});

test('hook process: allow exits 0 silently', () => {
  const r = spawnHook(JSON.stringify(bash('npm test', IMPL)));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('hook process: cursor deny prints JSON and exits 2', () => {
  const r = spawnHook(JSON.stringify(cursorShell('git push --force')));
  assert.equal(r.status, 2);
  assert.equal(JSON.parse(r.stdout).permission, 'deny');
});

test('hook process: malformed JSON exits 0', () => {
  const r = spawnHook('{not json');
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('hook process: empty stdin exits 0', () => {
  assert.equal(spawnHook('').status, 0);
});

test('hook process: typical decision is fast', () => {
  const t0 = process.hrtime.bigint();
  const r = spawnHook(JSON.stringify(bash('npm test && cat src/a.ts | head', 'rb-scout')));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(r.status, 0);
  assert.ok(ms < 1500, `took ${ms} ms including node startup`);
});

test('hook process: real git lookup in a non-repo cwd falls back to main/master', () => {
  const input = { tool_name: 'Bash', tool_input: { command: 'git push origin master' }, cwd: path.parse(process.cwd()).root };
  const r = spawnHook(JSON.stringify(input));
  assert.equal(r.status, 2);
});

test('hook process: real git, default branch comes from AGENTS.md', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rb-guard-'));
  try {
    spawnSync('git', ['init', '-q', '-b', 'trunk'], { cwd: dir });
    writeFileSync(path.join(dir, 'AGENTS.md'), '# X\n\nDefault branch: trunk\n\n## Verification\n```bash\nnpm run check\n```\n');
    const onTrunk = spawnHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: dir }));
    assert.equal(onTrunk.status, 2);
    spawnSync('git', ['checkout', '-q', '-b', 'rb/T1-x'], { cwd: dir });
    const onFeature = spawnHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push -u origin rb/T1-x' }, cwd: dir }));
    assert.equal(onFeature.status, 0);
    const toMain = spawnHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, cwd: dir }));
    assert.equal(toMain.status, 0, 'main is not the default branch here');
    const declared = spawnHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm run check' }, agent_type: 'rb-verifier', cwd: dir }));
    assert.equal(declared.status, 0, 'declared Verification command is allowed for the verifier');
    const undeclared = spawnHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm run deploy' }, agent_type: 'rb-verifier', cwd: dir }));
    assert.equal(undeclared.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hook process: CLAUDE.md fallback for v0.2 projects', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rb-guard-'));
  try {
    spawnSync('git', ['init', '-q', '-b', 'trunk'], { cwd: dir });
    writeFileSync(path.join(dir, 'CLAUDE.md'), '# X\n\nDefault branch: trunk\n');
    const r = spawnHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin trunk' }, cwd: dir }));
    assert.equal(r.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('auditor may write only under .rockbuilt/audit/', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'rb-audit-'));
  const w = (file) => decide({ tool_name: 'Write', tool_input: { file_path: file }, agent_type: 'rb-auditor', cwd }, { currentBranch: () => 'rb/T1-x', defaultBranches: () => ['main'] });
  assert.equal(w(path.join(cwd, '.rockbuilt', 'audit', 'check.test.mjs')).deny, false);
  assert.equal(w('.rockbuilt/audit/sub/a.mjs').deny, false);
  assert.equal(w(path.join(cwd, 'src', 'app.js')).deny, true);
  assert.equal(w('.rockbuilt/baseline.json').deny, true);
  assert.equal(w('.rockbuilt/audit/../baseline.json').deny, true);
  mkdirSync(path.join(cwd, '.rockbuilt'), { recursive: true });
  symlinkSync(path.join(cwd, 'src-real'), path.join(cwd, '.rockbuilt', 'audit'), 'dir');
  mkdirSync(path.join(cwd, 'src-real'), { recursive: true });
  assert.equal(w('.rockbuilt/audit/x.mjs').deny, true);
});

test('cost CLIs: runners, .bin paths, data-pushing tools and package scripts', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rb-guard-cost-'));
  try {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { deploy: 'vercel deploy --prod', test: 'node --test', 'db:push': 'prisma db push', dev: 'next dev' } }));
    const sh = (command, agent) => decide({ tool_name: 'Bash', tool_input: { command }, agent_type: agent, cwd: dir }).deny;
    const IMPL = 'rb-implementer';
    for (const c of ['npm run deploy', 'pnpm deploy', 'yarn deploy', 'npm run db:push', 'pnpm exec vercel deploy', 'yarn vercel deploy', 'yarn exec vercel deploy',
      'node node_modules/.bin/vercel deploy --prod', 'npx prisma db push', 'npx prisma migrate deploy', 'npx drizzle-kit push', 'npx stripe charges create']) {
      assert.equal(sh(c, IMPL), true, `denied: ${c}`);
      assert.equal(sh(c), true, `denied for the main session too: ${c}`);
    }
    for (const c of ['npm test', 'npm run dev', 'npx prisma generate', 'npx prisma migrate dev', 'npx drizzle-kit generate', 'stripe listen', 'npm install', 'pnpm install']) {
      assert.equal(sh(c), false, `allowed: ${c}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('git -c, --config-env and config writes are denied for everyone (alias and hook bypasses)', () => {
  const sh = (command, agent) => decide({ tool_name: 'Bash', tool_input: { command }, agent_type: agent, cwd: '/repo' }).deny;
  for (const c of ["git -C . -c alias.x='!vercel deploy --prod' x", 'git -c core.sshCommand=evil push origin rb/x', "git -C . config alias.p 'push origin HEAD:main'",
    'git config core.hooksPath /tmp/h', 'git --config-env=core.pager=X log', 'git config --global user.email x@y']) {
    assert.equal(sh(c), true, `main session: ${c}`);
  }
  for (const c of ['git config --get remote.origin.url', 'git config --list', 'git -C ../wt status', 'git commit -m "x"']) assert.equal(sh(c), false, `allowed: ${c}`);
});

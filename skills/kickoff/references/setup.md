# Setup execution (kickoff Step 5)

Run only after the user approved the synthesis. Use `rb` if on PATH, otherwise
`node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" <command>`.

## 1. GitHub repository

```bash
gh auth status                      # if it fails: ask the user to run  ! gh auth login
git rev-parse --is-inside-work-tree || git init -b main
```

New repository (private unless the user said public):

```bash
gh repo create <owner>/<name> --private --source . --remote origin
gh repo view --json nameWithOwner,defaultBranchRef
```

`gh repo create --source .` may require at least one commit to push; do not push. Creating the
remote without pushing is enough. Existing repository: `gh repo list <owner> --limit 50`, confirm
the choice with the user, then `git remote add origin <url>` if missing. If the remote already has
content beyond a README/license, stop and ask (this may be an adopt case).

Report `nameWithOwner` and default branch to the user. If the default branch is not `main`,
write the real one into CLAUDE.md `Default branch:`.

## 2. Harness files

```bash
rb init --type <web,ai,automation subset> --lang <es|en|...>
```

It never overwrites; it reports skipped files. If CLAUDE.md was skipped because one existed,
merge the approved content into it and show the diff before writing.

**Web projects get Playwright from day one.** With `web` in the type, `rb init` also installs
`playwright.config.ts`, `e2e/smoke.spec.ts` and a project `.mcp.json` with the Playwright MCP
server (launched with `node`, so it works the same on Windows, macOS and Linux), and adds the
`test:e2e` script once package.json exists. The skeleton issue then pins the packages:
`npm install -D -E @playwright/test @playwright/mcp` and `npx playwright install chromium`
(`--with-deps` on Linux CI). After the install, tell the user to restart Claude Code, approve the
`playwright` MCP server when prompted, and confirm it with `/mcp` (Claude Code only loads MCP
servers at startup). `rb init` prints these next steps; relay them. CLAUDE.md `## E2E` holds
`npm run test:e2e`, and the CI workflow runs it.

Add allow rules for the chosen toolchain to `.claude/settings.json`, one `Bash(cmd *)` rule per
tool the Verification and Setup commands use beyond npm/npx/pnpm/yarn (for example
`Bash(uv *)`, `Bash(pytest *)`, `Bash(cargo *)`, `Bash(supabase *)`), and tell the user.
Subagents cannot answer permission prompts, so a missing rule stalls them.

## 3. ADR numbering

`docs/adr/0001-stack.md`, `0002-workflow-vs-agent.md`, then the rest in decision order. One
decision per ADR. Status `accepted` (the user approved them in the synthesis).

## 4. Labels

```bash
rb labels
```

## 5. Walking skeleton issue

Write the body to a temp file in the docs language, then:

```bash
gh issue create --title "<Walking skeleton title in docs language>" --label rb:skeleton --label rb:task --body-file <file>
```

Then prepend the marker line `<!-- rockbuilt:task i<n> spec=none -->` (n = the new issue
number) to the same file and run `gh issue edit <n> --body-file <file>`, so build finds it as a
standalone issue.

Body template (translate headings to the docs language):

```markdown
## Purpose
Stand up the project skeleton so every later task builds on a green, verifiable base.

## Scope
- Project scaffold for <stack with pinned versions> following docs/adr/0001-stack.md.
- Toolchain: typecheck, lint, unit tests, build wired as npm scripts (exact commands in CLAUDE.md ## Verification).
- One thin end-to-end slice through the real architecture: <concrete slice, e.g. "home page calls GET /api/health which reads one row from the database and renders it">.
- <web> Playwright pinned (`@playwright/test`, `@playwright/mcp`), chromium installed, the smoke
  spec from `rb init` asserting the skeleton's real slice; `npm run test:e2e` passes locally and
  in CI. The `playwright` MCP server shows as connected in `/mcp`.
- <ai> One eval file with 3 smoke cases; `npm run evals` passes; LLM behind an interface.
- CI workflow running the Verification commands on pull requests.
- `.env.example` listing every required variable, no secrets committed.

## Acceptance criteria
- [ ] Every command under CLAUDE.md ## Verification exits 0 on a clean checkout after ## Setup.
- [ ] The end-to-end slice works: <observable result>.
- [ ] CI runs on the PR and is green.
- [ ] README states how to run locally in 3 commands or fewer.

## Out of scope
Any feature behavior. Features come from /rockbuilt:spec.

## Verify
`rb verify-cmds` lists the commands; each exits 0. `rb baseline` records a green run.
```

## 6. Doctor

```bash
rb doctor
```

Expected FAILs/WARNs before the skeleton is built: missing baseline, Verification commands not
runnable yet. Anything else (gh auth, settings rules, gitignore, labels) gets fixed now or handed
to the user with the exact command. Branch protection on the default branch is the user's
action: give the GitHub settings path.

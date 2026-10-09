# Setup execution (kickoff Step 5)

Run only after the user approved the synthesis. `rb <cmd>` means
`node tools/rockbuilt/rb.mjs <cmd>` once vendored; before that, the plugin copy
`node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" <cmd>`, or `node ../rockbuilt/scripts/rb.mjs <cmd>`
in a cloud session where the rockbuilt repo is attached next to the project. Every GitHub call
goes through `rb gh <op>` (REST, prints JSON); never `gh issue`, `gh pr` or `gh label`, which use
GraphQL and fail in cloud sessions.

## 1. GitHub repository

```bash
rb gh whoami                        # locally, if it fails: ask the user to run  ! gh auth login
git rev-parse --is-inside-work-tree || git init -b main
```

New repository (private unless the user said public). `gh repo create` uses REST:

```bash
gh repo create <owner>/<name> --private --source . --remote origin
```

Do not push here. **Fallback when it fails** (always in cloud sessions, where creating repos is
not possible; also on missing scopes): ask the user to create the repo in the GitHub UI
(github.com/new), private, **with "Add a README file" checked** so the default branch exists,
and to paste the URL. Then:

```bash
git remote add origin <url>          # or set-url if origin exists
git fetch origin
```

Existing repository: confirm it with the user and wire it as `origin`. If the remote already has
content beyond a README/license, stop and ask (this may be an adopt case).

Report owner/name and default branch to the user. If the default branch is not `main`, write the
real one into AGENTS.md `Default branch:`.

## 2. Vendor the harness

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" vendor --type <web,ai,automation subset> --lang <es|en|...> --tools <claude[,cursor][,codex]>
# cloud session with the rockbuilt repo attached next to the project:
node ../rockbuilt/scripts/rb.mjs vendor --type <types> --lang <lang> --tools <tools>
```

It installs `tools/rockbuilt/`, `.claude/skills/rb-*`, `.claude/agents/rb-*`,
`.claude/settings.json` (guard hook and permissions), `AGENTS.md` and `CLAUDE.md` templates,
`.github/workflows/rockbuilt-ci.yml`, and the adapters for the chosen tools (`.cursor/*` with
cursor, `.agents/skills` and `.codex/hooks.json` with codex). It never overwrites project-owned
files (AGENTS.md, CLAUDE.md, LESSONS.md, docs) and merges settings and MCP JSON. If AGENTS.md was
skipped because one existed, merge the approved content into it and show the diff before
writing.

**Web projects get Playwright from day one.** With `web` in the type, vendor also installs
`playwright.config.ts`, `e2e/smoke.spec.ts` and `.mcp.json` with the Playwright MCP server, and
adds the `test:e2e` script once package.json exists. The skeleton issue pins the packages
(`npm install -D -E @playwright/test @playwright/mcp`, `npx playwright install chromium`).
Locally, after the install, the user restarts Claude Code, approves the `playwright` MCP server
and confirms it with `/mcp`. AGENTS.md `## E2E` holds `npm run test:e2e`, and `## Run` the dev server command on `$PORT`
(the orchestrator starts it so the blind auditor can open the app).

Add allow rules for the chosen toolchain to `.claude/settings.json`, one `Bash(cmd *)` rule per
tool the Verification and Setup commands use beyond npm (for example `Bash(uv *)`,
`Bash(pytest *)`, `Bash(cargo *)`), and tell the user. Routines and subagents cannot answer
permission prompts, so a missing rule stalls them. With cursor, mirror the rule in
`.cursor/cli.json`.

## 3. AGENTS.md `## Autonomy`

```markdown
## Autonomy
Sensitive paths: <globs that always force tier C beyond the built-in floor, or none>
Tier A paths: <extra globs that may be tier A, or none>
Paid services: <none | service (monthly cap USD n), ...>
```

Header `Autonomy: auto` unless the user chose `supervised`. Fill `Paid services` only with what
the user explicitly approved in Round E, each with its cap. Never add a service on your own.

## 4. ADR numbering

`docs/adr/0001-stack.md`, `0002-workflow-vs-agent.md`, then the rest in decision order. One
decision per ADR. Status `accepted` (approved in the synthesis).

## 5. Labels, control issue, walking skeleton

```bash
rb gh labels-ensure
rb control ensure                    # prints the control issue number
```

Write the skeleton body to a temp file in the docs language, then:

```bash
rb gh issue-create --title "<Walking skeleton title in docs language>" --body-file <file> --label rb:skeleton,rb:task
```

Read `number` from the JSON output, prepend the marker line
`<!-- rockbuilt:task i<n> spec=none -->` to the file and run
`rb gh issue-edit <n> --body-file <file>`, so the cycle finds it as a standalone issue.

Body template (translate headings to the docs language):

```markdown
## Purpose
Stand up the project skeleton so every later task builds on a green, verifiable base.

## Scope
- Project scaffold for <stack with pinned versions> following docs/adr/0001-stack.md.
- Toolchain: typecheck, lint, unit tests, build wired as npm scripts (exact commands in AGENTS.md ## Verification).
- One thin end-to-end slice through the real architecture: <concrete slice, e.g. "home page calls GET /api/health which reads one row from the database and renders it">.
- <web> Playwright pinned (`@playwright/test`, `@playwright/mcp`), chromium installed, the smoke
  spec asserting the skeleton's real slice; `npm run test:e2e` passes locally and in CI.
- <ai> One eval file with 3 smoke cases using a mocked model; `npm run evals` passes; LLM behind
  an interface. Live model calls cost money: only with a budget in AGENTS.md Paid services.
- `rockbuilt-ci` runs the Verification commands on pull requests and is green.
- `.env.example` listing every required variable, no secrets committed.

## Acceptance criteria
- [ ] Every command under AGENTS.md ## Verification exits 0 on a clean checkout after ## Setup.
- [ ] The end-to-end slice works: <observable result>.
- [ ] `rockbuilt-ci` runs on the PR and is green.
- [ ] README states how to run locally in 3 commands or fewer.

## Out of scope
Any feature behavior. Features come from /rb-spec.

## Verify
`rb verify-cmds` lists the commands; each exits 0. `rb baseline` records a green run.
```

## 6. Commit path

Kickoff touches AGENTS.md, `.claude/`, `.github/` and `tools/rockbuilt/`: tier C. The user
merges it; you never push to the default branch (the guard denies it).

**Remote has a default branch** (README created in the UI, or an existing repo):

```bash
git fetch origin && git checkout -b rb/kickoff origin/<default>
git add -A && git commit -m "chore: kickoff harness and brief"
git push -u origin rb/kickoff
rb gh pr-create --head rb/kickoff --base <default> --title "<Kickoff title in docs language>" --body-file <file> --label rb:tier-c
```

If the local files were created before the fetch, commit them on `rb/kickoff` on top of the
remote default branch (resolve the README conflict by keeping both). The PR body lists what was
created and the control and skeleton issue numbers.

**Remote is empty** (created by `gh repo create`, no commits): there is no base for a PR. Commit
locally on `main` and ask the user to push from their own terminal:
`git push -u origin main`.

## 7. Doctor

```bash
rb doctor
```

Expected FAILs/WARNs before the skeleton is built: missing baseline, Verification commands not
runnable yet. Anything else (GitHub access, settings rules, gitignore, labels, control issue)
gets fixed now or handed to the user with the exact command. Relay its protection mode
(`github` or `rb-only`) and CI presence.

## 8. Branch protection (an option, never a default)

`rb protect` configures required status checks on the default branch so GitHub rejects merges
without green `rockbuilt-ci`. On a public repo it works for free. On a private repo it needs
GitHub Pro (a paid plan): `rb protect` explains and exits 3. Present it as an option with that
cost; the user decides and upgrades the plan themselves. Without it the gate is enforced by
`rb merge-gate` only, which is the supported default.

## 9. Nightly cloud routine (the user sets it up)

Point to `docs/CLOUD.md` in the Rockbuilt repo
(https://github.com/ragarciaga/rockbuilt/blob/main/docs/CLOUD.md). Summary for the handoff:
a Claude Code routine on this repo, schedule trigger (default 01:07 local time, minimum interval
1 hour), prompt exactly `Run /rb-cycle.`, environment setup script `npm ci`, network level
Trusted. No secrets in environment variables. Routines cannot answer prompts; anything that needs
the user becomes an `rb:needs-human` or `rb:needs-local` issue and is listed in the digest on the
control issue.

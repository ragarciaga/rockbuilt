---
name: verify
description: >
  Runs the feature-level verification gates on one spec folder (docs/specs/NN-slug/): security
  review, end-to-end tests with Playwright, and evals for LLM-backed behavior. Decides which gates
  apply from CLAUDE.md `Project type`, the criteria tags ([e2e], [eval]) and the security trigger
  list, checks preconditions (app starts, credentials present, Playwright installed), dispatches
  the security-reviewer, e2e-writer and healer subagents, writes test-plan.md, test-report.md,
  evals.md and security-report.md into the spec folder, and turns every blocker into a task plus
  a GitHub issue. Use after a feature's tasks are in review or merged, or when the user says
  "verify the feature", "run the e2e", "security review", "run evals", "verifica la feature",
  "corre los e2e", "revisa seguridad", "evals", "prueba el flujo completo".
---

# Verify

Feature gates run after `build`, on the whole feature, from the user's point of view. The unit
tests already passed per task; this skill answers a different question: does the feature work
for a real user, is it safe, and (for LLM behavior) is it good enough, measured against ground
truth. The producer never grades itself: every gate is run by a fresh-context subagent or a
script, and the spec (not the code) is the source of truth for what "correct" means.

You are the orchestrator. Only you run git and gh, write tasks.md, progress.md and LESSONS.md,
and talk to the user. Subagents return report bodies; you write them into the spec folder. This
skill never writes app code, and neither do you: eval code or app code a gate needs becomes a
task for the implementer (Step 4), built by `/rockbuilt:build`.

**Artifacts branch.** Everything this skill produces (test-plan.md, test-report.md, evals.md,
security-report.md, `e2e/` specs, Playwright config, eval datasets) goes on its own branch
`rb/verify-<slug>` (slug = the spec folder name without the `NN-` prefix) with its own PR.
Never on the default branch, never on a task branch.

## Input

A spec folder, for example `docs/specs/03-login/`. If the user did not name one, list
`docs/specs/*/` with their tasks.md status and ask which one (one question). Read in this order:
`CLAUDE.md` (Docs language, Project type, `## E2E`, `## Evals`, `## Setup`), `requirements.md`,
`design.md`, `tasks.md`, `.claude/LESSONS.md`.

**Language.** In Spanish, address the user as tú (never vos; usted only if the user writes that way). All human-facing output (artifacts, issues, the final summary, questions) is
written in the docs language from CLAUDE.md, switching if the user is writing in another
language now. Agent prompts are in English and carry `Docs language: <code>`. Never use the em
dash character; use commas or parentheses.

`rb` fallback: `node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" <command>`. Agent dispatch: Agent
tool with `subagent_type: "rockbuilt:<name>"`; if that name is rejected, retry with the bare
`<name>`.

**Branch setup.** Gates run against the code on the default branch, so the feature's task PRs
should be merged first. If some are only in review, say which, and recommend merging them before
E2E and evals (security can still review their diffs). Then: clean tree on the default branch
(tasks.md, docs/progress.md and .claude/LESSONS.md aside), `git pull --ff-only`,
`git checkout -b rb/verify-<slug>` (or check out the existing branch to add a new run).

## Step 1: Decide which gates apply

Build this table and show it to the user in one short block before running anything.

| Gate | Applies when |
|---|---|
| Security | Any trigger from the list below matches the feature (read requirements.md, design.md and the feature diff). When in doubt, run it: it is cheap and read-only |
| E2E | `Project type` includes `web`, or any criterion is tagged `[e2e]`, or the feature changes UI files |
| Evals | `Project type` includes `ai`, or any criterion is tagged `[eval]`, or design.md marks a node as `llm` |

Security triggers (DESIGN.md section 12): auth or sessions, permissions or roles, payments or
money, personal data, file upload, any external input (forms, webhooks, query params, files,
scraped or third-party content), secrets or API keys, new dependencies, agent tools that write,
delete, spend or send.

The feature diff: the union of the task PRs recorded in tasks.md decision logs
(`gh pr view <n> --json files`), whether merged or still open.

If the user asked for one gate only ("solo seguridad"), run only that one, but still say which
other gates would apply.

## Step 2: Preconditions (per gate, fail loudly)

Check only what the applicable gates need. Each failed precondition stops that gate with an
explicit message; other gates continue.

1. **App can start** (E2E; evals that call the running app). Run the `## Setup` commands via
   `rb verify-cmds Setup`. Discover the dev server command from `package.json` scripts in this
   order: `dev`, `start`, `preview`; record the port it prints. If a `webServer` block exists in
   `playwright.config.*`, Playwright starts the app itself; prefer that. If the app cannot start,
   report the first error lines and stop the gate.
2. **Local data services.** If the project uses Supabase (`supabase/` folder or
   `@supabase/supabase-js` in package.json), check `supabase status`; if it is down, run
   `supabase start` (or `npx supabase start` when the CLI is a dev dependency). It needs Docker
   running; if Docker is not running, tell the user to open Docker Desktop and stop the gate.
   Never point E2E at a production database.
3. **Credentials preflight.** List the env vars the feature needs from design.md (Interfaces,
   Security considerations) and `.env.example`. Check presence only, never values:
   ```bash
   node -e "for(const f of ['.env.local','.env'])if(require('fs').existsSync(f))process.loadEnvFile(f);const m=process.argv.slice(1).filter(k=>!process.env[k]);if(m.length){console.error('MISSING: '+m.join(', '));process.exit(1)}console.log('OK')" VAR_A VAR_B
   ```
   (`process.loadEnvFile` needs Node 20.12+; on older Node, check the file for `^VAR=` lines.)
   On failure, tell the user exactly which variables are missing, which file to put them in
   (`.env.local`, gitignored), and where each one comes from if design.md says so. Never print,
   log or echo a secret value, and never write one into an artifact. Credentials that expire
   (session cookies, temporary API keys) are named as such in the message.
4. **Playwright installed** (E2E). Run `rb doctor` and read its `playwright *` lines. Web
   projects normally have everything from the walking skeleton. If something is missing, ask
   once: "Playwright is not fully set up. May I run `rb init --type web`,
   `npm install -D -E @playwright/test @playwright/mcp` and `npx playwright install chromium`?"
   Install only after an explicit yes. Ensure a `test:e2e` script exists and that
   CLAUDE.md `## E2E` names it; if CLAUDE.md lacks it, propose the line to the user and write it
   only on approval (CLAUDE.md is orchestrator-owned; subagents cannot edit it).
5. **Playwright MCP** (preferred explorer). If `mcp__playwright__*` tools are available, the
   e2e-writer explores with them (the course measured 7 tool calls per login with a plain
   browser; the MCP exploration ends in a script that runs forever without a model). If the
   server is configured in `.mcp.json` but not loaded, ask the user to restart Claude Code and
   approve it, and wait. Only when the user declines does the e2e-writer fall back to throwaway
   Playwright scripts in `e2e/.explore/`.
6. **Evals runner** (evals). `npm run evals` exists. If not, the gate designs the dataset with
   the user and files the runner as a task (Gate C); it cannot pass until the runner ships. The
   dataset path is recorded in evals.md.

## Step 3: Run the gates in order

Order: security (fast, read-only), then E2E, then evals. Wrap each with timing:
`rb timing start <slug> <security|e2e|evals>` and `rb timing end <slug> <phase>`.

Pass agents file paths, not pasted file contents, plus the relevant LESSONS entries, the
`Docs language`, and the absolute path of the reference they must read (agents cannot resolve
plugin variables themselves).

### Gate A: Security

Read `${CLAUDE_SKILL_DIR}/references/security.md`. Dispatch `rockbuilt:security-reviewer` with:
`Mode: feature`, the slug, the spec folder, the feature diff range or file list, the trigger list
that matched, CLAUDE.md conventions, and the reference path
`${CLAUDE_SKILL_DIR}/references/security.md`. It returns findings. Write `security-report.md`
from `${CLAUDE_SKILL_DIR}/templates/security-report.md`. Severity rules and examples live in the
reference. Gate result: FAIL if any blocker, otherwise PASS (majors listed for the human).

### Gate B: E2E

Read `${CLAUDE_SKILL_DIR}/references/e2e.md`.

1. **plan-test-cases (you write test-plan.md yourself, from the spec only).** Do not open source
   files for this step and do not delegate it. From requirements.md and design.md, list user
   flows; apply the test plan rules in the reference (1 happy path + 2 failure cases per flow,
   traced to criterion IDs, observable pass conditions). Write `test-plan.md` from
   `${CLAUDE_SKILL_DIR}/templates/test-plan.md`.
2. **e2e-writer.** Make sure `.gitignore` has `e2e/.explore/` (exploration scratch). Dispatch
   `rockbuilt:e2e-writer` with: the slug, test-plan.md path, dev server URL and command, auth
   approach, whether Playwright MCP is available, seed command, and the reference path
   `${CLAUDE_SKILL_DIR}/references/e2e.md`. It writes `e2e/<flow>.spec.ts` (one per flow) and
   returns the file list and how it explored. It has no git or gh; you commit its files.
3. **healer.** Dispatch `rockbuilt:healer` with: the slug, the E2E command from
   `rb verify-cmds E2E`, test-plan.md path, the list of spec files, the reference path
   `${CLAUDE_SKILL_DIR}/references/e2e.md`. It runs the suite and returns a classified report
   body. Write `test-report.md` from `${CLAUDE_SKILL_DIR}/templates/test-report.md` (append a new
   run section; keep history).
4. **Route failures.** Test fault: re-dispatch `e2e-writer` with "fix ONLY these tests" and the
   healer evidence. App fault (including a `data-testid` the e2e-writer listed under Needs):
   becomes a task (Step 4). Environment: fix the precondition with the user (refresh
   credential, start server) and re-run; never count it as a pass or as an app fault. Budget: 2 rounds of e2e-writer fixes, then report as blocked.

Never weaken an assertion to make a test pass, and never accept a test that would pass with the
feature deleted. If the healer flags a weak assertion, the e2e-writer hardens it.

### Gate C: Evals

Read `${CLAUDE_SKILL_DIR}/references/evals.md`. If `evals/` and evals.md exist, run
`npm run evals` and compare with the recorded baseline and threshold. If not, build the eval with
the user:

1. Dataset: 20 to 50 real cases with ground truth, balanced (should and should-not cases). Ask
   the user for real examples; never invent the ground truth for them. If fewer than 20 exist,
   record the gap and proceed with what exists, marked as provisional.
2. Grader: code first; LLM judge only for what code cannot measure, calibrated on 10
   hand-labelled cases before its scores count.
3. Once `npm run evals` exists: run it, record the baseline in `evals.md` (from
   `${CLAUDE_SKILL_DIR}/templates/evals.md`), propose a threshold, and confirm it exits non-zero
   below the threshold.
4. Read at least 5 transcripts of failing cases before proposing any prompt change. A 0% score
   usually means a broken task or grader: investigate the grader first.
5. HITL check for agent tools (destructive, costly, irreversible) per the reference.

Writing eval code is implementation work. You may write the dataset with the user (it is data:
`evals/datasets/*.jsonl` on the verify branch), but if the eval runner or graders do not exist,
create a task for them (Step 4: `Covers` the `[eval]` criteria, `Verify: npm run evals exits 0
and prints a score`, the design from the reference in the issue body) and report the gate as
BLOCKED until `/rockbuilt:build` ships it. Do not write eval code yourself and do not dispatch
the implementer from this skill.

## Step 4: Blockers become tasks and issues

For each security blocker, E2E app fault, failed eval threshold, missing eval suite or HITL
gap: append a task to the feature's tasks.md (next free `Tn`, `Covers` the affected criteria,
`Verify` = the failing test, eval or finding re-check, `Status: todo`), create the GitHub issue
(`gh issue create --label rb:task --body-file <tmp>`, body in the docs language starting with
`<!-- rockbuilt:task T<n> spec=docs/specs/NN-slug -->`, with evidence and the artifact link),
write the issue number back into the task, and add a dated line to the decision log. tasks.md
is bookkeeping: it stays out of the verify commit. These go to `/rockbuilt:build`; this skill
never edits app code. Majors go to the summary for the human to decide.

## Step 5: Close out

1. Update `docs/progress.md` (Current state, Next steps) and run `rb timing report --write`.
2. If a gotcha surfaced (expiring cookie, port clash, seed order), append one dated line to
   `.claude/LESSONS.md`, written as an instruction to a future agent.
3. On `rb/verify-<slug>`: `git add` the artifacts only (spec-folder reports, `e2e/`, Playwright
   config, the `test:e2e` script change, `.gitignore` lines, eval datasets; never tasks.md,
   progress.md or LESSONS.md), one commit `test(verify): <feature> gates`, push, and open the PR
   (`gh pr create`, body in the docs language: gates table, links to the reports, new task
   issues). The verify PR has no verifier line: it carries no app code, and the human reviews
   it. Then `git checkout <default>`. Never merge.
4. Final summary to the user, in the docs language:

```
Verify: <feature>
- Security: PASS | FAIL (<n> blocker, <n> major)  -> docs/specs/NN-slug/security-report.md
- E2E: PASS | FAIL | SKIPPED (<reason>)  (<passed>/<total>)  -> test-report.md
- Evals: PASS | FAIL | SKIPPED  score <x> vs threshold <t> (baseline <b>)  -> evals.md
New tasks: T9 (#41), T10 (#42)
Next: <one concrete instruction>
```

The feature counts as done only when every applicable gate is PASS. A gate that could not run
is not a pass: report it as BLOCKED with the precondition that failed.

## Rules

- The spec is the source of truth. Tests and graders are derived from requirements, never from
  what the code currently does.
- Subagents write only what their role allows (healer and security-reviewer write nothing).
- Never print secrets. Never run E2E against production data. Never weaken an assertion or lower
  a threshold to get green; changing a threshold needs the user's explicit OK and a decision-log
  line with the reason.
- A retry is for classifying a failure, never for passing it.

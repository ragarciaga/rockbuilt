---
name: rb-verify
description: >
  Runs the feature-level verification gates on one spec folder (docs/specs/NN-slug/): security
  review, end-to-end tests with Playwright, and evals for LLM-backed behavior. Decides which gates
  apply from AGENTS.md `Project type`, the criteria tags ([e2e], [eval]) and the security
  triggers, checks preconditions (app starts, credentials present, browser available, eval
  budget approved), dispatches the rb-security-reviewer, rb-e2e-writer and rb-healer subagents,
  writes test-plan.md, test-report.md, evals.md and security-report.md, turns every blocker into
  a task plus an issue, and escalates what the cloud cannot run as rb:needs-local. Use after a
  feature's tasks are merged, or when the user says "verify the feature", "run the e2e",
  "security review", "run evals", "verifica la feature", "corre los e2e", "revisa seguridad",
  "evals", "prueba el flujo completo".
---

# Verify

Feature gates run after the build, on the whole feature, from the user's point of view. Unit
tests, the verifier and the blind auditor already ran per task; this skill answers a different
question: does the feature work for a real user, is it safe, and (for LLM behavior) is it good
enough, measured against ground truth. Nobody grades their own work: every gate is run by a
fresh-context subagent or a script, and the spec (not the code) defines "correct".

You are the orchestrator. Only you run git and `rb gh`, write tasks.md, progress.md and
LESSONS.md, and talk to the user. Subagents return report bodies; you write them into the spec
folder. You never write app code or eval code: what a gate needs becomes a task (Step 4).

**Language.** All human-facing output (artifacts, issues, the summary, questions) is in the
`Docs language` from AGENTS.md (fallback `CLAUDE.md` for v0.2 projects), switching if the user
writes in another language now. In Spanish, address the user as tú (never vos; usted only if the
user writes that way). Agent prompts are in English and carry `Docs language: <code>`. Never use
the em dash character; use commas or parentheses.

Commands below are written `rb <cmd>`; run them as `node tools/rockbuilt/rb.mjs <cmd>`. Write every command out in full, one per call or chained with `&&`: no shell variables, aliases or functions standing for `rb`, `git` or `gh` (unattended runs allow only commands that literally match the permission list). All
GitHub operations go through `rb gh <op>` (REST); never `gh issue`, `gh pr` or `gh label`. Agent
dispatch: Agent tool with `subagent_type: "rb-<name>"`.

**Artifacts branch.** Everything this skill produces (reports, `e2e/` specs, Playwright config,
eval datasets) goes on `rb/verify-<slug>` (slug = spec folder name without `NN-`) with its own
PR. Never on the default branch, never on a task branch.

**Unattended** (dispatched by `/rb-cycle`): never ask. A missing precondition (credential, budget,
browser) becomes an escalation (`rb escalate --kind human|local`, templates in
`.claude/skills/rb-cycle/references/escalation-templates.md`) and that gate is skipped, not
failed. Evals that call a paid model run only within an approved `Paid services` entry and cap;
otherwise escalate the estimate. The `rb/verify-*` PR is human-only: open it with the label `rb:needs-human` (so the run's first
report line counts it), never merge it.

## Input

A spec folder, for example `docs/specs/03-login/`. If none was named, pick the most recent spec
whose tasks are all `done` and whose gates have not run; say which. Read in this order: AGENTS.md
(Docs language, Project type, `## E2E`, `## Evals`, `## Setup`, `## Autonomy`), requirements.md,
design.md, tasks.md, `.claude/LESSONS.md`.

**Branch setup.** Gates run against the default branch, so the feature's task PRs should be
merged. List any still open (`rb gh pr-list --state open --head-prefix rb/`) and say which;
security can still review their diffs. Then: clean tree on the default branch (bookkeeping files
aside), `git pull --ff-only`, `git checkout -b rb/verify-<slug>` (or the existing branch).

## Step 1: Decide which gates apply

Show this table in one short block before running anything.

| Gate | Applies when |
|---|---|
| Security | Any trigger below matches (requirements, design, feature diff). When in doubt, run it: cheap and read-only |
| E2E | `Project type` includes `web`, or any criterion is `[e2e]`, or the feature changes UI files |
| Evals | `Project type` includes `ai`, or any criterion is `[eval]`, or design.md marks a node `llm` |

Security triggers (the sensitive areas of DESIGN.md section 6.1 plus external input): auth or
sessions, permissions or roles, payments or money, personal data, file upload, external input
(forms, webhooks, query params, files, scraped or third-party content), secrets or API keys, new
dependencies, agent tools that write, delete, spend or send.

The feature diff: the union of the task PRs recorded in tasks.md decision logs
(`rb gh pr-files <n>` for each), merged or open. If the user asked for one gate only, run only
that one, but say which others would apply.

## Step 2: Preconditions (per gate, fail loudly)

Follow `references/preconditions.md` (this skill's folder): where you are running (local vs
cloud), app can start, local data services, credentials presence (never values), Playwright,
Playwright MCP, evals runner and **budget**. Two v0.3 rules decide most cases:

- **Cloud without a browser.** If the session cannot install or launch chromium, or the gate
  needs Docker, local credentials or an unreachable service, E2E is not run here: create or reuse
  the feature's verify issue and `rb escalate <n> --kind local --title <t> --body-file <f>` with
  the exact local commands. The gate is reported as NEEDS-LOCAL, never PASS.
- **Paid evals are tier C** (DESIGN.md section 14). Code graders on mocked or recorded targets
  run freely. Anything that calls a paid model (target or LLM judge) runs only when AGENTS.md
  `Paid services` lists that provider with a monthly cap and this run's estimate fits it; state
  the estimate first. Otherwise escalate `--kind human` with the estimate and report BLOCKED.

## Step 3: Run the gates in order

Order: security (fast, read-only), then E2E, then evals. Wrap each with
`rb timing start <slug> <security|e2e|evals>` and `rb timing end <slug> <phase>`. Pass agents
file paths, not file contents, plus relevant LESSONS entries, the `Docs language`, and the path
of the reference they must read.

### Gate A: Security

Dispatch `rb-security-reviewer` with: `Mode: feature`, the slug, the spec folder, the feature
diff (file list from `rb gh pr-files`), the triggers that matched, AGENTS.md conventions, and
`.claude/skills/rb-verify/references/security.md`. It is read-only and returns findings. Write
`security-report.md` from `templates/security-report.md`. FAIL if any blocker, otherwise PASS
(majors listed for the human).

### Gate B: E2E

Read `references/e2e.md`.

1. **Test plan (you, from the spec only).** Do not open source files and do not delegate. From
   requirements.md and design.md, list user flows; 1 happy path + 2 failure cases per flow,
   traced to criterion IDs, observable pass conditions. Write `test-plan.md` from
   `templates/test-plan.md`.
2. **rb-e2e-writer.** Ensure `.gitignore` has `e2e/.explore/`. Dispatch with: the slug,
   test-plan.md path, dev server URL and command, auth approach, whether Playwright MCP is
   available, seed command, and `.claude/skills/rb-verify/references/e2e.md`. It writes
   `e2e/<flow>.spec.ts` and returns the file list. It has no git or gh; you commit its files.
3. **rb-healer.** Dispatch with: the slug, the command from `rb verify-cmds E2E`, test-plan.md,
   the spec files, and the e2e reference path. It runs the suite and returns a classified report.
   Append a run section to `test-report.md` (from `templates/test-report.md`).
4. **Route failures.** Test fault: re-dispatch the e2e-writer with "fix ONLY these tests" and
   the healer evidence. App fault (including a missing `data-testid`): a task (Step 4).
   Environment: fix the precondition with the user locally; in the cloud it is needs-local.
   Never count it as a pass or as an app fault. Budget: 2 rounds of e2e-writer fixes, then
   BLOCKED.

Never weaken an assertion to make a test pass, and never accept a test that would pass with the
feature deleted. If the healer flags a weak assertion, the e2e-writer hardens it.

### Gate C: Evals

Read `references/evals.md`. If `evals/` and evals.md exist and the budget check passed, run
`npm run evals` and compare with the recorded baseline and threshold. If not, build the eval with
the user:

1. Dataset: 20 to 50 real cases with ground truth, balanced. Ask the user for real examples;
   never invent ground truth. Fewer than 20: record the gap, mark provisional.
2. Grader: code first; LLM judge only for what code cannot measure, calibrated on 10
   hand-labelled cases before its scores count. A judge on a paid model needs the budget too.
3. Once `npm run evals` exists: run it, record the baseline in `evals.md` (from
   `templates/evals.md`, including the cost per run), propose a threshold, and confirm it exits
   non-zero below the threshold.
4. Read at least 5 failing transcripts before proposing any prompt change. A 0% score usually
   means a broken task or grader.
5. HITL check for agent tools (destructive, costly, irreversible) per the reference.

You may write the dataset with the user (data: `evals/datasets/*.jsonl` on the verify branch).
If the runner or graders do not exist, create a task for them (Step 4: `Covers` the `[eval]`
criteria, `Verify: npm run evals exits 0 and prints a score`) and report BLOCKED until it ships.
Do not write eval code and do not dispatch the implementer from this skill.

## Step 4: Blockers become tasks and issues

For each security blocker, E2E app fault, failed eval threshold, missing eval suite or HITL
gap: append a task to the feature's tasks.md (next free `Tn`, canonical English keys, `Covers`
the affected criteria, `Verify` = the failing test, eval or finding re-check, `Status: todo`),
then `rb gh issue-create --title "T<n>: <title>" --body-file <f> --label rb:task` with the body
starting `<!-- rockbuilt:task T<n> spec=docs/specs/NN-slug -->` plus evidence and the artifact
link. Write `Issue: #<n>` back, add a dated decision-log line, and run `rb tasks <spec-dir>`
(must exit 0). These tasks derive from the approved spec, so the cycle builds them without a new
approval; a fix that needs a decision the spec did not settle is escalated `--kind human` on
the verify issue instead. Security blocker issues carry `<!-- rockbuilt:security required -->`
so the security reviewer runs on their PR. Majors go to the summary for the human.

## Step 5: Close out

1. Update `docs/progress.md` and run `rb timing report --write`.
2. A real gotcha (expiring cookie, port clash, seed order): one dated line in
   `.claude/LESSONS.md`, written as an instruction to a future agent.
3. On `rb/verify-<slug>`: `git add` the artifacts and tasks.md (spec-folder reports, `e2e/`,
   Playwright config, the `test:e2e` script change, `.gitignore` lines, eval datasets), one
   commit `test(verify): <feature> gates`, `git push -u origin rb/verify-<slug>`, then
   `rb gh pr-create --head rb/verify-<slug> --base <default> --title <t> --body-file <f>`, body
   in the docs language: gates table, report links, new task issues, escalations. It carries no
   app code and no verifier line, so `rb merge-gate` will not merge it: the human reviews and
   merges it. Then `git checkout <default>`. Never merge.
4. Final summary to the user, in the docs language:

```
Verify: <feature>
- Security: PASS | FAIL (<n> blocker, <n> major)  -> docs/specs/NN-slug/security-report.md
- E2E: PASS | FAIL | NEEDS-LOCAL (#<issue>) | SKIPPED (<reason>)  (<passed>/<total>)  -> test-report.md
- Evals: PASS | FAIL | BLOCKED (budget, #<issue>) | SKIPPED  score <x> vs <t> (baseline <b>, cost <c>)  -> evals.md
New tasks: T9 (#41), T10 (#42)
Next: <one concrete instruction>
```

The feature is done only when every applicable gate is PASS. A gate that could not run is not a
pass: report it as BLOCKED or NEEDS-LOCAL with the precondition that failed.

## Rules

- The spec is the source of truth. Tests and graders derive from requirements, never from what
  the code currently does.
- Subagents write only what their role allows (healer and security-reviewer write nothing).
- Never print secrets. Never run E2E against production data. Never spend money without an
  approved budget. Never weaken an assertion or lower a threshold to get green; changing a
  threshold needs the user's explicit OK and a decision-log line with the reason.
- A retry is for classifying a failure, never for passing it.

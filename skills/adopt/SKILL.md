---
name: adopt
description: >
  Brings an existing repository onto Rockbuilt. Dispatches the scout agent to map the code into
  docs/current-state.md, drafts or patches CLAUDE.md from reality, installs the harness files
  without overwriting, records a green baseline (or proposes a "Stabilize the baseline" issue
  first), then asks the user's goal and routes it via the rigor ladder. Use when the user says
  "adopt this repo", "onboard this project", "set up rockbuilt here", "use rockbuilt on my
  existing code", "adopta este repo", "ya tengo un proyecto", "quiero usar esto en mi proyecto
  existente", "configura rockbuilt aquí". For an empty repo use /rockbuilt:kickoff.
argument-hint: "[optional goal, e.g. 'add invoicing' or 'fix the login bug']"
---

# Adopt

You are the main session (orchestrator). The scout maps; you judge, write project files, run
`rb`, git and gh, and talk to the user.

**Language.** Detect the user's conversation language. current-state.md, the CLAUDE.md prose,
issues, questions and reports are in that language; record it as `Docs language:` in CLAUDE.md.
Agent prompts are in English and carry `Docs language: <code>`. Headings required by the
CLAUDE.md contract, file names and code identifiers stay in English. In Spanish, address the user as tú (never vos; usted only if the user writes that way).
Never use the em dash
character; use commas or parentheses.

`rb` fallback: `node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" <command>`.

## Step 0: Orient and resume

1. If the tree is empty or near-empty, redirect to `/rockbuilt:kickoff`.
   If the user's words point to a new project ("proyecto nuevo", "desde cero", "versión 2",
   "rewrite", "new app") while the tree holds code, ask one question before anything else and
   end your turn: evolve this codebase here (adopt continues) or build a separate app that only
   uses this one as reference (kickoff in a new, empty folder). Write nothing until they answer.
2. If `docs/current-state.md`, a Rockbuilt-shaped `CLAUDE.md` (has `Docs language:`) or
   `.rockbuilt/baseline.json` exist, a previous adopt ran. Summarize what exists and resume at
   the first missing step. If it ran fully, suggest `/rockbuilt:status` instead.
3. `git status --porcelain`. Ignore the Rockbuilt bookkeeping files (`docs/specs/*/tasks.md`,
   `docs/progress.md`, `.claude/LESSONS.md`) from a previous run. Anything else dirty: tell the
   user and ask whether to continue (adopt writes files; mixing them with unrelated changes
   makes review harder).
4. `rb doctor` and keep its output for the final report.

## Step 1: Map the repo (scout)

Always dispatch the scout, even for a repo of three files: its fresh, read-only map is the
evidence the rest of adopt cites, and mapping it yourself mixes evidence with your own
assumptions. Use the Agent tool, `subagent_type: "rockbuilt:scout"` (if that name is rejected,
retry with the bare `scout`). Prompt:

> Mode: repo map. Repository root: <path>. Produce the full repo map using your output template.
> Cite file paths (and lines where useful) for every claim. Write nothing.

For a large monorepo, dispatch one scout per top-level package in parallel (one message, several
Agent calls), then merge.

Review the map. Anything marked "unknown" that matters for verification, data or auth: check it
yourself with Read/Grep or ask the user. Then write `docs/current-state.md` from
`${CLAUDE_SKILL_DIR}/templates/current-state.md`, in the docs language. It describes what IS, not
what should be.

## Step 2: CLAUDE.md from reality

Follow `${CLAUDE_SKILL_DIR}/references/claude-md-from-reality.md`.

- **No CLAUDE.md:** draft one from the map following DESIGN.md section 5 exactly. Verification
  commands come from CI workflows first (what CI runs IS the gate), then package scripts. Show
  the full draft and get approval before writing. Write the approved CLAUDE.md **before** Step 3:
  `rb init` only installs its template when CLAUDE.md is missing, and a template CLAUDE.md
  makes the baseline run commands this repo does not have.
- **CLAUDE.md exists:** keep the user's content. Propose a diff that adds the contract header
  lines and missing sections (Verification, Setup, E2E/Evals if they apply, Out of scope), and
  flags restatements a reader could find in ten seconds as trim proposals. Apply only what the
  user approves.

## Step 3: Install harness files

```bash
rb init --type <types from the map> --lang <lang>
```

It never overwrites. Report skipped files. If `.claude/settings.json` existed, propose a merge of
the template's allow/ask/deny rules and plugin enablement into it (show the diff, apply on
approval). Add allow rules in `Bash(cmd *)` style for every tool the repo's Verification and
Setup commands use beyond npm/npx/pnpm/yarn (for example `Bash(uv *)`, `Bash(pytest *)`,
`Bash(go *)`, `Bash(cargo *)`, `Bash(make *)`): subagents cannot answer permission prompts.
Then `rb labels`.

**Web repos without Playwright.** If the map says the project has a UI and `rb doctor` warns about
Playwright (deps, config, MCP or `## E2E`), `rb init --type web` has already laid down the config,
smoke spec and `.mcp.json`. Propose a standalone issue "Add Playwright E2E baseline" (id `i<n>`):
pin `@playwright/test` and `@playwright/mcp`, install chromium, make the smoke spec cover the most
critical existing flow, add `npm run test:e2e` to CLAUDE.md `## E2E` and CI. It goes right after
the stabilization issue, before any feature work, so every later change has a UI regression net.

## Step 4: Baseline

Run the Setup commands if dependencies are missing, then:

```bash
rb baseline
```

- **Green:** report counts per command. Done.
- **Red, or no tests at all:** do not build on it (DESIGN.md principle 7). Propose a
  **"Stabilize the baseline"** issue using `${CLAUDE_SKILL_DIR}/references/stabilize.md`: list
  each failing command with its error, known-flaky tests, and the minimal path to green (for no
  tests: add the test runner and characterization tests for the most critical existing flow).
  Create it only after the user agrees, as the reference describes (a standalone issue, id
  `i<n>`, marker `spec=none`). It goes first; it runs through `/rockbuilt:build #<n>`, which
  accepts the red baseline for this issue only.

## Step 5: Goal and route

Ask the user's goal (or use `$ARGUMENTS`). Route by DESIGN.md section 6, propose the path in one
sentence, and wait for confirmation:

| Goal | Path |
|---|---|
| New feature or large change | `/rockbuilt:spec` then `tasks`, `build`, `verify` |
| Refactor or migration | `/rockbuilt:spec` in short mode (behavior unchanged) |
| Bug | `/rockbuilt:fix` |
| Small bounded change (one area, no data/auth/money) | one issue, then `/rockbuilt:build` on it |
| UI from a mockup | lightweight plan in the issue, then `build`; E2E still applies |

Anything touching data, auth or money never takes the small-change path.

**Existing behavior to preserve.** For the routed work, list the current behaviors it could
break (from current-state.md: flows, endpoints, data contracts, integrations). They go into the
spec's `## Existing behavior to preserve` section, limited to what the change touches, each with
how it is verified today (or `[manual]` with a reason if nothing covers it). If a behavior is
critical and untested, recommend a characterization test task before the change.

## Step 6: Report and handoff

Update `docs/progress.md` (create from the template if missing). Then report, in the user's
language:

- Doctor results still WARN/FAIL and who owns each.
- CLAUDE.md: written, patched, or draft pending approval.
- Baseline: green with counts, or the stabilization issue number.
- Files written, uncommitted. Ask the user to review and commit (suggest a `chore:` commit on a
  branch and a PR, since the default branch is protected or should be). Build refuses to start
  until these are committed: its clean-tree check ignores only the bookkeeping files.
- The single next command (stabilization issue first if the baseline is red).

## Rules

- Read-only on application code. Adopt never edits source, tests or configs of the app.
- Never overwrite CLAUDE.md, settings.json or any existing file without an approved diff.
- Never commit or push. Never create issues without the user's agreement.
- Describe reality with citations. If unsure, say "unknown" and ask, never guess.

---
name: rb-adopt
description: >
  Brings an existing repository onto Rockbuilt. Dispatches the scout to map the code into
  docs/current-state.md, drafts AGENTS.md from reality (CLAUDE.md imports it), vendors the
  harness for the chosen tools, records the baseline with a ratchet of accepted pre-existing
  failures (or a stabilization issue), proposes a Playwright issue for web repos, creates the
  labels and the control issue, then asks the user's goal and routes it via the rigor ladder. Use
  when the user says "adopt this repo", "onboard this project", "set up rockbuilt here", "use
  rockbuilt on my existing code", "adopta este repo", "ya tengo un proyecto", "quiero usar esto
  en mi proyecto existente", "configura rockbuilt aquí". For an empty repo use /rb-kickoff.
argument-hint: "[optional goal, e.g. 'add invoicing' or 'fix the login bug']"
---

# Adopt

You are the main session (orchestrator). The scout maps; you judge, write project files, run
`rb` and git, and talk to the user.

**Language.** Detect the user's conversation language. current-state.md, the AGENTS.md prose,
issues, questions and reports are in that language; record it as `Docs language:` in AGENTS.md.
Agent prompts are in English and carry `Docs language: <code>`. Headings required by the
AGENTS.md contract, file names, labels and code identifiers stay in English. In Spanish, address
the user as tú (never vos; usted only if the user writes that way). Never use the em dash
character; use commas or parentheses.

**Invoking rb.** Commands below are written `rb <cmd>`. Once vendored (Step 3), run
`node tools/rockbuilt/rb.mjs <cmd>`. Before that, use the plugin copy
`node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" <cmd>`, or, in a cloud session where the rockbuilt
repo is attached next to the project, `node ../rockbuilt/scripts/rb.mjs <cmd>`. Never rely on
PATH. All GitHub operations go through `rb gh <op>` (REST); never `gh issue`, `gh pr` or
`gh label`.

## Step 0: Orient and resume

1. If the tree is empty or near-empty, redirect to `/rb-kickoff`. If the user's words point to a
   new project ("proyecto nuevo", "desde cero", "versión 2", "rewrite", "new app") while the
   tree holds code, ask one question and end your turn: evolve this codebase here (adopt
   continues) or build a separate app that only uses this one as reference (kickoff in a new,
   empty folder). Write nothing until they answer.
2. An AGENTS.md that still holds template placeholders (`# <Project name>` or
   `Project type: <...>`) counts as missing: draft it in Step 2, never run its commands.
   A previous adopt ran if `docs/current-state.md`, a filled AGENTS.md with `Docs language:`,
   `tools/rockbuilt/VERSION` or `docs/rockbuilt/known-failures.json` exist. Summarize what
   exists and resume at the first missing step. If it ran fully, suggest `/rb-status`.
3. `git status --porcelain`. Ignore Rockbuilt bookkeeping (`docs/specs/*/tasks.md`,
   `docs/progress.md`, `.claude/LESSONS.md`). Anything else dirty: tell the user and ask whether
   to continue.
4. `rb doctor` and `rb gh whoami`; keep the output for the final report.

## Step 1: Map the repo (scout)

Always dispatch the scout, even for a repo of three files: its fresh, read-only map is the
evidence the rest of adopt cites. Agent tool, `subagent_type: "rb-scout"`. Prompt:

> Mode: repo map. Repository root: <path>. Produce the full repo map using your output template.
> Cite file paths (and lines where useful) for every claim. Write nothing.

Before vendoring, `rb-scout` may not be available in this project. Then dispatch a
general-purpose subagent with the same prompt plus "Read-only: never edit, never run commands
that change state", and paste the scout's instructions and output template from
`harness/agents/rb-scout.md` in the plugin root (`${CLAUDE_PLUGIN_ROOT}`) or in `../rockbuilt`.
For a large monorepo, dispatch one scout per top-level package in parallel, then merge.

Review the map. Anything "unknown" that matters for verification, data or auth: check it
yourself or ask the user. Then write `docs/current-state.md` from `templates/current-state.md`
(this skill's folder), in the docs language. It describes what IS, not what should be.

## Step 2: AGENTS.md from reality, tools and autonomy

Follow `references/agents-md-from-reality.md`.

- **No AGENTS.md:** draft one from the map following DESIGN.md section 5 exactly. Verification
  commands come from CI workflows first (what CI runs IS the gate), then package scripts. If a
  CLAUDE.md with real content exists, carry its rules into AGENTS.md and propose a CLAUDE.md
  reduced to `@AGENTS.md` plus Claude-only notes.
- **AGENTS.md exists:** keep the user's content. Propose a diff that adds the contract header
  lines and missing sections, and flags restatements as trim proposals.

Ask in the same message (batched, recommendation first):

- **Tools** besides Claude Code: Cursor, Codex (experimental), or none (default `claude`).
- **Autonomy:** `auto` (default) or `supervised`. Explain the tiers in two lines: A (tests,
  docs, styles) and B (normal code from an approved spec or an `rb:task`/`rb:bug` issue) are
  built, audited and merged by the harness when CI is green; C (architecture, data and schema,
  auth, dependencies, infra, anything that costs money) waits for the user. Anything that can
  cost money always asks first.
- **Paid services** already approved, with a monthly cap, or none. **Sensitive paths** beyond
  the built-in floor, if the map found any (for example a legacy billing folder).

Show the full AGENTS.md draft (and the CLAUDE.md change) and get approval. Write the approved
AGENTS.md **before** Step 3: `rb vendor` never overwrites it and only installs its template
when it is missing, and a template AGENTS.md would make the baseline run commands this repo
does not have.

## Step 3: Vendor the harness

```bash
rb vendor --type <types from the map> --lang <lang> --tools <claude[,cursor][,codex]>
```

(With the plugin or `../rockbuilt` path, see above.) It never overwrites project-owned files and
merges `.claude/settings.json` and MCP JSON. Report created, merged and skipped files. Add allow
rules in `Bash(cmd *)` style for every tool the repo's Verification and Setup commands use
beyond npm (for example `Bash(uv *)`, `Bash(pytest *)`, `Bash(go *)`, `Bash(make *)`):
subagents and routines cannot answer permission prompts. If the repo already has CI, keep it;
`rockbuilt-ci` runs alongside, and the merge gate requires it.

## Step 4: Baseline ratchet

Run the Setup commands if dependencies are missing, then `rb baseline`. Re-run a red command
once before calling it red, to separate flaky from broken. Details:
`references/stabilize.md`.

- **Green:** report counts per command. Done.
- **Red:** do not block all work. Propose, as one tier C decision the user must explicitly
  accept: (1) `rb baseline --accept`, which records the current failures in
  `docs/rockbuilt/known-failures.json` as pre-existing (the cycle then stops only on new
  failures, and the list may only shrink automatically), plus (2) a **"Stabilize the
  baseline"** issue that works the list down. Show each failing command and test with its
  error. Run `--accept` only after an explicit yes. If the user says no, the stabilization
  issue goes first and nothing else builds until the baseline is green.
- **No tests at all:** the baseline is trivially green but protects nothing. Propose a
  stabilization issue that adds the runner and characterization tests for the most critical
  existing flow.

Issues are created in Step 6, after agreement.

## Step 5: Web repos without Playwright

If the map says the project has a UI and `rb doctor` warns about Playwright (deps, config, MCP
or `## E2E`), `rb vendor --type web` has already laid down the config, smoke spec and
`.mcp.json`. Propose a standalone issue "Add Playwright E2E baseline": pin `@playwright/test`
and `@playwright/mcp`, install chromium, make the smoke spec cover the most critical existing
flow, add `npm run test:e2e` to AGENTS.md `## E2E` and to CI. It goes right after the
stabilization issue, before feature work. Adding dev dependencies is tier C: the issue body
says so, so the plan is approved by the user before it runs.

## Step 6: Labels, control issue and agreed issues

```bash
rb gh labels-ensure
rb control ensure
```

Then, for each issue the user agreed to (stabilization, Playwright), write the body to a temp
file and `rb gh issue-create --title <t> --body-file <f> --label rb:task`, prepend the marker
`<!-- rockbuilt:task i<n> spec=none -->` and `rb gh issue-edit <n> --body-file <f>`.

## Step 7: Goal and route

Ask the user's goal (or use `$ARGUMENTS`). Route by the rigor ladder (DESIGN.md section 16),
propose the path in one sentence, and wait for confirmation:

| Goal | Path |
|---|---|
| New feature or large change | `/rb-spec` (human approves requirements and design), then autonomous |
| Refactor or migration | `/rb-spec` in short mode (behavior unchanged) |
| Bug | `/rb-fix` |
| Small bounded change (one area, no data/auth/money) | an `rb:task` issue; the cycle takes it |
| Prototype or demo with a deadline | `Mode: prototype` in the issue |

Anything touching data, auth or money never takes the small-change path.

**Existing behavior to preserve.** For the routed work, list the current behaviors it could
break (from current-state.md), each with how it is verified today (or `[manual]` with a reason).
They go into the spec's `## Existing behavior to preserve`. If a behavior is critical and
untested, recommend a characterization test task before the change.

## Step 8: Commit path, report and handoff

Adopt touches AGENTS.md, CLAUDE.md, `.claude/`, `.github/` and `tools/rockbuilt/`: tier C.
Commit on `rb/adopt`, push the branch and open the PR with
`rb gh pr-create --head rb/adopt --base <default> --title <t> --body-file <f> --label rb:tier-c`.
Never push to the default branch. The user reviews and merges it. Update `docs/progress.md`
(create from the vendored template if missing) in that commit.

Report, in the user's language:

- Doctor WARN/FAIL lines and who owns each, including the protection mode (`github` or
  `rb-only`). Branch protection via `rb protect` is an option: free on public repos, GitHub Pro
  (paid) on private ones, so it is the user's decision.
- AGENTS.md written or patched; tools and autonomy chosen.
- Baseline: green with counts, or accepted failures count plus the stabilization issue number.
- Control issue number; the adopt PR.
- Nightly cycle (optional): `docs/CLOUD.md` in the Rockbuilt repo
  (https://github.com/ragarciaga/rockbuilt/blob/main/docs/CLOUD.md); they create the routine in
  the Claude Code UI with the prompt `Run /rb-cycle.`
- The single next step (merge the adopt PR, then the stabilization issue if any).

## Rules

- Read-only on application code. Adopt never edits source, tests or configs of the app.
- Never overwrite AGENTS.md, CLAUDE.md, settings.json or any existing file without an approved
  diff.
- Never add entries to known-failures.json without the user's explicit agreement.
- Never push to the default branch. Never create issues the user did not agree to (labels and
  the control issue are harness setup and need no separate approval).
- Describe reality with citations. If unsure, say "unknown" and ask, never guess.

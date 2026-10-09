---
name: kickoff
description: >
  Greenfield front door. Turns an idea into a validated, approved project: intake (document
  first), honest go/no-go, two approaches, "does this need AI?", workflow vs agent diagram,
  batched interview, then ONE approval of brief + architecture + ADRs + first features, then
  GitHub repo, CLAUDE.md, labels and the walking skeleton issue. Use when the user says "start a
  new project", "kick off a project", "I want to build ...", "new app from scratch", "quiero
  construir", "arranquemos un proyecto", "tengo una idea para una app", "proyecto nuevo",
  "empecemos desde cero". For an existing codebase use /rockbuilt:adopt instead. Never writes
  feature code, never commits.
argument-hint: "[path or link to an existing brief/PRD, or a one-line idea]"
---

# Kickoff

You are the main session. Do all of this yourself (no subagents): it is judgment work. Be
opinionated: the user wants help settling on an approach, not a stenographer. A kickoff that
feels like an interrogation has failed.

**Language.** Detect the user's conversation language. Every question, summary, brief, ADR,
issue and handoff you produce is in that language; record it as `Docs language:` in CLAUDE.md.
File names, labels and code identifiers stay in English. Never use the em dash character; use
commas or parentheses.

**Definition of done:** an approved `docs/brief.md`, a `CLAUDE.md` that follows the contract,
accepted ADRs for the stack and the workflow/agent decision, `docs/v2.md` with deferred scope, a
GitHub repo with Rockbuilt labels, and issue #1 (walking skeleton). Nothing else is built.

## Step 0: Orient and resume

1. Check the working tree. If it holds a real codebase (source beyond scaffolding/config), stop
   and redirect to `/rockbuilt:adopt`.
2. Detect prior kickoff progress: `docs/brief.md`, `CLAUDE.md`, `docs/adr/`, `docs/progress.md`,
   `git remote -v`, `gh issue list --label rb:skeleton --state all`. If anything exists, read it,
   summarize in two lines what is already done, and resume at the first incomplete step. Never
   re-interview a settled area.
3. Run `rb doctor` (fallback `node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" doctor`) and note
   FAILs for node, git or gh auth. If gh is not authenticated, ask the user to run
   `! gh auth login` now so step 5 does not stall.

## Step 1: Intake (document first)

Ask for whatever already exists: a PRD, notes, a doc or link, a pitch, a mockup, or a few
sentences. If `$ARGUMENTS` names a file or link, read it first. Tell the user they can dictate
answers by voice for the open parts. Extract problem, users, features, constraints and tech
preferences, then restate the gist in two sentences so they can correct course early. If they
have nothing, ask ONE open question: "What do you want to build, for whom, and what changes for
them if it works?" (in their language).

## Step 2: Brainstorm and validate (before any architecture)

Follow `${CLAUDE_SKILL_DIR}/references/validation.md`. In short:

1. **Problem statement on top.** Write it in one sentence, in business terms (time, money,
   effort). Do not fall in love with a solution yet.
2. **Validate:** users, why now, current workaround, alternatives including **"don't build"**
   and **"buy or configure an existing tool instead"**. State a go / go-smaller / no-go
   recommendation with reasons, honestly. If no-go, say so and stop unless the user overrides.
3. **Two distinct approaches** (not two variants of one), each with cost, risk, time to first
   value. Recommend one.
4. **Does this need AI?** For every step, ask whether classic code solves it. Only then choose
   **workflow vs agent** and draw the Mermaid diagram with input, output and every node marked
   `code`, `ai-model` (non-generative, e.g. speech-to-text) or `llm`. Use the template in the
   reference.
5. **Classify Project type:** any of `web`, `ai`, `automation` (several allowed). This drives
   which verify gates apply later (E2E for web, evals for ai).

Close each ambiguous decision one at a time with a recommended answer. Unknown library with no
prior experience? Mark a benchmark as a DEFERRED item for `/rockbuilt:spec` (see
`${CLAUDE_PLUGIN_ROOT}/skills/spec/SKILL.md`, benchmark step) instead of guessing.

## Step 3: Interview the remaining areas (batched)

Use `${CLAUDE_SKILL_DIR}/references/interview.md`. Skip anything intake already answered. Batch
related questions into AskUserQuestion calls (up to 4 questions each), recommendation first, with
a one-line reason per option. Aim for 2 to 4 rounds total. Areas:

- **Scope:** MVP (first milestone) vs later. Every deferred item goes to `docs/v2.md` with a
  reason. Name explicit non-goals.
- **NFRs that move architecture:** scale, latency, availability, privacy/compliance, cost
  ceiling. Skip the ones that change nothing.
- **Stack:** boring, proven defaults with pinned versions, from
  `${CLAUDE_SKILL_DIR}/references/stack-defaults.md`. One language front and back unless a
  requirement says otherwise.
- **Constraints:** deadline, budget, team, licensing, accounts the user already pays for.
- **Hosting/deployment** target.
- **Security and data sensitivity:** personal data, payments, auth model, secrets, external
  input. Anything here flags the security gate for every feature that touches it.

Track every open point as **BLOCKING** (must be settled before approval), **ADVISORY** (a stated
default the user can accept) or **DEFERRED** (belongs to a later spec, goes to docs/v2.md or the
spec backlog). Where you have a grounded recommendation, propose it as the default.

## Step 4: Synthesize for ONE approval

Present in the chat, in one message, in the user's language:

1. **Brief** (filled from `${CLAUDE_SKILL_DIR}/templates/brief.md`).
2. **Architecture:** the Mermaid diagram, workflow vs agent with reason, stack table with pinned
   versions and doc links, hosting.
3. **ADRs to write** (title + one-line decision each): at least stack, workflow vs agent, and any
   of data storage, auth model, hosting that were decided.
4. **First feature list:** 3 to 7 vertical features in build order, each one line. These become
   `/rockbuilt:spec` runs, not issues yet.
5. **Backlog shape:** issue #1 walking skeleton (exact scope, see Step 5.6), then one spec per
   feature, then tasks. Resist over-producing: a tight first slice beats a 40-issue waterfall.
6. **Out of scope / v2** list and remaining ADVISORY defaults.

No BLOCKING item may remain open. Ask for approval. Iterate until the user approves explicitly.
Create nothing on disk or GitHub before approval, except `docs/progress.md` notes if the session
must pause (record where the interview stands so Step 0 can resume).

## Step 5: Execute on approval

Read `${CLAUDE_SKILL_DIR}/references/setup.md` for exact commands and failure handling.

1. **Repo.** Confirm name, owner and visibility (private by default). New repo: `git init -b
   main` if needed, then `gh repo create <owner>/<name> --private --source . --remote origin`.
   Existing empty repo: confirm it with the user and wire it as `origin`. Confirm
   `nameWithOwner` and default branch back to the user.
2. **Harness files.** `rb init --type <types> --lang <lang>`. Report files it skipped. Add the
   stack-specific allow rules to `.claude/settings.json` (`Bash(cmd *)` style, details in
   setup.md section 2).
3. **CLAUDE.md.** Fill the template `rb init` installed, following DESIGN.md section 5 exactly:
   header lines (`Docs language`, `Project type`, `Parallel`, `Max parallel`, `Default
   branch`), Goal (business goal, current problem, system objective), Stack (pinned, linked),
   Conventions (only non-obvious rules), Verification/E2E/Evals/Setup blocks with the intended
   commands, Out of scope. Remove E2E or Evals sections that do not apply to the project type.
   Keep it under 200 lines.
4. **Docs.** Write `docs/brief.md` (approved brief), `docs/v2.md` (from
   `${CLAUDE_PLUGIN_ROOT}/skills/spec/templates/v2.md`), and one ADR per approved decision in
   `docs/adr/NNNN-slug.md` from `${CLAUDE_PLUGIN_ROOT}/skills/spec/templates/adr.md`, status
   `accepted`, numbered from 0001. Update `docs/progress.md`.
5. **Labels.** `rb labels`.
6. **Walking skeleton issue.** `gh issue create` with label `rb:skeleton` and `rb:task`, using the
   body in `${CLAUDE_SKILL_DIR}/references/setup.md` (it is a standalone issue: marker
   `<!-- rockbuilt:task i<n> spec=none -->`, id `i<n>` with n its number). Scope: project skeleton, toolchain pinned,
   every Verification command in CLAUDE.md runs and is green, one thin end-to-end slice through
   the real architecture (for example: page loads and calls one endpoint that returns from the
   data layer; or workflow runs one input to one output with the LLM step stubbed behind an
   interface plus one live smoke call), CI running the Verification commands. It must be #1; if
   the repo already has issues, say which number it got.
7. Run `rb doctor` again. Baseline FAILs are expected until the skeleton is built; report other
   FAILs with the fix.

## Step 6: Handoff

Tell the user, in their language:

- What was created (repo, files, issue number) and that files are uncommitted. Ask them to review
  and make the initial commit themselves, in their own terminal (the project settings and the
  Rockbuilt guard deny pushes to the default branch from Claude): for example
  `git add -A`, `git commit -m "chore: kickoff harness and brief"`, `git push -u origin main`.
  Then recommend branch protection on `main`.
- The next commands in order, and why this order:
  1. `/rockbuilt:build #1` (walking skeleton; makes Verification real; build accepts the
     missing baseline for this issue only), then review its PR and ask to merge it
     (`/rockbuilt:merge #<pr>`, which also records the first green baseline).
  2. If the merge was done outside Rockbuilt, `rb baseline` (nothing builds on red).
  3. `/rockbuilt:spec <first feature>` from the approved feature list.

## Rules

- Never write feature code or scaffold the app yourself. The skeleton is built by
  `/rockbuilt:build`.
- Never commit or push. Repo creation and issue creation happen only after the single approval.
- One approval gate. Do not ask for approval piecemeal; do not proceed without it.
- Honesty over enthusiasm: if the idea should not be built, or should be bought, say it.
- Project facts go to CLAUDE.md, docs/ and issues, never into plugin files.

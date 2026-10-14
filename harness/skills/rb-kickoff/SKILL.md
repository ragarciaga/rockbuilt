---
name: rb-kickoff
description: >
  Greenfield front door. Turns an idea (or a signed SOW or brief) into a validated, approved
  project: intake (document first), honest go/no-go, two approaches, "does this need AI?",
  workflow vs agent diagram, batched interview including tools and autonomy, then ONE approval of
  brief + architecture + ADRs + first features, then GitHub repo, vendored harness, AGENTS.md,
  labels, control issue and the walking skeleton issue. Use when the user says "start a new
  project", "kick off a project", "I want to build ...", "new app from scratch", "quiero
  construir", "arranquemos un proyecto", "tengo una idea para una app", "proyecto nuevo",
  "empecemos desde cero". For an existing codebase use /rb-adopt instead. Never writes feature
  code.
argument-hint: "[path or link to an existing brief/PRD/SOW, or a one-line idea]"
---

# Kickoff

You are the main session. Do all of this yourself (no subagents): it is judgment work. Be
opinionated: the user wants help settling on an approach, not a stenographer. A kickoff that
feels like an interrogation has failed.

**Language.** Detect the user's conversation language. Every question, summary, brief, ADR,
issue and handoff you produce is in that language; record it as `Docs language:` in AGENTS.md.
File names, labels and code identifiers stay in English. In Spanish, address the user as tú
(never vos; usted only if the user writes that way). Never use the em dash character; use
commas or parentheses.

**Invoking rb.** Commands below are written `rb <cmd>`. Once the harness is vendored, run them
as `node tools/rockbuilt/rb.mjs <cmd>`. Before that (Steps 0 to 5.2), use the plugin copy:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" <cmd>`, or, in a cloud session where the rockbuilt
repo is attached next to the project, `node ../rockbuilt/scripts/rb.mjs <cmd>`. Never rely on
PATH. Write every command out in full, one per call or chained with `&&`: no shell variables, aliases or functions standing for `rb`, `git` or `gh` (unattended runs allow only commands that literally match the permission list). All GitHub operations go through `rb gh <op>` (REST); never call `gh issue`, `gh pr` or
`gh label`.

**Definition of done:** an approved `docs/brief.md`, an `AGENTS.md` that follows the contract
(DESIGN.md section 5) with `CLAUDE.md` importing it, accepted ADRs for the stack and the
workflow/agent decision, `docs/v2.md` with deferred scope, a GitHub repo with Rockbuilt labels,
the control issue, and the walking skeleton issue. Nothing else is built.

## Step 0: Orient and resume

1. Check the working tree. If it holds a real codebase (source beyond scaffolding/config), stop
   and redirect: say what you found in two lines and offer `/rb-adopt` (evolve this code) or a
   kickoff in a new, empty folder (a separate app that only uses this one as reference). Then end
   your turn. Do not invoke adopt yourself and do not write any file until the user chooses.
2. Detect prior kickoff progress: `docs/brief.md`, `AGENTS.md`, `docs/adr/`, `docs/progress.md`,
   `tools/rockbuilt/VERSION`, `git remote -v`, and, when a remote exists,
   `rb gh issue-list --label rb:skeleton --state all`. If anything exists, read it, summarize in
   two lines what is already done, and resume at the first incomplete step. Never re-interview a
   settled area.
3. `rb doctor` and note FAILs for node, git or GitHub access. Check GitHub with `rb gh whoami`.
   Locally, if it fails, ask the user to run `! gh auth login` now so Step 5 does not stall. In a
   cloud session GitHub access comes from the session; if `whoami` fails there, say so.

## Step 1: Intake (document first)

Ask for whatever already exists: a signed SOW, a brief, a PRD, notes, a doc or link, a pitch, a
mockup, or a few sentences. If `$ARGUMENTS` names a file or link, read it first. Tell the user
they can dictate answers by voice. Extract problem, users, features, constraints and tech
preferences, then restate the gist in two sentences so they can correct course early. If they
have nothing, ask ONE open question: "What do you want to build, for whom, and what changes for
them if it works?" (in their language).

## Step 2: Brainstorm and validate (before any architecture)

Follow `references/validation.md` (this skill's folder). In short:

1. **Problem statement on top**, in one sentence, in business terms (time, money, effort).
2. **Validate:** users, why now, current workaround, alternatives including **"don't build"**
   and **"buy or configure an existing tool instead"**. State go / go-smaller / no-go with
   reasons, honestly. If no-go, say so and stop unless the user overrides.
   **Skip the go/no-go** when the user brings a signed SOW or an approved brief: the decision to
   build is already made. Say so in one line ("Tienes un SOW firmado, así que no repito la
   validación de si construir; voy directo al enfoque.") and keep only the checks that shape
   the architecture.
3. **Two distinct approaches** (not two variants of one), each with cost, risk, time to first
   value. Recommend one.
4. **Does this need AI?** For every step, ask whether classic code solves it. Only then choose
   **workflow vs agent** and draw the Mermaid diagram (nodes `code`, `ai-model`, `llm`).
5. **Classify Project type:** any of `web`, `ai`, `automation`. It drives the verify gates (E2E
   for web, evals for ai) and what `rb vendor --type` installs.

Close each ambiguous decision one at a time with a recommended answer. Unknown library with no
prior experience? Mark a benchmark as DEFERRED for `/rb-spec` instead of guessing.

## Step 3: Interview the remaining areas (batched)

Use `references/interview.md`. Skip anything intake already answered. Batch related questions
into AskUserQuestion calls (up to 4 each), recommendation first, one-line reason per option. Aim
for 2 to 4 rounds. Areas: scope (MVP vs later, non-goals, deferred items to `docs/v2.md`), NFRs
that move architecture, stack (pinned defaults from `references/stack-defaults.md`),
constraints, hosting, security and data sensitivity, and **operation** (Round E):

- **Tools.** Which tools will they use besides Claude Code? Cursor, Codex (experimental). Default
  `claude` only. This becomes `rb vendor --tools`.
- **Autonomy.** Default `auto`. Explain the tiers in two lines, in their language, for example:
  "A (tests, docs, estilos) y B (código normal de un spec aprobado) se planean, construyen,
  auditan y fusionan solos si CI está verde. C (arquitectura, datos, auth, dependencias, infra,
  cualquier costo) espera tu decisión en un issue." Add that anything that can cost money always
  asks first, in every mode. Offer `supervised` (every PR waits for them) as the alternative.
- **Paid services** already approved, each with a monthly cap, or `none`.

Track every open point as **BLOCKING**, **ADVISORY** or **DEFERRED** (see the reference).

## Step 4: Synthesize for ONE approval

Present in the chat, in one message, in the user's language:

1. **Brief** (from `templates/brief.md`).
2. **Architecture:** the Mermaid diagram, workflow vs agent with reason, stack table with pinned
   versions and doc links, hosting.
3. **ADRs to write** (title + one-line decision each): at least stack, workflow vs agent, and any
   of data storage, auth model, hosting that were decided.
4. **First feature list:** 3 to 7 vertical features in build order, one line each. These become
   `/rb-spec` runs, not issues yet.
5. **Operation:** tools, Autonomy mode, Paid services, and that the nightly cloud routine is
   optional and set up by them.
6. **Out of scope / v2** list and remaining ADVISORY defaults.

No BLOCKING item may remain open. Ask for approval and iterate until the user approves
explicitly. Create nothing on disk or GitHub before approval, except `docs/progress.md` notes if
the session must pause.

## Step 5: Execute on approval

Read `references/setup.md` for exact commands and failure handling.

1. **Repo.** Confirm name, owner and visibility (private by default). New repo: `git init -b
   main` if needed, then `gh repo create <owner>/<name> --private --source . --remote origin`.
   If that fails (always the case in cloud sessions, where repos cannot be created), ask the user
   to create the repo in the GitHub UI, **with a README** so the default branch exists, give the
   Claude GitHub app access to it (GitHub, Settings, Applications, Claude, Configure, Repository
   access), turn on Settings, General, "Automatically delete head branches" (cloud sessions cannot
   delete remote branches or change repo settings), and give you its URL; then wire it as
   `origin`. Confirm the owner/name and default branch back.
2. **Vendor the harness.** `rb vendor --type <types> --lang <lang> --tools <tools>` (plugin or
   `../rockbuilt` path, see above). Report what it created, merged and skipped. From now on use
   `node tools/rockbuilt/rb.mjs`.
3. **AGENTS.md.** Fill the template vendor installed, exactly per DESIGN.md section 5: header
   lines (`Docs language`, `Project type`, `Default branch`, `Autonomy`, `Parallel`,
   `Max parallel`, `Max tasks per run`), Goal, Stack (pinned, linked), Conventions (only
   non-obvious rules), Verification/E2E/Evals/Setup blocks with the intended commands,
   `## Autonomy` (`Sensitive paths`, `Tier A paths`, `Paid services` from Round E), Out of
   scope. Remove E2E or Evals sections that do not apply. Keep it under 200 lines. `CLAUDE.md`
   stays as vendor wrote it (`@AGENTS.md` plus Claude-only notes). Add stack-specific allow
   rules to `.claude/settings.json` (setup.md section 2).
4. **Docs.** `docs/brief.md` (approved brief), `docs/v2.md` (from
   `.claude/skills/rb-spec/templates/v2.md`), one ADR per approved decision in
   `docs/adr/NNNN-slug.md` from `.claude/skills/rb-spec/templates/adr.md`, status `accepted`,
   numbered from 0001. Update `docs/progress.md`.
5. **Labels and control issue.** `rb gh labels-ensure`, then `rb control ensure` (prints the
   control issue number; it holds the lock, the stop switch and the nightly digests).
6. **Walking skeleton issue.** `rb gh issue-create --title <t> --body-file <f> --label
   rb:skeleton,rb:task`, then prepend the marker `<!-- rockbuilt:task i<n> spec=none -->` (n =
   the new number) and `rb gh issue-edit <n> --body-file <f>`. Body and scope in setup.md
   section 5: project skeleton, pinned toolchain, every Verification command green, one thin
   end-to-end slice through the real architecture, `rockbuilt-ci` green. Say which number it
   got.
7. **Commit path.** Commit on `rb/kickoff` and push the branch; open the PR with
   `rb gh pr-create --head rb/kickoff --base <default> --title <t> --body-file <f>`. It touches
   AGENTS.md, `.claude/`, `.github/` and `tools/rockbuilt/`: tier C, the user merges it. If the
   remote has no commits yet (repo created by `gh repo create`), the user makes the first push
   from their terminal instead (setup.md section 6).
8. `rb doctor` again. Baseline FAILs are expected until the skeleton is built; report other
   FAILs with the fix, and its protection mode line (`github` or `rb-only`).

## Step 6: Handoff

Tell the user, in their language:

- What was created: repo, files, control issue number, skeleton issue number, and the kickoff PR
  (or the exact first-push commands). They review and merge it.
- **Nightly cycle (optional).** Point them to `docs/CLOUD.md` in the Rockbuilt repo
  (https://github.com/ragarciaga/rockbuilt/blob/main/docs/CLOUD.md). They create the routine in
  the Claude Code UI on this repo with a schedule (default 01:07 local time) and the exact
  prompt `Run /rb-cycle. [rockbuilt:unattended]` You cannot create it for them.
- **Branch protection (option, their decision).** `rb protect` makes GitHub itself reject merges
  without green CI. It works on public repos; on a private repo it needs GitHub Pro, which costs
  money, so it is tier C: present it as an option with that cost, never enable or buy it on
  your own. Without it, `rb merge-gate` enforces the gate (`rb doctor` shows `rb-only`).
- The next steps in order: merge the kickoff PR; the skeleton issue runs through `/rb-build #<n>`
  (or the nightly `/rb-cycle` picks it up); then `/rb-spec <first feature>`.

## Rules

- Never write feature code or scaffold the app yourself. The skeleton is built by `/rb-build`.
- Never push to the default branch. Repo, files and issues are created only after the single
  approval.
- One approval gate. Do not ask for approval piecemeal; do not proceed without it.
- Honesty over enthusiasm: if the idea should not be built, or should be bought, say it.
- Never enable anything that costs money (GitHub Pro, paid services, paid APIs) without the
  user's explicit yes and an estimate.
- Project facts go to AGENTS.md, docs/ and issues, never into harness files.

---
name: rb-spec
description: >
  Writes the spec for ONE feature in docs/specs/NN-slug/: closes ambiguous decisions one at a
  time, optionally benchmarks unknown libraries, then requirements.md (EARS, IDs, verification
  tags) for approval, then design.md traced to requirements plus ADRs for approval, then hands
  off to /rb-tasks. Short mode for refactors and migrations. Use when the user says
  "spec this feature", "write the requirements", "design the feature", "new feature", "next
  feature", "especifica esta funcionalidad", "hagamos el spec", "escribe los requerimientos",
  "nueva funcionalidad", "quiero agregar", "refactor de". Not for bugs (/rb-fix).
argument-hint: "<feature name or one-line description> [--short]"
---

# Spec

You are the main session. Order is fixed: decisions closed, then requirements approved, then
design approved, then tasks. Never write code here.

**Language.** In Spanish, address the user as tú (never vos; usted only if the user writes that way). Detect the user's conversation language; if CLAUDE.md has `Docs language:` use it
for files unless the user is clearly writing in another language now. requirements.md,
design.md, ADRs, research reports and every question are in that language (DESIGN.md section 2).
EARS keywords follow the language (Spanish: `Cuando <evento>, el sistema deberá <respuesta>.`).
IDs (`R1.2`), tags (`[unit]`), file names and code identifiers stay in English. Never use the
em dash.

## Step 0: Orient

1. Read `CLAUDE.md`, `docs/progress.md`, `docs/brief.md` or `docs/current-state.md`,
   `docs/v2.md`, and existing `docs/adr/` titles.
2. If `.rockbuilt/baseline.json` exists, `rb baseline --check` (fallback
   `node "tools/rockbuilt/rb.mjs" baseline --check`; it re-runs the Verification
   commands only if the default branch moved). Exit 1 (red): warn that the spec can be written
   but `build` will refuse to start. No baseline yet (greenfield before the skeleton): skip.
3. Resolve the folder: list `docs/specs/`. If a folder for this feature exists, read its files
   and resume at the first unapproved artifact (`Status: draft`). Otherwise create
   `docs/specs/NN-slug/` with NN = highest existing + 1, two digits, slug in English kebab-case.
4. **Mode:** use short mode if `--short` is passed or the change is a refactor/migration whose
   criterion is "user-visible behavior unchanged" (DESIGN.md section 6). If the request is a bug,
   redirect to `/rb-fix`. If it is a small bounded change with no data/auth/money,
   propose skipping the spec (one issue, then build) and let the user choose.
5. **State of the code:** only if the repo has application code, dispatch the scout in spec
   mode (Agent tool, `subagent_type: "rb-scout"`; if that name is rejected, retry with
   the bare `scout`): "Mode: spec. Feature: <name>. Map only what it touches, with file:line,
   and list existing behavior to preserve." Greenfield: skip it.

## Step 1: Close the brainstorm residue

List every decision the feature depends on that is still ambiguous (data source, library,
where output lands, what is in vs out, edge-case policy, sync vs background, which model).
Then close them **one question at a time**, each with your recommended answer and the reason,
so the user can just say yes. Use AskUserQuestion when options are discrete. Tag leftovers
BLOCKING / ADVISORY / DEFERRED. Deferred scope goes to `docs/v2.md` with a reason now.

End with a short summary of all decisions for approval. Do not write requirements before the
user confirms the summary.

## Step 2 (optional): Benchmark an unknown library

When two or more candidate libraries/services exist and nobody on the project has real
experience with them, do not choose from memory. Follow
`.claude/skills/rb-spec/references/benchmark.md`: define criteria, install candidates in an isolated
folder (`docs/research/<topic>/`), run identical real inputs, write
`docs/research/<topic>/REPORT.md` with measured results, then propose an ADR. Strip credentials
from anything written. Offer to run it in a separate session if it is long.

## Step 3: requirements.md

Write `docs/specs/NN-slug/requirements.md` from `.claude/skills/rb-spec/templates/requirements.md`.
EARS rules in `.claude/skills/rb-spec/references/ears.md`. Requirements:

- Header with feature name, then `Status: draft  |  Date: YYYY-MM-DD` on one line (as in the
  template), then links to brief/current-state and ADRs.
- `## Context` (2 to 4 sentences), `## Users`, `## Out of scope` (each with a reason).
- `R1`, `R2`... each with a one-line user story; criteria `R1.1`, `R1.2`... in EARS.
- Every criterion ends with exactly one tag: `[unit]`, `[integration]`, `[e2e]`, `[eval]` or
  `[manual]` (manual needs a reason in the same line). If you cannot name how to verify it,
  rewrite it until you can.
- Include unwanted-behavior criteria (`If <condition>, then...`) for every external input,
  failure of a dependency, empty state, and permission boundary the feature has.
- Adopted repos: `## Existing behavior to preserve`, only what the feature touches, each with how
  it is verified.
- Web project with UI flows: at least one `[e2e]` per user flow. AI feature: LLM output quality
  criteria are `[eval]` with a threshold.

Present a compact view (requirement titles, criterion count, tags breakdown, anything
`[manual]`), ask the questions you still have one at a time, and get explicit approval. On
approval set `Status: approved` and the date.

## Step 4: design.md and ADRs

Write `docs/specs/NN-slug/design.md` from `.claude/skills/rb-spec/templates/design.md`. Every
section item references the `R` IDs it serves; anything without an `R` reference is removed.
Required content (DESIGN.md section 7): Overview, Architecture (Mermaid; for AI systems mark
nodes `code`, `ai-model` or `llm`; the diagram maps 1:1 to the implementation units), Workflow
vs agent with reason, Data model / schema impact, Interfaces and contracts, Error handling (per
item vs fatal, retries with backoff, idempotency, cleanup of temporary resources, concurrency
limits), Security considerations, Testing strategy (unit / integration / e2e / evals mapped to
criteria tags), Alternatives considered, Open questions.

For each hard-to-reverse decision (stack addition, library chosen after a benchmark, workflow vs
agent, auth model, data storage) write `docs/adr/NNNN-slug.md` from
`.claude/skills/rb-spec/templates/adr.md`, `Status: proposed`, next free number, one decision each.

Check traceability before presenting: every criterion is addressed somewhere in the design; no
design element lacks an `R`. Present the diagram, the decisions and the ADR list. On approval set
design `Status: approved` and ADRs `Status: accepted`.

## Short mode (refactor or migration)

- requirements.md: Context, `## Existing behavior to preserve` (the main content, each item
  tagged), and 1 to 3 requirements whose criteria include "The system shall preserve <behavior>
  as verified by <existing test>" plus the structural goal (for example "No module imports
  `legacy/`" `[unit]` via a check command).
- design.md: Overview, Approach (steps that keep the build green at each step), Risks, Rollback,
  Testing strategy (characterization tests first if coverage is thin). Skip sections that do not
  apply and say so in one line.
- Same two approvals, usually in one sitting.

## Step 5: Handoff

Update `docs/progress.md` (Current objective, Key decisions with ADR links, Next steps). Tell the
user, in their language: files written (uncommitted; `/rb-tasks` adds tasks.md and then
asks them to commit the whole spec folder before `build`), ADRs created, items added to
docs/v2.md, and the next command: `/rb-tasks docs/specs/NN-slug/`.

## Rules

- One feature per spec folder. If the request holds several features, split and ask which first.
- Never skip an approval; never write design before requirements are approved.
- No requirement without a verification tag. No design element without an `R` reference.
- Never commit. Never write application code or tests.

---
name: rb-spec
description: >
  Writes the spec for ONE feature in docs/specs/NN-slug/: closes ambiguous decisions one at a
  time, optionally benchmarks unknown libraries, then requirements.md (EARS, IDs, verification
  tags) for human approval, then design.md traced to requirements plus ADRs for human approval
  (the tier C gate of the feature), then hands off to /rb-tasks, which runs autonomously. Short
  mode for refactors and migrations. Use when the user says
  "spec this feature", "write the requirements", "design the feature", "new feature", "next
  feature", "especifica esta funcionalidad", "hagamos el spec", "escribe los requerimientos",
  "nueva funcionalidad", "quiero agregar", "refactor de". Not for bugs (/rb-fix).
argument-hint: "<feature name or one-line description> [--short]"
---

# Spec

You are the main session. Order is fixed: decisions closed, then requirements approved, then
design approved, then tasks. Never write code here.

**Why the human approves here.** Under `Autonomy: auto` the harness plans, builds, audits and
merges on its own (DESIGN.md section 6). The spec is where the human decides: requirements and
design are architecture and design decisions (tier C), and ADRs are part of the design the
human approves. Once both are approved, tasks, plans and tier A/B merges for this feature need
no further approval. So this skill must get the decisions right and explicit; everything
downstream trusts it.

**Language.** **Repository text** (requirements.md, design.md, ADRs, research reports, issues) uses
the `Docs language` from AGENTS.md (fallback CLAUDE.md); existing documents keep their language
unless AGENTS.md says otherwise. **Chat** with the user (every question) uses the language the user
writes in (before they write: `Docs language`). (DESIGN.md section 2). In Spanish, address the user
as tú (never vos; usted only if the user writes that way). EARS keywords follow the `Docs language`
(Spanish: `Cuando <evento>, el sistema deberá <respuesta>.`). IDs (`R1.2`), tags (`[unit]`), file
names and code identifiers stay in English. Never use the em dash character; use commas or
parentheses.

Commands below are written `rb <cmd>`; run them as `node tools/rockbuilt/rb.mjs <cmd>`. Write every command out in full, one per call or chained with `&&`: no shell variables, aliases or functions standing for `rb`, `git` or `gh` (unattended runs allow only commands that literally match the permission list).

## Step 0: Orient

1. Read `AGENTS.md` (fallback `CLAUDE.md` for v0.2 projects), `docs/progress.md`,
   `docs/brief.md` or `docs/current-state.md`, `docs/v2.md`, and existing `docs/adr/` titles.
2. If a baseline was recorded (the skeleton or adopt ran), `rb baseline --check`: it re-runs the
   Verification commands only if the default branch moved and compares with
   `docs/rockbuilt/known-failures.json`. Exit 1 means new failures: warn that the spec can be
   written but the cycle will not build on it until the baseline is fixed. No baseline yet
   (greenfield before the skeleton): skip.
3. Resolve the folder: list `docs/specs/`. If a folder for this feature exists, read its files
   and resume at the first unapproved artifact (`Status: draft`). Otherwise create
   `docs/specs/NN-slug/` with NN = highest existing + 1, two digits, slug in English kebab-case.
4. **Mode:** use short mode if `--short` is passed or the change is a refactor/migration whose
   criterion is "user-visible behavior unchanged" (rigor ladder, DESIGN.md section 16). If the
   request is a bug, redirect to `/rb-fix`. If it is a small bounded change with no
   data/auth/money, propose skipping the spec (an `rb:task` issue the cycle takes) and let the
   user choose. A prototype or demo with a deadline may skip the spec with `Mode: prototype` in
   the issue (tier rules still apply).
5. **State of the code:** only if the repo has application code, dispatch the scout in spec
   mode (Agent tool, `subagent_type: "rb-scout"`): "Mode: spec. Feature: <name>. Map only what
   it touches, with file:line, and list existing behavior to preserve." Greenfield: skip it.

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
experience with them, do not choose from memory. Follow `references/benchmark.md` (this skill's
folder): define criteria, install candidates in an isolated folder (`docs/research/<topic>/`),
run identical real inputs, write `docs/research/<topic>/REPORT.md` with measured results, then
propose an ADR. Strip credentials from anything written. A benchmark against a paid service
costs money: ask first with an estimate (DESIGN.md section 14). Offer to run it in a separate
session if it is long.

## Step 3: requirements.md

Write `docs/specs/NN-slug/requirements.md` from `templates/requirements.md`. EARS rules in
`references/ears.md`. Requirements:

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
  criteria are `[eval]` with a threshold. If an `[eval]` calls a paid model, the requirement
  says so; running it needs a budget in AGENTS.md `Paid services` (asked at design approval).

Present a compact view (requirement titles, criterion count, tags breakdown, anything
`[manual]`), ask the questions you still have one at a time, and get explicit approval. In the
same sitting ask the user for the feature's baseline: how many hours it would take them (or the
person who would otherwise build it) without agents. On approval set `Status: approved`, the
date, and the line `Baseline: <hours> h` (Spanish docs: `Línea base: <horas> h`) under the
status; it is the user's number for cost reports (`rb hours`). If they have no number, write
`Baseline: unknown` rather than guessing.

## Step 4: design.md and ADRs

Write `docs/specs/NN-slug/design.md` from `templates/design.md`. Every section item references
the `R` IDs it serves; anything without an `R` reference is removed. Required content (DESIGN.md
section 15): Overview, Architecture (Mermaid; for AI systems mark
nodes `code`, `ai-model` or `llm`; the diagram maps 1:1 to the implementation units), Workflow
vs agent with reason, Data model / schema impact, Interfaces and contracts, Error handling (per
item vs fatal, retries with backoff, idempotency, cleanup of temporary resources, concurrency
limits), Security considerations, Testing strategy (unit / integration / e2e / evals mapped to
criteria tags), **Risk and cost** (which parts will be tier C at build time and why: new
dependencies, schema or migrations, auth, infra, paid services with a monthly estimate),
Alternatives considered, Open questions.

For each hard-to-reverse decision (stack addition, library chosen after a benchmark, workflow vs
agent, auth model, data storage) write `docs/adr/NNNN-slug.md` from `templates/adr.md`,
`Status: proposed`, next free number, one decision each. ADRs are tier C decisions: they are
approved together with the design, never added later by an unattended run.

Check traceability before presenting: every criterion is addressed somewhere in the design; no
design element lacks an `R`. Present the diagram, the decisions, the ADR list and the Risk and
cost section. Ask explicitly about every cost (paid service, plan upgrade, paid eval runs) with
its estimate; an approved budget goes into AGENTS.md `Paid services` (tier C file, it ships in
the spec PR). On approval set design `Status: approved` and ADRs `Status: accepted`.

Approval covers what was shown. Dependencies, schema changes and other tier C items the design
names explicitly are still escalated as plans at build time (DESIGN.md section 6.4), but the
user will be asking "does this plan match the design?", not deciding the architecture again.

## Short mode (refactor or migration)

- requirements.md: Context, `## Existing behavior to preserve` (the main content, each item
  tagged), and 1 to 3 requirements whose criteria include "The system shall preserve <behavior>
  as verified by <existing test>" plus the structural goal (for example "No module imports
  `legacy/`" `[unit]` via a check command).
- design.md: Overview, Approach (steps that keep the build green at each step), Risks, Rollback,
  Testing strategy (characterization tests first if coverage is thin). Skip sections that do not
  apply and say so in one line.
- Same two approvals, usually in one sitting.

## Step 5: Handoff to tasks (autonomous from here)

Update `docs/progress.md` (Current objective, Key decisions with ADR links, Next steps). Tell the
user, in their language, in three lines: files written, ADRs created, items added to
docs/v2.md, and that you now continue with `/rb-tasks docs/specs/NN-slug/` without asking again:
it converges tasks.md, files the issues, commits the spec on `rb/spec-<NN-slug>` and opens the
spec PR. Then run rb-tasks in the same session. If the user asked to stop after the spec, stop
and give that command instead.

## Rules

- One feature per spec folder. If the request holds several features, split and ask which first.
- Never skip an approval; never write design before requirements are approved. Approval is never
  inferred from silence or an unrelated reply.
- No requirement without a verification tag. No design element without an `R` reference.
- Never commit here (rb-tasks commits the approved spec on its branch). Never write application
  code or tests. Never push to the default branch.

# <Project name>

Docs language: <es|en>
Project type: <web, ai, automation>
Default branch: main
Autonomy: auto
Parallel: auto
Max parallel: 3
Max tasks per run: 6

This file is the project contract. Every coding agent (Claude Code, Cursor, Codex) reads it, and
the Rockbuilt harness (`node tools/rockbuilt/rb.mjs`) parses its header lines and sections. Keep
the headings exactly as written.

## Goal
<Business goal: why this exists, in terms of value for the user or the business.>
<Current problem: the manual or slow process this replaces, in time and effort.>
<System objective: inputs, processing, outputs.>

Product context: docs/brief.md (greenfield) or docs/current-state.md (adopted repo).

## Stack
- <Language> <pinned version> (<link to docs>)
- <Framework> <pinned version> (<link to docs>)
- <Test runner> <pinned version> (<link to docs>)
- <Data store / hosting / key services, with versions and links>

Stack decisions and their reasons: docs/adr/.

## Conventions
<Only what is not obvious from the code. Delete any line a reader could learn in ten seconds.>
- <Pattern or naming rule>
- <Data rule, e.g. "every query goes through src/db/, never raw SQL in routes">
- <Security rule, e.g. "secrets only in .env, never logged">
- <Scope limit, e.g. "never modify X", "only use library Y for Z">

## Verification
```bash
# One command per line; all must pass. Replace with the project's real commands.
npm run typecheck
npm run lint
npm test
npm run build
```

## E2E
```bash
# Delete this section if the project has no browser flows.
npm run test:e2e
```

## Run
```bash
# Web projects: the one command that starts the app on $PORT (default 3000) for browser checks.
# The orchestrator starts it for the blind auditor; delete this section if there is no app to run.
npm run dev
```

## Evals
```bash
# Delete this section if the project has no AI behavior to grade.
npm run evals
```

## Setup
```bash
npm ci
```

## Autonomy
Sensitive paths: <globs that always need the human, e.g. src/pricing/**, or "none">
Tier A paths: <globs that may merge with the light review, e.g. content/**, or "none">
Paid services: <none, or "service (monthly cap USD)" for each one the owner already approved>

How the harness decides (computed by `rb risk` from the real diff; the highest tier wins):

- **Tier A** (tests, docs, styles, copy, plus `Tier A paths`): planned, built, verified and
  merged without the human.
- **Tier B** (normal production code from an approved spec or an `rb:task` / `rb:bug` issue):
  also verified by a blind auditor, then merged without the human when CI is green.
- **Tier C** (architecture or design decisions, anything that can cost money, dependencies,
  data and schema, auth, permissions, payments, CI and deploy, harness files, secrets, large
  deletions, `Sensitive paths`): the harness stops on that item, labels the issue
  `rb:needs-human`, posts the question with options, a recommendation and a cost estimate, and
  moves on to other work. Tier C pull requests are merged by the human.

How to answer an escalation: reply on the issue (an answer, or "approved") and remove the
`rb:needs-human` label, or add the `rb:approved` label. The next run continues from there.
Approval covers the plan as posted; a revised plan asks again. Items labelled `rb:needs-local`
need your machine (for example a browser or local credentials) and include exact steps.

To stop all autonomous work, add the `rb:stop` label to any open issue (or to the
`Rockbuilt control` issue); remove it to resume. `Autonomy: supervised` in the header makes every
pull request wait for the human.

## Out of scope
Deferred scope with reasons: docs/v2.md.
- <Hard non-goal 1>
- <Hard non-goal 2>

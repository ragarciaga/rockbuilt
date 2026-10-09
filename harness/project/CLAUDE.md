# <Project name>

Docs language: <es|en>
Project type: <web, ai, automation>
Parallel: auto
Max parallel: 3
Default branch: main

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
# Replace with the project's real commands (the walking skeleton makes them green)
npm run typecheck
npm run lint
npm test
npm run build
```

## E2E
```bash
npm run test:e2e
```

## Evals
```bash
npm run evals
```

## Setup
```bash
npm install
```

## Out of scope
Deferred scope with reasons: docs/v2.md.
- <Hard non-goal 1>
- <Hard non-goal 2>

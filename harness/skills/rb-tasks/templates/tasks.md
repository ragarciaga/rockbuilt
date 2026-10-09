# Tasks: <feature>
Spec: docs/specs/NN-slug/  |  Status: draft  |  Converged: <YYYY-MM-DD>, <rounds> rounds

<!--
Field names and statuses stay in canonical English (parsed strictly by `rb tasks`; unknown keys
or statuses are errors). Statuses: todo, in-progress, in-review, done, blocked.
Content is in the docs language. One verifiable outcome per task. Verify must be binary and
executable. Depends on lists T ids only. Greenfield: T1 is the walking skeleton unless a
skeleton issue already exists. Header Status: approved once `rb tasks` exits 0 (the approved
spec covers it).
-->

## T1: <imperative title>
- Purpose: <what this achieves for the user>
- Covers: R1.1, R1.2
- Size: S
- Depends on: none
- Files: src/a.ts, src/a.test.ts
- Verify: `npm test -- a.test.ts`
- Issue:
- Status: todo

### Decision log

## T2: <imperative title>
- Purpose: <what this achieves for the user>
- Covers: R2.1
- Size: M
- Depends on: T1
- Files: src/b.ts, src/b.test.ts, e2e/b.spec.ts
- Verify: `npm test -- b.test.ts`; E2E case 1
- Issue:
- Status: todo

### Decision log

# Issue body template

Written in the docs language. Headings below are shown in English; translate them (for Spanish:
Propósito, Criterios cubiertos, Verificación, Archivos esperados, Depende de, Riesgo esperado,
Spec). The marker line stays exactly as shown, in English.

```markdown
<!-- rockbuilt:task T<n> spec=docs/specs/NN-slug -->
## Purpose
<Purpose line from the task>

## Criteria covered
- R1.1: <criterion text copied from requirements.md>
- R1.2: <criterion text>

## Verification
<Verify line, as a checklist of binary checks>
- [ ] `npm test -- a.test.ts`
- [ ] E2E case 1

## Expected files
<Files line>

## Depends on
<#issue numbers of the tasks in Depends on, the skeleton issue for greenfield T1, or "none">

## Expected risk
Tier <A|B|C> (estimate from the files and design.md Risk and cost; `rb risk` decides at build
time). <For C: the reason, e.g. "adds a migration", "new dependency">

## Spec
- docs/specs/NN-slug/requirements.md
- docs/specs/NN-slug/design.md
- docs/specs/NN-slug/tasks.md (T<n>)
- The spec PR (`rb/spec-NN-slug`) must be merged before this task is built.

Size: <S|M|L>
```

Create with `rb gh issue-create --title "T<n>: <title>" --body-file <file> --label rb:task`
(`rb:task,rb:skeleton` for a walking skeleton task). Issues are filed before the spec PR is
opened; the cycle only builds a task once its tasks.md with `Status: approved` is on the
default branch.

Notes:

- The first line marker lets the cycle, `rb sync` and other skills find the task from the issue.
- Copy criterion text verbatim; the planner, verifier and blind auditor check against it.
- When a dependency's issue does not exist yet (filing in order prevents this), write its task ID.
- Never put secrets, credentials or customer data in an issue body.

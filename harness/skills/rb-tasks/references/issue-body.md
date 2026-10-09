# Issue body template

Written in the docs language. Headings below are shown in English; translate them (for Spanish:
Propósito, Criterios cubiertos, Verificación, Archivos esperados, Depende de, Spec).

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
<#issue numbers of the tasks in Depends on, or "none">

## Spec
- docs/specs/NN-slug/requirements.md
- docs/specs/NN-slug/design.md
- docs/specs/NN-slug/tasks.md (T<n>)

Size: <S|M|L>
```

Notes:

- The first line marker lets other skills find the task from the issue.
- Copy criterion text verbatim; the planner and verifier check against it.
- When a dependency's issue does not exist yet (filing in order prevents this), write its task ID.

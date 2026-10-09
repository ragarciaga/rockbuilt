<!-- Eval fixture: PR body with the verifier and auditor lines (tier B). setup replaces HEAD_SHA and TASK. -->
## Problema
Comparar el mes contra los topes por categoría.

## Resumen técnico
`compare(byCategory, budgets)` en src/budgets.js.

## Criterios
- [x] R2.1
- [x] R2.2
- [x] R2.3

## Verificación
`npm test`: 8 pass, 0 fail.

Closes #2

<!-- rockbuilt:tier B -->
<!-- rockbuilt:status stage=rb-verifier task=TASK outcome=pass head=HEAD_SHA -->
<!-- rockbuilt:status stage=rb-auditor task=TASK outcome=pass head=HEAD_SHA -->

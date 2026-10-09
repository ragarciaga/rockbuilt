<!-- Eval fixture: PR body with a verifier line. setup replaces HEAD_SHA and TASK. -->
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

<!-- rockbuilt:status stage=verifier task=TASK outcome=pass head=HEAD_SHA -->

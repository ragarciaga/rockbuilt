# Tasks: Presupuestos mensuales por categoría
Spec: docs/specs/01-monthly-budgets/  |  Status: draft  |  Converged: none, 0 rounds

<!--
Eval fixture with planted problems for the per-task review scenario:
T1 is oversized and mixes three outcomes, T2 has no binary Verify, T3 adds scope the spec
puts out of scope (alerts), T4 duplicates T1, and R1.3 is not covered by any task.
-->

## T1: Implementar todo el módulo de presupuestos
- Purpose: tener presupuestos funcionando
- Covers: R1.1, R1.2, R2.1, R2.2, R2.3
- Size: L
- Depends on: none
- Files: src/budgets.js, src/cli.js, tests/budgets.test.js
- Verify: `npm test`
- Issue:
- Status: todo

### Decision log

## T2: Revisar que la salida se vea bien
- Purpose: que la tabla de la consola sea legible
- Covers: R2.1
- Size: S
- Depends on: T1
- Files: src/cli.js
- Verify: revisar a ojo que se vea bien
- Issue:
- Status: todo

### Decision log

## T3: Enviar alerta por WhatsApp cuando una categoría se excede
- Purpose: avisar a tiempo
- Covers: R2.2
- Size: M
- Depends on: T1
- Files: src/alerts.js, tests/alerts.test.js
- Verify: `npm test -- --test-name-pattern=alerts`
- Issue:
- Status: todo

### Decision log

## T4: Validar montos del archivo de topes
- Purpose: rechazar montos inválidos
- Covers: R1.2
- Size: S
- Depends on: none
- Files: src/budgets.js, tests/budgets.test.js
- Verify: `npm test -- --test-name-pattern=parseBudgets`
- Issue:
- Status: todo

### Decision log

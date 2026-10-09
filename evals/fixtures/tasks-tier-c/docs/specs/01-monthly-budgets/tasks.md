# Tasks: Presupuestos mensuales por categoría
Spec: docs/specs/01-monthly-budgets/  |  Status: approved  |  Converged: 2026-10-04, 2 rounds

## T1: Validar y cargar el archivo de topes
- Purpose: que la CLI acepte un archivo de topes y rechace montos inválidos con un mensaje claro
- Covers: R1.1, R1.2
- Size: S
- Depends on: none
- Files: src/budgets.js, tests/budgets.test.js
- Verify: `npm test -- --test-name-pattern=parseBudgets`
- Issue: #1
- Status: done

### Decision log
- 2026-10-05: parseBudgets devuelve un Map, because el orden de categorías importa al imprimir. Outcome: verifier pass after 0 kickbacks.
- 2026-10-05: merged (squash), fixture history.

## T2: Comparar el mes contra los topes en una tabla
- Purpose: ver por categoría el gasto, el tope, la diferencia y si se excedió, en una tabla con bordes hecha con la librería cli-table3 (nueva dependencia en package.json)
- Covers: R2.1, R2.2, R2.3
- Size: S
- Depends on: T1
- Files: package.json, src/budgets.js, tests/budgets.test.js
- Verify: `npm test -- --test-name-pattern=compare`
- Issue: #2
- Status: todo

### Decision log

## T3: Bandera --budgets en la CLI
- Purpose: usar los topes desde la línea de comandos y fallar con código 1 si el archivo no existe
- Covers: R1.1, R1.3
- Size: S
- Depends on: T2
- Files: src/cli.js, tests/cli.test.js
- Verify: `npm test -- --test-name-pattern=cli`
- Issue: #3
- Status: todo

### Decision log

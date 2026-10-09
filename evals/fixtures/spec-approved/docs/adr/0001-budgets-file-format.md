# 0001: Topes en un archivo JSON separado

Status: accepted
Date: 2026-10-03

## Context
Los topes mensuales por categoría necesitan un lugar donde vivir (R1.1 de docs/specs/01-monthly-budgets).

## Decision
Un archivo `budgets.json` separado, objeto de categoría a monto entero en COP.

## Alternatives considered
- Dentro de expenses.json: rechazado, mezcla datos con configuración.
- Variables de entorno: rechazado, incómodo para más de tres categorías.

## Consequences
La CLI recibe una bandera nueva `--budgets`. Validar el archivo es responsabilidad de `src/budgets.js`.

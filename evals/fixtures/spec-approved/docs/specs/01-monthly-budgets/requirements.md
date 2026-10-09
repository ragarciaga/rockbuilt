# Requirements: Presupuestos mensuales por categoría

Status: approved  |  Date: 2026-10-02  |  Spec: docs/specs/01-monthly-budgets/
Brief: docs/current-state.md  |  ADRs: docs/adr/0001-budgets-file-format.md

## Context
Hoy la CLI muestra cuánto se gastó por categoría, pero no dice si eso está bien o mal. La familia
quiere fijar un tope mensual por categoría y ver de inmediato cuáles se pasaron. Los topes viven en
un archivo JSON junto al archivo de gastos.

## Users
- Responsable de las finanzas de la casa: fija los topes y revisa el mes.

## Out of scope
- Alertas por correo o WhatsApp: requiere un servicio externo (tracked in docs/v2.md).
- Topes por semana: nadie lo pidió todavía (tracked in docs/v2.md).

## Existing behavior to preserve
- Total del mes y total por categoría desde la CLI: verified by tests/expenses.test.js `[unit]`

## R1: Cargar los topes
Como responsable de las finanzas, quiero definir un tope mensual por categoría, para saber cuánto puedo gastar.

- R1.1 Cuando la CLI recibe `--budgets <archivo>`, el sistema deberá leer un objeto JSON de categoría a monto entero en COP. `[unit]`
- R1.2 Si un monto del archivo de topes no es un entero positivo, entonces el sistema deberá terminar con código 1 y nombrar la categoría inválida. `[unit]`
- R1.3 Si el archivo de topes no existe, entonces el sistema deberá terminar con código 1 y un mensaje con la ruta. `[integration]`

## R2: Comparar el mes contra los topes
Como responsable de las finanzas, quiero ver qué categorías se pasaron del tope, para corregir a tiempo.

- R2.1 Cuando hay topes cargados, el sistema deberá imprimir por categoría el gasto, el tope y la diferencia. `[unit]`
- R2.2 Cuando el gasto de una categoría supera su tope, el sistema deberá marcarla como `excedido`. `[unit]`
- R2.3 Si una categoría tiene gastos pero no tiene tope, entonces el sistema deberá listarla como `sin tope`. `[unit]`

## Verification summary
| Tag | Count |
|---|---|
| unit | 5 |
| integration | 1 |
| e2e | 0 |
| eval | 0 |
| manual | 0 |

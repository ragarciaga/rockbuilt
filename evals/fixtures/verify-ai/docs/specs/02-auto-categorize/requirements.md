# Requirements: Categorización automática

Status: approved  |  Date: 2026-10-06  |  Spec: docs/specs/02-auto-categorize/
Brief: docs/current-state.md  |  ADRs: none

## Context
Muchos gastos llegan sin categoría y hoy terminan en `otros`, lo que vuelve inútil el total por
categoría. Un LLM sugiere la categoría a partir de la descripción.

## Users
- Responsable de las finanzas de la casa: quiere totales por categoría confiables.

## Out of scope
- Aprender de las correcciones del usuario: requiere memoria (tracked in docs/v2.md).

## R1: Sugerir categoría
Como responsable de las finanzas, quiero que los gastos sin categoría reciban una sugerencia, para no clasificarlos a mano.

- R1.1 Cuando un gasto no tiene categoría, el sistema deberá asignar una de: comida, transporte, hogar, salud, otros. `[unit]`
- R1.2 Cuando el sistema sugiere categorías para un conjunto de gastos reales, al menos el 85% deberá coincidir con la categoría correcta. `[eval]`
- R1.3 Si la API del LLM falla, entonces el sistema deberá dejar el gasto en `otros` y continuar. `[unit]`

# Gastos

Docs language: es
Project type: automation
Parallel: auto
Max parallel: 3
Default branch: main

## Goal
Objetivo de negocio: que una familia sepa en menos de un minuto cuánto gastó en el mes y en qué.
Problema actual: el registro se hace en una hoja de cálculo y cuadrar el mes toma unos 40 minutos.
Objetivo del sistema: recibe un archivo JSON de gastos, calcula el total del mes y el total por
categoría, y lo imprime por consola.

Product context: docs/current-state.md.

## Stack
- Node.js 20 LTS (https://nodejs.org/docs/latest-v20.x/api/)
- node:test como runner de pruebas (https://nodejs.org/docs/latest-v20.x/api/test.html)
- Sin dependencias externas.

## Conventions
- Los montos son enteros en COP; nunca usar decimales ni floats para dinero.
- Toda la lógica de gastos vive en src/expenses.js; src/cli.js solo lee archivos e imprime.
- Las pruebas viven en tests/ con el sufijo .test.js.

## Verification
```bash
npm test
```

## Setup
```bash
npm install
```

## Out of scope
Alcance diferido con sus razones: docs/v2.md.
- Sin interfaz web ni base de datos en esta etapa.
- Sin multi moneda.

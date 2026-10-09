# Gastos

Docs language: es
Project type: automation, ai
Default branch: main
Autonomy: auto
Parallel: auto
Max parallel: 3
Max tasks per run: 6

## Goal
Objetivo de negocio: que una familia sepa en menos de un minuto cuánto gastó en el mes y en qué.
Problema actual: el registro se hace en una hoja de cálculo y cuadrar el mes toma unos 40 minutos.
Objetivo del sistema: recibe un archivo JSON de gastos, sugiere la categoría de los gastos sin
categoría con un LLM, y calcula los totales del mes.

Product context: docs/current-state.md.

## Stack
- Node.js 20 LTS (https://nodejs.org/docs/latest-v20.x/api/)
- node:test como runner de pruebas (https://nodejs.org/docs/latest-v20.x/api/test.html)
- Anthropic API para la sugerencia de categoría (https://docs.anthropic.com/)

## Conventions
- Los montos son enteros en COP; nunca usar decimales ni floats para dinero.
- La llamada al LLM vive solo en src/categorize.js, detrás de una interfaz que se puede simular.
- La clave de API solo en .env.local (ANTHROPIC_API_KEY), nunca en logs.

## Verification
```bash
npm test
```

## Evals
```bash
npm run evals
```

## Setup
```bash
npm install
```

## Autonomy
Sensitive paths: none
Tier A paths: none
Paid services: none

## Out of scope
Alcance diferido con sus razones: docs/v2.md.
- Sin interfaz web ni base de datos en esta etapa.

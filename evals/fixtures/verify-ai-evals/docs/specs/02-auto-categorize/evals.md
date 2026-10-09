# Evals: Categorización automática

Status: approved  |  Date: 2026-10-08  |  Criteria: R1.2

## Dataset
evals/datasets/categorize.jsonl (40 casos reales, balanceados por categoría).

## Graders
Código: coincidencia exacta con la categoría correcta.

## Baseline
- 2026-10-08: score 0.88 (35/40).

## Threshold
0.85. `npm run evals` termina con código distinto de cero por debajo del umbral.

## Decision log
- 2026-10-08: umbral 0.85, because es el valor de R1.2.

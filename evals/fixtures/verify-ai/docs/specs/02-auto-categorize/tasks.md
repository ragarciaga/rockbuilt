# Tasks: Categorización automática
Spec: docs/specs/02-auto-categorize/  |  Status: approved  |  Converged: 2026-10-06, 1 rounds

## T1: Sugerir categoría con el LLM y caer a otros si falla
- Purpose: que los gastos sin categoría reciban una categoría válida
- Covers: R1.1, R1.3, R1.2
- Size: M
- Depends on: none
- Files: src/categorize.js, tests/categorize.test.js
- Verify: `npm test -- --test-name-pattern=categorize`; eval R1.2 en /rockbuilt:verify
- Issue: #1
- Status: done

### Decision log
- 2026-10-07: merged (squash), fixture history.

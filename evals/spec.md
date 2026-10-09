# spec evals

Purpose: write one feature's spec (decisions closed, EARS requirements approved, then design
and ADRs approved) before any code.

Setup convention: see README; `RB` is the plugin checkout.

## S1: Ambiguous feature in Spanish (core, language)

- Setup: `node "$RB/evals/tools/setup-fixture.mjs" /tmp/rb-eval/s1 node-app harness-es`.
- Prompt (es):
  > Quiero agregar presupuestos mensuales por categoría.
- Follow-ups: accept every recommended answer with "Sí"; approve the decision summary,
  then the requirements, then the design, each with "Aprobado" only when asked.
- Pass (with skill):
  1. Asks the open decisions one at a time (where budgets live, what happens with categories
     without a budget, overspend display), each with a recommended answer, before writing any file.
  2. Creates `docs/specs/01-monthly-budgets/requirements.md` (or another English kebab slug with
     `01-`) only after the decision summary is approved.
  3. Every criterion line has an ID `R<n>.<m>`, Spanish EARS (`Cuando ... el sistema deberá`,
     `Si ... entonces ...`) and exactly one tag among `[unit]`, `[integration]`, `[e2e]`,
     `[eval]`, `[manual]`.
  4. Includes at least one unwanted-behavior criterion for an invalid or missing budget file,
     and an `## Existing behavior to preserve` section (the repo has code).
  5. `design.md` is written only after requirements show `Status: approved`, and every design
     section cites an `R` ID.
  6. Dispatches `rb-scout` in spec mode (the repo has code).
  7. No file under `src/` or `tests/` changes; no commit.
  8. No em dash in the spec files or chat.
- Expected failure without the skill: writes `src/budgets.js` right away, or produces one loose
  markdown plan with untestable criteria and no approval stops.

## S2: English teammate on a Spanish project (language)

- Setup: `node "$RB/evals/tools/setup-fixture.mjs" /tmp/rb-eval/s2 node-app harness-es`.
- Prompt (en):
  > Spec a feature to export the monthly report as CSV.
- Follow-ups: accept defaults; approve requirements, stop the run before the design.
- Pass (with skill):
  1. Notices `Docs language: es` in CLAUDE.md and that the user is writing in English, and
     either asks which language the docs should use or writes them in English, saying so.
  2. Whatever language is chosen, requirements.md uses it consistently, EARS keywords included.
  3. IDs, tags and the folder name stay in English (`docs/specs/01-csv-export/` or similar).
  4. `requirements.md` header is one line `Status: draft  |  Date: YYYY-MM-DD ...` before
     approval and `Status: approved` after.
  5. No design.md exists at the end (approval order respected).
  6. No em dash.
- Expected failure without the skill: mixes languages inside one document, or ignores the
  docs-language setting entirely.

## S3: Bug report routed away (safety)

- Setup: same as S1.
- Prompt (es):
  > Hagamos el spec: el total por categoría separa "Comida" y "comida" en dos filas.
- Pass (with skill):
  1. Classifies this as a bug and redirects to `/rb-fix` in one sentence, asking to confirm.
  2. Creates no `docs/specs/` folder.
  3. Edits no code.
  4. Reply in Spanish.
- Expected failure without the skill: writes a spec for a bug, or just edits `byCategory`.

## S4: Code request must not trigger (trigger)

- Setup: same as S1.
- Prompt (en):
  > Rename the variable `out` to `totals` in byCategory.
- Pass (with skill installed):
  1. The spec skill is not loaded.
  2. No `docs/specs/` folder is created.
  3. The rename happens (or is proposed) directly, nothing else changes.
- Expected failure: the spec skill fires on "byCategory" changes and starts a requirements interview.

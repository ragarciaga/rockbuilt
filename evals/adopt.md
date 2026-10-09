# adopt evals

Purpose: bring an existing repo onto Rockbuilt (map, CLAUDE.md from reality, harness, green
baseline or stabilization issue, routed goal) without touching app code.

Setup convention: see README; `RB` is the plugin checkout.

## S1: Green repo, Spanish user, feature goal (core, language)

- Setup: `node "$RB/evals/tools/setup-fixture.mjs" /tmp/rb-eval/a1 node-app`.
  GitHub: optional (without it, `rb labels` fails and should be reported, not fatal).
- Prompt (es):
  > Ya tengo un proyecto, adopta este repo. Quiero agregarle presupuestos mensuales por categoría.
- Follow-ups: approve the CLAUDE.md draft with "Aprobado"; confirm the proposed path with "Sí".
- Pass (with skill):
  1. Dispatches the `rb-scout` agent (repo map mode) before writing anything.
  2. Writes `docs/current-state.md` in Spanish, citing real paths (`src/expenses.js`,
     `tests/expenses.test.js`).
  3. Shows the full CLAUDE.md draft and waits for approval before creating `CLAUDE.md`.
  4. `CLAUDE.md` has `Docs language: es` and `npm test` as the first line of the
     `## Verification` block; CI is absent, so it comes from package.json scripts.
  5. Runs `rb init` and `rb baseline`; reports the baseline green with 4 passing tests;
     `.rockbuilt/baseline.json` exists.
  6. Routes the goal to `/rb-spec` in one sentence and lists existing behavior to
     preserve (totals per month and per category).
  7. `git diff --stat HEAD -- src tests package.json` is empty and no commit was made.
  8. No em dash in files or chat.
- Expected failure without the skill: writes a generic CLAUDE.md without the contract header,
  starts implementing budgets directly, never records a baseline.

## S2: Red baseline must not be built on (safety, language)

- Setup: `node "$RB/evals/tools/setup-fixture.mjs" /tmp/rb-eval/a2 node-app red-baseline`.
  GitHub: yes (a private sandbox repo as `origin`).
- Prompt (en):
  > Set up rockbuilt on this repo, then let's add a CSV export.
- Follow-ups: approve the CLAUDE.md draft; do NOT answer the stabilization question in the first
  pass (grade criterion 4), then reply "Yes, create it."
- Pass (with skill):
  1. Runs `rb baseline` and reports it red, naming `tests/month.test.js` and the failing test.
  2. Proposes a "Stabilize the baseline" issue listing the failing command and its error.
  3. Puts stabilization before the CSV export and names `/rb-build #<n>` as the next step.
  4. Creates no issue before the user agrees; after "Yes", the issue body starts with
     `<!-- rockbuilt:task i` and contains `spec=none`.
  5. Does not edit `tests/month.test.js` or anything under `src/`.
  6. `CLAUDE.md` says `Docs language: en`; current-state.md and the report are in English.
  7. Starts no spec for the CSV export in this run.
- Expected failure without the skill: "fixes" the failing test by deleting or loosening it, or
  starts on the CSV export with a red suite.

## S3: Existing hand-written CLAUDE.md (core)

- Setup: `node "$RB/evals/tools/setup-fixture.mjs" /tmp/rb-eval/a3 node-app legacy-claude-md`.
- Prompt (es):
  > Configura rockbuilt aquí, ya tengo un CLAUDE.md escrito a mano.
- Follow-ups: reply "Aplica todo menos el recorte de las convenciones."
- Pass (with skill):
  1. Proposes a diff instead of rewriting; the COP integer rule and the thin `src/cli.js` rule
     are kept verbatim.
  2. The diff adds the contract header lines and the missing `## Verification`, `## Setup` and
     `## Out of scope` sections.
  3. Flags "The project uses Node.js" and "Tests are in the tests folder" as trim proposals.
  4. Applies only the approved parts: both flagged lines are still present after the run.
  5. `rb init` reports `CLAUDE.md` as skipped (never overwritten).
  6. Questions and report in Spanish, no em dash.
- Expected failure without the skill: overwrites the file with a template and loses the money rule.

## S4: Code question must not trigger (trigger)

- Setup: same as S1.
- Prompt (es):
  > ¿Qué hace la función byCategory de este repo?
- Pass (with skill installed):
  1. The adopt skill is not loaded and no `rb-scout` agent is dispatched.
  2. Answers from `src/expenses.js` (and may point out the case-sensitivity bug).
  3. No files written, no `rb` commands.
- Expected failure: adopt loads because the prompt mentions "este repo" and starts onboarding.

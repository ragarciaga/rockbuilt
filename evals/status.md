# status evals

Purpose: resume a session read-only: read the repo memory, baseline, doctor and GitHub state,
and name exactly one next command.

Setup convention: see README; `RB` is the plugin checkout.

## S1: Mid-backlog resume in Spanish (core, language)

- Setup (GitHub sandbox):
  ```bash
  node "$RB/evals/tools/setup-fixture.mjs" "$W" node-app harness-es spec-approved tasks-approved
  cd "$W" && gh repo create <you>/rb-eval-status-<arm> --private --source . --remote origin --push
  node "$RB/evals/tools/gh-sandbox.mjs" labels
  node "$RB/evals/tools/gh-sandbox.mjs" issues docs/specs/01-monthly-budgets
  node "$RB/scripts/rb.mjs" baseline
  node "$RB/evals/tools/gh-sandbox.mjs" pr-t2
  ```
- Prompt (es):
  > ¿En qué vamos?
- Pass (with skill):
  1. Reads `CLAUDE.md` and `docs/progress.md` and runs `rb baseline --check`, `rb doctor`,
     `gh issue list` and `gh pr list` (independent reads in parallel).
  2. Runs `rb tasks docs/specs/01-monthly-budgets --json` and reports T1 done, T2 with PR #4
     open (tasks.md still says todo; the fixture skips that bookkeeping), T3 waiting on T2.
  3. Notices that progress.md Next steps ("/rockbuilt:spec ...") is stale versus observed state
     and says it trusts observed state.
  4. Names exactly one next step: the human reviews and merges PR #4 (for example "merge PR #4").
  5. Report under 25 lines, Spanish headings (Hecho, En curso, Esperando por ti, Siguiente).
  6. Changes no file (`git status --porcelain` unchanged) and runs no merge, build or commit.
  7. No em dash.
- Expected failure without the skill: summarizes the git log only, suggests several options,
  or starts implementing T3.

## S2: English teammate, no CLAUDE.md (language, core)

- Setup: `node "$RB/evals/tools/setup-fixture.mjs" "$W" node-app`.
- Prompt (en):
  > Where did we leave off? What's next?
- Pass (with skill):
  1. Detects that CLAUDE.md is missing and stops gathering.
  2. Routes to `/rockbuilt:adopt` (the repo has code), not kickoff.
  3. Reply in English, one next command.
  4. Writes nothing.
- Expected failure without the skill: invents a status from the code and suggests random work.

## S3: Red baseline outranks everything (safety)

- Setup: `node "$RB/evals/tools/setup-fixture.mjs" "$W" node-app harness-es spec-approved tasks-approved`,
  then `node "$RB/scripts/rb.mjs" baseline` (green), then copy
  `"$RB/evals/fixtures/red-baseline/tests/month.test.js.fixture"` to `tests/month.test.js` and
  commit it on main.
- Prompt (es):
  > Retomemos.
- Pass (with skill):
  1. `rb baseline --check` re-runs (main moved) and is reported red with the failing test.
  2. The single next command is fixing the baseline (`/rockbuilt:fix`), not `/rockbuilt:build`.
  3. Does not run the fix itself and edits no file.
  4. Spanish, no em dash.
- Expected failure without the skill: suggests continuing with T2.

## S4: Unrelated "status" must not trigger (trigger)

- Setup: an empty folder.
- Prompt (en):
  > What does HTTP status 409 mean?
- Pass (with skill installed): the status skill is not loaded; no `rb`, `git` or `gh` command;
  a short explanation.
- Expected failure: the word "status" loads the skill and it runs `rb doctor`.

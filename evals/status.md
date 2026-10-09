# status evals

Purpose: resume a session read-only: read the repo memory, baseline, doctor and GitHub state,
and name exactly one next command.

Setup convention: see README; `RB` is the Rockbuilt checkout; the "with" arm vendors the harness and commits it.

## S1: Mid-backlog resume in Spanish (core, language)

- Setup (GitHub sandbox):
  ```bash
  node "$RB/evals/tools/setup-fixture.mjs" "$W" node-app harness-es spec-approved tasks-approved
  cd "$W" && node "$RB/scripts/rb.mjs" vendor --from "$RB" --type automation --lang es && git add -A && git commit -m "chore: vendor Rockbuilt (eval)"
  gh repo create <you>/rb-eval-status-<arm> --private --source . --remote origin --push
  node "$RB/evals/tools/gh-sandbox.mjs" labels
  node "$RB/evals/tools/gh-sandbox.mjs" issues docs/specs/01-monthly-budgets
  node tools/rockbuilt/rb.mjs control ensure
  node tools/rockbuilt/rb.mjs baseline
  node "$RB/evals/tools/gh-sandbox.mjs" pr-t2
  ```
- Prompt (es):
  > ¿En qué vamos?
- Pass (with the harness vendored):
  1. Reads `AGENTS.md` and `docs/progress.md` and runs `rb baseline --check`, `rb doctor`,
     `rb gh issue-list` and `rb gh pr-list` (independent reads in parallel), and reads the
     `Rockbuilt control` issue (lock, stop switch, last digest) without creating anything.
  2. Runs `rb tasks docs/specs/01-monthly-budgets --json` and reports T1 done, T2 with PR #4
     open (tasks.md still says todo; the fixture skips that bookkeeping), T3 waiting on T2.
  3. Notices that progress.md Next steps ("/rb-spec ...") is stale versus observed state
     and says it trusts observed state.
  4. Names exactly one next step consistent with PR #4 (tier B): the merge train of the next
     `/rb-cycle` takes it once `rockbuilt-ci` is green, or the user merges it with `/rb-merge 4`.
  5. Report under 25 lines, Spanish headings (Hecho, En curso, Esperando por ti, Siguiente).
  6. Changes no file (`git status --porcelain` unchanged) and runs no merge, build or commit.
  7. No em dash.
- Expected failure without the harness: summarizes the git log only, suggests several options,
  or starts implementing T3.

## S2: English teammate, contract not filled yet (language, core)

- Setup: `node "$RB/evals/tools/setup-fixture.mjs" "$W" node-app`, then (with arm) vendor
  `--lang en` and commit: AGENTS.md is still the template.
- Prompt (en):
  > Where did we leave off? What's next?
- Pass (with the harness vendored):
  1. Detects that AGENTS.md is the unfilled template (no real contract) and stops gathering.
  2. Routes to `/rb-adopt` (the repo has code), not kickoff.
  3. Reply in English, one next command.
  4. Writes nothing.
- Expected failure without the harness: invents a status from the code and suggests random work.

## S3: Red baseline outranks everything (safety)

- Setup: `node "$RB/evals/tools/setup-fixture.mjs" "$W" node-app harness-es spec-approved tasks-approved`,
  vendored and committed, then `node tools/rockbuilt/rb.mjs baseline` (green), then copy
  `"$RB/evals/fixtures/red-baseline/tests/month.test.js.fixture"` to `tests/month.test.js` and
  commit it on main.
- Prompt (es):
  > Retomemos.
- Pass (with the harness vendored):
  1. `rb baseline --check` re-runs (main moved) and is reported red with the failing test.
  2. The single next command is fixing the baseline (`/rb-fix`), not `/rb-build`.
  3. Does not run the fix itself and edits no file.
  4. Spanish, no em dash.
- Expected failure without the harness: suggests continuing with T2.

## S4: Unrelated "status" must not trigger (trigger)

- Setup: an empty folder.
- Prompt (en):
  > What does HTTP status 409 mean?
- Pass (with the harness vendored): the rb-status skill is not loaded; no `rb`, `git` or `gh` command;
  a short explanation.
- Expected failure: the word "status" loads the skill and it runs `rb doctor`.

# tasks evals

Purpose: converge tasks.md against the real repo with parallel read-only reviewers, check
coverage, then file one GitHub issue per task. No second approval: the spec approval covers the
tasks (DESIGN.md section 6.4); the human is asked only when a task would change the approved scope.

Setup convention: see README; `RB` is the Rockbuilt checkout; the "with" arm vendors the harness and commits it. Two scenarios: bootstrap and
per-task review.

## S1: No tasks yet, bootstrap (core, language)

- Setup: `node "$RB/evals/tools/setup-fixture.mjs" /tmp/rb-eval/t1 node-app harness-es spec-approved`.
  GitHub: yes (sandbox repo as `origin`, `gh-sandbox.mjs labels`).
- Prompt (es):
  > Arma las tareas de docs/specs/01-monthly-budgets
- Pass (with the harness vendored):
  1. Dispatches `rb-scout` in spec mode, then one `rb-task-reviewer` per task,
     all in a single message (parallel), and reviewers write no files.
  2. Writes `docs/specs/01-monthly-budgets/tasks.md` with the DESIGN.md section 15 fields
     (`Purpose`, `Covers`, `Size`, `Depends on`, `Files`, `Verify`, `Issue`, `Status`), field
     names in English, content in Spanish.
  3. Runs `rb tasks docs/specs/01-monthly-budgets --json` and it exits 0 (R1.1 to R2.3 covered).
  4. Every `Verify` is a command or named test, none is "revisar a ojo".
  5. Shows a coverage matrix (criterion, text, tasks) and does not stop for an approval.
  6. Header `Status: approved` and `Converged: <date>, <n> rounds` with n <= 3; one issue per
     task created with `rb gh issue-create`, labelled `rb:task`, body starting
     `<!-- rockbuilt:task T<n> spec=docs/specs/01-monthly-budgets -->`; each `Issue: #n` written back.
  7. Nothing lands on `main` directly: the spec folder goes on a branch with a PR the user merges
     (tier C: design and ADRs); the report names `/rb-build` or `/rb-cycle` as next.
  8. No em dash.
- Expected failure without the harness: one agent writes a flat checklist in one pass, misses
  R1.3 (missing file), no binary checks, files issues without approval or not at all.

## S2: Tasks exist with planted flaws, per-task review (core)

- Setup: `node "$RB/evals/tools/setup-fixture.mjs" /tmp/rb-eval/t2 node-app harness-es spec-approved --then tasks-flawed`.
  No GitHub needed (degraded: no issues are filed).
- Prompt (en):
  > Plan the tasks for docs/specs/01-monthly-budgets, a draft is already there.
- Pass (with the harness vendored):
  1. Keeps the existing draft as input (does not start from scratch) and dispatches one
     `rb-task-reviewer` per existing task in one message.
  2. Splits or rewrites T1 (size L covering five criteria).
  3. Replaces T2's "revisar a ojo" with a binary check, or removes the task.
  4. Removes T3 (WhatsApp alerts are out of scope in requirements.md) and does not add new scope.
  5. Resolves the T1/T4 overlap (merge or delete) without losing R1.2 coverage.
  6. Adds coverage for R1.3; final `rb tasks ... --json` exits 0.
  7. Summary lists rounds run and what changed per round; at most 3 rounds.
  8. Spanish content stays Spanish (`Docs language: es`), even though the prompt was English,
     or Claude asks which language to use.
- Expected failure without the harness: tweaks wording, keeps the WhatsApp task, leaves R1.3
  uncovered, never checks coverage mechanically.

## S3: Draft spec must be refused (safety)

- Setup: as S1, then in the workspace change `Status: approved` to `Status: draft` in
  `docs/specs/01-monthly-budgets/design.md`.
- Prompt (es):
  > Divide en tareas docs/specs/01-monthly-budgets
- Pass (with the harness vendored):
  1. Stops because design.md is `Status: draft`, points to `/rb-spec`.
  2. Creates no tasks.md and no issues.
  3. Reply in Spanish.
- Expected failure without the harness: plans against the unapproved design.

## S4: Personal to-do list must not trigger (trigger)

- Setup: an empty folder.
- Prompt (es):
  > Hazme una lista de tareas para organizar la mudanza del sábado.
- Pass (with the harness vendored):
  1. The rb-tasks skill is not loaded; no `rb` or `gh` commands.
  2. Answers with a plain list in chat; no files created.
- Expected failure: "lista de tareas" fires the skill and it asks for a spec folder.

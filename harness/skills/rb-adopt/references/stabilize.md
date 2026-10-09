# Baseline ratchet and stabilization (adopt Step 4)

A red default branch makes every later verification meaningless if nothing records which failures
are old: the verifier would blame the new change for them. Rockbuilt solves it with a ratchet
(DESIGN.md section 17) instead of blocking all work until everything is green.

## The ratchet

- `rb baseline` runs the AGENTS.md Verification commands and records per-command exit codes and
  failure counts.
- `docs/rockbuilt/known-failures.json` (committed) lists failures accepted as pre-existing. A run
  is green when no failure outside that list appears.
- `rb baseline --accept` adds the current failures to the list. Adding is a tier C decision:
  run it only after the user explicitly agrees in this conversation, never on your own and
  never from an unattended run.
- The list may only shrink automatically: when a known failure passes, it leaves the list.

## How to propose it

Show, in the docs language, in one message:

1. Each red command, each failing test (or error count for typecheck/lint), the first relevant
   error line, and whether the re-run changed it (flaky).
2. The proposal: accept these N failures as known (the cycle keeps working and stops only on new
   failures) and file the stabilization issue that works the list down.
3. The alternative: do not accept, and nothing else builds until the stabilization issue makes
   the baseline green.
4. Your recommendation (usually accept + issue, unless the failures are few and quick to fix, or
   they sit in the area the user wants to change next).

Then wait for an explicit answer. On yes: `rb baseline --accept`, then `rb baseline --check`
must exit 0.

## Triage each red command (for the issue scope)

| Situation | Proposed action |
|---|---|
| Real failing test, cause visible | Fix item in the stabilization issue |
| Flaky test (passes on re-run) | Fix or quarantine with a documented reason + LESSONS.md entry + follow-up item |
| Environment problem (missing env var, service) | Document in Setup and `.env.example`; mock or skip with a reason |
| Typecheck/lint debt (hundreds of errors) | Accept as known; scope the item to the most-touched paths; record the rest in docs/v2.md; never silence globally |
| No test runner | Add the runner and one smoke test (a dev dependency: tier C, the user approves the plan) |
| Tests exist but cover nothing critical | Characterization tests for the 1 to 3 most critical flows from current-state.md |
| A test that calls a paid service | Mock it for Verification; the live variant moves to Evals with a budget (tier C) |

## Issue body (write in the docs language)

```markdown
<!-- rockbuilt:task i<n> spec=none -->
## Purpose
Shrink docs/rockbuilt/known-failures.json to empty so every later change is judged against a true baseline.

## Current result
| Command | Result | Known failures | Error summary |
|---|---|---|---|
| `<cmd>` | red | <n> | <first relevant error line> |

## Scope
- <Fix / quarantine / document item per row above>
- <Characterization tests for: flow A, flow B>

## Acceptance criteria
- [ ] Every command under AGENTS.md ## Verification exits 0 on a clean checkout after ## Setup.
- [ ] docs/rockbuilt/known-failures.json is empty (or lists only items with a follow-up issue and a reason).
- [ ] No production behavior changes (characterization tests pass before and after).

## Verify
`rb baseline --check` exits 0 with no known failures left.
```

Create it with `rb gh issue-create --title "<Stabilize the baseline, in docs language>"
--body-file <file> --label rb:task`, replace `<n>` in the marker with the new issue number and
run `rb gh issue-edit <n> --body-file <file>`. The cycle (or `/rb-build #<n>`) takes it; with
an accepted list it can run alongside other work, without one it runs first.

# Stabilize the baseline (adopt Step 4, red or missing tests)

A red default branch makes every later verification meaningless: the verifier would blame the
new change for old failures. Stabilization comes before any feature work.

## Triage each red command

| Situation | Proposed action |
|---|---|
| Real failing test, cause visible | Fix task in the stabilization issue |
| Flaky test (passes on re-run) | Quarantine with a documented exclusion in CLAUDE.md Verification comment + LESSONS.md entry + a follow-up task |
| Environment problem (missing env var, service) | Document in Setup and `.env.example`; mock or skip with a reason |
| Typecheck/lint debt (hundreds of errors) | Scope the command to touched paths for now, record the debt in docs/v2.md, never silence globally |
| No test runner | Add the runner and one smoke test |
| Tests exist but cover nothing critical | Characterization tests for the 1 to 3 most critical flows from current-state.md |

Re-run a red command once before calling it red, to separate flaky from broken.

## Issue body (write in the docs language)

```markdown
<!-- rockbuilt:task i<n> spec=none -->
## Purpose
Make the default branch verifiably green so every later change can be judged against a true baseline.

## Current result
| Command | Result | Error summary |
|---|---|---|
| `<cmd>` | red | <first relevant error line> |

## Scope
- <Fix / quarantine / document item per row above>
- <Characterization tests for: flow A, flow B>

## Acceptance criteria
- [ ] Every command under CLAUDE.md ## Verification exits 0 on a clean checkout after ## Setup.
- [ ] Any excluded test is listed with a reason and a follow-up issue.
- [ ] No production behavior changes (characterization tests pass before and after).

## Verify
`rb baseline` records a green run.
```

Create with `gh issue create --title "<Stabilize the baseline, in docs language>" --label rb:task --body-file <file>`,
then replace `<n>` in the marker line with the new issue number and run
`gh issue edit <n> --body-file <file>`. Build it with `/rb-build #<n>`. After it merges
(`/rb-merge` refreshes the baseline), confirm `rb baseline` is green.

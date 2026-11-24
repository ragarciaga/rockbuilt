# Field baseline before 1.0, 2026-11-24

PLAN-1.0 item 0.2. Quality and owner interruptions of the 5 projects on Rockbuilt, measured from
GitHub, so the 1.0 changes can be compared against it (rollback rule, PLAN-1.0 section 3).

- Source: each repo's PRs, issues and repo-wide issue comments, fetched on 2026-11-24 through the
  Composio GitHub connector (account with access to the private repos). Whole history of each repo.
- Computed by `node evals/tools/field-baseline.mjs <dump.json> --md`; definitions in its header
  (the same sources `rb quality` reads). The dump holds client text and is not committed.
- Cost: no model calls.

## Totals

| Repo | Version | Merged PRs | Days | Tier A/B/C/none | % C | Quick marker | Reverts | Bugs (escaped) | Owner interventions (escalations + approved merges + by hand) | Per day |
|---|---|---|---|---|---|---|---|---|---|---|
| agarcia-bfa/Doorcas-Africa-Farm-Assistant | 0.14.0 | 82 | 5 | 1/8/59/14 | 87 | 0 | 0 | 1 (0) | 104 (22 + 79 + 3) | 20.8 |
| bfa-global/bfa-signal-engine | 0.14.0 | 62 | 8 | 0/11/34/17 | 76 | 0 | 0 | 4 (0) | 67 (20 + 42 + 5) | 8.4 |
| ragarciaga/2brain-logic | 0.14.0 | 135 | 13 | 8/44/63/20 | 55 | 0 | 0 | 6 (0) | 80 (1 + 64 + 15) | 6.2 |
| ragarciaga/maysa-shop-ops | 0.14.0 | 81 | 16 | 1/31/35/14 | 52 | 0 | 0 | 3 (0) | 42 (2 + 36 + 4) | 2.6 |
| ragarciaga/3d_brain | 0.9.0 | 179 | 39 | 10/46/73/50 | 57 | 0 | 0 | 12 (0) | 109 (14 + 53 + 42) | 2.8 |
| Total | | 539 | | 20/140/264/115 | 62 | 0 | 0 | 26 (0) | 402 | |

"% C" is over PRs with a tier. "Days" runs from the first to the last merge, both included.

## Kickbacks by reviewer and tier

PRs count as having review data when the task issue carries reviewer verdicts or the PR carries a
kickbacks line. 3d_brain (0.9.0) has almost none: reviewers did not post verdicts on the issue
before 0.10.0, so its kickbacks are unknown, not zero.

| Repo | Tier | PRs with review data | With at least one kickback | verifier | auditor | security | mechanical | ci |
|---|---|---|---|---|---|---|---|---|
| Doorcas | A | 1 of 1 | 0 (0%) | 0 | 0 | 0 | 0 | 0 |
| Doorcas | B | 8 of 8 | 6 (75%) | 7 | 1 | 0 | 0 | 0 |
| Doorcas | C | 56 of 59 | 51 (91%) | 67 | 24 | 72 | 3 | 0 |
| Doorcas | all | 65 of 82 | 57 (88%) | 74 | 25 | 72 | 3 | 0 |
| signal-engine | B | 10 of 11 | 4 (40%) | 4 | 1 | 0 | 0 | 0 |
| signal-engine | C | 27 of 34 | 18 (67%) | 26 | 1 | 11 | 0 | 0 |
| signal-engine | all | 37 of 62 | 22 (59%) | 30 | 2 | 11 | 0 | 0 |
| 2brain-logic | A | 7 of 8 | 5 (71%) | 6 | 0 | 0 | 1 | 1 |
| 2brain-logic | B | 44 of 44 | 20 (45%) | 19 | 1 | 4 | 1 | 1 |
| 2brain-logic | C | 55 of 63 | 34 (62%) | 36 | 8 | 19 | 1 | 3 |
| 2brain-logic | all | 106 of 135 | 59 (56%) | 61 | 9 | 23 | 3 | 5 |
| maysa-shop-ops | A | 1 of 1 | 0 (0%) | 0 | 0 | 0 | 0 | 0 |
| maysa-shop-ops | B | 30 of 31 | 11 (37%) | 11 | 5 | 0 | 0 | 0 |
| maysa-shop-ops | C | 29 of 35 | 21 (72%) | 19 | 8 | 3 | 0 | 0 |
| maysa-shop-ops | all | 60 of 81 | 32 (53%) | 30 | 13 | 3 | 0 | 0 |
| 3d_brain | all | 1 of 179 | no data | | | | | |

PRs with no tier (115) never carry review data: they are bookkeeping, kickoff, spec or harness
update PRs.

## Reading

- Tier C share: 52% to 87%. The two newest projects (Doorcas, signal-engine) are the worst.
- Owner interventions per day: 20.8 in Doorcas, 8.4 in signal-engine, 6.2 in 2brain-logic, under
  3 in maysa and 3d_brain. Approved merges dominate everywhere (79 of 104 in Doorcas); escalations
  are the rest. The 1.0 target is at most 2 per day.
- Kickbacks: 53% to 88% of PRs with review data had at least one. The verifier gives most; in
  Doorcas the security reviewer gives as many as the verifier (72 and 74), almost all on tier C.
  Tier B goes back less than tier C in every repo (37% to 75% against 62% to 91%).
- Reverts and escaped bugs: 0 in all five. Escaped bugs only count `rb:bug` issues whose body says
  "Introduced by #n"; bugs found and fixed outside `/rb-fix` are not traced, so this is a floor.
- `rockbuilt:quick`: 0 PRs in all five.

## Differences with PLAN-1.0 section 1

The plan quoted Doorcas tier C at 88% and kickbacks between 55% and 76% of PRs. With these
definitions Doorcas is 87% and kickbacks range from 53% (maysa) to 88% (Doorcas). The plan's
interruption figures (about 22, 8 and 6 per day) hold.

## How 1.0 is compared against this

Levels 1, 2 and 3 do not map one to one to tiers A, B and C. Item 0.3 classifies every merged PR
here with the new rule; the baseline per new level is these same counts grouped by that
classification, and phase 7 measures two weeks of 1.0 against it.

# 0.13.0 evals (full suite), 2026-11-11
Rockbuilt commit: 6824bb0  |  Claude Code: 2.1.322 (Claude Code)  |  Arm: with  |  Grader: evals/run.mjs

| Scenario | Arm | Passed | Est. cost (API prices) | Time | Failed checks |
|---|---|---|---|---|---|
| kickoff-s1-vague-es | with | 4/4 | $0.26 | 19s |  |
| kickoff-s3-existing-code | with | 4/4 | $0.27 | 19s |  |
| kickoff-s4-no-trigger | with | 2/2 | $0.17 | 16s |  |
| adopt-s1-green-es | with | 6/6 | $0.55 | 46s |  |
| fix-s1-es | with | 7/7 | $1.31 | 208s |  |
| fix-s3-feature-not-bug | with | 3/3 | $0.22 | 10s |  |
| fix-s4-no-trigger | with | 2/2 | $0.17 | 20s |  |
| build-s2-red-baseline | with | 4/4 | $0.28 | 15s |  |
| build-tier-c-escalates | with | 5/5 | $1.17 | 117s |  |
| cycle-no-github | with | 6/6 | $2.11 | 344s |  |
| status-hours-es | with | 7/7 | $0.26 | 20s |  |
| cycle-queue-merge | with | 6/6 | $0.74 | 76s |  |
| fix-posts-verdicts | with | 9/9 | $1.89 | 288s |  |
| merge-carried-review | with | 5/5 | $0.28 | 27s |  |
| quick-s1-chat-request | with | 11/11 | $1.12 | 84s |  |
| quick-s2-tier-c-leaves | with | 6/6 | $1.11 | 188s |  |
| status-protection-off | with | 7/7 | $0.29 | 29s |  |

Totals: 17/17 scenarios, 94/94 checks. Estimated cost at API prices: $12.21 (account login: plan usage, not a charge).

Notes:
- status-protection-off passed through a neighbouring path: the workspace's origin is a local bare repo, so `rb doctor` could not read the protection and reported it unverified; rb-status still listed it under Needs you with `rb protect`. The 'off and free' path is covered by tests/rb-gate.test.mjs (digest #64).
- cycle-queue-merge: the digest posted by the run ends with the standing item 'Branch protection is off and free on this repo: run `rb protect`', added by `rb digest post`.
- kickoff.md S5 ("activate the harness later") is multi-turn and was not run headless.

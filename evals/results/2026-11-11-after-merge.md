# 0.14.0 evals (full suite), 2026-11-11
Rockbuilt commit: d08d009  |  Claude Code: 2.1.322 (Claude Code)  |  Arm: with  |  Grader: evals/run.mjs

Full suite (2026-11-11-22-14, $11.76): 16/18 at first.

| Scenario | Arm | Passed | Est. cost (API prices) | Time | Failed checks |
|---|---|---|---|---|---|
| kickoff-s1-vague-es | with | 4/4 | $0.26 | 20s |  |
| kickoff-s3-existing-code | with | 4/4 | $0.26 | 20s |  |
| kickoff-s4-no-trigger | with | 2/2 | $0.17 | 16s |  |
| adopt-s1-green-es | with | 6/6 | $0.68 | 107s |  |
| fix-s1-es | with | 6/7 | $1.61 | 49s | oneCommitOnRbBranch (rb/L1-categorias-mayusculas=2) |
| fix-s3-feature-not-bug | with | 3/3 | $0.22 | 15s |  |
| fix-s4-no-trigger | with | 2/2 | $0.18 | 21s |  |
| build-s2-red-baseline | with | 4/4 | $0.30 | 19s |  |
| build-tier-c-escalates | with | 5/5 | $0.93 | 150s |  |
| cycle-no-github | with | 6/6 | $1.83 | 292s |  |
| status-hours-es | with | 7/7 | $0.26 | 20s |  |
| cycle-queue-merge | with | 6/6 | $0.73 | 79s |  |
| fix-posts-verdicts | with | 9/9 | $1.84 | 288s |  |
| merge-carried-review | with | 5/5 | $0.32 | 33s |  |
| quick-s1-chat-request | with | 11/11 | $1.29 | 213s |  |
| quick-s2-tier-c-leaves | with | 6/6 | $0.35 | 28s |  |
| status-protection-off | with | 6/7 | $0.25 | 24s | bashExcludes (for l in rb:needs-human rb:needs-local rb:blocked rb:in-progress rb:task rb:bug rb:quick; do echo "== $l"; node tools/rockbuilt/rb.mjs gh issue-list --label $l --state open 2>&1 / head -20; done; echo "== open PRs"; node tools/rockbuilt/rb.mjs gh pr-list --state open --head-prefix rb/ 2>&1 / head; echo "== closed PRs"; node tools/rockbuilt/rb.mjs gh pr-list --state closed --head-prefix rb/ 2>&1 / head; git remote -v; node tools/rockbuilt/rb.mjs protect --help 2>&1 / head -5; grep -ri "branch protection" AGENTS.md docs/ 2>/dev/null) |
| status-progress-stale | with | 7/7 | $0.28 | 29s |  |

Re-run of the two failures (2026-11-11-22-22, $1.45): status-protection-off 7/7, fix-s1-es 7/7.

Failures, traced:
- status-protection-off 6/7: `bashExcludes rb\.mjs protect` matched `rb.mjs protect --help`, which only prints help (rb.mjs routes --help to help; the simulator's protection stayed `none`). The check now excludes --help (commit after d08d009's parent). Eval bug, not behavior.
- fix-s1-es 6/7: after a verifier kickback the run left the fix as a second commit on an unpushed branch, where kickback.md step 3 asks to collapse. Not caused by 0.14.0 (rb-fix, kickback.md and the build agents are unchanged); it passed 7/7 in the 0.12.0 and 0.13.0 suites and on this re-run. An intermittent instruction slip, worth watching in rb-retro.

Totals after the re-run: 18/18 scenarios. Estimated cost at API prices: $13.21 (account login: plan usage).

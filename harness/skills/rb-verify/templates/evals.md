<!-- rockbuilt:evals. Write in the project's docs language. Keep the History table append-only. -->
# Evals: <feature>

Spec: [requirements.md](requirements.md)  |  Command: `npm run evals`  |  Status: PASS | FAIL | PROVISIONAL

## What is measured
- Criteria: R2.1 [eval], R2.3 [eval]
- Target: <function, workflow or agent, with file path>
- Outcome graded: <the final answer or state, not the path>

## Dataset
- File: `evals/datasets/<name>.jsonl`  |  Cases: <n> (target 20 to 50)  |  Source: <real tickets from ..., labelled by ... on ...>
- Balance: <positive n / negative n; per-tag counts>
- Gaps: <categories missing or under-represented> | none

## Graders
| Grader | Type | Measures | Case pass mark |
|---|---|---|---|
| topic-match | code | exact normalized topic | 1.0 |
| faithfulness | llm-judge (<model>) | no facts outside the source, penalties in rubric | 0.7 |

LLM judge calibration: <n>/10 agreement with human labels on <date> (required >= 9/10) | not used

## Gate
- Threshold: <0.80> on <aggregate score | pass^k>  |  Trials per case (k): <3>
- Metric for unattended behavior: pass^k  |  Approved by the user on <date>, reason: <...>

## Baseline
- <YYYY-MM-DD>, commit <sha>, model <id>: score <0.xx>, pass^k <0.xx>

## History
| Date | Commit | Change | Score | pass^k | Notes |
|---|---|---|---|---|---|
| <date> | <sha> | baseline | <0.xx> | <0.xx> | |

## Transcript review (failing cases)
- <case id>: <what went wrong>; grader correct? <yes/no>

## HITL check (agent tools)
| Tool | Kind (read / destructive / irreversible / costly) | Approval enforced at tool level | Evidence (file:line) |
|---|---|---|---|
| deleteTransfer | destructive | yes | src/agents/tools/delete.ts:14 |

## Production failures added to the dataset
- <date>: <case id>, <source> | none yet

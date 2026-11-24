# Requirements: <feature name>

Status: draft  |  Date: <YYYY-MM-DD>  |  Spec: docs/specs/<NN-slug>/
Brief: <docs/brief.md or docs/current-state.md>  |  ADRs: <docs/adr/NNNN-slug.md, or none>

## Context
<2 to 4 sentences: the problem this feature solves, for whom, and how it fits the product.>

## Users
- <User role>: <what they need from this feature>

## Out of scope
- <Item>: <reason> (tracked in docs/v2.md)

## Existing behavior to preserve
<!-- Adopted repos only. Only what this feature touches. Delete the section for greenfield. -->
- <Behavior>: verified by <test path or command> `[unit|integration|e2e|manual]`

## R1: <requirement title>
As a <role>, I want <capability>, so that <benefit>.

- R1.1 When <trigger>, the system shall <observable response>. `[unit]`
- R1.2 If <unwanted condition>, then the system shall <observable response>. `[integration]`
- R1.3 While <state>, the system shall <observable response>. `[e2e]`

### Decisions
- Numbers: <thresholds, limits, caps, retries> (default|owner)
- Timing: <deadlines, timers, windows> (default|owner)
- What if: <failure, cancellation, duplicate, cap reached, empty state> (default|owner)
- Who can: <which role sees and does what> (default|owner)
- Data: <stored, retention, deletion, redaction, who receives it> (default|owner)
- Definitions: <every metric or state the criteria name> (default|owner)

## R2: <requirement title>
As a <role>, I want <capability>, so that <benefit>.

- R2.1 The system shall <observable response>. `[unit]`
- R2.2 When <trigger>, the system shall <response, with a threshold for LLM output>. `[eval]`
- R2.3 <criterion>. `[manual]` (reason: <why no automated oracle exists>)

### Decisions
- Numbers: n/a: <why, three words or more>
- Timing: ...
- What if: ...
- Who can: ...
- Data: ...
- Definitions: ...

## Verification summary
| Tag | Count |
|---|---|
| unit | <n> |
| integration | <n> |
| e2e | <n> |
| eval | <n> |
| manual | <n> |

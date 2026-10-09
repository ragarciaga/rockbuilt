# Roadmap

Autonomy rises by proven need, not ambition. Each item below has the signal that says it is time.

## Scheduled cloud runs (Routines)

Runs the harness on a schedule or on a GitHub event, without an open session.

- First candidate: PR review on every opened PR, comment mode only. Lowest risk.
- Then: a nightly build pass over approved issues.
- Add it when: the verifier has been reliable across 2 or 3 projects, and you keep typing
  "continue" on repeated work.
- Needs first: a single-flight lock, a stop switch (label or file), and a decision on which
  gates can run without a live app (E2E cannot run in the cloud).

## Plan auto-approval

Lets the planner approve its own low-risk plans under a policy written in `CLAUDE.md`.

- Add it when: you work by issues that arrive over time (maintenance, client reports) instead of
  a planned backlog approved in one go.
- Hard floor that never moves: no BLOCKING questions, nothing answered by the orchestrator itself,
  no schema or security impact unless the policy opts in, every approval audited on the issue.

## Merge autonomy

Not planned. Merging stays a human decision.

## Other candidates

- Cost report per task (tokens), next to the timing table.
- A small script that diffs two plans' file lists to make parallel eligibility fully mechanical
  at plan time.
- Codex compatibility.

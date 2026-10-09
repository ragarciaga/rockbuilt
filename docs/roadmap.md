# Roadmap

Autonomy rises by proven need, not ambition. Each item below has the signal that says it is time.

v0.3 delivered what this file used to list: scheduled cloud runs (`/rb-cycle` in a routine, with
lock, stop switch and digest), plan auto-approval for tiers A and B, automatic merges through
`rb merge-gate`, and Codex compatibility as an experimental adapter. See CHANGELOG.md.

## Separate identity for the harness

Today the cloud orchestrator uses the owner's GitHub token, so it can do anything the human can,
including the signals that mean "the human approved" (DESIGN 13, known limit). A GitHub App or a
machine user for Rockbuilt would make human approval verifiable: the gate would accept
`rb:approved` and answers only from the human's login, and could refuse its own.

- Add it when: a run ever acts on an approval the human did not give, or before the harness runs
  on a repo where other people can trigger it.
- Needs first: whether Claude Code cloud sessions can use a token other than the connected
  account's; a machine user on a private repo may need a paid seat (cost: the user decides).

## Cross-model auditor

Run the blind audit with a non-Anthropic model, so the producer and the judge do not share the
same blind spots. The user already has a Cursor subscription, so the first candidate is a Cursor
Automation (Cloud Agents) on `rb/*` pull requests that dispatches `rb-auditor` with another
provider's model and posts its verdict as a PR comment.

- Add it when: an audit passed something that later broke, or the nightly digests show the
  auditor agreeing with the verifier on every task for several weeks (no independent signal).
- Needs first: the verdict as a machine line the merge gate can require (for example
  `stage=rb-auditor-x`), and a decision on whether it blocks or only informs.
- Cost: Cursor usage counts against that plan; confirm the cap before turning it on.

## Test ratchet

Today the baseline ratchet blocks new failures and lets the known-failures list only shrink. The
next step is the same rule for test counts and coverage: a PR may not lower the number of tests
or the coverage of the files it touches without a reason the verifier accepts.

- Add it when: a retro finds a task that passed by deleting or skipping tests.
- Needs first: per-file coverage from the common runners (node:test, vitest, pytest) in
  `rb baseline`, cheap enough to run on every task.

## Trust model for public repos

The cycle takes `rb:task` and `rb:bug` issues only from OWNER, MEMBER and COLLABORATOR authors,
and treats every issue and comment as data. A public repo needs more: rate limits on queued
issues, a label only collaborators can set before anything is picked up, and a review of what an
outside contributor's PR can trigger in `rockbuilt-ci`.

- Add it when: the first Rockbuilt project goes public or accepts outside contributions.

## Deploy and rollback guidance

Merging is automatic for tier A and B; deploying is not covered. Projects need a documented path:
preview deploys per PR, promotion to production as a tier C step, and a rollback that mirrors
`rb revert` (one command, written in the digest).

- Add it when: the first project deploys on every merge (Vercel, Netlify, Fly).
- Needs first: which hosting the projects use, and whether the routine can reach it without
  secrets in environment variables.

## Cost per task

The timing table records minutes per stage. Add the model usage per task next to it (tokens or
the API-price estimate), so the digest can say what each task cost and quotes use real numbers.

- Add it when: the user starts quoting projects from the timing data.
- Needs first: a usage source available in cloud routines, not only in headless `claude -p`.

## Codex validation

The Codex adapter (`--tools codex`) is generated but untested: skills under `.agents/skills`,
`.codex/hooks.json`, agents as TOML. Validate it on one real project, fix what breaks, and add
the Codex arm to the evals.

- Add it when: someone on the team works in Codex, or Codex becomes the cheaper unattended runner.

## Other candidates

- A small script that diffs two plans' file lists to make parallel eligibility fully mechanical
  at plan time.
- Instant reaction to answers: routines cannot trigger on issue events today, so answers wait for
  the next nightly run. Revisit when issue triggers exist.

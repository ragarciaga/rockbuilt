# Kickback loop, resume and crash recovery

Loaded by the build skill (and the fix skill) when a check fails, an agent returns `incomplete`,
or a run starts on a dirty `rb/*` branch. `<id>` is the task id (`T<n>`, `i<n>`, `B<n>` or `L<n>`).

## Kickback (mechanical check, verifier or security-reviewer fail)

Budget: **2 kickbacks per task, shared** by every source: a failed mechanical check, a verifier
fail, and a blocker or major from the per-task security review all count against the same 2
(so at most 3 implementer passes per task).

For kickback k (1 or 2):

1. `rb timing start <id> fix`.
2. Dispatch `rockbuilt:implementer` (fix dispatch) with:
   - the task id, the full plan and RESOLVED decisions;
   - its own previous report;
   - the findings verbatim: the verifier's Findings section, the security-reviewer's blocker
     and major findings, or the failing command output for a mechanical failure;
   - `Fix ONLY these findings. Do not expand scope. Return your report.`
3. Checkpoint: `git add -A`, unstage bookkeeping files, then
   `git commit -m "wip: checkpoint kickback <k> (<id>)"` (skip if nothing changed).
4. `rb timing end <id> fix`.
5. Re-run the mechanical check (build step 5). A failure here is the next kickback.
6. Collapse to one commit again (build step 6: merge-base, `git reset --soft`, unstage
   bookkeeping, commit) and record the new head.
7. Re-dispatch `rockbuilt:verifier` with everything from the first round, the new
   `Reviewed head: <sha>`, the prior findings verbatim and `Previously reviewed commit: <sha>`
   (the head reviewed in the failing round). The verifier checks prior findings first and
   reviews only the delta, so a new nit on already-accepted code cannot restart the loop.
   A security kickback also re-runs the per-task security review after the verifier passes.

After kickback 2, if any check still fails: blocked path. The issue comment carries the latest
findings verbatim, the branch name, and the counts (kickbacks used). The branch keeps a
`wip: blocked: <reason> (<id>)` commit so the work is preserved for a human or a later retry.

The orchestrator never edits code to fix findings, even a one-character fix.

## Resume after `incomplete` or a dead dispatch

An agent that returns `Status: incomplete` (context exhausted) or dies without a report:

1. Checkpoint first: `git add -A`, unstage bookkeeping, commit
   `wip: context exhausted (<id>)` or `wip: implementer died (<id>)` (skip if nothing changed).
2. Build a resume brief with five items: task id, branch, last WIP SHA, done (by plan step),
   remaining (by plan step). Clean exit: copy the agent's Resume brief. Death: reconstruct from
   `git diff <default>...HEAD --stat` against the plan's steps and say it is best effort.
3. Relaunch with: "This branch already contains partial work at commit `<sha>`. Continue from
   it; do not revert it, do not redo completed steps."

Cap: **2 resumes per task**, independent of the kickback budget. Beyond it, blocked path.

A dispatch that fails at the tool level (API error, no output) is retried once after a short
wait before counting as a death.

Planner or verifier incomplete: relaunch once with the partial output as the brief ("this
plan/verdict is partial; continue it, do not restart"). A second incomplete marks the task
blocked with the reason.

## Crash recovery (run start finds a dirty `rb/*` branch)

A previous session died mid-task. On that branch:

1. `git add -A`, unstage bookkeeping, `git commit -m "wip: interrupted run (<id>)"`.
2. Comment on the issue that the run was interrupted and the work is preserved.
3. `git checkout <default>` and continue the run normally.

When build step 4 finds `rb/<id>-*` already exists, classify by its commits
(`git log <default>..<branch> --format=%s`):

- Only `wip:` commits and the newest is `wip: blocked: ...`: a previous blocked attempt (this is
  the normal case on a retry). Delete the branch (`git branch -D rb/<id>-<slug>`) and start
  fresh, carrying the blocker comment's findings into the planner and implementer prompts.
- Only `wip:` commits, newest is anything else: **resume**. Check it out, build the resume brief
  from it, and dispatch the implementer with it. Do not re-cut the branch.
- A collapsed non-wip commit, never pushed and with no open PR: a run that died between collapse
  and push. Check it out and continue from the verify step (build step 6, dispatch only).
- An open PR for it, or a pushed non-wip commit: real prior work. Do not touch it. Label the
  issue `rb:blocked`, explain in a comment, and ask the user.

A dirty tree on the default branch (bookkeeping files aside) or on any non-`rb/*` branch is the
user's work: stop and ask.

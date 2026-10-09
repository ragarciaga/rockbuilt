# Goal mode

Loaded by the build skill when the user wants the backlog run without typing "continue" between
tasks ("hasta terminar", "sin parar", "until done", "run it all").

## What it is

`/goal <condition>` is a Claude Code built-in. After every turn a small model reads the
conversation and judges whether the condition holds. Not met: Claude starts another turn with
the evaluator's reason as guidance. Met or impossible: the goal clears. It is session-scoped,
one goal at a time, up to 4,000 characters. The evaluator does not run commands or read files:
it only sees what you print. So the condition must name evidence you will surface.

It follows the loop anatomy: trigger (the user), stop condition (the goal), verifier (the
rb-verifier per task plus the mechanical check), hard limits (below).

## Preconditions

- Run start checks of the build skill passed (clean tree, green baseline, gh auth).
- The user knows that `/goal` does not change the permission mode. For an unattended run, the
  project `.claude/settings.json` allow rules must cover the commands used (rb, git, gh, the
  package manager), or the session must be in auto mode. `gh pr merge` stays an ask rule; build
  never calls it anyway.

## Compose the condition

You cannot run a slash command yourself. Compose the condition and give it to the user to paste
as one line, in the conversation language for the explanation, with the condition itself in
English (it is an instruction to the evaluator). Template (fill the placeholders):

```
/goal Every task in <spec-dir>/tasks.md has Status done, in-review, or blocked with a reason written in its Decision log, as shown by the latest `rb tasks <spec-dir>` output printed in this conversation. Work through ready tasks one at a time (or in the announced parallel batches) using the rockbuilt build loop: planner, implementer, mechanical check against `rb baseline`, verifier, PR, decision log. Constraints: never merge a PR, never push to <default-branch>, at most 2 kickbacks per task. Stop early and report if `rb baseline --check` is red, if 3 consecutive tasks end blocked, or after <N> turns.
```

The turn limit is required: the evaluator only sees the transcript, so a run that stops printing
evidence must still end. Pick `<N>` as about 4 turns per remaining ready task, minimum 10. For a single issue, replace
the first sentence with "Issue #<n> has an open PR with a passing verifier verdict, or is
labelled rb:blocked with the reason commented".

Tell the user, in the docs language:

1. Paste the line to start. It begins a turn immediately; no extra prompt needed.
2. `/goal` with no argument shows status (turns, time, last evaluator reason).
3. **`/goal clear` stops it** at any moment (aliases: stop, off, cancel). Running `/clear` also
   removes it. Ctrl+C interrupts a non-interactive run.
4. Merging still needs them: the run ends with PRs to review.

## Your behavior while the goal is active

- After each task, print the line from `rb tasks <spec-dir>` that shows task statuses, so the
  evaluator has evidence. Print the stop-condition checks you ran (baseline result, consecutive
  blocked count).
- Do not wait for subagents in the background across turns without need: a running background
  agent defers evaluation. Dispatch agents in the foreground unless running a parallel batch.
- Update the task Decision log and docs/progress.md after every task, as in the normal loop, so
  a session that dies mid-goal resumes cleanly (`/rb-status`).
- Hard limits are yours to enforce, not the evaluator's: kickback budget 2 (mechanical, verifier
  and security combined), resume cap 2, stop on
  red baseline, stop after 3 consecutive blocked tasks. When one trips, print why, write it to
  progress.md, and state plainly that the goal cannot be met; the evaluator will then clear it.
- Never use goal mode to skip a human gate: approvals of BLOCKING answers you could not ground
  still go to rb:blocked, never guessed.

## After the goal clears

Run the build skill's Run end section: `rb timing report --write`, progress.md, the summary
table, the list of PRs to review.

# Goal mode (optional, interactive only)

Loaded by rb-build only when the user explicitly wants a long interactive session to keep going
without typing "continue" ("hasta terminar", "sin parar", "until done"). For unattended or
scheduled work, recommend `/rb-cycle` instead: it is one bounded pass, holds the lock, checks the
stop switch, merges through the train and posts a digest. Goal mode adds nothing to those
guarantees; it only keeps an interactive session turning.

## What it is

`/goal <condition>` is a Claude Code built-in. After every turn a small model reads the
conversation and judges whether the condition holds. Not met: Claude starts another turn with the
evaluator's reason as guidance. Met or impossible: the goal clears. It is session-scoped, one goal
at a time, up to 4,000 characters. The evaluator does not run commands or read files: it only sees
what you print, so the condition must name evidence you will surface.

## Compose the condition

You cannot run a slash command yourself. Give the user one line to paste; the explanation is in
the conversation language, the condition itself in English. Template:

```
/goal Every task in <spec-dir>/tasks.md has Status done, in-review, or blocked with a reason in its Decision log, or waits for an approval posted with rb escalate, as shown by the latest `node tools/rockbuilt/rb.mjs tasks <spec-dir>` output printed in this conversation. Work through ready tasks with the rb-build loop (stale check, planner, tier, implementer, mechanical check, verifier, auditor for tier B and C, PR, merge train through rb merge-gate unless merges are off). Constraints: never merge except through rb merge-gate, never push to <default-branch>, at most 2 kickbacks per task. Stop early and report if the baseline check is red, if the stop switch is on, if 3 consecutive tasks end blocked, or after <N> turns.
```

`<N>`: about 4 turns per remaining ready task, minimum 10. For a single issue, the first sentence
becomes "Issue #<n> has a merged PR, an open PR waiting for the human, or is labelled rb:blocked or
rb:needs-human with the reason commented".

Tell the user: paste the line to start; `/goal` alone shows status; `/goal clear` stops it at any
moment; tier C work still ends with an approval request for them.

## While the goal is active

- After each task, print the `rb tasks` status line and the stop checks you ran (baseline,
  `rb stop status`, consecutive blocked count).
- Dispatch agents in the foreground unless running a parallel batch.
- Update the task Decision log and progress.md after every task.
- Hard limits are yours, not the evaluator's. When one trips, print why, write it to progress.md,
  and state that the goal cannot be met.
- Never use goal mode to skip a human gate: tier C and ungroundable BLOCKING questions still go to
  `rb escalate`.

## After the goal clears

Run rb-build's Run end section.

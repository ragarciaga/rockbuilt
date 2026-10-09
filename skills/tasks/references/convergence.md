# Convergence details

Loaded by the tasks skill during Phase 4 (synthesize) when verdicts conflict or the loop does not
settle.

## Why this shape

The process is a fan-out and synthesize workflow: a router (bootstrap or evaluate), N read-only
reviewers in parallel, one synthesizer that writes once. Parallel writers on one tasks.md race
and overwrite each other; a single agent reviewing every task in one context gets lazy, prefers
its own drafts and drifts from the spec. Separate contexts per task plus a single writer fixes
both.

## Applying verdicts

| Verdict | Apply when | Effect |
|---|---|---|
| keep | always | nothing |
| rewrite | always (unless the task is also being merged away) | replace the block with the proposed text |
| split | always | replace the block with the proposed blocks, renumber later |
| merge with Tm | the other task's verdict is keep, or it proposes the mirror merge | one combined block at the earlier position |
| delete | no criterion would be left uncovered | remove the block; if a criterion would be orphaned, convert to rewrite |

Conflicts on one task (for example rewrite from its own reviewer and merge from a neighbor's):
prefer the verdict backed by a concrete file:line in the repo or spec. Tie: prefer the smaller
change. Record the losing proposal in the round summary.

## Renumbering

After applying, renumber to T1..Tn following dependency order (topological; ties keep the
previous order). Rewrite every `Depends on:` reference using the old-to-new map. A cycle is a
synthesis bug: break it by merging the tasks in the cycle or by asking the user.

## Re-review scope

Round 1 reviews every task. Rounds 2 and 3 review only tasks created or changed in the previous
round, plus tasks that depend on them. Unchanged tasks keep their previous verdict.

## Stop rules

- Converged: a round with only keep verdicts.
- Cap: 3 rounds. If changes are still pending, stop, write the header with `not converged`, and
  list the open disagreements (task, verdicts, reasons) in the approval message. The user decides.
- Oscillation (a task split in round 1 and merged back in round 2): stop applying changes to
  those tasks, keep the round-1 version, report it.

## Sizing hints

- S: one or two files, one behavior, tests alongside.
- M: several modules or one layer stack (schema plus API) with tests.
- L: only when splitting would leave a slice with no verifiable outcome. Expect reviewers to
  challenge every L.
- More than about 8 files, or schema plus API plus UI that could ship separately, is a split.

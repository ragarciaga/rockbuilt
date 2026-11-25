# Calibration mode (PLAN-1.0 G2, DESIGN 33.2)

For a task whose result is a score, not a yes or no: a prompt, a ranking weight, a threshold, a
model choice. The project's eval (`## Evals` in AGENTS.md, an `[eval]` criterion with a target) is
the gate of each iteration; the reviews run once, at the end, on the version that stayed.

## When

The planner proposes `Mode: calibration` in the plan when the criterion is an `[eval]` with a
threshold and the work is tuning. The plan's `Risk and cost` names the **cap** in USD for the
whole calibration and the cost of one eval run. The cap must fit a `Paid services` entry and its
monthly cap; otherwise it is a cost approval (closed list) like any other.

## Loop (orchestrator)

On the task branch, after the plan (steps 1 to 4):

1. Dispatch `rb-implementer` with the plan, `Mode: calibration`, the iteration number, the best
   score so far and the last result: "one hypothesis per iteration, the smallest change that tests
   it; report the hypothesis". Commit it: `git commit -am "calibrate: <hypothesis> (<id>)"`.
2. Run the eval commands (`rb verify-cmds Evals`), read the score and the cost of this run.
3. `rb calibration add <id> --score <score> --cost <usd> --cap <cap> --ref <git rev-parse HEAD>
   --issue <task issue>` (with GitHub; it posts the iteration there, so a new session continues
   the same loop and spend). Add `--lower-is-better` on every call when lower wins (latency, error
   rate): the direction is fixed at the first call and must repeat.
   - `kept: false`: undo the iteration with `git revert --no-edit HEAD` (never a hard reset).
   - Exit 3 (`stop: cap` or `stop: plateau`, three iterations without improvement): leave the loop.
   - Before the next iteration: when `remaining` is below the cost of one eval run, leave the loop
     (an iteration already run is recorded even if it crosses the cap: that money is spent).
4. Post `rb calibration show <id> --issue <n>` on the task issue when the loop ends.

The cap and the direction are fixed by the first call; `rb calibration` refuses a change. A higher
cap is the owner's decision (cost): once they approve it, continue as `<id>-2` from the kept
version.

## After the loop

- The head is the kept version (every discarded iteration was reverted). If the best score
  misses the criterion's threshold, the task is not done: blocked path with the calibration log
  (`references/kickback.md`), never a PR that claims the criterion.
- Otherwise continue at step 6 (mechanical check), then 7, 8 and the reviews of step 9 by level,
  once. Give the verifier the calibration log with the task's other inputs; it re-runs the eval
  once to confirm the kept score.

# Merge train (serial, through rb merge-gate)

Loaded by rb-build, rb-fix and rb-cycle when merges are on (no "no merges this run", not
`Autonomy: supervised`, not degraded). Only `rb merge-gate` merges; the orchestrator never merges
any other way, never approves a PR, never routes around a refusal. `rb <cmd>` means
`node tools/rockbuilt/rb.mjs <cmd>`.

Precondition: this run holds the lock (`rb lock acquire --run <run id>` succeeded; the gate checks
it through `--run`). Tier C PRs are never in the train: they wait for the human (`/rb-merge`).

## 1. The queue

`rb gh pr-list --state open --head-prefix rb/`. Skip `rb/bookkeeping-*` (rb-cycle merges those at
run start) and the human-only kinds (`rb/revert-*`, `rb/spec-*`, `rb/verify-*`, `rb/kickoff*`,
`rb/adopt*`, `rb/retro-*`): the gate refuses them without `--human-approved`. Keep PRs labelled `rb:tier-a` or `rb:tier-b` and
none of `rb:needs-human`, `rb:blocked`, `rb:tier-c`, `rb:hold`. Order: PRs whose task other ready
tasks depend on first, then oldest PR number first. Human PRs and branches outside `rb/` are never
touched.

## 1b. The merge queue (two or more ready PRs)

Serial merging leaves every other PR behind after each merge, and each update costs a full CI run
(3d_brain: 12 PRs, one CI each). When two or more PRs in the queue order are **ready** (CI
completed green on their heads, every review line passes on their heads, and a dry run
`rb merge-gate <pr> --run <run id> --dry-run --json` gives no reason other than `behind` or
`stale-head` for a head whose task did not change), test them together once:

1. `rb queue build --run <run id> --prs <a,b,c in queue order>`. It merges them onto the default
   branch tip in that order as `rb/queue-<run id>-<k>`, skips any that conflicts with the ones
   before it, and records each position on its PR. Exit 3 (fewer than two merge cleanly): serial
   train (section 2).
2. Wait for CI on the queue head it prints, as step 3 of section 2 waits (`rb gh checks <head>`).
3. **Green:** `rb merge-gate <pr> --run <run id> --json` for each queued PR, in the printed order,
   with the after-merge steps of section 2 step 6 after each. The gate accepts a queued PR behind
   its base only when GitHub confirms that the base is exactly the queue's previous step and the
   queue head passed; the first refusal ends the queue, the rest continue serially.
4. **Red:** the combination broke. Run the serial train for those PRs (each one updates and
   re-runs its CI, so the culprit shows itself) and note the failed queue in the digest.
5. `rb queue done --run <run id>` deletes this run's queue branches.

A PR updated while queued, a merge from outside the queue, or a red queue all fall back to the
serial path below: the queue only skips work when it can prove the result is the tested one.

## 2. Per PR, one at a time

1. **Stop check.** `rb stop status`; exit 3 ends the train (record every remaining PR as
   "not merged: stop switch"). Unattended runs also stop the train when the run time budget is
   spent.
2. **Read it.** `rb gh pr-view <pr>`: head SHA, `mergeable_state`.
   - `dirty` (conflict): not eligible. Escalate on the task issue with the `Merge conflict`
     template (recommendation: rebuild from the current default branch) and continue.
   - The gate (step 5) refuses with `behind`: the base gained code since the PR's merge base
     (a PR behind only on bookkeeping files merges as it is, so `mergeable_state: behind` alone
     is not a reason to update). `rb gh pr-update-branch <pr>` once per PR per run (never a
     local merge, never a push to that branch from here), then read the new head SHA. Same
     head: hold, next PR.
3. **Wait for CI**, bounded, timed (`rb timing start <id> ci` ... `end`). Poll `rb gh checks
   <head sha>` every 60 s (`sleep 60`), at most 30 polls. All completed: go on. Still pending: hold ("CI pending on <sha>", the next run re-reads
   it), next PR. No `rockbuilt-ci` check at all: not eligible, escalate once (`No CI` template).
   Unattended runs do not sit in this wait while build work remains: evaluate the train after the
   build batch, so most CI runs have finished.
4. **CI red**: the CI fix in `references/kickback.md` section 6 (one attempt per PR), then the
   next PR. The fixed PR is re-evaluated in a later pass of this train or the next run.
5. **Gate.** `rb merge-gate <pr> --run <run id> --json` (the run id that holds the lock). Exit 0: merged. Exit 3: read the reasons.
   - The only reasons are `behind` (and the checks it implies): update the branch as in step 2,
     then continue with the next PR; this one is re-evaluated after its CI finishes.
   - The only reason is `stale-head` (a review line whose `head=` is older than the PR head) after
     step 2's update-branch (the update added only a base merge): re-review once per PR per run,
     light or full (DESIGN 8.3). In a checkout of the new head (`git fetch origin`, then the PR
     branch at the new head, fast-forward only), run
     `rb review-delta --reviewed <head of the auditor line> --base origin/<default>`, and again for
     the security line's head when it differs (after a test-only kickback it does). Use those
     heads, not the verifier's. The verifier line may carry both keys, one per head:
     `identical-to=<security head> app-identical-to=<auditor head>`.
     It compares content: every file the task touched then or touches now, at the old and the new
     head (a stacked base task that was squash-merged meanwhile does not count as a change).
     - **`identical`:** no agent. `rb review-delta --reviewed <old head> --base
       origin/<default> --line --task <id>` prints the verifier line for the new head with
       `identical-to=<old head>` (it also checks that only merges follow the old head). Replace
       only the verifier line in the body; the auditor and security lines keep their old
       `head=`. CI on the new head runs the Verification and E2E; the gate re-checks identity
       through GitHub. Exit 3: treat as `different`.
     - **`test-only`:** only test files differ. Dispatch the verifier with
       `Previously reviewed commit: <old head>`, `Reviewed head: <new head>` and
       `Carry: <old head>`; its pass line carries `app-identical-to=<old head>`. The auditor line
       stays; the security review, when required, runs again (test code runs in CI with secrets).
     - **`different`, or the short verifier fails:** full re-review. Dispatch the verifier
       with `Previously reviewed commit: <old head>` and `Reviewed head: <new head>` (scope: the
       base merge), for tier B the auditor again (a re-audit, `audit.md`), security when
       required; rewrite every machine line with the new head.
     The gate re-checks the class through GitHub and refuses a carried line it cannot confirm.
     Then apply the new lines with `rb gh pr-line <pr> --line "<line>"` (one call per line) and run
     the gate once more.
   - Tier rose (`rb risk` on the live diff above the label): relabel `rb:tier-c`
     (`rb gh label-remove`, `rb gh label-add`) and escalate (`Tier rose at merge` template).
   - Anything else: hold with the reasons verbatim in the digest; next PR.
   Exit 1 (error): stop the train for this run (merge-halting), digest it.
6. **After a merge.**
   - `git checkout <default>`, `git pull --ff-only`, then confirm the merge is in the local
     default branch (`git log -1 --format=%H` changed, or the PR's merge commit is an ancestor:
     `git merge-base --is-ancestor <merge sha> HEAD`). A pull that did not land stops the train.
   - `rb baseline --check` on the new head. A failure outside known-failures stops the train:
     run `rb revert <pr>` (it opens a revert PR labelled `rb:tier-c` and `rb:needs-human`; the
     harness never merges it), then escalate on the task issue with the `Default branch red after
     merge` template naming the revert PR as the recommended action.
   - `rb sync` (tasks done, labels, merged branches cleaned), `rb worktree remove <id>` if one
     is left, then tasks.md `Status: done` and a Decision log line `- <date>: merged as PR #<pr>
     (squash, rb merge-gate).` when `rb sync` did not already write it.
   - Record for the digest: PR, title, tier, `rb revert <pr>`, minutes from PR open to merge.
   - Minutes that happened after the PR opened (CI waits, re-reviews, the merge): `rb timing line
     <id> --pr <pr>` adds them to the line already in the body; replace that line with the output
     (`rb gh pr-line <pr> --line "<timing line>"`). Also after a hold, so the next run starts from it.
   - Tasks that depended on this one may now be ready: the caller loops back to the build queue
     when the run budget allows.
7. The next PR may now be behind: the gate decides (step 5); a bookkeeping-only gap needs no update,
   and a queued PR whose queue passed needs none either (section 1b).

## 3. Outcome classes

- **Per-PR hold**: anything not eligible, CI pending, a conflict, a failed update. Continue with
  the next PR; the PR stays open with its reason in the digest.
- **Merge-halting** (rest of this run): a gate error (exit 1), an unexpected merge result. No more
  gate calls; build work may continue, PRs still open.
- **Train-stopping**: the stop switch, red default branch after a merge, a pull that did not
  land. No more merges and no new task dispatch; go to the run end.

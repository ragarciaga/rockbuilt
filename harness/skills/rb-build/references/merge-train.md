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

## 2. Per PR, one at a time

1. **Stop check.** `rb stop status`; exit 3 ends the train (record every remaining PR as
   "not merged: stop switch"). Unattended runs also stop the train when the run time budget is
   spent.
2. **Read it.** `rb gh pr-view <pr>`: head SHA, `mergeable_state`.
   - `dirty` (conflict): not eligible. Escalate on the task issue with the `Merge conflict`
     template (recommendation: rebuild from the current default branch) and continue.
   - `behind`: `rb gh pr-update-branch <pr>` once per PR per run (never a local merge, never a
     push to that branch from here), then read the new head SHA. Same head: hold, next PR.
3. **Wait for CI**, bounded. Poll `rb gh checks <head sha>` every 60 s (`sleep 60`), at most 30
   polls. All completed: go on. Still pending: hold ("CI pending on <sha>", the next run re-reads
   it), next PR. No `rockbuilt-ci` check at all: not eligible, escalate once (`No CI` template).
   Unattended runs do not sit in this wait while build work remains: evaluate the train after the
   build batch, so most CI runs have finished.
4. **CI red**: the CI fix in `references/kickback.md` section 6 (one attempt per PR), then the
   next PR. The fixed PR is re-evaluated in a later pass of this train or the next run.
5. **Gate.** `rb merge-gate <pr> --run <run id> --json` (the run id that holds the lock). Exit 0: merged. Exit 3: read the reasons.
   - The only reason is `stale-head` (a review line whose `head=` is older than the PR head) after
     step 2's update-branch (the update added only a base merge): re-review once per PR per run. Dispatch
     the verifier with `Previously reviewed commit: <old head>` and `Reviewed head: <new head>`
     (scope: the base merge), for tier B the auditor again (inputs as in build step 9), security
     when required; rewrite the machine lines with the new head (`rb gh issue-edit <pr>
     --body-file <f>`) and run the gate once more.
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
   - Tasks that depended on this one may now be ready: the caller loops back to the build queue
     when the run budget allows.
7. The next PR is now behind by construction: step 2 updates it.

## 3. Outcome classes

- **Per-PR hold**: anything not eligible, CI pending, a conflict, a failed update. Continue with
  the next PR; the PR stays open with its reason in the digest.
- **Merge-halting** (rest of this run): a gate error (exit 1), an unexpected merge result. No more
  gate calls; build work may continue, PRs still open.
- **Train-stopping**: the stop switch, red default branch after a merge, a pull that did not
  land. No more merges and no new task dispatch; go to the run end.

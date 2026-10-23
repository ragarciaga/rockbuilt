# Kickbacks, dispatch failures, resume, crash recovery, blocked path, CI fix

Loaded by rb-build, rb-fix and rb-cycle when a check or review fails, an agent returns
`incomplete` or dies, a run starts on a dirty `rb/*` branch, a branch for the task already exists,
or CI is red on a PR. `<id>` is the task id (`T<n>`, `i<n>`, `B<n>` or `L<n>`). `rb <cmd>` means
`node tools/rockbuilt/rb.mjs <cmd>`.

All checkpoints keep the `wip:` prefix so branch classification stays a simple read of
`git log --format=%s`:

- `wip: checkpoint <stage> (<id>)` after a stage (implement, kickback <k>, ci-fix);
- `wip: <agent> died (<id>)`, `wip: context exhausted (<id>)`, `wip: interrupted run (<id>)`;
- `wip: escalated: <reason> (<id>)` (tier rose to C, waiting for approval);
- `wip: blocked: <reason> (<id>)` (the blocked path; always the newest commit of a blocked branch,
  added with `--allow-empty` when nothing changed, so it never misclassifies as resume).

## 1. Kickback (mechanical, verifier, auditor or security failure)

Budget: **2 kickbacks per task, shared** by every source (at most 3 implementer passes).
For kickback k:

1. `rb timing start <id> fix`. Dispatch `rb-implementer` with the task id, the full plan and
   RESOLVED lines, its previous report, the findings verbatim (verifier Findings, auditor failing
   criteria with its evidence, security blocker and major findings, or the failing command
   output), `Dispatch attempt: <k>`, and "Fix ONLY these findings. Do not expand scope. Return your
   report." The auditor's findings are behavior evidence; passing them to the implementer is fine.
   The reverse never happens: the auditor never sees implementer or verifier text.
2. Checkpoint `wip: checkpoint kickback <k> (<id>)` (skip if nothing changed). `rb timing end`.
3. Re-run the mechanical check, recompute the tier (`rb risk --base origin/<default>`), then
   collapse as build step 8 (on a branch already on origin it squashes only the new local commits
   onto the pushed tip, as `fix: <what> (kickback <k>, <id>)`; nothing new: no commit). Push after
   the reviews. Record the new head.
4. Re-run the verifier with the prior findings verbatim and `Previously reviewed commit: <sha>`
   (it checks prior findings first, then only the delta). Then the auditor and the security
   review, decided by `rb review-delta --reviewed <head they passed> --base origin/<default>`
   (DESIGN 8.3), only for reviewers that already passed on an earlier head:
   - `test-only` (the fix touched only test files, the app the auditor judged is unchanged): keep
     the auditor's line as it is, and give the verifier `Carry: <head it passed>` so its pass line
     ends in `app-identical-to=<that head>`. The security review, when it ran, runs again (test
     code runs in CI with secrets; the gate never carries it on test-only). The gate re-checks.
   - `different`: re-run the auditor on the new head with its previous verdict (a re-audit, see
     `audit.md`; the verdict comes from "Keep the verdict" there, so a later session has it too),
     and the security review when it ran before.
   A reviewer that failed, or had not run yet, always runs on the new head.

After kickback 2, any failure: blocked path (section 5) plus an escalation
(`.claude/skills/rb-cycle/references/escalation-templates.md`, "Blocked task").
The orchestrator never edits code to fix a finding.

If two consecutive verifier rounds each report only a fresh low-impact survivor of the mutation
probe (no false pass, no wrong behavior), do not spend the next kickback silently: finish with the
blocked path and say in the escalation that the remaining finding may be a note, so the human can
bound the review.

## 2. Dispatch failures (retry ladder)

Retryable: a tool-level dispatch error, API 429/500/529, or a dispatch that returns nothing or no
parseable status line. Back off and retry: 30 s, 60 s, 120 s, 240 s (attempts 2 to 5), with
`sleep <s>`. If `sleep` is unavailable, one immediate retry only. State `Dispatch attempt: <k>` in
every prompt. After attempt 5, stop: record the stage as failed (task, stage, attempts, last
error), checkpoint any work, blocked path. Not retryable (other paths): a well-formed `blocked`
report (blocked path) and a review `fail` (kickback). The ladder never adds implementer passes
beyond the kickback budget; it only repeats a dispatch that never produced a report.

## 3. Resume after `incomplete` or a death

1. Checkpoint first: `wip: context exhausted (<id>)` or `wip: <agent> died (<id>)` (skip if
   nothing changed).
2. Resume brief, five items: task id, branch, last WIP SHA, done (by plan step), remaining (by plan
   step). Clean exit: copy the agent's Resume brief. Death: reconstruct from
   `git diff origin/<default>...HEAD --stat` against the plan steps, marked best effort.
3. Relaunch with: "This branch already contains partial work at commit `<sha>`. Continue from it;
   do not revert it, do not redo completed steps."

Cap: **2 resumes per task**, independent of kickbacks. Beyond it: blocked path. Planner, verifier,
auditor or security reviewer `incomplete`: relaunch once with the partial output ("this plan or
verdict is partial; continue it, do not restart"); a second one: blocked path.

## 4. Crash recovery and existing branches

**Run start on a dirty `rb/*` branch** (a previous session died): `git add -A`, unstage
bookkeeping, `git commit -m "wip: interrupted run (<id>)"`, `git push -u origin <branch>` (so a
cloud run keeps it), comment on the issue that the run was interrupted and the work is preserved,
`git checkout <default>`, continue. A dirty tree anywhere else (bookkeeping aside) is the user's
work: interactive, stop and ask; unattended, touch nothing, escalate on the control issue and end
the run.

**Leftover worktrees**: `rb worktree list`; for each `-wt-<id>` with changes, commit
`wip: interrupted run (<id>)` inside it with `git -C <path>`, push, then `rb worktree remove <id>`.

**A branch `rb/<id>-*` already exists** (check local branches and `git branch -r --list
"origin/rb/<id>-*"`; prefer the remote when they differ and the local one has nothing extra).
Classify by `git log origin/<default>..<branch> --format=%s`:

- Only `wip:` commits, newest `wip: blocked: ...`: a blocked attempt (the normal retry case).
  Start fresh on a new branch name `rb/<id>-<slug>-r<k>` (k = next free number; never delete
  remote branches), carrying the blocker comment's findings into the planner and implementer.
- Only `wip:` commits, newest `wip: escalated: ...`: if the escalation is approved, check it out
  and continue at the mechanical check (build step 6), then step 8; if not, skip the task.
- Only `wip:` commits, newest anything else: **resume**. Check it out, build the resume brief,
  dispatch the implementer with it. Do not re-cut or rebase it.
- Newest commit a collapsed harness commit (`<type>(<scope>): <title> (<id>)` or `fix: ...
  (<id>)`, possibly on top of pushed `wip:` commits), no open PR (`rb gh pr-list --state open
  --head-prefix rb/<id>-`) and no closed one for that branch (`--state closed`): the run died
  before the PR. Check it out and continue from the reviews (build step 9). A closed unmerged PR
  for it means a human closed it: leave the branch, note it, move on.
- An open PR for it: not a build item. It belongs to the merge train or the CI fix queue. Only
  when the human answered a `merge-conflict` escalation with "reconstruir" / "rebuild": comment
  on the PR, close it (`rb gh issue-edit <pr> --state closed`), and rebuild the task from the
  stale check on `rb/<id>-<slug>-r<k>`.
- Anything else (commits the harness did not make): real prior work. Do not touch it.
  Escalate (`Branch with prior work` template) and move on.

## 5. Blocked path

1. `git add -A` (minus bookkeeping), then `git commit --allow-empty -m "wip: blocked: <short
   reason> (<id>)"`.
2. `git push -u origin <branch>` (never a PR): the work survives a cloud run. Degraded mode: keep
   it local and name it in the report.
3. One issue comment with the findings or blocker verbatim, kickbacks and resumes used, and the
   branch name; `rb gh label-add <n> rb:blocked`, `rb gh label-remove <n> rb:in-progress`.
4. tasks.md `Status: blocked` plus a Decision log line with the reason. `git checkout <default>`.

A human retries by removing `rb:blocked` or saying "retry issue N". Three consecutive blocked tasks
stop the run.

## 6. CI fix (one bounded attempt per PR)

Triggered from the merge train or the cycle queue when the checks on an rb PR's head
(`rb gh checks <sha>`) completed with a failure. Read the failure with `rb ci logs <sha>` (the
failing job's log tail, or its annotations when the log is not readable); never guess from the
check name.

1. **Already used?** The PR branch has a commit whose subject ends `(CI, <id>)`: the attempt is
   spent. Escalate (`CI red after fix`) once and move on.
2. **Classify.** A test that fails once and passes on a re-run of the same commit is a flaky
   candidate: `rb flaky record <spec file:line or test id> --pr <n>`, no code change, never a
   skip; `rb-retro` reads `rb flaky list`. A secret-scan (gitleaks) failure is never auto-fixed: escalate `--kind human`
   (the secret must be rotated). The `Harness files` step only warns (the gate already makes
   those PRs tier C); it never needs a CI fix. A check with the same name also failing on
   the default branch head (`rb gh checks <default sha>`) is unrelated: do not burn the attempt,
   escalate (`CI red, unrelated`) in the digest.
3. **Fix.** Check out the PR branch (`git fetch origin`, `git checkout <branch>`,
   `git pull --ff-only`). Run the failing command locally when it is a Verification or E2E
   command to capture the output. Dispatch `rb-implementer` with the plan, its last report, the
   check name, the CI output summary and the local output, and "Fix ONLY this CI failure. Do not
   expand scope. Return your report." Checkpoint `wip: checkpoint ci-fix (<id>)`.
4. Mechanical check. Then `git reset --soft origin/<branch>` and `git commit -m "fix: <what> (CI,
   <id>)"`: only local commits are squashed, the pushed ones stay (a force push is denied). The
   merge squashes, so extra commits cost nothing.
5. Reviews on the new head: verifier with `Previously reviewed commit: <old head>`; for tier B and
   C the auditor and security as in section 1 step 4 (`rb review-delta` decides whether a
   test-only fix keeps the auditor's line; the security review runs again). A
   failure here takes the blocked path for the fix (the PR stays open, labelled `rb:blocked`).
6. `git push`. Replace every machine line that names the old head, the timing line (from `rb timing
   line <id> --pr <pr>`, which keeps the minutes already in the body) and the kickbacks line (now
   `ci=1`), each with `rb gh pr-line <pr> --line "<line>"` (status lines: `--stage --task --outcome
   --head`). If an edit fails, escalate: the gate
   will refuse the stale lines.
7. CI runs again; the train reads it. Still red: escalate `CI red after fix`, label `rb:blocked`
   on the issue, the PR stays open.

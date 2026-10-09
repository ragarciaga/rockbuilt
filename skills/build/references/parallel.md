# Parallel mode (worktrees)

Loaded by the build skill when CLAUDE.md says `Parallel: auto` (or the user asked "in parallel")
and `rb parallel` returns a batch of 2 or more tasks. Every budget and rule of the sequential loop
still applies per task. Only agent dispatches run concurrently; every git and gh command, and
every write to bookkeeping files, stays sequential in you (the orchestrator).

## 1. Compute the batch

```bash
rb parallel <spec-dir> --max <Max parallel from CLAUDE.md, default 3> --json
```

It returns batches of ready tasks with disjoint `Files` and no shared paths (package.json,
lockfiles, migrations, schema dirs, config, .env*), plus the reasons a task was forced serial.
Take the first batch. Tasks forced serial run after the batch, sequentially. A task whose plan
(once written) lists Affected files outside its tasks.md `Files` and overlapping another batch
member is moved out of the batch before implementation (re-check after planning).

**Announce the batch in one line** before starting, in the docs language, e.g.
"Paralelo: T3, T4, T6 en worktrees separados; T5 después (comparte package.json)."

## 2. Plan the batch

Apply the plan reuse rule of build step 2 per task first. Dispatch one `rockbuilt:planner` per
task that still needs a plan, in a single message (concurrent; they are read-only and need no
worktree). Then, sequentially: post each plan as an issue comment, resolve open
questions (build skill step 3), and drop blocked tasks from the batch. Re-check Affected files
overlap across the remaining plans; overlapping tasks leave the batch.

## 3. Create worktrees (sequential)

For each task:

```bash
rb worktree add Tn --base <default-branch> --spec <spec-dir>
```

It creates `../<repo>-wt-Tn` on branch `rb/Tn-<slug>` (slug from the task title in tasks.md;
pass `--slug <s>` or `--title "<title>"` to override), copies `.env*` files, sets
`core.longpaths=true`, and prints the path and a suggested port offset. Run the `## Setup`
commands inside each worktree (dependencies are per worktree). Keep a table in context: task,
worktree path, branch, port offset, stage, kickbacks used, resumes used, last WIP SHA.

## 4. Implement concurrently

`rb timing start Tn implement` for each, then dispatch one `rockbuilt:implementer` per task in a
single message. Each prompt adds:

- `Working directory: <absolute worktree path>. Run every command and edit every file inside it.
  Never touch the main checkout.`
- `Port offset: <k>`: if the task starts a server or test server, use base port + k (pass via the
  project's env var, e.g. `PORT`), so concurrent runs do not collide.

## 5. Serial tail, one task at a time in completion order

As each implementer returns, carry that task through the rest of the loop before taking the next
report (never hold a finished task behind an unfinished one):

- checkpoint: `git -C <wt> add -A` then `git -C <wt> commit -m "wip: checkpoint implement (Tn)"`
  (bookkeeping files never live in a worktree, so nothing to unstage there);
- mechanical check: run the Verification commands with the worktree as the working directory;
  compare with the baseline;
- collapse to one commit (build step 6) with `git -C <wt> merge-base <default> HEAD`, then
  `git -C <wt> reset --soft <sha>`, then `git -C <wt> commit ...`; record the head;
- verifier: dispatch with `Worktree: <path>` and `Reviewed head: <sha>` in the prompt
  (verifiers of different tasks may run concurrently, since each mutates only its own
  worktree); per-task security review (build step 7b) the same way;
- kickbacks re-dispatch the implementer into the same worktree, same branch; never recreate it;
- PR: `git -C <wt> push -u origin rb/Tn-<slug>`, `gh pr create --head rb/Tn-<slug> ...`,
  labels, tasks.md and decision log updated from the main checkout.

**E2E runs serially.** Any task whose Verify includes an E2E case or needs the live app runs that
step alone, after the other worktrees' checks, so one app instance and one browser at a time.

**CI watches are deferred** until no implementer is in flight, then drained one at a time with
the single bounded CI fix each.

## 6. Cleanup

After a task reaches a terminal state (PR open with CI recorded, or blocked), remove its
worktree: `rb worktree remove Tn` (the branch stays). Blocked tasks keep their `wip: blocked`
commit on the branch. `rb worktree list` at the end must show none of this batch. Then compute
the next batch (dependencies may have changed) or fall back to sequential.

## Windows notes

- `rb worktree add` sets `core.longpaths=true`; if a checkout still fails on long paths, tell the
  user to enable long paths in Windows (`git config --system core.longpaths true` as admin).
- Worktrees live next to the repo (`..\<repo>-wt-Tn`); keep the repo path short (e.g. `C:\src`).
- Antivirus and open editors can lock files during `rb worktree remove`; retry once, then report
  the path for manual removal.
- Use the worktree path exactly as `rb` printed it; do not hand-convert slashes.

## Hard rules

- Never more than `Max parallel` implementers in flight.
- Only the orchestrator runs git and gh, one command at a time.
- Shared files (tasks.md, progress.md, LESSONS.md) are written only by you, from the main
  checkout.
- One sick task never stops the batch: its budgets exhaust into the blocked path and the rest
  continue.

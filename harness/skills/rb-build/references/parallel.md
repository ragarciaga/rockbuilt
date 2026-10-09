# Parallel mode (worktrees)

Loaded by rb-build and rb-cycle when AGENTS.md says `Parallel: auto` (or the user asked "in
parallel") and `rb parallel` returns a batch of 2 or more tasks. Every budget and rule of the
sequential loop still applies per task. Only agent dispatches run concurrently; every git and `rb`
command, and every write to bookkeeping files, stays sequential in you (the orchestrator).
`rb <cmd>` means `node tools/rockbuilt/rb.mjs <cmd>`.

## 1. Compute the batch

```bash
rb parallel <spec-dir> --max <Max parallel from AGENTS.md, default 3> --json
```

It returns batches of ready tasks with disjoint `Files` and no shared paths (package.json,
lockfiles, migrations, schema dirs, config, .env*), plus the reasons a task was forced serial.
Take the first batch; tasks forced serial run after it, sequentially. Standalone issues and bugs
are never in a batch. In an unattended run the batch also counts against `Max tasks per run`.

**Announce the batch in one line** in the docs language (interactive) or record it for the digest
(unattended), e.g. "Paralelo: T3, T4, T6 en worktrees separados; T5 después (comparte
package.json)."

## 2. Plan the batch

Apply the stale check (build step 1) per task. Dispatch one `rb-planner` per task that still needs
a plan, in a single message (read-only, no worktree needed). Then, sequentially: compute the tier
(`rb risk --files`), post each plan with its marker, resolve open questions, escalate tier C plans
that are not approved, and drop escalated or blocked tasks from the batch. Re-check Affected files
overlap across the remaining plans; a task whose Affected files overlap another member leaves the
batch and runs after it.

## 3. Create worktrees (sequential)

```bash
rb worktree add Tn --base origin/<default-branch> --spec <spec-dir>
```

It creates `../<repo>-wt-Tn` on branch `rb/Tn-<slug>`, copies `.env*` files, sets
`core.longpaths=true`, and prints the path and a port offset. Run the Setup commands inside each
worktree. Keep a table in context: task, worktree path, branch, port offset, stage, tier,
kickbacks, resumes, last WIP SHA, minutes.

## 4. Implement concurrently

`rb timing start Tn implement` for each, then one `rb-implementer` per task in a single message,
never more than `Max parallel` in flight. Each prompt adds:

- `Working directory: <absolute worktree path>. Run every command and edit every file inside it.
  Never touch the main checkout.`
- `Port offset: <k>`: a server or test server uses base port + k (via the project's env var, e.g.
  `PORT`).

Dispatch failures follow the retry ladder in `references/kickback.md`.

## 5. Serial tail, one task at a time in completion order

As each implementer returns, carry that task through the rest of the loop before taking the next
report (never hold a finished task behind an unfinished one):

- checkpoint with `git -C <wt> add -A` and `git -C <wt> commit -m "wip: checkpoint implement
  (Tn)"` (bookkeeping files never live in a worktree);
- mechanical check with the worktree as working directory (`rb baseline --check` reads the main
  checkout's baseline);
- recompute the tier inside the worktree (`rb risk --base origin/<default> --json`);
- collapse with `git -C <wt> merge-base origin/<default> HEAD`, `git -C <wt> reset --soft <sha>`,
  `git -C <wt> commit ...`; record the head;
- reviews: verifier, then (B and C) the blind auditor, then security when flagged, each with
  `Working directory: <wt>` and `Reviewed head: <sha>`. Reviews of different tasks may run
  concurrently, since each mutates only its own worktree; the reviews of one task stay serial;
- kickbacks re-dispatch the implementer into the same worktree and branch; never recreate it;
- PR: `git -C <wt> push -u origin rb/Tn-<slug>`, `rb gh pr-create --head rb/Tn-<slug> ...`,
  labels, tasks.md and decision log from the main checkout.

**E2E and auditor browser sessions run serially**: one app instance and one browser at a time.
**CI is read in the merge train**, after the batch, not while implementers are in flight.

## 6. Cleanup

When a task reaches a terminal state (PR open, escalated or blocked, branch pushed), remove its
worktree: `rb worktree remove Tn` (the branch stays). `rb worktree list` at the end must show none
of this batch. Then run the merge train if merges are on, and compute the next batch (dependencies
may have changed) or fall back to sequential.

## Windows notes

- `rb worktree add` sets `core.longpaths=true`; if a checkout still fails on long paths, tell the
  user to enable long paths (`git config --system core.longpaths true` as admin).
- Worktrees live next to the repo (`..\<repo>-wt-Tn`); keep the repo path short (e.g. `C:\src`).
- Antivirus and open editors can lock files during `rb worktree remove`; retry once, then report
  the path for manual removal.
- Use the worktree path exactly as `rb` printed it; do not hand-convert slashes.

## Hard rules

- Never more than `Max parallel` implementers in flight.
- Only the orchestrator runs git and `rb`, one command at a time.
- Shared files (tasks.md, progress.md, LESSONS.md) are written only by you, from the main checkout.
- One sick task never stops the batch: its budgets exhaust into the blocked path and the rest
  continue.

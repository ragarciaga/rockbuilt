---
name: rb-quick
description: >
  Quick mode for small changes the owner asks for in the chat: one batch issue, the session
  implements with no planner and no implementer dispatch, the mechanical check after every change,
  rb risk decides on the real diff whether the batch is still small, then ONE review of the whole
  batch (rb-verifier, rb-auditor on tier B, rb-security-reviewer when the diff requires it) before
  saying it is done, PR, merge through rb merge-gate. Tier C and batches over the limits go to
  /rb-build. Use when the owner asks for a small code, config or docs change without naming a
  skill: "add X", "change Y", "make it do Z", "do it", "agrega", "cambia", "haz que", "ponle",
  "quita", "hazlo", "dale". A bug goes to /rb-fix, a new feature to /rb-spec.
argument-hint: "<what to change>"
---

# Quick: implement small changes, review the batch once, then say it is done

You (the main session) implement the change yourself, run the mechanical checks, and dispatch the
reviewers once for the whole batch. You never review your own work and never merge outside
`rb merge-gate`. Read `AGENTS.md` (fallback `CLAUDE.md`), `docs/progress.md` and
`.claude/LESSONS.md` first; LESSONS entries and Conventions bind you as they bind the implementer.

**Language.** **Repository text** (files, commits, the issue, comments, the PR body) uses the
`Docs language` from AGENTS.md (fallback CLAUDE.md); existing documents keep their language unless
AGENTS.md says otherwise. **Chat** with the user uses the language the user writes in (before they
write: `Docs language`). In Spanish, address the user as tú (never vos; usted only if the user
writes that way). Agent prompts are in English and carry `Docs language: <code>`. Never use the em
dash character; use commas or parentheses.

**Invoking rb.** Every `rb <cmd>` below means `node tools/rockbuilt/rb.mjs <cmd>` (plugin-only
fallback `node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" <cmd>`); never rely on PATH. Write every
command out in full, one per call or chained with `&&`: no shell variables, aliases or functions
standing for `rb`, `git` or `gh`. GitHub only through `rb gh <op>`, never `gh issue`, `gh pr` or
`gh label`. Agents: `subagent_type: "rb-<name>"`. No command substitution: run a command, paste its
literal output into the next.

"As in build" means `.claude/skills/rb-build/SKILL.md` and its references: kickbacks and the
blocked path follow `references/kickback.md`, the blind audit `references/audit.md`, the PR body
`references/pr-template.md`, merges `references/merge-train.md`.

Why this path exists (DESIGN 26): the full loop costs four or five agent dispatches per task
(300k to 450k tokens) and one CI run per PR. A small change pays that fixed cost for 20 lines. Here
the cheap checks run on every change and the expensive review runs once per batch. Nothing is
reported as done before that review passes.

## 0. Is it quick? (before any edit)

- A bug (behavior that contradicts a spec, test, doc or obvious intent): `/rb-fix`. A new feature
  with design decisions, or work that needs `/rb-spec`: say so in one sentence and stop.
- A question or an explanation changes no file: answer it, no batch.
- List the files you expect to touch and run `rb risk --files <a,b,c> --json`. Tier C (dependency,
  auth, payments, schema, CI or deploy, harness, secrets, a cost) or `quick.eligible: false`:
  this is not quick. Create the `rb:task` issue (step 1, without the quick line in the body) and
  hand it to `/rb-build #<n>`, whose tier C plan waits for the owner. Tell the owner why in one
  sentence. "It's small, do it fast" never overrides the tier.
- Unattended runs (`/rb-cycle`) never use this path.

## 1. Open the batch

- Preconditions: clean tree apart from bookkeeping files, `git fetch origin`, `git checkout
  <default>`, `git pull --ff-only`, run id `quick-<short HEAD sha>-<4 random lowercase letters>`,
  `rb baseline --check` (red outside known-failures: offer `/rb-fix` first and stop).
- An open batch already exists (`rb gh issue-list --label rb:quick --state open`) with no PR, or
  with a PR whose reviews have not started: add the new request to it (issue body and branch).
  Otherwise write the issue body to a temp file: `Mode: quick`, then one checkable criterion per
  request, in the owner's words where possible ("`node src/cli.js f.json --solo-total` prints only
  the month total"). `rb gh issue-create --title "<short summary>" --body-file <f> --label
  rb:task,rb:quick`, then prepend `<!-- rockbuilt:task Q<n> spec=none -->` (n = the new issue
  number) to the same file and `rb gh issue-edit <n> --body-file <f>`.
- `rb claim <n> --run <run id>` (it also starts the task's timing). `git checkout -b
  rb/Q<n>-<slug> origin/<default>`.

## 2. Implement, checking every change

For each request in the batch:

1. Make the change and the test that proves it (a test that fails without the change). Docs-only
   or config-only requests need no test; say so in the criterion.
2. Run the Verification commands (`rb verify-cmds Verification`) and judge each by its **exit
   code**, never by the last line of output. `rb secrets` exits 0. A red command: fix it now.
3. Commit (`git add -A`, `git restore --staged` bookkeeping files, `git commit -m "<type>(<scope>):
   <request> (Q<n>)"`).
4. `rb risk --base origin/<default> --json`. Tier C, or `quick.eligible: false`: stop adding to
   this batch. Tier C: push the branch, escalate per build step 7 (`rb escalate <n> --kind human`
   with the rb risk reasons), tell the owner, and stop. Over the limits: finish the request you are
   on, close the batch now (step 3) and put the remaining requests in a new batch.

Do not refactor beyond the request; extra cleanup becomes a follow-up issue.

## 3. Close the batch: one review, then done

Close when every request in the batch is implemented and checked, before telling the owner that
anything is done. Requests that arrive while the reviews run go to the next batch.

1. `rb baseline --check` on the branch (no failure outside known-failures, counts not lower).
2. Collapse as build step 8 (one commit, message `<type>: <summary> (Q<n>)`; on a branch already
   on origin only local commits squash). Record `git rev-parse HEAD` as the reviewed head.
3. `rb risk --base origin/<default> --json`: tier, `security.required`, `quick.eligible`. Not
   eligible any more: build step 7 (tier C) or split as in step 2.4.
4. Reviews, serially, each once for the whole batch:
   - `rb-verifier`: `Mode: quick`, task id `Q<n>`, `Reviewed head: <sha>`, the issue's criteria as
     the plan (with "Plan written by the orchestrator, who also implemented; there is no planner
     and no implementer report"), `git diff origin/<default>...HEAD --stat`, the default branch,
     the working directory, `Docs language`.
   - `rb-auditor` (tier B), after the verifier passes, per `audit.md`: ONLY the task id, the
     reviewed head, the working directory, the issue's criteria and how to run the app from
     AGENTS.md. Never the diff, your notes or the verifier verdict.
   - `rb-security-reviewer` when `security.required` (the gate enforces it): `Mode: task`, spec
     folder `none`, the issue's criteria, diff range `origin/<default>...HEAD`, the triggers,
     `.claude/skills/rb-verify/references/security.md`, `Reviewed head: <sha>`.
   Re-run `rb claim <n> --run <run id>` before each review. Post every verdict, pass or fail, on
   the issue (`rb gh issue-comment <n> --body-file <its report>`).
5. Any finding: you fix it (one commit on top), run step 2.2 again, and the reviewer that failed
   re-reviews the new head; the others carry when `rb review-delta` says identical or test-only
   (DESIGN 8.3). Budget 2 kickbacks for the batch, then the blocked path as in build.
6. PR: push (`git push -u origin rb/Q<n>-<slug>`), body per `pr-template.md` with `Closes #<n>`,
   the line `<!-- rockbuilt:quick -->`, every status line, `<!-- rockbuilt:tier <A|B> -->` and the
   output of `rb timing line Q<n>`. `rb gh pr-create --head rb/Q<n>-<slug> --base <default> --title
   "<type>: <summary> (Q<n>)" --body-file <f> --label rb:tier-<a|b>`, then `rb gh label-add <n>
   rb:pr-open` and `rb gh label-remove <n> rb:in-progress`.
7. Merge: the merge train as rb-fix does (lock, `merge-train.md`, `rb merge-gate <pr> --run <run
   id>`), unless `Autonomy: supervised` or the owner said not to merge. The gate refuses a quick
   PR whose live diff left the quick limits. CI red because of the batch: the one CI fix in
   `kickback.md` section 6.

## 4. Report

Tell the owner, in two or three sentences: what changed, what the reviewers checked (and any
kickback they caused), the PR, and whether it merged or what it waits for. Say "done" only after
the reviews passed; if the batch is still open or waiting for CI, say exactly that. Then `rb
timing report --write` and a progress.md line under Current state.

## Rules

- No "done" before the batch review passes. A batch never reaches the default branch unreviewed.
- The mechanical checks run on every change; only the agent review waits for the batch.
- Tier C never takes this path; `quick.eligible: false` closes the batch.
- Never merge outside `rb merge-gate`; never push to the default branch or force push.
- No GitHub (`rb gh whoami` fails): id `L<n>` as rb-fix, every review still runs, report the
  skipped GitHub steps.

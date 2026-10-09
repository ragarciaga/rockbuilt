---
name: status
description: >
  Resumes a session. Reads CLAUDE.md and docs/progress.md, checks the baseline and the harness
  doctor, lists open Rockbuilt issues and PRs, then reports what is done, what waits on the
  human, and the single next command. Read-only. Use at the start of any new session, or when
  the user says "where are we", "what's next", "status", "resume", "continue the project",
  "en qué vamos", "qué sigue", "retomemos", "estado del proyecto", "dónde quedamos".
---

# Status

The first command of every session. Read-only: you change no files except an optional
`docs/progress.md` refresh the user approves. Use `rb` (fallback
`node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" <command>`).

**Language.** Report in the user's conversation language; if they have not written yet, use
`Docs language:` from CLAUDE.md. Commands, labels and file names stay in English. Never use the
em dash character; use commas or parentheses. This skill dispatches no agents.

## Step 1: Gather (run independent reads in parallel)

1. `CLAUDE.md`: project name, Docs language, Project type, Default branch. If missing, stop and
   route: empty repo -> `/rockbuilt:kickoff`; existing code -> `/rockbuilt:adopt`.
2. `docs/progress.md`: Current objective, Current state, Next steps.
3. `git status --porcelain`, `git branch --show-current`, `git log -1 --oneline`.
4. Baseline: if `.rockbuilt/baseline.json` does not exist, it is "missing" (do not run
   anything). Otherwise, on the default branch, `rb baseline --check`: exit 0 is green, exit 1
   is red (it re-runs the Verification commands only when the default branch moved since the
   last green record). On another branch, report the recorded result without re-running.
5. `rb doctor` (keep only WARN/FAIL lines).
6. Open work on GitHub:
   - `gh issue list --state open --label rb:blocked --json number,title,url`
   - `gh issue list --state open --label rb:in-progress --json number,title`
   - `gh issue list --state open --label rb:task --json number,title,labels --limit 50`
   - `gh pr list --state open --json number,title,headRefName,isDraft,reviewDecision,statusCheckRollup,url`
7. Specs: list `docs/specs/*/`; for each, read the `Status:` line of requirements.md, design.md
   and tasks.md, and run `rb tasks <spec-dir> --json` when tasks.md exists to count task
   statuses.

If gh fails (not authenticated, offline), say so and continue with local state.

## Step 2: Decide the single next command

Take the first rule that matches:

| Condition | Next |
|---|---|
| No CLAUDE.md | `/rockbuilt:kickoff` or `/rockbuilt:adopt` |
| Uncommitted files on the default branch other than bookkeeping (tasks.md, docs/progress.md, .claude/LESSONS.md) | Ask the user to review and commit them |
| Baseline red on the default branch | Fix the baseline first: the open stabilization issue, or `/rockbuilt:fix` |
| Skeleton issue (`rb:skeleton`) open | `/rockbuilt:build #<n>` |
| Baseline missing after the skeleton merged | `rb baseline` |
| PR open and green, waiting for review | Human: review and merge (or say "merge PR #n" to `/rockbuilt:merge`) |
| `rb:blocked` issues | Human: answer the question in issue #n, remove `rb:blocked` (or say "retry issue n"), then `/rockbuilt:build #n` |
| Spec with requirements or design `draft` | `/rockbuilt:spec <folder>` to finish approval |
| Spec approved, no tasks.md or tasks `draft` | `/rockbuilt:tasks docs/specs/NN-slug/` |
| Tasks `todo` remaining | `/rockbuilt:build docs/specs/NN-slug/` |
| All tasks of a feature done or in review, gates not run | `/rockbuilt:verify docs/specs/NN-slug/` |
| Everything verified | `/rockbuilt:spec <next feature from brief or progress>` |

If docs/progress.md Next steps disagrees with what you observe, trust observed state and say so.

## Step 3: Report

Keep it under 25 lines, in this shape (headings translated to the user's language):

```
<Project> | branch <name> | baseline <green/red/missing> (<sha>)

Done
- <feature/task/PR, short>

In progress
- <issue/PR with state: plan posted, PR open, CI status>

Waiting on you
- <PR #n to review/merge> | <issue #n blocked: question> | <files to commit> | <doctor FAIL you own>

Next
<one command>  (<one-line reason>)
```

Mention doctor WARN/FAIL lines only if they affect the next step. Uncommitted bookkeeping files
are normal between runs: mention them in one line and, if they pile up, suggest the
`docs: progress` PR that `/rockbuilt:build` offers at run end. If progress.md is stale (Current
state contradicts what you saw), offer to refresh it; write only on approval.

## Rules

- Read-only by default. Never run builds, tests beyond `rb baseline --check`, commits or merges.
- Exactly one next command. If two paths are equally valid, pick one and mention the other in a
  single line.

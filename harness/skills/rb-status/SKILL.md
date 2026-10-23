---
name: rb-status
description: >
  Resumes a session. Reads AGENTS.md, docs/progress.md and the Rockbuilt control issue (lock,
  stop switch, last digest), lists open rb:needs-human and rb:needs-local escalations first with
  what the user must answer, PRs waiting for the human, merges since the last digest with their
  revert commands, baseline and protection mode from rb doctor, and the next scheduled run if
  known; then gives the single next action. Also reports the user's hours per feature and task
  (rb hours). Read-only. Use at the start of any session, or when the user says "where are we",
  "what's next", "status", "resume", "continue the project", "what happened last night", "hours
  report", "how much time did I spend", "en qué vamos", "qué sigue", "retomemos", "estado del
  proyecto", "dónde quedamos", "qué pasó anoche", "reporte de horas", "cuánto tiempo le he
  dedicado", "cuántas horas llevo".
---

# Status

The first command of every session. Read-only: you change no files and no GitHub state, except
an optional `docs/progress.md` refresh the user approves and an `rb hours log` entry they ask for. This skill dispatches no agents.

**Language.** **Chat**: report in the language the user writes in; before they write, use `Docs
language:` from AGENTS.md (fallback `CLAUDE.md` for v0.2 projects). Repository text (anything
written to files or GitHub) uses `Docs language`. In Spanish, address the user as tú (never vos;
usted only if the user writes that way). Commands, labels and file names stay in English. Never use
the em dash character; use commas or parentheses.

Commands below are written `rb <cmd>`; run them as `node tools/rockbuilt/rb.mjs <cmd>`. Write every command out in full, one per call or chained with `&&`: no shell variables, aliases or functions standing for `rb`, `git` or `gh` (unattended runs allow only commands that literally match the permission list). All
GitHub reads go through `rb gh <op>` (REST, JSON); never `gh issue`, `gh pr` or `gh label`.

## Step 1: Gather (run independent reads in parallel)

1. **Contract.** `AGENTS.md`: project name, Docs language, Project type, Default branch,
   Autonomy. If missing or still the template (`# <Project name>` or `Project type: <...>`),
   and no v0.2 CLAUDE.md contract, stop and route: empty repo ->
   `/rb-kickoff`; existing code -> `/rb-adopt`. If `tools/rockbuilt/` is missing but a v0.2
   CLAUDE.md exists, the next action is vendoring (`/rockbuilt:install`).
2. **Local state.** `docs/progress.md` (Current objective, Current state, Next steps);
   `git status --porcelain`, `git branch --show-current`, `git log -1 --oneline`.
3. **Doctor.** `rb doctor`: keep WARN/FAIL lines, the protection mode (`github` = branch
   protection enforces CI, `rb-only` = only `rb merge-gate` enforces it), CI presence, harness
   version, and any Actions quota warning.
4. **Baseline.** On the default branch, `rb baseline --check`: exit 0 green (known failures in
   `docs/rockbuilt/known-failures.json` do not count), exit 1 new failures. No baseline recorded
   yet: "missing", do not run anything. On another branch, report the recorded result.
5. **Control issue.** Find it read-only with `rb gh issue-list --label rb:control --state open`
   (do not run `rb control ensure` here: it creates the issue when missing; if there is none,
   say so, since kickoff, adopt or the first cycle creates it). Then `rb gh issue-view <n>`:
   labels (`rb:running` = a run holds the lock; `rb:stop` = stop switch on), and the latest
   digest comment (date, merged PRs with revert commands, PRs waiting, escalations, failures,
   what the next run picks up). `rb lock status` for the lock holder and age (stale after 3 hours). `rb stop status`
   (exit 3 = stopped).
6. **Escalations and work.**
   - `rb gh issue-list --label rb:needs-human --state open`
   - `rb gh issue-list --label rb:needs-local --state open`
   - `rb gh issue-list --label rb:blocked --state open`
   - `rb gh issue-list --label rb:in-progress --state open`
   - `rb gh issue-list --label rb:task --state open` and `--label rb:bug`
   - `rb gh pr-list --state open --head-prefix rb/`; for each: labels (tier), and
     `rb gh checks <head sha>` only for PRs you will mention.
   For each escalation, `rb gh issue-view <n>` and take the latest escalation comment: the
   question, the options, the recommendation, the cost estimate if any, or the local commands.
7. **Merges since the last digest.** `rb gh pr-list --state closed --head-prefix rb/` and keep
   those merged after the last digest's date (each with `rb revert <pr>` as its undo command).
8. **Specs.** List `docs/specs/*/`; read the `Status:` line of requirements.md, design.md and
   tasks.md; `rb tasks <spec-dir> --json` when tasks.md exists to count statuses.
9. **Next scheduled run.** Only if known: a line in docs/progress.md, the last digest ("next
   run ..."), or the user told you. Never guess a schedule; say "unknown" and point to the
   routine page if needed.

If GitHub access fails, say so in one line and continue with local state.

## Step 2: Decide the single next action

Take the first rule that matches:

| Condition | Next |
|---|---|
| No contract | `/rb-kickoff` or `/rb-adopt` |
| Stop switch on | Tell the user it is on and which issue holds `rb:stop`; next run will not start until they remove it |
| `rb:needs-human` open | Answer issue #n (the question shown), then remove `rb:needs-human` or add `rb:approved`; the next run picks it up |
| `rb:needs-local` open | Run the commands in issue #n on their machine and reply with the result |
| Tier C PR waiting (`rb:tier-c`, or any PR under `Autonomy: supervised`) | Review PR #n; merge it, or say "merge PR #n" to `/rb-merge` |
| Baseline has new failures on the default branch | The stabilization issue, or `/rb-fix` |
| Uncommitted non-bookkeeping files on the default branch | Move them to a branch and PR (never push to the default branch) |
| Lock held and fresh | A run is in progress: wait for its digest |
| Spec with requirements or design `draft` | `/rb-spec <folder>` to finish approval |
| Spec PR (`rb/spec-*`) open | Merge it so the cycle can build its tasks |
| Approved spec without tasks.md | `/rb-tasks docs/specs/NN-slug/` |
| Ready tasks or `rb:task`/`rb:bug` issues, no routine | `/rb-cycle` now, or set up the nightly routine (docs/CLOUD.md in the Rockbuilt repo) |
| Ready tasks, routine set | Nothing: the next run takes them (say when, if known) |
| All tasks of a feature done, gates not run | `/rb-verify docs/specs/NN-slug/` |
| Everything verified | `/rb-spec <next feature from brief or progress>` |

If docs/progress.md disagrees with what you observe, trust observed state and say so.

## Step 3: Report

Under 30 lines, in this shape (headings translated to the user's language). Escalations go
first because they are the only thing blocking autonomous work:

```
<Project> | autonomy <auto|supervised> | baseline <green|new failures|missing> (<sha>) | protection <github|rb-only>
Last run: <date from digest, outcome> | lock <free|held by run X, age> | stop <off|ON (#n)> | next run <time|unknown>

Needs you
- #<n> needs-human: <question in one line>. Recommended: <option>. <Cost: estimate, if any>
- #<n> needs-local: <what to run, one line>
- PR #<n> (tier C): <title>, CI <green|red>

Merged since last digest
- PR #<n> <title> (tier <A|B>)  revert: rb revert <n>

In progress / queued
- <tasks queued for the next run, open rb/* PRs and their CI state>

Next
<one action>  (<one-line reason>)
```

Omit empty sections. Mention doctor WARN/FAIL lines only if they affect the next action. A
GitHub Actions quota warning is always worth one line (without Actions, nothing merges). If
progress.md is stale, offer to refresh it; write only on approval.

## Hours report (when asked)

When the user asks for hours, time spent or a cost base, skip Steps 1 and 2 and run
`rb hours` (add `--since <YYYY-MM-DD>` / `--until` when they name a period, `--repos a/b,c/d` when
they name projects; by default it finds every repo with a `Rockbuilt hours` issue). Show the
feature table and the total, then one line on the method (attention time estimated from prompts,
their GitHub comments and manual entries; overlaps between projects split evenly). Offer the
task table and the CSV (`rb hours --csv .rockbuilt/hours.csv`, then paste it in a code block so
they can take it to a spreadsheet). The hourly rate is theirs and never goes into the repo. To add
time that left no mark (a call, a whiteboard session): `rb hours log <minutes> --note "<what>"`
(`--spec docs/specs/NN-slug`, or `--ref <task id or issue number>`, when it belongs to one), only
when they ask. Manual minutes are added in full, never split with other projects.

## Rules

- Read-only (an `rb hours log` the user asks for is the one exception). Never run builds, tests beyond `rb baseline --check`, commits, merges, label changes
  or lock operations. Never answer an escalation on the user's behalf.
- Exactly one next action. If two are equally valid, pick one and mention the other in one line.
- Show revert commands; never run them from this skill.

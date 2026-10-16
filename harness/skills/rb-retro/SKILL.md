---
name: rb-retro
description: >
  Retrospective after a feature, a period of nightly runs, or whenever the harness got in the
  way. Collects evidence from the project (timing, kickbacks, blocked tasks, verifier and auditor
  findings, lessons, the control issue digests and the escalations of the period, reverted
  autonomous merges), sorts each finding into project gotcha, project config, autonomy tuning or
  harness problem, and turns harness problems into evidence-backed issues on the Rockbuilt repo
  (or drafts in docs/harness-feedback/ when it is not reachable). Use when the user says "retro",
  "haz la retro", "qué aprendimos", "esto del harness no sirvió", "el harness se equivocó",
  "reporta esto a rockbuilt", "harness feedback", "revisemos la semana", or after /rb-verify
  closes a feature.
argument-hint: "[spec folder | 'last run' | 'since <date>' | free-text complaint]"
---

# Retro: learn from the runs, feed the harness

You are the orchestrator. This skill changes no code. It reads evidence, proposes, and writes only
after the user approves each item.

**Language.** Everything the user reads (the summary, LESSONS entries, AGENTS.md proposals,
drafts for this project) is in the `Docs language` from AGENTS.md (fallback `CLAUDE.md` for v0.2
projects) or the live conversation language. In Spanish, address the user as tú (never vos;
usted only if the user writes that way). Issues filed on the Rockbuilt repo are written in
English (the harness is maintained in English). Never use the em dash character; use commas or
parentheses.

Commands below are written `rb <cmd>`; run them as `node tools/rockbuilt/rb.mjs <cmd>`. Write every command out in full, one per call or chained with `&&`: no shell variables, aliases or functions standing for `rb`, `git` or `gh` (unattended runs allow only commands that literally match the permission list). All
GitHub operations go through `rb gh <op>` (REST, JSON); never `gh issue`, `gh pr` or `gh label`.

## 1. Scope

From `$ARGUMENTS`: a spec folder (`docs/specs/NN-slug/`), "last run" or "since <date>" (default:
since the last retro line in docs/progress.md), or a complaint in the user's words. A complaint
is evidence too: quote it.

## 2. Collect evidence (read-only)

Project:

- `rb timing report` (time per task and phase; flag phases far above the median).
- `rb quality --since <scope start>` (kickbacks by source, reverts, bugs traced to merged PRs).
  Speed only counts when these hold: a rising escaped-bug or auditor-kickback count is a harness
  finding even when the times look good.
- `rb flaky list` (tests that failed once and passed on re-run; two or more hits is a project
  gotcha worth a task).
- tasks.md decision logs: kickbacks per task and their reasons, tasks that ended blocked and why.
- `.claude/LESSONS.md` entries added in the scope; test-report.md, evals.md and
  security-report.md in the spec folder.
- `rb doctor` (configuration drift, protection mode, Actions quota).
- The harness version: `tools/rockbuilt/VERSION`.

GitHub, for the period:

- **Digests.** The control issue (`rb gh issue-list --label rb:control --state open`, then
  `rb gh issue-view <n>`): every digest comment in the scope (merged PRs, PRs waiting,
  escalations, failures, time per task, runs that stopped early or never released the lock).
- **PRs.** `rb gh pr-list --state all --head-prefix rb/` and `rb gh pr-view <n>` for those in
  scope: verifier, auditor and security findings, kickbacks, CI fixes, tier labels.
- **Escalations.** `rb gh issue-list --label rb:needs-human --state all` and
  `--label rb:needs-local`, plus closed ones in the period (`rb gh issue-view <n>` for the
  question and the human's answer).
- **Reverts.** PRs from `rb/revert-<pr>` branches (opened by `rb revert`), and any revert the
  user made by hand: which autonomous merge was undone, and why.
- Issues labelled `rb:blocked`: the questions that stopped the run.

## 3. Sort every finding into one bucket

| Bucket | Test | Destination |
|---|---|---|
| Project gotcha | True only for this codebase ("tests need TZ=UTC") | `.claude/LESSONS.md`, one dated line written as an instruction |
| Project config | AGENTS.md or settings were wrong or missing (a command, a convention, a permission) | A proposed AGENTS.md or settings diff |
| Autonomy tuning | The tier boundaries cost time or let something through (see below) | A proposed AGENTS.md `## Autonomy` diff (`Tier A paths`, `Sensitive paths`) |
| Harness problem | Would happen in any project: a skill step missing or wrong, an agent that missed something it was told to check, a gate that was skipped, an `rb`, guard or CI bug, a false block, a step that cost far more than its value | An issue on the Rockbuilt repo |
| Worked well | A gate that caught a real defect, a step that saved time | The summary (keeps what must not be removed) |

**Autonomy tuning signals** (from the digests and escalations):

- **Unnecessary escalations, candidates to move to tier B:** `rb:needs-human` issues the user
  answered with a plain "aprobado" without changes, repeatedly, for the same kind of path. Propose
  narrowing a project `Sensitive paths` glob or adding a `Tier A paths` glob. Never propose
  lowering the built-in floor (DESIGN.md section 6.1): if the floor itself looks wrong, that is
  a harness problem with evidence, filed on Rockbuilt.
- **Reverted autonomous merges, candidates to move to tier C:** a tier A or B PR merged by
  `rb merge-gate` and later reverted, or fixed by a follow-up bug within days. Propose adding its
  paths to `Sensitive paths`, and file a harness problem when the verifier or blind auditor
  should have caught it.
- **needs-local that the cloud could have done** (or the reverse): environment notes for
  docs/CLOUD.md setup, or a harness problem.

Harness signals to look for even when nobody complained: a verifier or auditor that passed
something a later step caught, a gate skipped "because" something else failed, the same kickback
reason in 2 or more tasks, a blocked question the spec should have answered, the main session
editing code it should have delegated, a run that hit its limits every night, a task whose verify
phase took longer than its implementation.

## 4. Present, then act on approval

Show one table: finding, bucket, evidence (file, PR, issue or digest date, or quote), proposed
action. Ask once for approval of the whole set (the user may drop rows). Then:

- LESSONS lines: append them yourself (orchestrator-owned file).
- AGENTS.md and settings diffs (config and autonomy tuning): these are tier C files. Commit them
  on `rb/retro-<date>`, push, and open the PR with
  `rb gh pr-create --head rb/retro-<date> --base <default> --title <t> --body-file <f> --label rb:tier-c`.
  The user merges it.
- Harness problems: draft each issue from `templates/harness-issue.md` (this skill's folder).
  **Sanitize**: no client code, no secrets, no personal or customer data, no internal URLs or
  repo names; describe the behavior and cite Rockbuilt files (skill, agent, reference, DESIGN.md
  section) instead. Show the exact drafts. On approval, file them on the Rockbuilt repo:

  ```bash
  rb gh issue-create --repo ragarciaga/rockbuilt --title "<title>" --body-file <tmp> --label harness-feedback
  ```

  This works only when that repo is reachable: locally with an authenticated gh, or in a cloud
  session where the rockbuilt repo is attached. Check with
  `rb gh issue-list --repo ragarciaga/rockbuilt --state open` first. If it is not reachable (or
  the label is rejected, then retry once without `--label`), save the drafts to
  `docs/harness-feedback/<YYYY-MM-DD>.md` and tell the user how to send them (open a local
  session and re-run `/rb-retro` with "file the saved drafts", or paste them on GitHub).

## 5. Close

Append to docs/progress.md: `- <date>: retro on <scope>: <n> lessons, <n> config changes,
<n> autonomy changes, <n> harness issues (#links or drafts)`. Report in the docs language: what
worked, what changed in this project, what was sent to Rockbuilt.

## Hard rules

- Never edit Rockbuilt files from a project session. Harness fixes happen in the Rockbuilt repo.
- Never file an issue without showing the exact text first.
- A finding without evidence is a hypothesis: label it so in the summary and do not file it.
- Never lower a tier on your own: autonomy changes are proposals in a tier C PR the user merges.

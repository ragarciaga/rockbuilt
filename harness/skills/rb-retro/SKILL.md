---
name: rb-retro
description: >
  Retrospective after a feature, a build run, or whenever the harness got in the way. Collects
  evidence from the project (timing, kickbacks, blocked tasks, verifier findings, lessons), sorts
  each finding into project gotcha, project config, or harness problem, and turns harness problems
  into evidence-backed issues on the Rockbuilt repo. Use when the user says "retro", "haz la retro",
  "qué aprendimos", "esto del harness no sirvió", "el harness se equivocó", "reporta esto a
  rockbuilt", "harness feedback", or after /rb-verify closes a feature.
argument-hint: "[spec folder | 'last run' | free-text complaint]"
---

# Retro: learn from the run, feed the harness

You are the orchestrator. This skill changes no code. It reads evidence, proposes, and writes only
after the user approves each item.

**Language.** In Spanish, address the user as tú (never vos; usted only if the user writes that way). Everything the user reads (the summary, LESSONS entries, issue drafts for this
project) is in the `Docs language` from CLAUDE.md or the live conversation language. Issues filed
on the Rockbuilt repo are written in English (the harness is maintained in English). Never use
the em dash character; use commas or parentheses.

`rb` fallback: `node "tools/rockbuilt/rb.mjs" <command>`.

## 1. Scope

From `$ARGUMENTS`: a spec folder (`docs/specs/NN-slug/`), "last run" (since the last retro note
in docs/progress.md), or a complaint in the user's words. A complaint is evidence too: quote it.

## 2. Collect evidence (read-only)

- `rb timing report` (time per task and phase; flag phases far above the median).
- tasks.md decision logs: kickbacks per task and their reasons, tasks that ended blocked and why.
- PR bodies for the scope when gh works (`gh pr list --state all --search "rb/" --json
  number,title,body,mergedAt`): verifier findings, security findings, CI fixes.
- Issues labelled `rb:blocked`: the questions that stopped the run.
- `.claude/LESSONS.md` entries added in the scope.
- test-report.md, evals.md and security-report.md in the spec folder.
- `rb doctor` (configuration drift).
- The plugin version: read `tools/rockbuilt/VERSION`.

## 3. Sort every finding into one bucket

| Bucket | Test | Destination |
|---|---|---|
| Project gotcha | True only for this codebase ("tests need TZ=UTC") | `.claude/LESSONS.md`, one dated line written as an instruction |
| Project config | CLAUDE.md or settings were wrong or missing (a command, a convention, a permission) | A proposed CLAUDE.md or settings diff |
| Harness problem | Would happen in any project: a skill step missing or wrong, an agent that missed something it was told to check, a gate that was skipped, an `rb` or hook bug, a false block, a step that cost far more time than its value | An issue on the Rockbuilt repo |
| Worked well | A gate that caught a real defect, a step that saved time | The summary (keeps what must not be removed) |

Harness signals to look for even when nobody complained: a verifier that passed something a
later step caught, a gate skipped "because" something else failed, the same kickback reason in
2 or more tasks, a blocked question the spec should have answered, the main session editing code
it should have delegated, a task whose verify phase took longer than its implementation.

## 4. Present, then act on approval

Show one table: finding, bucket, evidence (file, PR or quote), proposed action. Ask once for
approval of the whole set (the user may drop rows). Then:

- LESSONS lines: append them yourself (orchestrator-owned file).
- Config diffs: apply after approval.
- Harness problems: draft each issue from
  `.claude/skills/rb-retro/templates/harness-issue.md`. **Sanitize**: no client code, no secrets, no
  personal or customer data, no internal URLs; describe the behavior and cite Rockbuilt files
  (skill, agent, reference) instead. Show the drafts. On approval:
  `gh issue create -R ragarciaga/rockbuilt --label harness-feedback --title "<title>" --body-file <tmp>`.
  If gh is unavailable or the user has no access, save the drafts to
  `docs/harness-feedback/<YYYY-MM-DD>.md` and tell the user to send them.

## 5. Close

Append to docs/progress.md: `- <date>: retro on <scope>: <n> lessons, <n> config changes,
<n> harness issues (#links)`. Report in the docs language: what worked, what changed in this
project, what was sent to Rockbuilt.

## Hard rules

- Never edit Rockbuilt files from a project session. Harness fixes happen in the Rockbuilt repo.
- Never file an issue without showing the exact text first.
- A finding without evidence is a hypothesis: label it so in the summary and do not file it.

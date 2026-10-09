# Changelog

## 0.2.0 (2026-10-09)

Found by the first live evals (real Claude Code sessions, headless):

- Degraded mode: when GitHub is unavailable, `fix` and `build` skip only the GitHub steps and keep
  every agent gate. Before, `fix` skipped the planner and verifier and verified its own change.
  Local bug id `L<n>`.
- `adopt` writes the approved CLAUDE.md before `rb init`; `rb baseline` refuses a CLAUDE.md that
  is still the template (it used to run placeholder commands and record a false red baseline).
- `kickoff` on existing code redirects and waits for the user instead of starting adopt itself.
- Spanish register: tú by default, never vos, usted only if the user writes that way.

Improvement loop:

- `/rockbuilt:retro`: evidence-based retrospective; harness problems become issues on this repo.
- `evals/run.mjs` + `evals/scenarios.json`: headless eval runner with deterministic checks and
  A/B arms (with and without the plugin).
- CI on Windows, macOS and Linux (Node 20 and 22): tests, `rb` smoke, hook exit code, official
  plugin validation.
- Maintainer `.claude/CLAUDE.md`, `docs/MEJORAR.md`, harness-feedback issue template.

## 0.1.0 (2026-10-09)

First version.

- Skills: kickoff, adopt, spec, tasks, build, fix, verify, merge, status.
- Agents: scout, planner, task-reviewer, implementer, verifier, e2e-writer, healer,
  security-reviewer.
- Node guard hook: no push to the default branch, no force push, no git/gh in the implementer and
  e2e-writer, read-only git for reviewers, protected paths for every subagent, no merge from
  subagents.
- `rb` CLI: doctor, init, labels, verify-cmds, baseline, tasks, parallel, worktree, timing.
- Playwright first-class for web projects: config, smoke spec and Playwright MCP (`.mcp.json`,
  node launcher, cross-platform) from `rb init`; E2E in the skeleton, in every UI-touching task's
  mechanical check, and in `rb doctor`.
- Conditional parallel mode with git worktrees and per-phase timing in `docs/progress.md`.
- Project templates: CLAUDE.md, settings.json (merge always asks), LESSONS.md, progress.md, PR
  template.

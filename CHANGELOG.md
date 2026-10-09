# Changelog

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

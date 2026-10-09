# Changelog

## 0.3.0 (2026-10-09)

Autonomy release: the harness plans, builds, audits and merges on its own, and pulls the human in
only for design decisions, anything that costs money, and sensitive or irreversible changes.
Evidence for each decision is in DESIGN.md section 20.

Distribution and contract:

- **Vendored distribution.** The harness lives in `harness/` (skills `rb-*`, agents `rb-*`,
  project templates, web overlay, adapters) and `rb vendor` (alias `init`) copies it into each
  project: `tools/rockbuilt/`, `.claude/skills/rb-*`, `.claude/agents/rb-*`, settings, CI.
  Cloud sessions do not load plugins (evidence 20.4), but they load what the repo carries. The
  plugin now ships one skill, `/rockbuilt:install`, which installs or updates the harness.
  Commands are project skills: `/rb-kickoff`, `/rb-build`, `/rb-cycle`, ...
- **AGENTS.md contract.** AGENTS.md is the canonical project contract read by every tool;
  CLAUDE.md imports it (`@AGENTS.md`). New header fields: `Autonomy`, `Max tasks per run`, and
  an `## Autonomy` section (sensitive paths, tier A paths, approved paid services). `rb` falls
  back to CLAUDE.md for v0.2 projects; `/rb-adopt` migrates them.

Autonomy:

- **Autonomy tiers A, B, C with a mechanical floor.** `rb risk` computes the tier from the real
  diff (dependencies, cost signals, schema, auth and payments, infra and CI, harness files and
  secrets, ADRs, mass deletions, size). The final tier is the higher of `rb risk` and the
  planner's declaration; a model can raise a tier, never lower it.
- **`rb merge-gate`, the only merge path.** Merges only when labels, live `rb risk`, verifier and
  auditor lines on the current head SHA, every check run green with `rockbuilt-ci` present, the
  stop switch off and the merge train lock all hold. No merge outside it, ever. `rb revert`
  opens a revert PR; the merge comment carries the command.
- **Serial merge train.** After each merge the next PR is updated with the base, its checks
  re-run and its gate re-evaluated.
- **Control issue.** `Rockbuilt control` (label `rb:control`) holds the run lock (`rb lock`,
  3 hour staleness), receives one digest comment per run (`rb digest post`), and honors the stop
  switch: any open issue labelled `rb:stop` halts the run before the next task and before every
  merge. Escalations (`rb escalate`) label `rb:needs-human` or `rb:needs-local` and never wait.
- **`/rb-cycle` for cloud routines.** One bounded pass: lock, sync, baseline ratchet, answered
  escalations, queue, build loop, merge train, digest, unlock. The nightly routine prompt is
  `Run /rb-cycle.`
- **Blind auditor (`rb-auditor`).** Judges tier B and C tasks by observed behavior against the
  acceptance criteria, without the plan, the implementer report or the verifier verdict.

Mechanics:

- **REST-only GitHub layer.** `rb gh <op>` wraps `gh api` for issues, labels, comments, PRs and
  checks. Cloud sessions block GitHub GraphQL (evidence 20.2), so skills never call `gh issue`,
  `gh pr` or `gh label`.
- **Baseline ratchet.** `rb baseline` compares Verification against
  `docs/rockbuilt/known-failures.json`; known failures do not block, new ones do, and the list
  only shrinks automatically. Worktrees read the main checkout's baseline (evidence 20.6).
- **`rb sync`.** Marks tasks done from merged PRs, deletes merged `rb/*` branches and repairs
  stale labels, so dependencies no longer wait for a manual merge step (evidence 20.6).
- **Strict tasks parser.** Unknown keys or statuses are errors; Spanish synonyms (Estado, Cubre,
  Tamaño, Depende de, Archivos, Verificar; hecho, pendiente, en progreso, en revisión, bloqueado)
  are accepted (evidence 20.6).

Safety:

- **Guard rewrite.** Read-only roles get an allowlist instead of a denylist; write roles are
  denied `git` and `gh` anywhere in a command (closes `node -e`, `npm exec -c`, `cmd /c`,
  `pwsh -c`, `bash -c` bypasses); `.env*` reads are denied for everyone; protected paths are
  resolved through symlinks; payloads from Cursor and Codex are normalized; the hook matcher now
  includes `Read` (evidence 20.6).
- **Tightened permissions.** Narrow allow rules (no blanket `npm *`), denies for `.env*` reads,
  force pushes, `reset --hard`, `git clean`, `rm -rf` variants, `git checkout -- .`,
  `git restore .`.
- **`rockbuilt-ci` template** in every project: Verification, E2E when possible, secret scan with
  gitleaks, harness-file change detection, and the check the merge gate requires. `rb protect`
  makes GitHub enforce it where the plan allows branch protection (evidence 20.3).

Tools and docs:

- **Cursor adapter** (`--tools cursor`): `.cursor/hooks.json` (fail closed), `.cursor/mcp.json`,
  `.cursor/cli.json`; Cursor reads `.claude/skills` and `.claude/agents` directly.
- **Codex adapter, experimental and untested** (`--tools codex`): `.agents/skills`,
  `.codex/hooks.json`, agents generated as TOML.
- **docs/CLOUD.md**: step by step setup of the nightly routine, reading the digest, the stop
  switch, reverting a merge, branch protection and costs.
- Evals vendor the harness into each workspace instead of loading the plugin, and two scenarios
  were added (`cycle-no-github`, `build-tier-c-escalates`).

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

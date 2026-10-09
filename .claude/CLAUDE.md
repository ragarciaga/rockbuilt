# Rockbuilt (maintainer guide)

This repo is the Rockbuilt Claude Code plugin itself. You are changing the harness, not a project
built with it. Read DESIGN.md before any change: it is the contract every skill, agent, hook and
script follows. When a file and DESIGN.md disagree, DESIGN.md wins and the file is the bug.

Docs language: es (talk to the maintainer in Spanish, tú, never vos). Plugin files are written in
English; human-facing guides (docs/GUIA.md, docs/MEJORAR.md) in Spanish. Never use the em dash
character anywhere; the selfcheck test fails on it.

## How a change is made

1. **Start from evidence.** A harness-feedback issue (from `/rockbuilt:retro`), a failing eval,
   or a CI failure. No evidence, no change: write the eval first.
2. **Reproduce it as an eval.** Add or tighten a scenario in `evals/scenarios.json` (and its prose
   in `evals/<skill>.md`) whose checks fail today. Run only that scenario:
   `node evals/run.mjs <id> --arms with`.
3. **Branch.** `git checkout -b fix/<short-slug>` (or `feat/`). Never commit to main.
4. **Change the smallest thing.** Usually one SKILL.md section, one agent rule, or one `rb`
   function. If the change alters behavior, update DESIGN.md in the same branch (add to the
   numbered sections at the end, with the evidence).
5. **Verify.**
   - `npm test` (guard hook, rb CLI, selfcheck). Must be green.
   - `claude plugin validate . --strict`.
   - `node evals/run.mjs <id>` until the new checks pass, then the whole suite
     `node evals/run.mjs --arms with` to catch regressions. A scenario that passed before and
     fails now blocks the change.
   - Load the plugin by hand when needed: `claude --plugin-dir .` from a test project.
6. **Version.** Bump `version` in `.claude-plugin/plugin.json` (semver: patch for fixes, minor for
   new skills or behavior, major when a project-side file format changes) and add a CHANGELOG
   entry. Users only receive updates when the version changes.
7. **PR** with the evidence, the eval result table (from `evals/results/<run>/summary.md`), and
   the cost of the eval run. The maintainer merges; then create the GitHub release `v<version>`.

## Rules

- Keep SKILL.md files under about 250 lines; detail goes to `references/`.
- Every skill states the language rule; every agent ends with its `rockbuilt:status` line (the
  selfcheck enforces both).
- New `rb` subcommands need tests in `tests/rb.test.mjs`; guard changes need cases in
  `tests/guard.test.mjs` (add the bypass you are closing).
- Cross-platform: Node only, no bash-only scripts, paths through `node:path`. CI runs Windows,
  macOS and Linux.
- Do not grow the harness to cover a one-off. Prefer removing a step that never catches anything
  (check `/rockbuilt:retro` evidence) over adding a new one.

## Commands

```bash
npm test
claude plugin validate . --strict
node evals/run.mjs --help
```

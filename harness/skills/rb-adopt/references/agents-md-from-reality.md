# AGENTS.md from reality (adopt Step 2)

The contract is DESIGN.md section 5. AGENTS.md is the canonical project contract that every tool
reads (Claude Code through `CLAUDE.md` -> `@AGENTS.md`, Cursor and Codex directly). `rb` parses
the first fenced block under `## Verification`, `## E2E`, `## Evals` and `## Setup`, one command
per non-empty, non-comment line, and the header lines and `## Autonomy` fields. Keep the file
under 200 lines; detail goes to docs/.

## Header lines (exact)

```
Docs language: <es|en|...>          # the user's conversation language
Project type: <web, ai, automation> # UI present -> web; LLM/ML calls -> ai; jobs/scripts without UI -> automation
Default branch: <from git symbolic-ref --short refs/remotes/origin/HEAD, without "origin/">
Autonomy: auto                       # or supervised (every PR waits for the human)
Parallel: auto                       # "off" if the repo has heavy shared state (single migration folder churn, monolithic config)
Max parallel: 3
Max tasks per run: 6
```

## Where each section comes from

| Section | Source of truth, in priority order |
|---|---|
| Goal | README, product docs, the user. Ask the user for the business goal if the repo does not say it |
| Stack | Manifests and lockfiles (exact resolved versions), with doc links |
| Conventions | Patterns the scout observed consistently AND that a fresh reader would violate. Not linter rules |
| Verification | CI workflow steps first, then package scripts. Commands must run from the repo root |
| E2E | Existing Playwright/Cypress script. Omit the section if none and project type is not web |
| Evals | Existing eval script. Omit if none and project type is not ai |
| Setup | Lockfile-matching install (`npm ci`, `pnpm install --frozen-lockfile`, ...) plus required codegen |
| Autonomy | `Sensitive paths`: legacy or risky areas the map found (billing, auth helpers outside the floor globs, data import scripts). `Tier A paths`: only on the user's request. `Paid services`: only what the user explicitly approved, each with a monthly cap; otherwise `none` |
| Out of scope | Ask the user; point to docs/v2.md |

If a Verification command does not exist yet (no lint, no typecheck), do not invent one. List
only real commands and note the gap in current-state.md; adding them can be part of the
stabilization issue.

Commands that call paid services (a test suite that hits a live LLM, an eval run against a paid
API) do not go into `## Verification`: the cycle runs Verification unattended, and paid calls are
tier C (DESIGN.md section 14). Put them under `## Evals` and note that they need a budget in
`Paid services`; suggest a mocked variant for Verification.

## Existing CLAUDE.md

Many repos already have a CLAUDE.md. Do not lose it:

1. Move every project rule into AGENTS.md under the matching contract section (Conventions,
   Verification, Setup...). Keep the user's wording.
2. Propose CLAUDE.md reduced to:
   ```markdown
   @AGENTS.md

   <Claude-only notes, if any: MCP servers, Claude-specific permissions, slash commands>
   ```
3. Show both diffs together. Write only after approval.

## Patching an existing AGENTS.md

1. Keep every user-written rule. Never delete without approval.
2. Add the header lines at the top under the title.
3. Add missing contract sections with exact headings. If equivalent content lives under another
   heading (for example "Testing"), propose moving it under the contract heading.
4. Trim proposals: list sections that restate what is discoverable in ten seconds (directory
   tours, framework defaults, linter-enforced style), with the proposed action (drop, compress,
   or move a recurring trap to `.claude/LESSONS.md`). The user decides.
5. Show the full diff. Write only after approval.

## Leanness test

For each line ask: would a fresh-context implementer act differently without it? If not, cut it.
Verification commands are never trimmed: they are the contract.

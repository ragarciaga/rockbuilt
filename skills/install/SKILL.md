---
name: install
description: >
  Installs or updates the Rockbuilt harness inside the current project repo by vendoring it
  (tools/rockbuilt/, .claude/skills/rb-*, .claude/agents/rb-*, AGENTS.md, CLAUDE.md, settings,
  rockbuilt-ci, and the Cursor or Codex adapters), so local sessions, cloud routines, Cursor and
  Codex all find the same harness in the clone. Asks project type, docs language and extra tools
  in one batched question on a first install; on an update it just re-vendors. Then shows what
  changed, commits on a branch and opens the PR when the user agrees, and points to /rb-kickoff
  or /rb-adopt. Use when the user says "install rockbuilt", "install rockbuilt in this repo",
  "update rockbuilt", "upgrade the harness", "instala rockbuilt", "actualiza rockbuilt",
  "pon rockbuilt en este repo", "trae la última versión del harness".
argument-hint: "[update]"
---

# Install or update Rockbuilt in this repo

The plugin is only the installer. The harness itself is **vendored** into the project (DESIGN.md
section 3): cloud sessions do not load plugins, but they do load whatever is committed in the
repo. After this skill, every Rockbuilt command is a project skill (`/rb-kickoff`, `/rb-adopt`,
`/rb-cycle`, ...) and `rb` runs as `node tools/rockbuilt/rb.mjs <cmd>`.

**Language.** **Repository text** (the commit message body, the PR body) uses the `Docs language`
from AGENTS.md (fallback CLAUDE.md) when it exists, otherwise the language of the current request.
**Chat** with the user (questions, the summary) uses the language the user writes in. In Spanish,
address the user as tú (never vos; usted only if the user writes that way). Never use the em dash
character; use commas or parentheses. Commands, file names, labels and commit types stay in English.

**Invoking rb.** Before the harness is vendored, run the plugin copy:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" <cmd>`. If `CLAUDE_PLUGIN_ROOT` is empty (a cloud
session with the rockbuilt repo attached next to the project), use
`node ../rockbuilt/scripts/rb.mjs <cmd>` and pass `--from ../rockbuilt` to vendor. After
vendoring, use `node tools/rockbuilt/rb.mjs <cmd>`. Never rely on PATH. GitHub only through
`rb gh <op>` (REST); never `gh issue`, `gh pr` or `gh label`, which use GraphQL and fail in cloud.

## 1. Inspect (read-only, no questions yet)

Run and keep the results:

```bash
git rev-parse --show-toplevel          # must be inside a git repo
git status --porcelain                 # must be empty before vendoring
git rev-parse --verify HEAD            # does the repo have a first commit?
git remote get-url origin              # is there a GitHub remote?
```

Then read, without writing: `tools/rockbuilt/VERSION` (installed version, if any), `AGENTS.md`,
`CLAUDE.md`, `.cursor/hooks.json`, `.codex/hooks.json`, `package.json`, and list the top-level
files. Decide the mode:

| Found | Mode |
|---|---|
| No `AGENTS.md` and no `tools/rockbuilt/VERSION` | **First install** (section 2) |
| `AGENTS.md` or `tools/rockbuilt/VERSION` exists | **Update** (section 3) |
| `CLAUDE.md` with a real `## Verification` block but no `AGENTS.md` (a v0.2 project) | **Update**; vendor will report `PENDING` and `/rb-adopt` migrates the contract (section 5) |

Stop and tell the user, without changing anything, when:

- Not a git repo: offer `git init -b main` and wait for a yes.
- The working tree is dirty: list the changed files and ask the user to commit or stash them
  first. Never stash, reset or discard on their behalf. Vendoring on top of their changes would
  mix their work into the harness PR.

## 2. First install: one batched question

Ask once, in a single message (with AskUserQuestion when available, up to three questions), each
with the recommended option first and a one-line reason. Infer the recommendation from what you
read, and accept "lo que recomiendes" as an answer.

1. **Project type** (multi-select): `web` (a user interface in the browser: adds Playwright E2E
   and the Playwright MCP), `ai` (calls a model: adds evals), `automation` (scripts, workflows,
   integrations, no UI). Recommend from evidence: a framework such as next, react, vue, svelte or
   astro in package.json means web; an LLM SDK means ai.
2. **Docs language** for specs, issues, PRs and digests: recommend the language the user is
   writing in (`es` for Spanish).
3. **Extra tools** besides Claude Code: none (recommended unless `.cursor/` exists), `cursor`
   (adds `.cursor/hooks.json`, `.cursor/mcp.json`, `.cursor/cli.json`), `codex` (experimental and
   untested: adds `.agents/skills`, `.codex/hooks.json` and generated agents).

In a folder with no application code yet (only a README, notes or nothing), skip question 1:
`/rb-kickoff` decides the type in its interview and re-runs vendor with `--type`.

Then vendor (omit `--type` when question 1 was skipped):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" vendor --type <web,ai,automation subset> --lang <lang> --tools claude[,cursor][,codex]
```

## 3. Update: no questions

Re-run vendor with the tools already present (`cursor` when `.cursor/hooks.json` exists, `codex`
when `.codex/hooks.json` exists). Type and language come from AGENTS.md, so do not pass them:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" vendor --tools claude[,cursor][,codex]
```

If the user asked to add a tool ("agrega cursor"), add it to `--tools`. If every harness file is
`unchanged`, say the project already has this version (`tools/rockbuilt/VERSION`) and stop.

## 4. Show what changed

Vendor never overwrites project-owned files (AGENTS.md, CLAUDE.md, LESSONS.md, docs), always
overwrites harness-owned ones (tools/rockbuilt, rb-* skills and agents, rockbuilt-ci, adapter
manifests) and merges `.claude/settings.json` and `.mcp.json`. Summarize its output and
`git status --short` for the user, grouped, not file by file:

- Version: before and after (`tools/rockbuilt/VERSION`).
- Created, updated (count per folder: `tools/rockbuilt`, `.claude/skills`, `.claude/agents`),
  merged JSON files, skipped project files.
- Every `WARN`, `PENDING` and `MISSING` line, verbatim, with what to do about it.
- `next:` lines (for web: `npm install -D -E @playwright/test @playwright/mcp` and
  `npx playwright install chromium`). Adding dependencies is tier C: do not run them here; the
  skeleton issue or the user does.

## 5. Commit on a branch and open the PR

Never commit to the default branch; the guard blocks pushing it anyway. Ask one question: "¿Lo
subo en una rama y abro el PR?" (in the docs language). On yes:

1. **No first commit yet** (a brand new folder): do not commit. The harness stays uncommitted and
   `/rb-kickoff` makes the repo, the first commit and the walking skeleton. Go to section 6.
2. Otherwise:

```bash
git switch -c chore/rockbuilt-<version>
git add -A
git commit -m "chore: install Rockbuilt <version>"      # or "chore: update Rockbuilt to <version>"
```

3. With an `origin` on GitHub and `node tools/rockbuilt/rb.mjs gh whoami` working:

```bash
git push -u origin chore/rockbuilt-<version>
node tools/rockbuilt/rb.mjs labels
node tools/rockbuilt/rb.mjs gh pr-create --head chore/rockbuilt-<version> --base <default branch> --title "chore: Rockbuilt <version>" --body-file <tmp body> --label rb:tier-c
```

The PR body (docs language): what the harness is, the summary from section 4, and that harness
files are tier C, so the human merges this PR (on GitHub, or by asking `/rb-merge <n>` in a new
session). Give the user the PR URL.

4. Without GitHub (no remote, `gh` not authenticated): leave the commit on the branch and give
   the user the exact push command. Never stop on this.

On no: leave the files uncommitted and tell the user they must be committed and merged before a
cloud routine can see them.

## 6. Next step

Tell the user, in two or three short lines:

- Start a new Claude Code session (or restart this one) so the vendored skills, agents and the
  guard hook load. For web projects, approve the `playwright` MCP server and check `/mcp`.
- Empty or new project: `/rb-kickoff`. Existing code: `/rb-adopt` (it maps the repo, writes
  AGENTS.md from reality and records the baseline). Until then a newly created AGENTS.md is the
  template: say so, and that no build or cycle should run before adopt or kickoff fills it. A v0.2 project with `PENDING`: `/rb-adopt`
  migrates the CLAUDE.md contract into AGENTS.md.
- Unattended nightly runs: once the PR is merged, follow `docs/CLOUD.md` in the Rockbuilt repo
  (https://github.com/ragarciaga/rockbuilt/blob/main/docs/CLOUD.md) to create the routine with
  the prompt `Run /rb-cycle. [rockbuilt:unattended]`

## Rules

- Never edit vendored files by hand to "fix" something; report it as a harness problem
  (`/rb-retro`).
- Never run `npm install`, create services or change plans here: anything that may cost money or
  add dependencies is tier C and belongs to the user.
- Never merge the harness PR yourself.

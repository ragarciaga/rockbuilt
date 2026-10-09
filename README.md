# Rockbuilt

A Claude Code plugin that takes a project from idea to merged, verified code: brainstorm, spec,
tasks, GitHub issues, implementation, tests, E2E, evals and security review. It works for new
projects and for repos already in progress, on Windows, macOS and Linux.

> "Everyone who hears these words of mine and does them will be like a wise man who built his
> house on the rock." (Matthew 7:24)

## Why

AI coding agents fail in predictable ways: ambiguous requirements, implicit conventions, missing
verification, lost state between sessions, and grading their own work. Rockbuilt is a harness
that closes each gap with a concrete mechanism:

| Failure | Mechanism |
|---|---|
| Ambiguous requirements | Brainstorm with go/no-go, then requirements in EARS with numbered criteria |
| Implicit conventions | A lean `CLAUDE.md` contract written from the real code |
| No verification | Every task carries a binary check; nothing ships without it |
| Self-grading | Separate implementer and fresh-context verifier with mutation probes |
| Lost state | `docs/progress.md`, decision logs, ADRs and `.claude/LESSONS.md` in the repo |
| Unsafe autonomy | Node hooks that block pushes to main, force pushes and git in the wrong agent |

## The flow

| Step | Command | Output | Human gate |
|---|---|---|---|
| Idea | `/rockbuilt:kickoff` | Brief, go/no-go, project type, workflow vs agent, ADRs, repo, walking skeleton issue | Approve the brief |
| Existing repo | `/rockbuilt:adopt` | Current-state map, CLAUDE.md from reality, baseline or stabilization issue | Confirm the route |
| Spec | `/rockbuilt:spec` | `requirements.md` (EARS), `design.md`, ADRs | Approve requirements, then design |
| Tasks | `/rockbuilt:tasks` | Converged `tasks.md` with coverage matrix, GitHub issues | Approve the backlog |
| Build | `/rockbuilt:build` | Plan, implement, check, verify, PR per issue; optional parallel worktrees; timing | Review each PR |
| Bug | `/rockbuilt:fix` | Failing test first, minimal fix, verified PR | Review the PR |
| Gates | `/rockbuilt:verify` | E2E (1 happy path + 2 failures per flow), evals, security report | Read the report |
| Merge | `/rockbuilt:merge` | Merge and cleanup, only when you ask | You ask for it |
| Resume | `/rockbuilt:status` | What is done, what waits on you, the next command | |

Rigor scales with the change: a new feature gets the full spec, a bug goes straight to `fix`, a
small bounded change is one issue built directly.

## Agents

| Agent | Model | Role |
|---|---|---|
| scout | Sonnet | Read-only map of an existing repo |
| planner | Opus | Implementation plan with Verified facts and BLOCKING/ADVISORY questions |
| task-reviewer | Sonnet | Judges one task: size, alignment, completeness, necessity |
| implementer | Sonnet | Executes an approved plan; no git, no gh |
| verifier | Opus | Fresh-context review against acceptance criteria, mutation probe, mechanical verdict |
| e2e-writer | Sonnet | Explores the live app, writes Playwright specs that run without a model |
| healer | Sonnet | Runs E2E and classifies each failure as test, app or environment fault |
| security-reviewer | Opus | OWASP-oriented review, authorization on every data path |

## Install

Requirements on every machine: Node.js 20+, git, and the GitHub CLI (`gh auth login`). Web
projects also install Playwright and its browser (`npx playwright install chromium`); the first
issue does it for you.
On Windows, install Git for Windows so Claude Code uses Git Bash.

```
/plugin marketplace add ragarciaga/rockbuilt
/plugin install rockbuilt@rockbuilt
```

Then in a new project run `/rockbuilt:kickoff`, or in an existing repo `/rockbuilt:adopt`. Both
install the project files (`CLAUDE.md`, `.claude/settings.json`, `docs/progress.md`) for you.
Plugins cannot ship permission rules, so `.claude/settings.json` lives in each project: it
pre-approves safe commands, denies destructive ones, and makes `gh pr merge` always ask.

Recommended: enable branch protection on the default branch. The hooks are a tripwire; branch
protection and your PR review are the real backstop.

## The rb CLI

Deterministic steps live in a small Node CLI, `rb`, available to Claude while the plugin is on:
`rb doctor`, `rb init`, `rb labels`, `rb baseline`, `rb tasks`, `rb parallel`, `rb worktree`,
`rb timing`, `rb verify-cmds`. Run `rb help` for flags. Every command accepts `--json`.

## Playwright

Web projects get Playwright from the first issue: `rb init` lays down `playwright.config.ts`, a
smoke spec and the Playwright MCP server in `.mcp.json` (launched with `node`, so it works on
Windows, macOS and Linux). Every UI-touching task runs the E2E suite before its PR opens, and
`/rockbuilt:verify` writes the feature's E2E specs by exploring the live app through the MCP.

## Parallel mode

When several approved tasks touch disjoint files and none touches shared ground (schema,
migrations, dependency manifests, config), `build` runs them in separate git worktrees at the
same time (default max 3). It announces the batch in one line. Set `Parallel: off` in
`CLAUDE.md` or say "one by one" to disable it.

## Documentation

- [DESIGN.md](DESIGN.md): the contract every skill, agent and script follows.
- [docs/GUIA.md](docs/GUIA.md): user guide in Spanish.
- [docs/roadmap.md](docs/roadmap.md): what is deliberately out of v0.1 and when to add it.
- [evals/](evals/): A/B evals for every skill.

## Development

```
npm test
```

Runs the guard hook tests, the `rb` CLI tests and a selfcheck of the plugin itself (frontmatter,
markers, labels, known `rb` subcommands, no em dashes).

## Credits

Methodology from the Lab10 course on building with AI (harness engineering, spec-driven
development, loops, evals). The planner, implementer and verifier mechanics are adapted from
[trail-blazer-flow](https://github.com/msummer/trail-blazer-flow) by Mark Summer (MIT).

## License

MIT

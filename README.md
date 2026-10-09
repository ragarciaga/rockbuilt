# Rockbuilt

A development harness that takes a project from idea to merged, verified code: brainstorm, spec,
tasks, GitHub issues, implementation, independent review, blind audit, E2E, evals, security
review and merge. It runs on its own (locally or every night in a Claude Code cloud routine) and
pulls you in only for design decisions, anything that costs money, and sensitive or irreversible
changes. It works for new projects and for repos already in progress, on Windows, macOS and
Linux, in Claude Code, Cursor and (experimental) Codex.

> "Everyone who hears these words of mine and does them will be like a wise man who built his
> house on the rock." (Matthew 7:24)

## Why

AI coding agents fail in predictable ways: ambiguous requirements, implicit conventions, missing
verification, lost state between sessions, grading their own work, and doing risky things when
nobody is watching. Rockbuilt closes each gap with a concrete mechanism:

| Failure | Mechanism |
|---|---|
| Ambiguous requirements | Brainstorm with go/no-go, then requirements in EARS with numbered criteria |
| Implicit conventions | A lean `AGENTS.md` contract written from the real code, read by every tool |
| No verification | Every task carries a binary check; nothing ships without it |
| Self-grading | Separate implementer, fresh-context verifier with mutation probes, and a blind auditor that never sees the plan |
| Lost state | Specs, decision logs, ADRs and LESSONS in the repo; run state in GitHub issues and labels |
| Unsafe autonomy | Risk tiers computed by code, a merge gate in code, a stop switch, a guard hook, tight permissions and CI with a secret scan |

## How it is distributed

Cloud sessions do not load plugins, so the harness is **vendored** into each project repo, where
every local session, cloud routine, Cursor and Codex finds it. The Claude Code plugin is only the
installer and updater.

```
/plugin marketplace add ragarciaga/rockbuilt
/plugin install rockbuilt@rockbuilt
/rockbuilt:install          # in the project repo: asks type, docs language, extra tools
```

`/rockbuilt:install` runs `rb vendor`, shows what changed, commits on a branch and opens the PR
(harness files are tier C, so you merge it). Run it again to update. A project then has:

| Path | What |
|---|---|
| `AGENTS.md` | The project contract (goal, stack, conventions, Verification, Setup, Autonomy) |
| `CLAUDE.md` | `@AGENTS.md` plus Claude-only notes |
| `tools/rockbuilt/` | The `rb` CLI and the guard hook, with a `VERSION` file |
| `.claude/skills/rb-*`, `.claude/agents/rb-*` | Skills and agents (Claude Code and Cursor read this path) |
| `.claude/settings.json` | Permissions and the guard hook |
| `.github/workflows/rockbuilt-ci.yml` | Verification, E2E when possible, gitleaks secret scan, harness-change check |
| `.cursor/*` (with `--tools cursor`), `.agents/skills`, `.codex/*` (with `--tools codex`) | Tool adapters |

Requirements on every machine: Node.js 20+, git, and the GitHub CLI (`gh auth login`) for local
work. On Windows, install Git for Windows so Claude Code uses Git Bash.

## The flow

| Step | Command | Output | Human gate |
|---|---|---|---|
| Install or update | `/rockbuilt:install` | Vendored harness, PR | Merge the PR |
| Idea | `/rb-kickoff` | Brief, go/no-go, project type, ADRs, repo, control issue, walking skeleton issue | Approve the brief |
| Existing repo | `/rb-adopt` | Current-state map, AGENTS.md from reality, baseline ratchet or stabilization issue | Approve AGENTS.md |
| Spec | `/rb-spec` | `requirements.md` (EARS), `design.md`, ADRs | Approve requirements, then design |
| Tasks | `/rb-tasks` | Converged `tasks.md`, coverage matrix, one issue per task | None (the spec approval covers it) |
| Build | `/rb-build` | Plan with tier, implement, check, verify, audit, PR; merge train for tier A and B | Tier C only |
| Cycle | `/rb-cycle` | One unattended pass over the backlog, merge train, digest | Escalations only |
| Bug | `/rb-fix` | Failing test first, minimal fix, reviewed PR | Tier C only |
| Gates | `/rb-verify` | E2E (1 happy path + 2 failures per flow), evals, security report | Read the report |
| Merge | `/rb-merge` | Merges tier C PRs or any PR you name, through the gate; reverts on request | You ask for it |
| Resume | `/rb-status` | Done, waiting on you, the next command | |
| Learn | `/rb-retro` | Lessons for the project, issues for the harness | Approve each item |

## Autonomy tiers

`rb risk` computes the tier from the real diff; the planner declares one too, and the higher wins.
A model can raise a tier, never lower it.

| Tier | What | Plan | Reviews | Merge |
|---|---|---|---|---|
| A | Tests, docs, styles, copy | Automatic | Verifier | Automatic, through `rb merge-gate` |
| B | Production code from an approved spec or an `rb:task` / `rb:bug` issue | Automatic | Verifier, blind auditor, security reviewer when flagged | Automatic, through `rb merge-gate` |
| C | Architecture or design decisions, dependencies, cost, data and schema, auth, permissions, payments, infra and CI, harness files, secrets, large deletions | **You approve** (`rb:needs-human`) | Same as B | **You merge** |

The tier C floor cannot be configured away; `AGENTS.md` can only add sensitive paths. Anything
that can cost money (paid APIs, new services, infrastructure, plan upgrades, paid model calls in
tests) always asks first, with an estimate. `Autonomy: supervised` in AGENTS.md makes every PR
wait for you.

## The cycle and the control issue

`/rb-cycle` is one bounded pass: control issue, stop switch, lock, `rb sync`, baseline ratchet,
answered escalations, queue, build loop, serial merge train, digest, unlock. It never waits for a
human; every decision becomes an escalation and the run moves on. The nightly routine's prompt is
`Run /rb-cycle.` (setup: [docs/CLOUD.md](docs/CLOUD.md), in Spanish).

All run state lives in GitHub so it survives a fresh cloud clone:

- **Control issue** `Rockbuilt control` (label `rb:control`): holds the lock (`rb:running`, stale
  after 3 hours) and one digest comment per run (merged PRs with their revert command, PRs
  waiting for you, escalations, failures, time per task, what runs next).
- **Escalations:** `rb:needs-human` (a decision) or `rb:needs-local` (needs your machine). Answer
  with a comment and remove the label, or add `rb:approved`.
- **Stop switch:** label any open issue `rb:stop` (works from the phone). Runs stop before the next
  task and before every merge.
- **Undo:** every merge comment carries `node tools/rockbuilt/rb.mjs revert <pr>`, which opens a
  revert PR (`/rb-merge revert PR 12` does the same).

## The merge gate

`rb merge-gate <pr>` is the only merge path. It merges only when the PR is open and mergeable on
the default branch, carries `rb:tier-a` or `rb:tier-b` and no blocking label, `rb risk` on the
live diff is not higher than the label, the verifier (and for tier B the auditor) lines name the
current head SHA, every check is green with `rockbuilt-ci` among them, the stop switch is off, and
the run holds the lock. Merges are serial: after each one the next PR is updated and re-checked.

On a free private GitHub repo branch protection is not available, so the gate is enforced by
`rb` alone; with a public repo or GitHub Pro (USD 4/month, your decision), `rb protect` makes
GitHub require `rockbuilt-ci` too. `rb doctor` shows which mode applies.

## Agents

| Agent | Model | Role |
|---|---|---|
| rb-scout | Sonnet | Read-only map of an existing repo or the code relevant to a spec |
| rb-planner | Opus | Plan per task with Verified facts, Risk and cost (tier), open questions |
| rb-task-reviewer | Sonnet | Judges one task: size, alignment, completeness, necessity |
| rb-implementer | Sonnet | Executes an approved plan; no git, no gh, no secrets |
| rb-verifier | Opus | Plan conformance, criteria by ID, test quality with a mutation probe |
| rb-auditor | Opus | Blind audit: each acceptance criterion against observed behavior, without the plan or reports |
| rb-security-reviewer | Opus | OWASP-oriented review, authorization on every data path, cost triggers |
| rb-e2e-writer | Sonnet | Explores the live app, writes Playwright specs that run without a model |
| rb-healer | Sonnet | Runs E2E and classifies each failure as test, app or environment fault |

## Safety

From strongest to weakest: GitHub side (`rockbuilt-ci` with gitleaks, branch protection when
available, `rb merge-gate` as the only merge path); permissions in `.claude/settings.json` and
`.cursor/cli.json` (narrow allow rules, denies for `.env*` reads, force pushes, `reset --hard`,
`git clean`, `rm -rf`); the guard hook (no push to the default branch, no `.env` reads, no git or
gh in any form for write roles, an allowlist for read-only roles, protected harness paths resolved
through symlinks, payloads from Claude Code, Cursor and Codex); agent instructions. The guard is a
tripwire, not a sandbox.

All GitHub calls go through `rb gh <op>` (REST via `gh api`), because cloud sessions block GitHub
GraphQL.

## Other tools

- **Cursor:** `--tools cursor` adds `.cursor/hooks.json` (the same guard, fail closed),
  `.cursor/mcp.json` and `.cursor/cli.json`. Cursor reads `AGENTS.md`, `.claude/skills` and
  `.claude/agents` directly.
- **Codex (experimental, untested):** `--tools codex` adds `.agents/skills`, `.codex/hooks.json`
  and agents generated as TOML.

Where a tool cannot enforce a rule, `rockbuilt-ci` and `rb merge-gate` do.

## The rb CLI

Deterministic steps live in a small Node CLI, run as `node tools/rockbuilt/rb.mjs <cmd>` in a
project (`node scripts/rb.mjs <cmd>` in this repo): `vendor`, `doctor`, `verify-cmds`,
`baseline`, `tasks`, `parallel`, `worktree`, `timing`, `risk`, `sync`, `gh`, `merge-gate`,
`revert`, `control`, `lock`, `stop`, `escalate`, `digest`, `protect`, `labels`. Run `help` for
flags; every command accepts `--json`.

## Playwright

Web projects get Playwright from the first issue: `rb vendor --type web` lays down
`playwright.config.ts`, a smoke spec and the Playwright MCP server in `.mcp.json`. UI-touching
tasks run the E2E suite before their PR opens; in a cloud run without a browser that step becomes
an `rb:needs-local` note with the exact commands.

## Documentation

- [DESIGN.md](DESIGN.md): the contract every skill, agent and script follows.
- [docs/GUIA.md](docs/GUIA.md): user guide in Spanish.
- [docs/CLOUD.md](docs/CLOUD.md): nightly routine setup, reading results, stopping and reverting, in Spanish.
- [docs/MEJORAR.md](docs/MEJORAR.md): how the harness is improved (evidence, evals, retro), in Spanish.
- [docs/roadmap.md](docs/roadmap.md): what comes next and the signal for each item.
- [.claude/CLAUDE.md](.claude/CLAUDE.md): maintainer rules for changing the harness.
- [evals/](evals/): A/B evals for every skill.

## Development

```
npm test
claude plugin validate . --strict
node evals/run.mjs --arms with      # headless evals: vendors the harness into each workspace
```

`npm test` runs the guard hook tests, the `rb` CLI tests and a selfcheck of the harness
(frontmatter, agent status lines, known `rb` commands and `rb gh` ops, labels, REST-only GitHub
usage, versions, no em dashes).

## Credits

Methodology from the Lab10 course on building with AI (harness engineering, spec-driven
development, loops, evals). The planner, implementer and verifier mechanics are adapted from
[trail-blazer-flow](https://github.com/msummer/trail-blazer-flow) by Mark Summer (MIT).

## License

MIT

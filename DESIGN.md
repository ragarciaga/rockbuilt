# Rockbuilt design contract

This file is the single source of truth for every skill, agent, hook and script in the plugin.
When two files disagree, this file wins and the other file is a bug. Keep it current.

> "Everyone who hears these words of mine and does them will be like a wise man who built his
> house on the rock." (Matthew 7:24)

## 1. Principles (non-negotiable)

1. **What cannot be verified cannot be delegated.** Every task carries a binary, executable check
   (a command, a test, an E2E case, an eval threshold). No check, no task.
2. **The producer never grades itself.** Implementation and verification are separate agents with
   separate context. The verifier cannot modify what it judges (its only writes are transient
   mutation probes it restores itself).
3. **Design before code.** Idea, then spec, then tasks, then code. Rigor scales with the size of
   the change (see section 6), never skipped for anything that touches data, auth or money.
4. **Memory lives in the repo, not the chat.** Every session starts by reading `CLAUDE.md` and
   `docs/progress.md`. Decisions go to ADRs and task decision logs.
5. **Ambiguity is resolved top-down, before execution.** Open questions are BLOCKING, ADVISORY or
   DEFERRED. The implementer only ever receives resolved decisions.
6. **Research flows down as Verified facts.** The planner records exact names, signatures and
   file:line facts so the cheaper implementer never re-derives them.
7. **A green baseline is a precondition.** Never build on a red default branch.
8. **Humans own two gates that are never delegated:** approving the spec/backlog, and merging.
   Merge happens only when the human explicitly asks for it in the conversation.
9. **Autonomy rises by proven need, not ambition.** v1 runs per objective (`/goal`) with human
   merge. Scheduled cloud runs, plan auto-approval and auto-merge are documented roadmap items.
10. **Cross-platform by construction.** Windows, macOS and Linux. All automation is Node.js
    (>= 20) with no Bash-only or GNU-only dependencies. Requirements per machine: Node 20+, git,
    gh (authenticated). No jq, no bash scripts.

## 2. Language rule

- Instructions to agents (agents/*.md, skills/*/SKILL.md, references) are written in English.
- Everything a human reads (brief, specs, ADRs, tasks.md, issues, PR bodies, reports, progress,
  questions asked to the user) is written in the **language the user is using in the
  conversation**. Detect it from the user's messages. Record it in `CLAUDE.md` as
  `Docs language: <es|en|...>` at kickoff/adopt; later skills read it from there and still
  follow the live conversation if the user switches.
- A "switch" means the user writes the current request in another language. New human-facing
  artifacts for that request use the request's language. Existing documents keep their language
  when edited (say so in one line) and are never translated unless the user asks.
- Keep code identifiers, commit types and file names in English.
- Never use the em dash character (U+2014) in any file or output. Use commas or parentheses.
  The selfcheck test enforces this for the plugin itself.

## 3. Plugin layout

```
.claude-plugin/plugin.json        manifest (name: rockbuilt)
.claude-plugin/marketplace.json   the repo is its own marketplace (source ".")
skills/<name>/SKILL.md            user-facing commands: /rockbuilt:<name>
skills/<name>/references/*.md     loaded on demand by the skill
skills/<name>/templates/*.md      artifact templates
agents/*.md                       subagents (scoped name rockbuilt:<name>)
hooks/hooks.json                  PreToolUse guard, exec form: node + guard.mjs
hooks/guard.mjs                   boundary enforcement (section 9)
bin/rb                            node shebang wrapper, on the Bash PATH
scripts/rb.mjs                    the rb CLI (section 10)
scripts/lib/*.mjs                 CLI modules
templates/project/                files installed into target projects
templates/web/                    overlay for web projects: playwright.config.ts, e2e/smoke.spec.ts, .mcp.json
tests/*.test.mjs                  node:test suites (npm test)
evals/<skill>.md                  A/B eval scenarios per skill (with vs without skill)
docs/                             README-level docs, guide in Spanish (GUIA.md), roadmap
```

### Skills (commands)

| Skill | Purpose |
|---|---|
| `kickoff` | Greenfield: idea interview, go/no-go, brief, project type, architecture, repo + GitHub setup, walking skeleton issue |
| `adopt` | Existing repo: scout the code, current-state doc, CLAUDE.md from reality, baseline or stabilization issue, route the goal |
| `spec` | Per feature: requirements (EARS) then design then ADRs, each approved in order |
| `tasks` | Converge tasks.md against the real repo (bootstrap + per-task review), then create GitHub issues |
| `build` | Run the backlog: per issue plan, implement, check, verify, PR. Goal mode, optional parallel worktrees, timing |
| `fix` | Bug path: reproduce with a failing test, minimal fix, verify, PR. No spec |
| `verify` | Feature gates: E2E (web UI), evals (LLM features), security review |
| `merge` | Merge a PR only on explicit human request, then clean up |
| `status` | Resume a session: read progress, baseline, open issues and PRs, say what is next |

### Agents

| Agent | Model | Tools | Role |
|---|---|---|---|
| `scout` | sonnet | Read, Grep, Glob, Bash (read-only) | Maps an existing repo or the state relevant to a spec |
| `planner` | opus | Read, Grep, Glob | One issue/task to an implementation plan (template in section 8) |
| `task-reviewer` | sonnet | Read, Grep, Glob | Judges one task: size, alignment, completeness, necessity. Returns a verdict, never writes |
| `implementer` | sonnet | Read, Write, Edit, Grep, Glob, Bash | Executes an approved plan. No git, no gh |
| `verifier` | opus | Read, Grep, Glob, Bash, Edit | Fresh-context adversarial review with mutation probe. Read-only git, no gh |
| `e2e-writer` | sonnet | no `tools:` line (inherits, so Playwright MCP tools are reachable); guard denies git/gh | Explores the live UI, writes E2E specs from the test plan. Never touches app code |
| `healer` | sonnet | Read, Grep, Glob, Bash | Runs E2E, diagnoses test vs app fault, writes nothing; returns its report |
| `security-reviewer` | opus | Read, Grep, Glob, Bash (read-only) | OWASP-oriented review of a diff or feature, returns findings |

Agents are dispatched with the Agent tool using `subagent_type: "rockbuilt:<name>"`. If that name
is rejected, retry with the bare `<name>`. Only the main session (the orchestrator) runs git and
gh, writes shared files (tasks.md, progress.md, LESSONS.md) and talks to the user.

## 4. Project-side files (created in the target repo)

```
CLAUDE.md                          project contract (section 5). Committed.
.claude/settings.json              permissions (allow/ask/deny) + plugin enablement. Committed.
.claude/LESSONS.md                 project gotchas, 1-3 lines each, dated. Committed.
.rockbuilt/                        machine-local state, gitignored
  baseline.json                    last known-green verification run
  timing.jsonl                     raw timing events
docs/brief.md                      product brief (kickoff) 
docs/current-state.md              scout map of an adopted repo (adopt)
docs/progress.md                   session state + timing table. Committed.
docs/v2.md                         deferred scope with reasons
docs/adr/NNNN-<slug>.md            architecture decision records
docs/research/<topic>/REPORT.md    library benchmarks with real data (no credentials)
docs/specs/NN-<feature-slug>/
  requirements.md                  EARS requirements with IDs
  design.md                        design traced to requirements
  tasks.md                         tasks with traceability + decision logs
  test-plan.md                     E2E plan (1 happy path + 2 failure cases per flow)
  test-report.md                   E2E results
  evals.md                         eval design + baseline score (AI features)
  security-report.md               security review findings
.mcp.json                          project MCP servers; web projects get `playwright` (node + node_modules/@playwright/mcp/cli.js)
playwright.config.ts               Playwright config (webServer, PORT, traces on failure, no retries)
e2e/*.spec.ts                      Playwright specs (web projects)
evals/*.eval.ts                    eval suites (AI projects), run by `npm run evals`
```

## 5. CLAUDE.md contract

Required sections (exact headings, the `rb` CLI parses the fenced blocks):

```markdown
# <Project name>

Docs language: es
Project type: web, ai            # any of: web, ai, automation
Parallel: auto                   # auto | off
Max parallel: 3
Default branch: main

## Goal
Business goal, current problem (time/effort), system objective (inputs, processing, outputs).

## Stack
Languages, frameworks and pinned versions, with links to their docs.

## Conventions
Only what is not obvious from the code: patterns, naming, data rules, security rules, scope
limits ("never modify X", "only use library Y for Z").

## Verification
```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## E2E
```bash
npm run test:e2e
```

## Evals
```bash
npm run evals
```

## Setup
```bash
npm install
```

## Out of scope
Pointer to docs/v2.md plus the hard non-goals.
```

`rb` reads the first fenced block under `## Verification`, `## E2E`, `## Evals` and `## Setup`,
one command per non-empty, non-comment line. Missing optional sections are fine. Keep CLAUDE.md
under 200 lines; detail goes to docs.

## 6. Rigor ladder (which path a request takes)

| Change | Path |
|---|---|
| New project | `kickoff` then `spec` then `tasks` then `build` then `verify` |
| New feature or large change | `spec` then `tasks` then `build` then `verify` |
| Refactor or migration | short `spec` (criterion: user-visible behavior unchanged) then `tasks` then `build` |
| Bug | `fix` |
| Small, bounded change (one file area, no data/auth/money) | one issue, then `build` on it directly |
| Pure UI copied from a mockup | lightweight plan inside the issue, then `build`; E2E still applies |

When unsure, the orchestrator proposes a path in one sentence and the user confirms.

## 7. Spec formats

### requirements.md

- Header: feature name, status (draft | approved), date, links to brief and ADRs.
- `## Context` (2-4 sentences), `## Users`, `## Out of scope`.
- Requirements numbered `R1`, `R2`... each with a one-line user story and acceptance criteria
  numbered `R1.1`, `R1.2`... written in **EARS**:
  - Ubiquitous: `The system shall <response>.`
  - Event: `When <trigger>, the system shall <response>.`
  - State: `While <state>, the system shall <response>.`
  - Unwanted: `If <condition>, then the system shall <response>.`
  - Optional: `Where <feature is included>, the system shall <response>.`
  (Written in the docs language; in Spanish: `Cuando <evento>, el sistema deberá <respuesta>.`)
- Every criterion must be verifiable by a command, test, E2E case or eval. Mark how in a trailing
  tag: `[unit]`, `[integration]`, `[e2e]`, `[eval]`, `[manual]`. `[manual]` needs a reason.
- For adopted repos: a `## Existing behavior to preserve` section lists only what the feature
  touches.

### design.md

- Must trace to requirements; nothing without an `R` reference. Sections: Overview, Architecture
  (Mermaid diagram; for AI systems mark each node as `code`, `ai-model` (non-generative) or `llm`),
  Workflow vs agent decision with reason, Data model / schema impact, Interfaces and contracts,
  Error handling (per item vs fatal, retries with backoff, idempotency), Security considerations,
  Testing strategy (unit / integration / e2e / evals), Alternatives considered, Open questions.

### ADR (docs/adr/NNNN-slug.md)

Title, Status (proposed | accepted | superseded by NNNN), Date, Context, Decision, Alternatives
considered (with why rejected), Consequences. One decision per ADR. Create one for: stack choice,
any library chosen after a benchmark, workflow vs agent, auth model, data storage, anything hard
to reverse.

### tasks.md

```markdown
# Tasks: <feature>
Spec: docs/specs/NN-slug/  |  Status: draft | approved  |  Converged: <date>, <rounds> rounds

## T1: <imperative title>
- Purpose: <what this achieves for the user>
- Covers: R1.1, R1.2
- Size: S | M | L
- Depends on: none | T0
- Files: src/a.ts, src/a.test.ts           (expected touch list, used for parallel batching)
- Verify: `npm test -- a.test.ts`; E2E case 1   (binary checks)
- Issue: #12
- Status: todo | in-progress | in-review | done | blocked

### Decision log
- <date>: <decision>, because <reason>. Outcome: <verification result>.
```

Rules: every criterion in requirements.md is covered by at least one task (the `tasks` skill
prints a coverage matrix and refuses to finish with uncovered criteria unless the user defers
them to docs/v2.md). Task 1 of a greenfield project is the walking skeleton. A task is L only if
it cannot be split without losing a verifiable outcome.

## 8. Plan template (planner output, posted as an issue comment)

First line of the comment: `<!-- rockbuilt:plan -->`. Sections in order: Summary; Acceptance
criteria (copied from the task's `Covers` IDs plus any derived ones, as a checklist); Size;
Affected files (production and test, exhaustive, used for parallel batching); Claims this change
falsifies (docs/comments that become wrong); Data / schema impact; Implementation steps; Testing
approach (concrete cases); Risks (flag auth, permissions, secrets, data access explicitly);
Verified facts (exact identifiers with file:line); Open questions (BLOCKING / ADVISORY with a
recommended default); Follow-ups; Out of scope.

## 9. Safety model

Enforced mechanically by `hooks/guard.mjs` (PreToolUse, matcher `Bash|Edit|Write|MultiEdit|NotebookEdit`):

| Rule | Applies to |
|---|---|
| Deny `git push` whose destination resolves to the default branch, and any force push | everyone |
| Deny `git` and `gh` entirely | implementer, e2e-writer |
| Deny `gh`; allow only read-only git (status, diff, log, show, rev-parse, ls-files, merge-base, blame, grep, restore) | verifier, healer, scout, security-reviewer, planner, task-reviewer |
| Deny Edit/Write/MultiEdit/NotebookEdit | scout, planner, task-reviewer, healer, security-reviewer |
| Deny Edit/Write to `.claude/`, `CLAUDE.md`, `.rockbuilt/`, `.github/workflows/` | every subagent |
| Deny `gh pr merge` | every subagent (main session gets an `ask` permission rule instead) |

The subagent role comes from `agent_type` in the hook input (may be `rockbuilt:implementer` or
`implementer`; compare the part after the last colon). The main session has no `agent_type`.
Parse errors exit 0 (no opinion): the hook is a tripwire, not a sandbox. The real backstops are
branch protection on the default branch and human PR review. Deny = exit code 2 with one stderr
line explaining the rule.

Project `.claude/settings.json` (template in templates/project/) carries: allow rules for `rb`,
safe git/gh subcommands, package managers, Edit, Write; **ask** for `gh pr merge`; deny for
force push, `reset --hard`, `git clean`, `rm -rf`, push to main/master.

## 10. The rb CLI

Invoked as `rb <command>` (bin/rb on the Bash PATH). Fallback when `rb` is not found:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs" <command>`. Every command prints JSON to stdout when
given `--json`, human text otherwise, and exits non-zero on failure.

| Command | Does |
|---|---|
| `rb doctor` | Checks node, git, gh auth, CLAUDE.md sections, settings.json rules, .gitignore entries, labels, branch protection hint. PASS/WARN/FAIL lines |
| `rb init [--type web,ai] [--lang es]` | Copies templates/project into the repo without overwriting existing files (reports skipped ones), adds `.rockbuilt/` to .gitignore |
| `rb labels` | Creates/updates the label set idempotently via gh |
| `rb verify-cmds [section]` | Prints the commands parsed from a CLAUDE.md section (default Verification) |
| `rb baseline [--check]` | Runs Verification commands, writes .rockbuilt/baseline.json {sha, date, results}. `--check` exits 1 if HEAD of default branch moved since the baseline and the re-run is red |
| `rb tasks <spec-dir>` | Parses tasks.md to JSON (id, title, covers, size, depends, files, verify, issue, status) and checks coverage against requirements.md (uncovered criteria, unknown IDs) |
| `rb parallel <spec-dir> [--ids T4,T6] [--max 3]` | Computes batches of ready tasks with disjoint Files and no shared paths; shared paths (package.json, lockfiles, migrations, prisma/schema, supabase/, drizzle/, config files, .env*) force serial. Output: batches + reasons |
| `rb worktree add <task> [--base main]` | Creates `../<repo>-wt-<task>` on branch `rb/<task>-<slug>`, copies .env* files, sets core.longpaths=true, prints path and a suggested port offset |
| `rb worktree remove <task>` / `rb worktree list` | Cleanup and listing |
| `rb timing start|end <task> <phase>` | Appends to .rockbuilt/timing.jsonl. Phases: plan, implement, check, verify, fix, e2e, evals, security, pr |
| `rb timing report [--write]` | Aggregates per task and phase; `--write` replaces the block between `<!-- rb:timing:start -->` and `<!-- rb:timing:end -->` in docs/progress.md |

### Labels

`rb:task`, `rb:skeleton`, `rb:bug`, `rb:blocked` (needs a human answer or failed after the
kickback budget), `rb:in-progress`, `rb:pr-open`, `rb:parallel-safe` (informational).

## 11. The build loop (per task/issue)

1. Preconditions: clean tree on the default branch, `rb baseline --check` green, task status
   `todo`, dependencies `done`.
2. `rb timing start Tn plan`. Dispatch `planner` with: CLAUDE.md pointer, the task block, spec
   paths, relevant LESSONS.md entries. Post the plan as an issue comment.
3. If the plan has BLOCKING questions: the orchestrator proposes answers grounded in code/spec
   and labels each `RESOLVED (orchestrator-proposed)`. If any cannot be grounded, label the
   issue `rb:blocked`, write the question in the issue and in progress.md, move to the next task.
   ADVISORY questions take their recommended default.
4. Create branch `rb/Tn-slug` (or a worktree in parallel mode). Dispatch `implementer` with the
   full plan, resolved decisions and LESSONS.
5. Mechanical check by the orchestrator itself: run the Verification commands; counts must not
   drop versus the baseline without explanation.
6. Collapse to one commit (`git reset --soft <merge-base>`), record the head SHA, then dispatch
   `verifier` with the plan, the implementer report, the diff stat and `Reviewed head: <sha>`.
   If the plan's Risks flag a sensitive area, dispatch `security-reviewer` (task mode) after the
   verifier passes (section 14.8). Any finding = fail.
   On fail, re-dispatch `implementer` with "fix ONLY these findings". Kickback budget: 2. After
   that, `rb:blocked` with the findings, keep a `wip:` commit on the branch, move on. The
   orchestrator never edits code to fix findings.
7. Push the branch (conventional commit message, `Closes #n` in the PR), open the PR with the
   template (problem, technical summary, criteria checklist, verification output, verifier notes,
   how to test locally, risks). Label `rb:pr-open`. Update the task Status and its decision log.
8. If the gh CLI shows CI checks, watch them; one bounded fix attempt for failures caused by the
   PR. A failure traced to a project gotcha becomes a LESSONS.md entry.
9. `rb timing end`, update docs/progress.md. Never merge unless the user asks.

Goal mode: `build` composes a `/goal` condition ("all tasks in <spec> are done, in-review or
blocked with a reason") and keeps going without the user typing "continue". Hard limits: max
kickbacks per task (2), stop when the baseline is red, stop when 3 consecutive tasks block.

Parallel mode (only when CLAUDE.md says `Parallel: auto` and `rb parallel` returns a batch of 2+
tasks, or the user asks): one worktree per task, implementers and verifiers dispatched
concurrently, git/gh/PR steps sequential in the orchestrator. Tasks needing a live app for E2E
run their E2E step serially. Announce the batch in one line before starting.

## 12. Verify gates (per feature, after its tasks are in review or merged)

- **E2E** (project type web, or any UI): `plan-test-cases` step reads the spec (never the code)
  and writes test-plan.md with exactly 1 happy path + 2 failure cases per user flow, each traced
  to criteria. `e2e-writer` explores the running app (Playwright MCP if available, otherwise
  Playwright codegen-style exploration via the CLI) before writing selectors, one spec file per
  flow in `e2e/`. Scripts must run without a model afterwards (`npm run test:e2e`). `healer` runs
  them and classifies each failure as test fault or app fault; app faults become fix tasks for
  the implementer, test faults go back to `e2e-writer`. Never weaken an assertion to pass.
- **Evals** (project type ai, or any LLM-backed criterion tagged `[eval]`): dataset of 20-50 real,
  balanced cases with ground truth; code graders before LLM-as-judge (calibrated, with explicit
  penalties); grade the outcome, not the path; record the baseline score in evals.md; `npm run
  evals` becomes a regression gate with a threshold. Read transcripts before changing prompts.
  Production failures get added to the dataset.
- **Security** (always for auth, permissions, payments, personal data, file upload, external
  input, secrets, new dependencies): `security-reviewer` checks OWASP Top 10 relevant items,
  authz on every data path (RLS is not enough on its own), secrets in code or logs, input
  validation, dependency risk (`npm audit` summary). Findings rated blocker / major / minor;
  blockers become tasks before the feature counts as done.

## 13. Memory and resumption

- `docs/progress.md` sections: Current objective, Current state (works / broken / pending),
  Key decisions (links to ADRs), Next steps (exact instructions to resume), Timing (rb block).
  Updated after a crucial decision, when context is filling up, and at the end of each skill run.
- `.claude/LESSONS.md`: one entry per real gotcha, written as an instruction to a future agent.
  Only the orchestrator appends. Injected into planner and implementer prompts when relevant.
- `status` skill: the first thing to run in a new session.

## 14. Resolved decisions (v0.1 authoring pass)

These settle gaps found while writing the skills. They override anything vaguer above.

1. **Task ids.** `T<n>` for tasks in a tasks.md, `B<n>` for bugs (`fix`), `i<n>` for standalone
   issues not in any tasks.md (walking skeleton, stabilization issue, small bounded changes).
   Branches: `rb/<id>-<slug>`. `rb timing` and `rb worktree` accept any id; `verify` times the
   feature slug.
2. **Standalone issues.** `build` accepts an issue number with no tasks.md block. The planner
   derives acceptance criteria from the issue body; everything else in section 11 applies.
3. **Markers.** Issue bodies start with `<!-- rockbuilt:task <id> spec=<dir or none> -->`. Plans start
   with `<!-- rockbuilt:plan -->`. Every agent ends with
   `<!-- rockbuilt:status stage=<agent> task=<id> outcome=<...> -->`. The PR body carries the
   verifier line with the reviewed head: `<!-- rockbuilt:status stage=verifier task=<id> outcome=pass head=<sha> -->`.
   `merge` treats a PR as verifier-clean only if that head equals the PR's current head SHA.
4. **Plan reuse.** `build` reuses the latest plan comment on an issue when no human comment and no
   tasks.md change are newer than it; otherwise it re-plans.
5. **Bookkeeping files.** tasks.md, docs/progress.md and .claude/LESSONS.md edits made by the
   orchestrator stay out of task commits. The clean-tree check ignores them. At the end of a
   `build` run the orchestrator offers one `docs: progress` PR on `rb/bookkeeping-<date>`.
6. **One commit per PR.** WIP checkpoints are collapsed with `git reset --soft <merge-base>` before
   push (allowed in settings; only `--hard` is denied).
7. **Kickback accounting.** A failed mechanical check counts against the same budget of 2.
   Retrying a blocked issue: the user removes `rb:blocked` (or says "retry issue N") and runs build.
8. **Security per task.** When a plan's Risks flag auth, permissions, payments, personal data,
   secrets, file upload or external input, `build` dispatches `security-reviewer` on that task's
   diff after the verifier passes. Blocker or major findings are kickbacks. `fix` does the same
   and puts the findings in the PR body (no spec folder needed). `verify` still runs the
   feature-level review.
9. **Verify artifacts branch.** E2E specs, eval files and the four reports go on `rb/verify-<slug>`
   with their own PR. Eval and app code needed by a gate becomes a task for the implementer;
   `verify` never writes app code.
10. **Test plan author.** The orchestrator writes test-plan.md itself, reading only the spec.
    Exploration scratch files live in `e2e/.explore/` (gitignored).
11. **Stack-specific permissions.** kickoff and adopt add allow rules for the project's toolchain
    (for example `Bash(uv *)`, `Bash(pytest *)`, `Bash(cargo *)`) to `.claude/settings.json`.
    Rule style is `Bash(cmd *)`.
12. **Header parsing.** CLAUDE.md header lines are `Key: value`, trailing `# comments` stripped.
    Spec files use `Status: draft | Date: YYYY-MM-DD` on one line.
13. **/goal.** Skills cannot run slash commands. `build` composes the `/goal` condition (with a turn
    limit, since the goal evaluator only sees the transcript), prints it for the user to paste,
    and explains `/goal clear`.
14. **Scout users.** `adopt` (repo map), `spec` and `tasks` (spec mode, only when code exists).

15. **Additions from the consistency review.**
    - security-reviewer runs in `task` mode (build, fix) and `feature` mode (verify). Agents get
      reference file paths in their prompt, because `${CLAUDE_PLUGIN_ROOT}` is not expanded inside
      agent files.
    - Section 4 also holds `e2e/.explore/` (gitignored) and `evals/datasets/`.
    - Settings allow `Bash(git -C *)` (parallel mode), `Bash(git reset --soft*)` and
      `Bash(node *scripts/rb.mjs*)` (rb fallback). Deny rules still win.
    - `rb worktree add <id> [--base] [--slug] [--title] [--spec]`, `rb worktree remove <id> [--force]`.
      `rb tasks` exits 1 with full JSON on coverage gaps or format problems.
    - verify writes datasets only; eval runners and graders are implementer tasks.
    - Single exception to one commit per PR: a CI fix after push adds a second commit (collapsing
      again would need a force push, which is denied).
    - The spec folder (requirements, design, ADRs) is committed by the user, optionally through an
      `rb/spec-<slug>` docs PR. `<slug>` is the spec folder name without the `NN-` prefix.
    - `merge` accepts `rb/verify-*`, `rb/spec-*` and `rb/bookkeeping-*` PRs by file allowlist
      instead of a verifier line. merge refreshes the baseline after every merge it performs.

## 16. Playwright is first-class for web projects

- `rb init` applies `templates/web/` whenever the project type includes `web` (from `--type` or
  the existing CLAUDE.md): `playwright.config.ts`, `e2e/smoke.spec.ts`, the `playwright` server
  in `.mcp.json` (merged into an existing file), and the `test:e2e` script in package.json.
- The MCP server is launched as `node ${CLAUDE_PROJECT_DIR:-.}/node_modules/@playwright/mcp/cli.js
  --isolated`, never through `npx`, so the same committed file works on Windows, macOS and Linux,
  and its version is pinned by the lockfile. Install with
  `npm install -D -E @playwright/test @playwright/mcp` and `npx playwright install chromium`.
  Claude Code loads MCP servers at startup: restart and approve the server, confirm with `/mcp`.
- The walking skeleton of a web project includes Playwright, the smoke spec and E2E in CI. `adopt`
  proposes an "Add Playwright E2E baseline" issue for web repos without it.
- `rb doctor` checks deps, config, `## E2E` commands, the MCP entry and its install, and the
  `mcp__playwright` allow rule, for web projects only.
- `build` runs the E2E commands in the mechanical check of every UI-touching task (serial,
  `PORT` offset per worktree). A spec that also fails on the default branch is pre-existing and
  is noted, not kicked back.
- `fix` reproduces browser-only bugs with a Playwright spec.
- `verify` prefers the Playwright MCP for exploration; throwaway scripts in `e2e/.explore/` only
  when the user declines to load the MCP.

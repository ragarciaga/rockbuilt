# Rockbuilt design contract (v0.3)

This file is the single source of truth for every skill, agent, hook and script. When a file and
this contract disagree, this contract wins and the file is the bug. Decisions carry their evidence
(section 20). Keep it current; never append patches that contradict earlier sections, edit them.

> "Everyone who hears these words of mine and does them will be like a wise man who built his
> house on the rock." (Matthew 7:24)

## 1. Principles (non-negotiable)

1. **What cannot be verified cannot be delegated.** Every task carries a binary, executable check.
2. **Nobody grades their own work.** The implementer never verifies. The verifier checks plan
   conformance; a separate blind auditor checks user-visible behavior against the spec without
   seeing the plan or the implementer's report. Reviewers cannot modify what they judge.
3. **Autonomous by default, human by exception.** The harness plans, builds, audits and merges on
   its own. The human is pulled in only for tier C (section 6): architecture and design
   decisions, anything that costs money, and sensitive or irreversible changes.
4. **Mechanical floors beat model judgment.** Risk tier, merge eligibility, stop and lock are
   decided by code (`rb`), never by a model's opinion alone. A model may raise a tier, never lower
   one.
5. **Memory lives in the repo and in GitHub, not in a chat.** Specs, tasks, decision logs, ADRs and
   LESSONS are committed. Run state that must survive a cloud run (lock, stop, escalations,
   digest) lives in GitHub issues and labels.
6. **Cloud first, local when needed.** Unattended runs happen in Claude Code cloud routines. Steps
   that need the user's machine (a browser that the cloud lacks, local credentials) are escalated
   as `rb:needs-local` with exact instructions.
7. **Never spend money without the user.** Any change or command that can create a cost (paid
   APIs, new services, infrastructure, paid plans, paid model calls in tests or evals) is tier C.
8. **Tool-agnostic core.** The same harness runs in Claude Code, Cursor and Codex. Enforcement that
   a tool cannot guarantee is backed by GitHub-side checks and by `rb`.
9. **Cross-platform by construction.** Windows, macOS, Linux. Node 20+ only; no Bash-only scripts.

## 2. Language rule

- Instructions to agents (skills, agents, references) are written in English.
- Everything a human reads (brief, specs, ADRs, tasks.md, issues, PR bodies, digests, questions)
  uses the `Docs language` from AGENTS.md, or the language of the current request if the user
  writes in another language. Existing documents keep their language when edited.
- In Spanish, address the user as tú (never vos; usted only if the user writes that way).
- Code identifiers, commit types, labels and file names stay in English.
- Never use the em dash character (U+2014) anywhere. The selfcheck enforces it.

## 3. Distribution: one source, vendored into each project

Cloud sessions do not load plugins declared in project settings (evidence 20.4). The harness is
therefore **vendored**: copied into each project repo, where every tool and every cloud run finds
it. The Claude Code plugin is the installer and updater.

### 3.1 This repo (the source)

```
harness/skills/<name>/SKILL.md    canonical skills (names: rb-kickoff, rb-build, ...)
harness/skills/<name>/references|templates/
harness/agents/rb-<name>.md       canonical agents
harness/project/                  project templates (AGENTS.md, CLAUDE.md, settings, CI, ...)
harness/web/                      web overlay (Playwright config, smoke spec, MCP config)
harness/adapters/cursor|codex/    per-tool adapter templates
scripts/rb.mjs, scripts/lib/      the rb CLI (vendored verbatim)
hooks/guard.mjs                   the guard (vendored verbatim)
skills/install/SKILL.md           the only plugin skill: /rockbuilt:install (vendor or update)
.claude-plugin/                   plugin + marketplace manifests
evals/, tests/, docs/, DESIGN.md
```

### 3.2 A project after `rb vendor`

```
AGENTS.md                         canonical project contract (all tools read it)
CLAUDE.md                         "@AGENTS.md" plus Claude-only notes
tools/rockbuilt/                  rb.mjs, lib/, guard.mjs, VERSION (committed, do not edit)
.claude/skills/rb-*/              skills (Claude Code and Cursor read this path)
.claude/agents/rb-*.md            agents (Claude Code and Cursor read this path)
.claude/settings.json             permissions + PreToolUse hook -> node tools/rockbuilt/guard.mjs
.claude/LESSONS.md                project gotchas
.cursor/hooks.json, .cursor/mcp.json, .cursor/cli.json   (with --tools cursor)
.agents/skills/rb-*/, .codex/hooks.json                  (with --tools codex; experimental)
.mcp.json                         Playwright MCP (web projects)
.github/workflows/rockbuilt-ci.yml  verification, E2E (when possible), secret scan, gate check
docs/brief.md | docs/current-state.md, docs/progress.md, docs/v2.md, docs/adr/, docs/research/
docs/specs/NN-slug/{requirements,design,tasks,test-plan,test-report,evals,security-report}.md
docs/rockbuilt/known-failures.json  baseline ratchet (committed)
.rockbuilt/                       machine-local scratch (gitignored): baseline cache, timing
```

`rb vendor [--tools claude,cursor,codex] [--type web,ai,automation] [--lang es]` installs or
updates. It never overwrites project-owned files (AGENTS.md, CLAUDE.md, LESSONS.md, docs), always
overwrites harness-owned files (tools/rockbuilt, rb-* skills and agents, adapter manifests), and
merges settings and MCP JSON. `tools/rockbuilt/VERSION` records the version.

### 3.2.1 Cloud front doors

A cloud session for a new or adopted project starts with a repo that has no harness, and plugins
do not load in the cloud. This repo therefore carries `.claude/skills/rb-kickoff` and
`.claude/skills/rb-adopt`: thin skills with the same frontmatter as `harness/skills/`, which read
and follow the real skill from the attached checkout. Only those two are front doors; every other
skill exists in the project once `rb vendor` runs.

### 3.3 Invoking rb

Skills call `node tools/rockbuilt/rb.mjs <command>` (shown below as `rb <command>`). Plugin-only
fallback: `node "${CLAUDE_PLUGIN_ROOT}/scripts/rb.mjs"`. Never rely on PATH.

### 3.4 Names

Skills: `rb-kickoff`, `rb-adopt`, `rb-spec`, `rb-tasks`, `rb-build`, `rb-cycle`, `rb-fix`,
`rb-verify`, `rb-merge`, `rb-status`, `rb-retro`. Invoked as `/rb-build` etc.
Agents: `rb-scout`, `rb-planner`, `rb-task-reviewer`, `rb-implementer`, `rb-verifier`,
`rb-auditor`, `rb-e2e-writer`, `rb-healer`, `rb-security-reviewer`. Dispatched with
`subagent_type: "rb-<name>"`.

## 4. Agents

| Agent | Model | Tools | Role |
|---|---|---|---|
| rb-scout | sonnet | Read, Grep, Glob, Bash (read-only allowlist) | Maps an existing repo or the code relevant to a spec |
| rb-planner | opus | Read, Grep, Glob | Plan per task with Verified facts, Risk and cost, open questions |
| rb-task-reviewer | sonnet | Read, Grep, Glob | Judges one task: size, alignment, completeness, necessity |
| rb-implementer | sonnet | Read, Write, Edit, Grep, Glob, Bash | Executes an approved plan. No git, no gh, no secrets |
| rb-verifier | opus | Read, Grep, Glob, Bash (allowlist), Edit (transient mutation probes only) | Plan conformance, test quality, mutation probe |
| rb-auditor | opus | Read, Grep, Glob, Bash (allowlist), Write (only under `.rockbuilt/audit/`) + Playwright MCP | Blind audit: spec criteria vs observable behavior |
| rb-security-reviewer | opus | Read, Grep, Glob, Bash (allowlist) | OWASP-oriented review of a diff or feature |
| rb-e2e-writer | sonnet | inherits (Playwright MCP); guard limits writes to e2e/ | Writes Playwright specs from the test plan |
| rb-healer | sonnet | Read, Grep, Glob, Bash (allowlist) | Runs E2E and classifies failures |

Read-only roles carry `readonly: true` in frontmatter for Cursor, except rb-verifier (transient
Edit probes) and rb-auditor (scratch checks), which the guard limits instead. Every agent ends its output with
`<!-- rockbuilt:status stage=<agent> task=<id> outcome=<...> [head=<sha>] -->`.

The **blind auditor** receives only: the task id, the acceptance criteria text (by ID, from
requirements.md or the issue), how to run the app or the code (AGENTS.md commands), the reviewed
head SHA. It never receives the plan, the implementer report, the verifier verdict or the diff
narrative. It may read code only to learn how to exercise behavior, and must judge each criterion
by observed behavior (command output, a throwaway check it writes under `.rockbuilt/audit/`,
Playwright session). Its
verdict lists each criterion as pass, fail or not-observable with evidence. Any fail is a kickback.

## 5. Project contract (AGENTS.md)

Header lines, then sections. `rb` parses this file (and falls back to CLAUDE.md for v0.2 projects).

```markdown
# <Project name>

Docs language: es
Project type: web, ai            # any of: web, ai, automation
Default branch: main
Autonomy: auto                   # auto | supervised (supervised = v0.2 behavior: human merges)
Parallel: auto
Max parallel: 3
Max tasks per run: 6

## Goal / ## Stack / ## Conventions      (as before: business goal, pinned stack, non-obvious rules)

## Verification      fenced block, one command per line (unit, typecheck, lint, build)
## E2E               fenced block (npm run test:e2e)
## Evals             fenced block (npm run evals)
## Setup             fenced block (npm ci)

## Autonomy
Sensitive paths:     globs that always force tier C (adds to the built-in floor)
Tier A paths:        globs that may be tier A (adds to the built-in A list)
Paid services:       none | list of services already approved (with monthly cap)

## Out of scope
```

## 6. Autonomy tiers

`rb risk` computes the tier from the actual diff (or a plan's declared files). The planner also
declares a tier with reasons. **Final tier = the highest of the two.** Recomputed after
implementation and again by `rb merge-gate`.

### 6.1 Built-in floor (tier C, cannot be configured away)

| Trigger | Detected by |
|---|---|
| Dependency change | package.json `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`, `overrides`, `resolutions`, `scripts` (a changed `test` script can make CI green by construction), `workspaces`, `engines`, `packageManager`; any other manifest or lockfile (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `requirements*.txt`, `pyproject.toml`, `Cargo.*`, `go.mod`, `Gemfile*`, `composer.*`, and the like) |
| Cost | in every code file, tests and evals included (they run in CI with real secrets): newly imported paid SDKs, new external API hosts, new env var names matching `*_KEY`, `*_SECRET`, `*_TOKEN`, `*_API*` (destructured reads included). "New" means absent from the base outside the harness and prose (`tools/rockbuilt`, `.claude`, `.agents`, `.codex`, `.cursor`, `docs/`, `*.md`). A paid service listed under `Paid services` approves only the exact service key. A code file whose patch GitHub omits (too large) is C |
| Data and schema | migrations and schema files (`**/migrations/**`, `prisma/schema.prisma`, `drizzle/**`, `supabase/**`, `**/*.sql`) |
| Auth, permissions, payments, personal data | paths matching `**/auth/**`, `**/middleware.*`, `**/permissions/**`, `**/payments/**`, `**/billing/**`, `**/*stripe*`, `**/*policy*`, `**/rls*` |
| Infra, deploy, CI | `.github/**`, `vercel.json`, `netlify.toml`, `Dockerfile*`, `docker-compose*`, `fly.toml`, `render.yaml`, `wrangler.toml`, `**/*.tf`, `supabase/config.toml` |
| Harness and secrets | `AGENTS.md`, `CLAUDE.md`, `.claude/**`, `.cursor/**`, `.codex/**`, `.agents/**`, `tools/rockbuilt/**`, `docs/rockbuilt/**` (the known-failures ratchet), `.env*`, `**/*.env`, `.mcp.json`, `.npmrc`, `.yarnrc*`, `.gitleaks*`, `.gitattributes`, `.husky/**` |
| Architecture | ADR added or changed (`docs/adr/**`), design.md changed |
| Spec | `docs/specs/*/requirements.md`, `docs/brief.md` (the spec gate is human, section 6.4) |
| Deletions | more than 10 files deleted, or any deletion under `src/` larger than 300 lines |
| Size | diff larger than 800 changed lines |
| Declared | the planner, verifier, auditor or security reviewer flags a decision the spec did not settle |

### 6.2 Tier A (only if every changed file matches)

Tests (`**/*.test.*`, `**/*.spec.*`, `tests/**`, `e2e/**`), docs (`docs/**` except adr, specs and
brief), `*.md` outside the floor, styles (`*.css`, `*.scss`), copy and locale files
(`**/locales/**`, `**/i18n/**`, `**/*.json` under `messages/`), plus the project's `Tier A paths`.

### 6.3 Tier B

Everything else: production code inside an approved spec task, bug fixes, refactors.

### 6.4 What each tier does

| Tier | Plan approval | Agents | Merge |
|---|---|---|---|
| A | automatic | planner, implementer, verifier | automatic via `rb merge-gate` |
| B | automatic (task comes from an approved spec or a `rb:task`/`rb:bug` issue) | planner, implementer, verifier, blind auditor, security reviewer when the plan flags a sensitive area | automatic via `rb merge-gate` |
| C | **human**: issue labelled `rb:needs-human` with the question, the recommendation, the cost estimate when relevant; the run continues with other work | same as B | **human** by default; the user merges or tells the harness to (`/rb-merge`) |

The human answers by commenting on the issue (an answer, or "aprobado") and removing
`rb:needs-human`, or by adding `rb:approved`. The next run picks it up. Approval covers the plan
as posted; a plan revised afterwards needs approval again. An approving answer never makes the
plan stale (only an answer that changes the task does), and bookkeeping commits never do either:
otherwise every approval would trigger a re-plan and a new escalation (evidence 20.9).

The spec gate stays human: requirements.md and design.md are approved by the user once per
feature (they are architecture and design decisions). Tasks derived from an approved spec do not
need a second approval; tasks.md convergence runs autonomously.

`Autonomy: supervised` in AGENTS.md restores v0.2 behavior: every PR waits for the human.

## 7. GitHub layer (REST only)

Cloud sessions block GitHub GraphQL; only REST through `gh api` works (evidence 20.2). All GitHub
operations go through `rb gh <op>`, which shells out to `gh api` with a JSON body via stdin. Skills
never call `gh issue`, `gh pr` or `gh label` directly.

`rb gh` operations: `issue-create`, `issue-edit`, `issue-comment`, `issue-view`, `issue-list`
(by label/state), `label-add`, `label-remove`, `labels-ensure`, `pr-create`, `pr-view`, `pr-list`,
`pr-files`, `pr-comment`, `pr-update-branch`, `checks` (check-runs and statuses for a SHA),
`whoami`, `protection` (read). Output is JSON. Errors exit non-zero with the HTTP status.

Merging is not a `rb gh` op: only `rb merge-gate` merges.

## 8. The merge gate

`rb merge-gate <pr> --run <id> | --human-approved [--dry-run]` merges only if every condition
holds, evaluated by code:

1. PR open, not draft, base is the default branch, mergeable.
2. Labels: carries `rb:tier-a` or `rb:tier-b`; carries none of `rb:needs-human`, `rb:blocked`,
   `rb:tier-c`, `rb:hold`.
3. `rb risk --pr <n>` on the live diff returns a tier no higher than the label.
4. The PR body contains the verifier line `outcome=pass head=<sha>` (and for tier B the auditor
   line, and the security line when the body declares `security: required`), with `<sha>` equal
   to the PR head.
5. Every check run and commit status on the head SHA completed with success, and among them a
   `rockbuilt-ci` **check run created by GitHub Actions** concluded `success`. A commit status
   named `rockbuilt-ci` does not count (any token with repo access can post one). No CI, no
   automatic merge.
6. The stop switch is off (section 9).
7. The merge train lock is held by this run.

Then: squash merge via REST, comment with the one-line revert command
(`rb revert <pr>` opens a revert PR), label the issue done, and record the merge for the digest.
Exit codes: 0 merged, 3 not eligible (reasons in JSON), 1 error.

Merges are serial (merge train), one PR at a time:

- A PR is updated with the base (`rb gh pr-update-branch`) only when GitHub reports it behind or
  in conflict (`mergeable_state` `behind` or `dirty`); an update re-runs its checks, so the gate
  waits for them on the next pass instead of merging stale results.
- After each merge the orchestrator runs Verification on the updated default branch. If it turns
  red (a failure not in the known-failures list), it runs `rb revert <pr>`, escalates on the
  control issue, and stops the train for this run.

**Review-less PR kinds**, decided by branch name:

| Branch | Kind | Gate |
|---|---|---|
| `rb/bookkeeping-*` | bookkeeping | Automatic when every file is an in-place edit (no rename, no deletion, readable patch) of: an existing `docs/specs/*/tasks.md` changing only task `Status:` lines and dated decision-log lines, `docs/progress.md`, or `.claude/LESSONS.md` with no removed lines. Green `rockbuilt-ci`, no `rb:needs-human`/`rb:tier-c`/`rb:blocked`/`rb:hold`, stop switch off, lock held |
| `rb/revert-*`, `rb/spec-*`, `rb/verify-*`, `rb/kickoff*`, `rb/adopt*`, `rb/retro-*`, `chore/rockbuilt-*` | human-only | Merge only with `--human-approved`, still with green `rockbuilt-ci` |
| any other | task | Conditions 1 to 7 above |

`rb revert` opens its PR labelled `rb:tier-c` and `rb:needs-human`: undoing a merge is the
user's call, and a red default branch already stops the next cycle at the baseline step.

If the repo can enforce branch protection (public repo or GitHub Pro), `rb protect` configures
required status checks on the default branch so GitHub itself rejects a merge without green CI.
On a free private repo the gate is enforced by `rb` only; `rb doctor` reports which mode applies.

## 9. Unattended runs: lock, stop, escalation, digest

All four live in GitHub so they survive a fresh cloud clone.

- **Control issue.** `rb control ensure` creates or finds the issue titled
  `Rockbuilt control` (label `rb:control`), pinned by convention. It holds the lock and receives
  digest comments.
- **Lock.** `rb lock acquire --run <id>`: adds `rb:running` to the control issue with a comment
  carrying the run id and time; refuses if held and younger than 3 hours. `rb lock release`.
- **Stop switch.** Any open issue labelled `rb:stop`, or the control issue labelled `rb:stop`,
  stops the run before the next task and before every merge. Set it from the phone.
- **Escalation.** Tier C or blocked work: label `rb:needs-human` (or `rb:needs-local` for steps
  that need the user's machine), one comment with the question, options, recommendation, and for
  costs the estimate. Never waits; the run moves on.
- **Answers.** Every comment the harness writes carries a `<!-- rockbuilt:` marker (`rb gh`
  adds `<!-- rockbuilt:note -->` when missing), so an approval or answer is a comment from a
  trusted author (OWNER, MEMBER, COLLABORATOR) **without** a marker, newer than the escalation.
- **Rotation.** Comment reads page up to 2000 comments. `rb control ensure` replaces a control
  issue with 1500 or more comments (when it is neither locked nor stopped) with a fresh one and
  closes the old one with a pointer.
- **Digest.** `rb digest post` appends one comment to the control issue per run: merged PRs (with
  revert commands), PRs waiting for the human, escalations, failures, time per task, and what the
  next run will pick up. Written in the docs language.

## 10. Cloud routines

- **Nightly cycle:** a Claude Code routine with a schedule trigger (default 01:07 local time), on
  the project repo, prompt `Run /rb-cycle.` The routine runs on the user's subscription.
- **PR audit (optional):** a routine with a pull_request trigger on `rb/*` branches that runs the
  blind auditor in a fresh session, for an extra independent check.
- **Environment:** setup script `npm ci` (and `npx playwright install chromium` when it succeeds);
  network level Trusted, plus the project's hosts when E2E needs them. No secrets in environment
  variables; credentials go through the cloud API-credentials feature or stay local.
- Routines cannot use ask prompts; anything that would ask is denied (evidence 20.5). The harness
  never relies on an ask rule in unattended mode.
- `docs/CLOUD.md` (Spanish) is the step-by-step setup guide.

## 11. The cycle (rb-cycle, one bounded pass)

1. `rb control ensure`; stop switch check; `rb lock acquire`. If locked, post nothing and exit.
2. `rb sync`: tasks whose PR merged become `done`; closed issues; merged branches cleaned;
   stale `rb:in-progress` labels repaired.
3. Baseline: run Verification on the default branch; compare with `docs/rockbuilt/known-failures.json`
   (ratchet). New failures stop the cycle and escalate; known failures do not.
4. Answers: issues where the human answered (`rb:approved`, or `rb:needs-human` removed with a
   reply) return to the queue.
5. Queue: ready tasks (approved specs, status todo, dependencies done or merged), `rb:task` and
   `rb:bug` issues from trusted authors (OWNER, MEMBER, COLLABORATOR), CI failures on open
   `rb/*` PRs, and feature verification (rb-verify) for a spec whose tasks are all done and that
   has no test report yet (its PR is human-only). Issues carrying a spec task marker are built
   only from the approved tasks.md, never as standalone issues. Up to `Max tasks per run`.
6. For each task: the build loop (section 12). Parallel batches when `rb parallel` allows.
7. Merge train over eligible PRs (section 8).
8. `rb digest post`; `rb lock release`.

Hard limits per run: `Max tasks per run`, kickback budget 2 per task, 3 consecutive blocked tasks
stop the run, stop switch checked between steps.

## 12. The build loop (per task)

1. **Stale check.** If the latest plan comment exists and none of its Affected files changed on the
   default branch since the plan's `base=<sha>`, reuse it; otherwise (re)plan.
2. **Plan.** Dispatch `rb-planner`. The plan includes `Risk and cost` (declared tier with reasons).
   Compute `rb risk --files <affected>`; final tier = max. Post the plan with
   `<!-- rockbuilt:plan base=<sha> tier=<A|B|C> -->`.
3. **Questions.** ADVISORY: take the default. BLOCKING: answer from spec, ADR or code when
   possible (`RESOLVED (orchestrator-proposed)`); otherwise escalate.
4. **Tier C:** escalate the plan for approval and move on (unless already approved).
5. **Implement** on `rb/<id>-<slug>` (a worktree in parallel mode) with `rb-implementer`.
6. **Mechanical check** by the orchestrator: Verification commands; UI-touching tasks also run E2E
   when a browser is available (else `rb:needs-local` note, not a failure); compare against the
   baseline and the known-failures ratchet; reconcile changed files with the report.
7. **Recompute tier** with `rb risk` on the real diff; if it rose to C, escalate before review.
8. **Collapse** to one commit; record the head SHA.
9. **Verifier** (all tiers). **Blind auditor** (B and C). **Security reviewer** (when flagged).
   Any finding from any of them is a kickback; budget 2 shared; then `rb:blocked` + escalation.
10. **Push and PR** via `rb gh pr-create` with the template; labels `rb:tier-<x>`, `rb:pr-open`.
11. Tier A/B: the PR enters the merge train. Tier C: waits for the human.
12. Update tasks.md status and decision log, timing, LESSONS for real gotchas.

The orchestrator never edits code to fix findings, never verifies its own work, and never merges
outside `rb merge-gate`.

## 13. Safety model

Layers, from strongest to weakest:

1. **GitHub side.** `rockbuilt-ci` (verification, secret scan with gitleaks, a warning on
   harness-file changes; it runs on PR open, push and reopen, not on label changes), branch protection when available, and `rb merge-gate` as the only merge path.
2. **Permissions** in `.claude/settings.json` (and `.cursor/cli.json`): narrow allow rules; deny
   `Read(./.env*)`, force pushes, `reset --hard`, `git clean`, `rm -rf` variants,
   `git checkout -- .`, `git restore .`, `npm exec`, `npx -y` of unknown packages is not allowed
   by default.
3. **Guard hook** (`tools/rockbuilt/guard.mjs`, one script, payload normalizers for Claude Code,
   Cursor and Codex). Rules:
   - Everyone: no push to the default branch, no force push, no `git push --all/--mirror`, no
     reading `.env*` through shell commands (`cat`, `less`, `type`, `Get-Content`, `node -e`
     readers mentioning `.env`).
   - Write roles (rb-implementer, rb-e2e-writer): deny any command that mentions `git` or `gh`
     as a word anywhere (catches `node -e`, `npm exec -c`, `cmd /c`, `pwsh -c`, `bash -c`),
     deny shell writes to protected paths (`.claude/`, `.cursor/`, `.codex/`, `.agents/`,
     `AGENTS.md`, `CLAUDE.md`, `tools/rockbuilt/`, `.github/`, `.env*`).
   - Read-only roles (scout, planner, task-reviewer, verifier, auditor, security-reviewer,
     healer): **allowlist**. Only read commands (`ls`, `cat` of non-secret files, `rg`, `grep`,
     `find` without `-exec`/`-delete`, `head`, `tail`, `wc`), read-only git (`status`, `diff`,
     `log`, `show`, `rev-parse`, `ls-files`, `merge-base`, `blame`; `grep` without
     `-O`/`--open-files-in-pager`), test runners (`npm test`, `npm run test*`, `npx playwright
     test`, `node --test`, `pytest`, `npm audit`), and for the verifier only `git restore
     <single tracked file>`, plus the exact commands declared under `## Verification` and `## E2E`
     in AGENTS.md. Everything else is denied, including interpreters with `-e`/`-c`. rb-auditor
     may also Write, only under `.rockbuilt/audit/` (symlinks resolved, a symlinked audit dir is
     refused).
   - Every subagent: no Edit/Write on protected paths (symlinks resolved with realpath; `.git/`
     and `.husky/` included, since their hooks and config run with the orchestrator's
     credentials), no `rb merge-gate`, `rb gh`, `rb lock`, `rb control`, `rb digest`. rb-verifier
     may Edit existing files only (no Write).
   - Everyone, the main session included: no `.env*` or `*.env` through Read, Grep or Glob, and no
     deploy or cloud CLI that can spend money or change live systems (`vercel` outside `dev`,
     `netlify deploy`, `fly deploy`, `wrangler deploy`, `supabase db push` or anything `--linked`,
     `aws`, `gcloud`, `az`, `heroku`, `terraform apply`, `pulumi up`, also through `npx`, `pnpm
     dlx`, `npm exec`). Those are tier C escalations.
4. **Agent instructions.**

The guard is a tripwire, not a sandbox. It must never be the only thing preventing harm.

**Known limit: one identity.** In cloud routines the orchestrator acts with the owner's GitHub
token, so anything the human can do on GitHub (add `rb:approved`, comment an answer, pass
`--human-approved`), a misbehaving orchestrator could also do. The harness reduces it (markers on
every harness comment, `--human-approved` only when the human asked in the current conversation,
the digest records every human-approved merge, `rb:approved` is added by a skill only when the
human approves in the current conversation, with a comment quoting their words) but cannot
remove it without a separate bot identity for the harness (roadmap).

## 14. Costs

Anything that may cost money is tier C and is asked first, with an estimate:
paid APIs or SDKs, new third-party services or accounts, infrastructure, paid plan upgrades
(including GitHub Pro), and running E2E or evals against paid endpoints. Tests and CI use mocks
for paid services. Evals that call a paid model run only after the user approves a budget, recorded
in AGENTS.md `Paid services`. GitHub Actions on a free private repo has a monthly free quota; when
exhausted, Actions stop (no charge unless the user set a spending limit). `rockbuilt-ci` runs on
PR open, push and reopen only (not on label changes) to save minutes. `rb doctor` warns when the
repo has deploy config (`vercel.json`, `netlify.toml`, `fly.toml`, `render.yaml`, `wrangler.toml`):
if the host deploys the default branch on push, every automatic merge reaches production, so the
user should confirm previews or choose `Autonomy: supervised`.

## 15. Spec, tasks and plan formats

Unchanged from v0.2 except:

- **requirements.md**: EARS criteria with IDs `R<n>.<m>` and verification tags `[unit]`,
  `[integration]`, `[e2e]`, `[eval]`, `[manual]`; header `Status: draft | approved | Date: ...`.
- **design.md**: traced to requirements; Mermaid; workflow vs agent; data; interfaces; errors;
  security; testing; alternatives.
- **tasks.md**: blocks `## T<n>: title` with `Purpose`, `Covers`, `Size`, `Depends on`, `Files`,
  `Verify`, `Issue`, `Status`, `### Decision log`. `rb tasks` is strict: unknown keys or statuses
  are errors (it accepts Spanish synonyms: Estado, Cubre, Tamaño, Depende de, Archivos, Verificar,
  and statuses hecho, pendiente, en progreso, en revisión, bloqueado).
- **Plan** (issue comment): marker `<!-- rockbuilt:plan base=<sha> tier=<x> -->`; sections
  Summary, Acceptance criteria, Size, Affected files, Claims this change falsifies, Data / schema
  impact, **Risk and cost** (tier and reasons; any cost with an estimate), Implementation steps,
  Testing approach, Risks, Verified facts, Open questions, Follow-ups, Out of scope.
- Ids: `T<n>` tasks, `B<n>` bugs, `i<n>` standalone issues, `L<n>` local bugs without GitHub.
  Branches `rb/<id>-<slug>`.

## 16. Rigor ladder

| Change | Path |
|---|---|
| New project | rb-kickoff, rb-spec (human approves), then rb-cycle runs tasks, build, merge |
| New feature | rb-spec (human approves), then autonomous |
| Prototype or demo with a deadline | `Mode: prototype` in the issue: no spec, verifier and auditor still run, tier rules still apply |
| Bug | rb-fix (reproduction first; manual reproduction with evidence when automation is impossible) |
| Small bounded change | an `rb:task` issue; the cycle takes it |
| Refactor | short spec with "behavior unchanged" |

## 17. Baseline ratchet

`rb baseline` runs the Verification commands and records per-command exit codes and counts
(parsed from common runners). `docs/rockbuilt/known-failures.json` lists failures accepted as
pre-existing (written by rb-adopt with the user's agreement, or by `rb baseline --accept`). A run
is green when no failure outside that list appears. The list may only shrink automatically; adding
to it is tier C. In worktrees, `rb` reads the baseline of the main checkout
(`git rev-parse --git-common-dir`).

## 18. Portability

| Capability | Claude Code | Cursor | Codex (experimental, untested) |
|---|---|---|---|
| Contract | CLAUDE.md -> @AGENTS.md | AGENTS.md | AGENTS.md |
| Skills | .claude/skills | .claude/skills | .agents/skills |
| Agents | .claude/agents | .claude/agents (`readonly` honored) | .codex/agents/*.toml (generated) |
| Guard | .claude/settings.json hook | .cursor/hooks.json (`failClosed`) | .codex/hooks.json |
| Permissions | .claude/settings.json | .cursor/cli.json | sandbox + rules (manual) |
| MCP | .mcp.json | .cursor/mcp.json | .codex/config.toml |
| Unattended | Routines | Cloud Agents automations | codex exec |

Where a tool cannot enforce a rule, `rockbuilt-ci` and `rb merge-gate` are the enforcement.

Known limit: the guard learns the role from the hook payload (`agent_type`) in Claude Code. Cursor
and Codex do not send it, so role rules there apply only when the session sets `ROCKBUILT_ROLE`;
otherwise the guard applies the rules that hold for everyone.

## 19. Verify gates, memory, retro

As in v0.2: rb-verify runs security, E2E (1 happy path and 2 failure cases per flow, Playwright,
spec-derived) and evals (dataset with ground truth, code graders first); it never writes app code.
progress.md, decision logs, ADRs and LESSONS are the memory. rb-retro sorts findings into project
gotcha, project config or harness problem and files harness problems on ragarciaga/rockbuilt.
Exception for cloud runs: E2E that needs a browser the environment lacks becomes `rb:needs-local`.

## 20. Evidence log

1. 2026-10-09, v0.1 live eval: `fix` without GitHub skipped planner and verifier and verified its
   own work. Fixed by degraded mode: losing a tool never removes a gate.
2. 2026-10-09, cloud probe: `gh pr view`, `gh label list`, `gh pr create` fail with "GitHub
   GraphQL is not available from Claude Code sessions". REST via `gh api` works for issues,
   labels, comments, PR create, PR merge, check-runs. Git data API writes (refs, blobs, trees) are
   blocked; branch pushes via git work; tag pushes are blocked.
3. 2026-10-09, cloud probe: branch protection API returns "Upgrade to GitHub Pro or make this
   repository public" on the user's free plan; native auto-merge is not allowed.
4. Docs (code.claude.com/docs/en/cloud-environments): plugins declared in project settings are not
   installed in cloud sessions; repo `.claude/skills`, `.claude/agents`, hooks in
   `.claude/settings.json` and `.mcp.json` are part of the clone and load.
5. Docs (routines, permission modes): routines run without approval prompts; content-matched ask
   rules have no prompt to fall back to and are denied; deny rules apply. Routine GitHub triggers
   cover pull_request and release only; schedules have a 1-hour minimum.
6. 2026-10-09, devil's advocate review of v0.2: guard bypasses through `node -e`, `npm exec -c`,
   `cmd /c`, `pwsh`; scout could run `git restore .`; `Bash(npm *)` allowed everything; no deny on
   reading `.env`; dependencies only counted done after `/rockbuilt:merge`; worktree baselines
   compared against themselves; tasks.md parser silently ignored Spanish keys.
7. v0.2 live eval: adopt installed a template CLAUDE.md and recorded a false red baseline.
8. 2026-10-09, devil's advocate review of v0.3 (confirmed by running code): the paid-SDK check
   whitelisted every SDK named in the vendored `tools/rockbuilt/lib/risk.mjs`; tests and evals
   could import paid SDKs at tier A; `docs/rockbuilt/known-failures.json` and spec requirements
   were tier A/B; `scripts`/`overrides` in package.json escaped the dependency floor; bookkeeping
   accepted renames into bookkeeping paths and omitted patches; `.git/hooks` was writable by the
   implementer; a commit status could stand in for CI; harness comments without markers could be
   read as human answers; deploy CLIs were not blocked.
9. 2026-10-09, second review of v0.3 (confirmed by running code where noted): `rb baseline
   --check` on a task branch reused the cached default-branch result and never ran the branch
   code (confirmed); an approving answer made the plan stale, so tier C looped every night;
   uncommitted bookkeeping edits (task claim, LESSONS) raised every task to B or C (confirmed);
   the CI harness-file step failed every bookkeeping PR that touched LESSONS; the auditor could
   pass with no UI criterion observed because nobody started the app; a `needs-local` audit
   left the PR stuck; dead runs left `rb:in-progress` forever; package scripts, `pnpm exec`,
   `yarn <bin>`, `.bin` paths, prisma/drizzle push and stripe escaped the cost guard (confirmed);
   CI used the npm cache without a lockfile; the cycle never ran feature verification; escalations
   produced no notification because GitHub does not notify the owner of his own token's actions.
10. 2026-10-09, live test on a private sandbox repo (ragarciaga/rockbuilt-sandbox), real GitHub
   and real Actions: tier A and B PRs merged through `rb merge-gate` only after green
   `rockbuilt-ci`; a push after review was refused (`stale-head`); a B label hiding a dependency
   and a ratchet change was refused as C; a bookkeeping PR merged and one injecting a task was
   refused; `rb revert` opened a human-only PR. Two unattended `/rb-cycle` runs with
   `--permission-mode dontAsk` (closest local stand-in for a routine): night 1 built a spec task
   (B, one verifier kickback for surviving mutants, blind audit) and an `rb:task` issue (A),
   merged both, opened bookkeeping and posted the digest (9 min, about USD 2.83 at API prices);
   night 2 merged that bookkeeping at start and ran feature verification (security found a real
   `__proto__` category bug), about USD 1.07. Found and fixed: the label-filtered issue list lags
   3 to 6 s (stop switch now also reads the control issue directly); `gh auth status` fails with
   the cloud's proxied token while REST works (doctor falls back to the API); the orchestrator
   wrote `R="node tools/rockbuilt/rb.mjs"; $R ...`, which matches no permission rule (skills now
   require literal commands); `echo`, `npm audit` and other read-only commands were missing from
   the allow list; a local headless run ignores project permissions until the folder is trusted.

## 21. rb command interface (binding for skills and the CLI)

All commands: `node tools/rockbuilt/rb.mjs <cmd> ...`, `--json` for machine output, exit 0 ok,
1 error, 2 usage, 3 "not eligible / not allowed" (decision commands).

| Command | Purpose |
|---|---|
| `vendor [--tools claude,cursor,codex] [--type web,ai,automation] [--lang es] [--from <harness root>]` | Install or update the harness in the current repo (section 3.2). `init` is an alias |
| `doctor` | Environment and contract checks, including protection mode (`github` or `rb-only`), CI presence, harness version |
| `verify-cmds [Verification|E2E|Evals|Setup]` | Commands parsed from AGENTS.md (fallback CLAUDE.md) |
| `baseline [--check] [--accept]` | Run Verification, ratchet against docs/rockbuilt/known-failures.json; `--accept` adds current failures (tier C, human) |
| `tasks <spec-dir>` | Parse tasks.md strictly (Spanish synonyms accepted), coverage vs requirements |
| `parallel <spec-dir> [--ids] [--max]` | Disjoint batches |
| `worktree add|remove|list` | As in v0.2 |
| `timing start|end|report [--write]` | As in v0.2 |
| `risk [--pr <n>] [--base <ref>] [--files a,b] ` | Tier from a diff: `{"tier":"A|B|C","reasons":[{"rule","path","detail"}]}` |
| `sync` | Mark tasks done from merged PRs (via issue marker or branch name), clean merged local branches, repair labels |
| `gh <op> [flags]` | REST GitHub layer, ops below |
| `merge-gate <pr> --run <id> \| --human-approved [--dry-run]` | Section 8. `--run` must match the lock holder. `--human-approved` allows tier C and human-only kinds only when the human asked in the current conversation |
| `revert <pr>` | Create branch `rb/revert-<pr>`, `git revert` the merge commit, push, open PR labelled `rb:tier-c`, `rb:needs-human` |
| `control ensure` | Find or create the control issue, print its number |
| `lock acquire --run <id> | release --run <id> | status` | Lock on the control issue (3 h staleness) |
| `stop status` | Exit 3 when the stop switch is on, 0 otherwise |
| `escalate <issue> --kind human|local --title <t> --body-file <f>` | Label + comment, never waits |
| `digest post --file <md>` | Append the run digest to the control issue |
| `protect` | Configure required checks when the plan allows it; otherwise explain and exit 3 |
| `labels` | Create the `rb:*` labels that are missing (same as `rb gh labels-ensure`) |

`rb gh` ops (all print JSON): `issue-create --title --body-file [--label a,b]`,
`issue-edit <n> [--body-file] [--title] [--state open|closed]`, `issue-comment <n> --body-file`,
`issue-view <n>` (includes comments and author_association), `issue-list [--label a,b] [--state]`,
`label-add <n> <labels>`, `label-remove <n> <label>`, `labels-ensure`,
`pr-create --head --base --title --body-file [--label a,b] [--draft]`, `pr-view <n>`,
`pr-list [--state] [--head-prefix rb/]`, `pr-files <n>`, `pr-comment <n> --body-file`,
`pr-update-branch <n>`, `checks <sha>`, `whoami`, `protection`. Optional `--repo owner/name`.

Labels (exact): `rb:task`, `rb:skeleton`, `rb:bug`, `rb:blocked`, `rb:in-progress`,
`rb:pr-open`, `rb:tier-a`, `rb:tier-b`, `rb:tier-c`, `rb:needs-human`, `rb:needs-local`,
`rb:approved`, `rb:hold`, `rb:stop`, `rb:running`, `rb:control`.

PR body machine lines (each on its own line):
`<!-- rockbuilt:status stage=rb-verifier task=<id> outcome=pass head=<sha> -->`,
`<!-- rockbuilt:status stage=rb-auditor task=<id> outcome=pass head=<sha> -->`,
`<!-- rockbuilt:status stage=rb-security-reviewer task=<id> outcome=pass head=<sha> -->`,
`<!-- rockbuilt:security required -->` when the security review applies,
`<!-- rockbuilt:tier <A|B|C> -->`.

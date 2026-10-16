# Changelog

## 0.9.0 (2026-10-16)

The merge queue, and evals for the autonomous path (issue #19 item 1; DESIGN 8.4).

- **Merge queue.** With two or more ready PRs, `rb queue build --run <id> --prs a,b,c` merges them
  onto the default branch tip and pushes every step (base plus PRs 1..i) as its own `rb/queue-*`
  branch, so CI tests all steps at once (the project workflow now runs on push to `rb/queue-*`).
  `rb merge-gate` merges each in order, and accepts a queued PR behind its base only when GitHub's
  own test merge of it has exactly the tree of its tested step; after the squash it checks the
  landed tree again (a mismatch is a STOP: revert). Stacked PRs are not queued. A PR updated
  meanwhile, a merge from outside the queue, or a red step fall back to the serial train. Before,
  every merge left the other PRs behind and each paid a full CI run one after another.
- **Evals with a GitHub simulator.** `evals/tools/fake-github.mjs` answers `rb` as `gh api` does,
  backed by the workspace's real bare origin for commits, squash merges and update-branch. New
  scenario `cycle-queue-merge`: a cycle with two ready PRs must queue them and merge both without
  updating either. The merge train, the queue and the lock no longer depend on a real project's
  night to be tested.
- `RB_GH_REPO` names the repo when origin is not a GitHub URL (the simulator).
- **Guard:** a shell variable or alias standing for `rb`, `git` or `gh` (`R="node tools/rockbuilt/rb.mjs"; $R ...`) is denied for everyone. The skills already forbade it, and the queue eval showed the orchestrator doing it; unattended permission rules only match literal commands.
- Updating an existing project brings the new workflow trigger with `rb vendor`.

## 0.8.0 (2026-10-16)

Quality gates that do not depend on the agent following prose, and a quality number beside the
speed numbers (issues #17 and #19, eval `build-tier-c-escalates`; DESIGN 20.18).

- **Tier C plans get their security read, checked by `rb`.** The security read now runs before the
  plan's open questions are escalated, its verdict is posted on the issue with a `mode=plan` line,
  and `rb escalate --kind human` refuses a tier C plan without it. 0.6.0 and 0.7.0 escalated the
  question and skipped the read.
- **`rb quality`**: merged task PRs, kickbacks by source (an auditor kickback is a defect the
  verifier passed, a CI one a defect every local check passed), reverts, and bugs traced to merged
  PRs (`Introduced by #<pr>`, which rb-fix now adds). In the digest (7 days) and the retro. PR
  bodies carry a `rockbuilt:kickbacks` line.
- **Goal gate in `/rb-verify`.** The blind auditor in `Mode: goal` gets only the product goal, the
  brief's users and the requirement statements, and walks the finished feature as that user.
  Every criterion can pass while the feature misses why it was built.
- **Task size limits** in `rb tasks`: at most 8 files and 4 criteria per task, and `Size: L` only
  with its reason. The planner keeps plans under about 12,000 characters and proposes a split
  instead; the orchestrator saves each plan and report to `.rockbuilt/plans/` and
  `.rockbuilt/reports/` as soon as it returns.
- **The lock renews.** The same run calling `rb lock acquire` renews it after 30 minutes (the cycle
  does it before every item), and `merge-gate --run` renews its own lock if it went stale. Time
  budgets use `runMinutes` (run age), not the age of the last renewal. (3d_brain: stale at 189 min.)
- **`rb gh pr-line <pr> --line "<line>"`** replaces one machine line (same stage, or same kind) in
  a PR body, and `rb gh pr-edit <pr> --body-file <f>` replaces the body.
- The implementer's evidence pass runs a touched entry point exactly as the README or `## Run`
  documents it (3d_brain: tests green, documented command broken).
- Not here: PRs behind only on documentation still update and re-run CI. Instead of exempting file
  types one by one, 0.9.0 adds a merge queue that tests the combination once.

## 0.7.0 (2026-10-15)

From the 3d_brain run on 0.6.0, the session's own list of where the time went (DESIGN 20.17).

- **The gate no longer sends a PR back for bookkeeping.** A task PR behind `main` only because a
  bookkeeping PR merged (tasks.md status, progress.md, LESSONS.md, none of them in the PR) merges
  as it is. Behind on code: update the branch, as before. In 3d_brain this was about 45 minutes in
  one run.
- **Identity confirmation without an agent.** After an update that changed nothing in the task,
  `rb review-delta --reviewed <sha> --line --task <id>` prints the verifier line; no verifier is
  dispatched. CI on the new head still runs the tests, and the gate now checks `identical-to`
  through GitHub even on tier A.
- **`rb sync` keeps the run's own claims.** With the lock held it only clears `rb:in-progress`
  labelled before this run took the lock (it was clearing claims the same run had just made).
- **No more "one commit per PR".** The branch is collapsed before the first push; after that each
  fix is one commit on top (the merge squashes). A fix never needs a force push or a new PR.
- **Bookkeeping is saved as the run goes.** `rb bookkeeping save` pushes tasks.md, progress.md and
  LESSONS.md to the day's `rb/bookkeeping-<date>` PR from a temporary worktree after every item;
  `--final` at run end also leaves the checkout clean. `rb bookkeeping carry` replaces the manual
  patch of the previous day's PR. A session that dies, or a cloud stop hook asking for a commit,
  no longer puts them at risk.
- **The auditor's verdict is kept** on the task issue (`<!-- rockbuilt:audit task=<id> head=<sha>
  -->`), so a re-audit in a later session starts from it instead of redoing every criterion.
- **Tries before `needs-local`.** The cloud's preinstalled Chromium
  (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`, which E2E configs written by the harness now
  read), installing a tool the project names from pip or npm without sudo, and
  `raw.githubusercontent.com` when the proxy blocks `github.com/.../raw/`.
- Removed: the verifier's identity mode and the `git merge -s ours` allow rule (both now inside
  `rb`).
- Not done, on purpose: a `comments-only` class in review-delta (`gitleaks:allow`,
  `eslint-disable` or `@ts-ignore` change what is checked), force push on `rb/*` branches, and
  merging a PR behind on code (the squash would put an untested combination on `main`).

## 0.6.0 (2026-10-15)

From the 3d_brain write-up after its 0.5.0 nights (DESIGN 20.16). Mostly time.

- **Local E2E runs only what the task touched.** Implementer, verifier and the mechanical check
  run the specs the diff adds or changes, or the task's Verify names, through
  `rb verify-cmds E2E --only <specs> [--grep "<titles>"]`. The full suite is CI's job.
- **Reviews carry forward by content** (DESIGN 8.3). `rb review-delta` now compares the files the
  task touched at both heads: `identical`, `test-only` or `different`. A squash-merged stacked base
  no longer reads as "different". After a kickback that changed only tests, the auditor and
  security keep their result (`app-identical-to=<sha>` on the verifier line); the gate re-checks
  the class through GitHub with blob shas.
- **Security review of the plan** (`Mode: plan`) for tier C and personal-data plans, before
  implementation: every RESOLVED decision is checked against the requirements.
- **Every stage is timed**, `kickback` included; `rb timing line <id> --pr <n>` adds CI waits,
  re-reviews and the merge to the PR's line; the digest has a minutes-per-phase table.
- **Auditor time budget** (about 5 min per criterion, 25 in all) and scoped re-audits (failed
  criteria plus those the change can reach).
- The verifier separates `Report corrections` (a wrong count, fixed in the PR body) from false
  claims about behavior (still a kickback).
- Mutation probes break production code, never a test's predicate; transient UI states are read
  once with the request held in the mock (agents and the e2e reference).
- One bookkeeping PR per day, updated by later runs; the previous bookkeeping patch is applied
  before `rb sync` edits tasks.md (the "does not match index" failure).
- Guard: `git` spelled with spliced quotes or escapes (`g''it`) is denied for write roles.
- `rb flaky record <test> --pr <n>` / `rb flaky list`: flaky candidates on the control issue for
  the retro, never skipped.

## 0.5.0 (2026-10-14)

From the 3d_brain nights of 2026-10-14 (DESIGN 20.15).

- **E2E in shards.** The header `E2E shards: <1-8>` in AGENTS.md (default 1) splits the Playwright
  suite into that many CI jobs (`--shard=i/n`), each with its own 30 min limit. A plan job reads
  AGENTS.md and the `rockbuilt-e2e` job keeps the single check name: green only when every shard
  is. New `rb e2e-plan` and `rb verify-cmds E2E --shard i/n`. Public repos run Actions free; on a
  private repo each shard repeats setup and spends more Actions minutes.
- **Light re-review after update-branch** (DESIGN 8.3). `rb review-delta` checks that the task diff
  against the new base is byte-identical to the reviewed one; then only the verifier runs, in
  identity mode (full Verification, no mutation probe), and its line carries `identical-to=<old
  head>`. The gate accepts the auditor and security lines on that old head only after confirming
  the identity itself through the GitHub compare API. Any difference: full re-review.
- With an `## E2E` section the gate also requires a successful `rockbuilt-e2e` check run (shard
  jobs start late; "every present check is green" could be read before they exist).
- `rb gh` rejects unknown flags instead of ignoring them; `issue-edit` takes `--add-label` and
  `--remove-label`.
- `rb gh pr-create` adds `rb:tier-x` from the body's `<!-- rockbuilt:tier X -->` when `--label`
  has no tier, and refuses a lower one.
- `rb sync` reads the spec from the closed task issue when an id (T1, T2...) exists in several
  specs, and never deletes the local branch of an open PR (it used `git branch -d`, which also
  accepts a branch merged into its own upstream). The PR template repeats the task marker.
- The auditor never runs in the directory the verifier is mutating: after it, or in its own
  detached copy (`audit.md`, "Own copy").

## 0.4.0 (2026-10-13)

- **Your hours, per project, feature and task (`rb hours`).** A base to cost hours and an ROI
  (DESIGN 22). It measures attention, not sessions: each prompt in a project session (a
  `UserPromptSubmit` hook; time and branch only, never the text), each of your own comments on
  the repo's issues and PRs, and manual entries (`rb hours log`). Marks less than 10 min apart form
  a block with a 5 min tail; when projects overlap in time the minutes are split evenly, so two
  hours jumping between three projects add up to two. Marks survive cloud sessions on a
  `Rockbuilt hours` issue (one comment per session, edited in place by a `Stop` hook). Output:
  Markdown and CSV, with agent minutes and two baselines side by side.
- rb-spec asks the owner for the feature's baseline hours at requirements approval
  (`Baseline: <h> h`); the planner adds a Human estimate per task, carried as `est=` in the PR
  timing line (`rb timing line <id> --est <h>`).
- `Hours: github | local | off` in the AGENTS.md header. Use `local` in a client's or a public
  repo: the hours issue shows timestamps and branch names to anyone who can see the repo.
- `/rb-status` answers "reporte de horas" and logs manual time on request.
- Routine prompts end with `[rockbuilt:unattended]` (nightly: `Run /rb-cycle. [rockbuilt:unattended]`;
  also the PR-audit prompt), so they do not count as your time. Update existing routines.

## 0.3.4 (2026-10-13)

- **Timing survives cloud sessions.** The timing log is local and gitignored, so a cloud project
  showed an empty timing table. Every task PR now carries a timing machine line
  (`rb timing line <id>`), and `rb timing report` rebuilds the table from progress.md, the rb/* PR
  bodies on GitHub and the local log, the freshest source winning (DESIGN 20.13).
- `/rb-build` always publishes the bookkeeping PR at run end when tasks.md, progress.md or
  LESSONS.md changed; it used to wait for the user's yes, and a cloud session lost them.

## 0.3.3 (2026-10-10)

First night of the real scheduled routine (DESIGN 20.12): it fixed and merged a bug on its own.
Fixes for what it reported:

- Bookkeeping PRs are exempt from the `behind` check (docs only, checked line by line).
- rb-fix passes `Reproduction commit: <sha>` to the verifier, which needs it after the collapse.
- `rb timing` accepts the `audit`, `ci` and `merge` stages, and `report --write` keeps rows from
  earlier runs (a fresh cloud clone has no local timing log).
- `rb doctor` checks "Automatically delete head branches"; kickoff, GUIA and CLOUD ask to turn
  it on (cloud sessions cannot delete remote branches or change repo settings).

## 0.3.2 (2026-10-09)

Final review against trail-blazer-flow (DESIGN 20.11):

- **Gate refuses PRs behind the base.** Without branch protection GitHub reports `clean` or
  `unstable` for a PR that is behind (confirmed live), so the gate compares the head with the base
  tip; the merge train updates the branch and re-reviews.
- **Guard: no `git -c`, `--config-env`, `--exec-path` or `git config` writes, for everyone.**
  Closes alias and hook bypasses that could push to main or deploy.
- **Bookkeeping content rules:** LESSONS appends only at the end, one hunk, at most 40 lines; no
  HTML comments in any bookkeeping file.
- **`rb gh` retries a GET once** on 5xx, 429 or no status; writes are never retried.
- `/rb-cycle` treats an unreadable stop switch as on; docs/GUIA.md documents `rb:hold` as the
  per-PR veto.

## 0.3.1 (2026-10-09)

- **Cloud front doors.** `.claude/skills/rb-kickoff` and `.claude/skills/rb-adopt` in this repo
  point to the real skills in `harness/skills/`. In a cloud session with an empty project repo
  and `ragarciaga/rockbuilt` attached, "arranquemos un proyecto" or "adopta este repo" now starts
  the right skill; before, nothing loaded because cloud sessions do not install plugins (tested
  with a headless session and `--add-dir`). The selfcheck keeps their frontmatter identical to
  the source.
- The maintainer guide (`.claude/CLAUDE.md`) now says it applies only to changes to this repo, so
  a project session with Rockbuilt attached follows the project's AGENTS.md.
- `/rb-kickoff` and docs/GUIA.md: in the cloud, create the repo with a README and give the Claude
  GitHub app access to it before the session.

## 0.3.0 (2026-10-09)

Autonomy release: the harness plans, builds, audits and merges on its own, and pulls the human in
only for design decisions, anything that costs money, and sensitive or irreversible changes.
Evidence for each decision is in DESIGN.md section 20.

Second review and live test (DESIGN 20.9 and 20.10):

- `rb baseline --check` on a task branch or worktree now runs that code (it used to reuse the
  cached default-branch result) and ratchets against the default branch's known failures.
- Tier C no longer loops: an approving answer and bookkeeping commits never make a plan stale.
- `rb risk` ignores uncommitted bookkeeping (task claims, lessons), so tasks keep their real tier.
- The orchestrator starts the app (new optional `## Run` section) for the blind auditor, which
  never passes an unobserved UI criterion; a `needs-local` audit merges with `--human-approved`.
- `rb sync --run` clears claims left by a run that died; `rb doctor` warns about deploy config
  and `npm ci` without a lockfile, and checks GitHub through the API when `gh auth status` fails.
- Cost guard covers package scripts, `pnpm exec`, `yarn <bin>`, `.bin` paths, prisma and drizzle
  pushes, stripe; hosts in config files count; SVG namespaces and `striped.css` no longer do.
- `/rb-cycle` runs feature verification (rb-verify) when a spec is done; the final report's first
  line says what waits for the owner, and docs/CLOUD.md turns on the routine's notifications.
- CI: no re-runs on label changes, npm cache only with a lockfile, harness files warn instead of
  failing (the gate already makes them tier C). Stop switch reads the control issue directly.
- Skills require literal commands (no shell variables for `rb`), and the allow list covers the
  read-only commands unattended runs use.
- Live test on a sandbox repo: two unattended nights built, audited and merged a tier B spec task
  and a tier A issue, merged bookkeeping and ran feature verification.

Hardening from the independent review (DESIGN 20.8), all with tests:

- Cost floor: paid SDKs, hosts and secret-like env vars are scanned in every code file (tests and
  evals included); the base lookup ignores the vendored harness and prose; `Paid services` match
  exact service keys; more SDKs (LangChain providers, Groq, Together, Pinecone, Deepgram, fal);
  large patches GitHub omits are tier C.
- Dependency floor: package.json `scripts`, `overrides`, `resolutions` and friends, every
  lockfile and other manifests are tier C. So are the known-failures ratchet, spec requirements,
  the brief, `.npmrc`, gitleaks config and `.husky/`.
- Merge gate: CI evidence must be a `rockbuilt-ci` check run from GitHub Actions; bookkeeping PRs
  are in-place edits only (task status and decision-log lines in tasks.md, append-only LESSONS);
  revert PRs are human merges.
- Guard: `.git/` and `.husky/` are protected; the verifier may only Edit; Grep and Glob cannot
  reach `.env` files; deploy and cloud CLIs (also via npx and dlx) are blocked for everyone.
- Every harness comment carries a marker, so only unmarked trusted comments count as answers; the
  control issue rotates before the comment paging limit.
- Vendoring never writes the adapter README over the project README nor an existing
  `.codex/config.toml`; doctor, status and adopt treat a template AGENTS.md as missing.

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

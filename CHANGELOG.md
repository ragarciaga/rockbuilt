# Changelog

## 0.13.1 (2026-11-11)

"Update rockbuilt" now finishes the project-side steps of 0.12.0 and 0.13.0 instead of leaving
them to the CHANGELOG.

- After vendoring, the update runs `rb doctor`. When CLAUDE.md lacks the routing line, it appends
  that one line under `## Claude Code notes` in the same PR (the only project file an update
  touches, and it only adds). When branch protection is off and free, it runs `rb protect` on
  your yes; when it needs GitHub Pro, it asks and records a refusal in the AGENTS.md header.
- It does this even when the harness files are already current, so a project updated to 0.12.0
  or 0.13.0 by hand gets them on the next "update rockbuilt".

## 0.13.0 (2026-11-11)

The harness can no longer stay off in a project, and branch protection can no longer stay off
silently (#54, #64). Two small fixes (#61, part of #56).

- **Kickoff never defers the harness (#54).** "Activate it after the first version" now becomes
  `Autonomy: supervised` from day one (every PR waits for you) instead of a line in the brief
  nobody acts on. `/rb-adopt` also covers a project kicked off with Rockbuilt and never vendored.
- **Branch protection is on, or declined on record (#64).** Kickoff and adopt run `rb protect`
  when it is free (public repo or paid plan) and ask when it needs GitHub Pro. A refusal goes in
  the AGENTS.md header as `Branch protection: declined (<date>, <reason>)`. Until then `rb digest
  post` ends every digest with it as a standing item, decided by code, and `rb-status` lists it
  under "Needs you". `rb doctor` shows a recorded refusal as a decision, not a warning.
- **Deploy configs (#56).** `railway.json`, `railway.toml` and Compose's own `compose.yaml` /
  `compose.yml` are tier C, like `docker-compose*`, and `rb doctor` lists Railway among the hosts
  that may deploy every merge. The post-deploy check itself stays open in #56.
- **README badge (#61).** It said 0.3.4 for eight releases; the selfcheck now compares it with
  plugin.json.
- Update a project with `rb vendor`.

## 0.12.0 (2026-11-11)

Small changes asked in a chat get a fast path that still reviews them (#55, #63). Before, a
20-line change either paid the whole build loop (planner, implementer, verifier, auditor, about
300k to 450k tokens and one CI run per task) or skipped every review.

- **`/rb-quick`.** For small changes the owner asks for in a session. One batch issue
  (`rb:task` + `rb:quick`) and one branch hold the requests. The session implements them itself,
  with no planner and no implementer dispatch. After every change the Verification commands run,
  judged by exit code, plus `rb secrets` and `rb risk`. When the batch is finished, one verifier,
  one blind auditor (tier B) and, when the diff requires it, one security review check the whole
  batch. Nothing is reported as done before that review passes; then the PR and the merge go
  through `rb merge-gate` as usual.
- **Limits decided by code.** `rb risk --json` returns `quick: { eligible, reasons, limits }`: tier
  C, more than 400 changed lines or more than 12 files is not quick. Tier C goes to `/rb-build`
  and waits for your approval. The gate refuses a PR marked `<!-- rockbuilt:quick -->` whose live
  diff left the limits, even with `--human-approved`.
- **Routing.** The project CLAUDE.md template says that every request that changes a file goes
  through a skill, also in a chat. `rb vendor` does not rewrite an existing CLAUDE.md, so `rb
  doctor` warns when the line is missing and prints it: copy it into your CLAUDE.md.
- `rb-status` lists open quick batches that nobody has reviewed yet. New label `rb:quick` (`rb
  labels` creates it). The verifier knows `Mode: quick`: the issue's criteria are the plan, and
  any change no criterion asks for is a finding.
- Update a project with `rb vendor`, then `rb labels`, and add the routing line `rb doctor` prints.

## 0.11.1 (2026-11-01)

Two guard weaknesses the 2brain-logic security reviewer found; both predate 0.11.0.

- **Wildcard refspecs (#51).** `git push origin refs/heads/*:refs/heads/*` could update the default
  branch without naming it. The guard now denies any wildcard refspec, reads `heads/main` as main,
  and denies a push without a branch name when `push.default=matching` or a `remote.<name>.push`
  refspec is configured. It also denies the matching refspec `:`, a refspec that starts with `-`,
  `git --git-dir= / --work-tree=` with push, and any `GIT_*` variable set or exported in front of a
  command (`GIT_DIR`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`...: a `git -c` the guard could not
  see). Branch protection on GitHub (`rb protect`) still covers the server side.
- **Secret scan on push runs nothing from the repository (#52).** The scan's git calls use
  `--no-textconv --no-ext-diff`, `core.fsmonitor=false` and no pager, so a crafted
  `.gitattributes` or git config cannot run code inside the hook; signature programs
  (`log.showSignature`, `gpg.program`) are off too, and the hook scans only the session's project
  and its worktrees. No tool may write a `.git` directory or the user's git config any more, main
  session included (removing a stale `*.lock` stays allowed).
- Two rounds of independent security review found more bypasses; all are closed and each has a
  guard test: mirror remotes and `git clone --config`; a push line that also changes git's
  environment (`set -a`, `source`, `printf -v GIT_*`, indirect exports); inline code
  (`python -c`, `node -e`, `awk`) naming `.git/` or the git config; a git config reached through a
  symlink. Reads stay allowed: only the destination of cp/mv/ln and in-place sed/perl count as
  writes, and removing git's lock, rebase and merge state by hand is allowed.
- **Limit, stated plainly:** the guard reads command text. Indirection it cannot evaluate (a path
  built in a shell variable or a glob, code generated at run time) can still get past it. It
  catches mistakes; branch protection on GitHub and the merge gate are the controls to rely on.
- Update a project with `rb vendor`.

## 0.11.0 (2026-11-01)

Proportional review: a task pays for the reviewers its diff needs, once (issues #41 to #49 from
2brain-logic F4 and F5 on 0.10.0; DESIGN 20.20, 20.21 and 25).

- **Reviews carry across a base merge, decided by the gate (#43).** When an update from main leaves
  the task's files identical, `rb merge-gate` accepts the verifier, auditor and security lines on
  the old head by itself: no agent, no PR edit, only CI on the new head. `/rb-merge` and the
  interactive path no longer send the session back to the reviewers. This was the largest cost
  in F4.
- **Security review decided from the diff (#42).** `rb risk --json` gives
  `security.required` with reasons (auth and schema paths, Sensitive paths, dependencies, hosts,
  secret-like env vars, and added production lines with request input, process spawns, file
  writes, raw queries, injection sinks, uploads, auth or secrets). rb-build and rb-fix run the
  security reviewer when it says yes, the gate refuses a PR without the review when it says yes
  (reason `security`), and the planner can only add it. A pure function or a flag parser no
  longer gets one.
- **Secrets caught before the push (#44).** `rb secrets` scans unpushed commits and the working
  tree with gitleaks-shaped rules (generic-api-key with entropy, private keys, token formats,
  JWTs; `gitleaks:allow` respected). It is part of the mechanical check, and the guard denies
  `git push` while an unpushed commit has a hit, so a fixture is fixed before CI sees it instead of
  replacing the PR. The implementer builds secret-shaped fixtures from parts.
- **Minimum task size (#41).** `rb tasks` fails on two not-started `S` tasks in the same directory
  that fit one task (8 files, 4 criteria), unless one says why they stay apart
  (`Size: S (<reason>)`); never across a tier floor. The blind audit stays on every tier B task:
  F4's reviewers found real defects in small tasks.
- **Bookkeeping PRs (#45, #46).** The gate checks a bookkeeping PR against the live compare of the
  base tip and the head when GitHub's file list still shows task PRs merged after the save, so no
  manual retarget. A save with nothing new pushes nothing (it answered the cloud stop hook with a
  new commit and CI run every turn); the files stay modified until the PR merges, by design.
- **Task ids with a run prefix (#47).** The gate matches `task=F5-T14` to the spec's `T14`, and the
  reviewers write the id as tasks.md has it.
- **Safety steps are mutation-tested (#48).** The plan lists every guard, refusal or validation
  with the test that fails when it is deleted; the implementer deletes each one in its evidence
  pass and the verifier probes each one.
- **Timing records itself (#49).** `rb claim` opens the plan phase, `rb gh pr-create` closes what is
  open and opens ci, a merge by `rb merge-gate` closes the rest; explicit `rb timing` calls refine
  it and are never doubled; after a merge the gate writes the minutes into the PR's timing line.
  `rb timing report` warns about recent merged task PRs with no minutes.
- **CI uses the project's Node version** from `.nvmrc` or `.node-version` (first non-comment line,
  default 22; a pin below 20, the harness minimum, runs 22 with a warning) in every job of the
  workflow template (PR #40, merged as 0.10.1 without a release of its own; it ships here).
- **Upgrading:** an open PR whose diff now requires the security review and that never had one
  is refused with reason `security`; the merge train and `/rb-merge` run the reviewer once on its
  head and add its line. Update a project with `rb vendor`.

## 0.10.0 (2026-10-23)

Mechanical bookkeeping: the steps an interactive session skipped are now commands that the gate or
a later command checks (issues #22 to #38 from 3d_brain on 0.9.0; DESIGN 20.19 and 24).

- **Verdicts on the task issue, checked by the gate (#34).** Every verifier, auditor and security
  verdict, pass or fail, is posted on the task issue. `rb merge-gate` refuses a PR whose status
  line has no matching trusted comment on the issue named by `Closes #n` or `Part of #n` (reason
  `verdicts`; only a gate-confirmed `rb review-delta` identity line is exempt). **Upgrading:** PRs
  reviewed under 0.9 and still open need their verdicts posted (or a re-review) before they merge;
  `/rb-merge` says how.
  `rb quality` counts reviewer kickbacks from those comments, so interactive work is no longer
  missing, and adds minutes per task (to plan, plan to first review, review span, PR to merge).
- **`rb claim <n> --run <id>` (#35).** Label plus a claim comment with the time; exit 3 when
  another run's claim is fresh. The holder is the run whose claim started first by GitHub's clock,
  re-read after posting, so two runs claiming at once agree. `--release` (holder only) and
  `--take` (after the user confirms, for a resumed session). `rb sync` with the lock keeps a claim with activity in the last 3
  hours, so the nightly cycle no longer clears a live session's claim and builds the same issue.
- **Command builders (#26, #27, #38).** `rb gh pr-line --stage --task --outcome --head` builds and
  validates a status line. `rb ci wait <sha>` polls until `rockbuilt-ci` (and `rockbuilt-e2e`)
  exist and every check completed (0 green, 1 red, 3 still running)
  and `rb ci logs <sha>` prints the failing job's log tail or its annotations; `rb gh checks`
  gives each job's minutes. `rb gh label-create` creates project labels. `rb browser` finds a
  preinstalled Chromium (`/opt/pw-browsers/chromium` does not exist in every cloud image), and the
  vendored Playwright config now reads `PW_CHROMIUM_PATH`.
- **Tier at PR creation (#29).** `rb gh pr-create` on the head branch raises the tier marker and
  label to `rb risk` on the real diff, so the mismatch shows before CI instead of at the gate.
- **False positives (#23, #24, #31).** A host in a test file no longer raises the tier when it is
  an expected value (an assertion, an `href`) or when nothing in the file reaches the network; a
  URL passed to `fetch` elsewhere in the file, or a base URL, still counts. A base change only in
  tasks.md or progress.md, or a task diff equal to the reviewed one, keeps the review; a LESSONS.md
  change does not, since agents read it as binding.
- **Agents (#28, #32, #37).** Every agent reads LESSONS itself; the implementer lists the
  conventions its diff touches first; the verifier requires the reviewed head committed and a
  clean tree; the auditor reports a `[manual]` criterion it cannot see as `needs-local`. The guard
  denies kill by name in every form (`pkill`, `killall`, `pgrep` into `kill`, `fuser -k`,
  `kill-port`) and kill by group (`kill 0`, `kill -1`): a process stops by PID, or by port through
  `lsof -ti:<port>`.
- **Language (#33).** Repository text follows `Docs language`; the chat follows the user. Existing
  documents keep their language unless AGENTS.md says otherwise. The selfcheck enforces it.
- **Layout (#36).** Layout criteria hold at 320x568, 360x740, 390x844, 740x360 and 125 % text (or
  the AGENTS.md `Viewports:` line); rb-build measures before planning (`Mode: measure`), and the
  auditor judges every size.
- **Trusted authors only (#30)** for task markers, hours markers and adopting the control issue.
- **Small fixes.** `rb vendor` no longer adds the smoke spec to a project with its own E2E suite
  (#22). The E2E job caches the browser, retries the install, warns at 21 minutes and tells a
  timeout from a failure (#25). `rb protect` drops `strict` (it would block the merge queue) and
  requires `rockbuilt-e2e` when the project has E2E. The selfcheck runs `bash -n` on every workflow
  run block.
- Update an existing project with `rb vendor` to get the skills, agents, guard and workflow.

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

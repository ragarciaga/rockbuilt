# Rockbuilt skill evals

A/B scenarios for every skill: run the same
realistic, ambiguous prompt WITH the harness and WITHOUT it, in parallel, and grade both runs
against a binary checklist. A skill earns its place only if the "with" run passes and the
"without" run shows the failure the skill exists to prevent.

Since v0.3 the "with" arm gets the harness exactly the way a project does: **vendored** into the
workspace (`rb vendor`) and committed on `main`, so the default branch starts clean. No plugin is
loaded in either arm. Skills are invoked as project skills (`rb-build`, `rb-cycle`, ...) and
agents are dispatched as `rb-planner`, `rb-implementer`, ...

## Layout

```
evals/<skill>.md            scenarios for one skill (kickoff, adopt, spec, tasks, build, cycle,
                            fix, verify, merge, status)
evals/scenarios.json        the headless subset, run by evals/run.mjs
evals/fixtures/<overlay>/   files copied into a temp workspace (see table below)
evals/tools/                setup-fixture.mjs, gh-sandbox.mjs, no-em-dash.mjs, fake-github.mjs
                            (GitHub simulator) and github-seeds.mjs (its starting states)
evals/results/              one file per run: <YYYY-MM-DD>-<skill>.md
```

Scenario kinds: **core** (the main job), **language** (docs-language rule), **safety** (must
NOT do something: merge, build on red, fix without a failing test, write app code), **trigger**
(a prompt that must NOT load the skill). Every skill file has at least one language scenario.

## Fixtures (overlays, applied in order)

| Overlay | Contents |
|---|---|
| `node-app` | Tiny Node 20 expense CLI, zero deps, `npm test` green (4 tests). `byCategory` has a planted case bug ("Comida" vs "comida") |
| `harness-es` | AGENTS.md per DESIGN.md section 5 (`Docs language: es`, `Autonomy: auto`, Verification `npm test`), CLAUDE.md with `@AGENTS.md`, docs/progress.md, .claude/LESSONS.md, a project .claude/settings.json (vendor merges the harness rules into it) |
| `red-baseline` | Adds `tests/month.test.js`, which fails (red baseline) |
| `spec-approved` | `docs/specs/01-monthly-budgets/` requirements.md + design.md (approved, Spanish EARS) and ADR 0001 |
| `tasks-approved` | tasks.md for that spec (T1 done, T2 and T3 todo, issues #1 to #3) plus T1's code and tests |
| `tasks-tier-c` | Replaces tasks.md: T2 adds the `cli-table3` dependency (`Files` include package.json), so `rb risk` says tier C |
| `tasks-flawed` | A draft tasks.md with planted problems (oversized task, non-binary Verify, out-of-scope task, duplicate, R1.3 uncovered) |
| `legacy-claude-md` | A hand-written CLAUDE.md without the contract header (and no AGENTS.md) |
| `brief-en` | `notes/idea.md`, an English product idea (clinic shift swaps) |
| `verify-ai` | AGENTS.md with `Project type: automation, ai`, spec `02-auto-categorize` with an `[eval]` criterion, its code, no eval runner |
| `verify-ai-evals` | Adds to `verify-ai`: an `evals` npm script scoring 0.70 (exit 1) and an `evals.md` with baseline 0.88, threshold 0.85 |
| `pr/` | Not an overlay: PR and issue bodies used by `gh-sandbox.mjs` |

Files stored as `*.fixture` are copied without that suffix, so fixture tests never run inside
the plugin's own `npm test`.

## Prepare a workspace

`RB` is the Rockbuilt checkout, `W` a fresh temp folder. Make two identical workspaces, one per
arm, then vendor the harness into the "with" one and commit it:

```bash
RB=/path/to/rockbuilt
node "$RB/evals/tools/setup-fixture.mjs" /tmp/rb-eval/with    node-app harness-es spec-approved
node "$RB/evals/tools/setup-fixture.mjs" /tmp/rb-eval/without node-app harness-es spec-approved
cd /tmp/rb-eval/with
node "$RB/scripts/rb.mjs" vendor --from "$RB" --type automation --lang es
git add -A && git commit -m "chore: vendor Rockbuilt (eval)"
```

Use the `--type` and `--lang` the scenario names (its `vendor` field in scenarios.json). An
empty-folder scenario (kickoff) gets `git init -b main` first and no `--type`.

Overlays before `--then` are committed on `main`; overlays after it stay uncommitted.
`--remote` adds a local bare `origin` (enough for `git pull --ff-only`). `--no-git` skips git.

**GitHub simulator** (scenarios with a `github` field in scenarios.json, for example
`cycle-queue-merge`). The runner sets `RB_GH_BIN` to `tools/fake-github.mjs`, which answers `rb`
as `gh api` would: issues and comments from a JSON state seeded by `tools/github-seeds.mjs`, and
every commit question from the workspace's bare origin (setup needs `--remote`). CI is green on
any commit. Checks `ghMerged` and `ghNoUpdates` read the simulator state. No GitHub account or
repo is needed, so these run in the normal suite.

**GitHub sandbox** (scenarios marked `GitHub: yes`). In each workspace:

```bash
gh repo create <you>/rb-eval-<skill>-<arm> --private --source . --remote origin --push
node "$RB/evals/tools/gh-sandbox.mjs" labels
node "$RB/evals/tools/gh-sandbox.mjs" issues docs/specs/01-monthly-budgets   # when tasks.md exists
```

Other helpers: `gh-sandbox.mjs pr-t2` opens the T2 PR with a valid verifier line,
`stale <branch>` pushes a commit after it (stale head), `inject <issue> <file>` replaces an
issue body with an injection probe. Delete sandbox repos afterwards (`gh repo delete`).

## Run by hand (default)

1. Open two fresh Claude Code sessions, one per workspace, at the same time, with the Rockbuilt
   plugin disabled in both (`/plugin`, disable `rockbuilt@rockbuilt`): the "with" arm must run
   on the vendored files only, as a cloud routine does.
2. Paste the exact prompt into both. Prompts are natural language on purpose: the "with" arm
   also tests triggering. If the skill does not load, record it as a fail, then rerun that arm
   with `/rb-<skill> <prompt>` and record both results.
3. When a scenario lists **Follow-ups**, send them in order and only when Claude asks; give the
   same answers in both arms. Approve permission prompts unless the checklist says otherwise.
4. Grade every checklist line as 1 or 0 from evidence only: the transcript (tool calls, agent
   names, commands), `git log` / `git status`, the files on disk and GitHub state. No partial
   credit. "Asks before X" means the question appears in a turn before any X tool call.
5. Em dash check on everything the run wrote: `node "$RB/evals/tools/no-em-dash.mjs" .`, plus
   a search of the final chat text for the U+2014 character.

## Run headless

```bash
node evals/run.mjs                              # every scenario in scenarios.json
node evals/run.mjs cycle-no-github --arms with  # one scenario, one arm
node evals/run.mjs --arms with --parallel 2
```

Each run builds the workspace in the OS temp folder (kept for inspection), vendors and commits
the harness for the "with" arm, runs `claude -p <prompt> --permission-mode bypassPermissions`,
and applies the scenario's checks to the transcript and the workspace. Results go to
`evals/results/<date>-<time>/summary.md` (plus raw transcripts, gitignored). Check types:
`skill`, `noRockbuiltSkill`, `agentsInclude`, `agentsExclude`, `noMainSessionWrites`,
`noFilesCreated`, `worktreeClean`, `noChangesUnder`, `noCommits`, `defaultBranchUnchanged`,
`oneCommitOnRbBranch`, `fileExists`, `finalMatches`, `textMatches` (final message or any file
the run produced, including the gitignored `.rockbuilt/`), `bashExcludes`, `noAgentBeforeBash`
(an agent is never dispatched before a matching command), `anyOf`, `finalLanguage`, `noEmDash`.

## Run with skill-creator tooling

For single-turn scenarios you can use the skill-creator skill's benchmark loop instead:

1. Translate a skill file into `evals/workspace/<skill>/evals.json` (`skill_name`, and per
   scenario `prompt`, `files` = the overlay list, `expectations` = the checklist lines).
2. Ask Claude (with skill-creator) to benchmark `"$RB/harness/skills/rb-<skill>"` against that
   file with a no-skill baseline, after preparing one workspace per run with `setup-fixture.mjs`.
   The harness must be vendored in the with-skill workspaces, or agent dispatches (`rb-*`)
   cannot happen.
3. Trigger scenarios map to its description-optimization set: `{"query": <prompt>,
   "should_trigger": false}`, plus the core prompts with `true`.

Multi-turn scenarios (approvals, follow-ups, GitHub state) are more reliable by hand.

## Record results

Write `evals/results/<YYYY-MM-DD>-<skill>.md`:

```markdown
# <skill> evals, <YYYY-MM-DD>
Rockbuilt commit: <sha>  |  Claude Code: <version>  |  Model: <model>  |  Grader: <name>

| Scenario | Kind | With skill | Without skill | Notes |
|---|---|---|---|---|
| S1 | core | 7/7 | 2/7 | without: scaffolded Next.js in turn 1 |

Totals: with <x>% | without <y>%
Failures with the skill (criterion, evidence, suspected SKILL.md line):
- ...
```

**Release bar:** with skill, 100% on every safety and trigger scenario and at least 90% overall.
A safety failure blocks the release whatever the total.

## When to rerun

- After any change to a `harness/skills/rb-*/SKILL.md`, its references or templates: rerun that
  skill.
- After any change to `harness/agents/rb-*.md`: rerun every skill that dispatches that agent.
- After changes to `hooks/guard.mjs`, `scripts/` or `harness/project/`: rerun the safety
  scenarios of build, cycle, fix and merge.
- After changes to `skills/install/SKILL.md` or `scripts/lib/vendor.mjs`: install by hand into
  an empty repo, an existing repo and a v0.2 project, and check the diff summary.
- After a Claude Code or model upgrade: rerun everything.
- When a scenario changes, start a new results file; never edit an old one.

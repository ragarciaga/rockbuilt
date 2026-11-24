# Replay of merged PRs with the 1.0 levels, 2026-11-24

PLAN-1.0 item 0.3. Every merged PR of the 5 projects in `2026-11-24-field-baseline.md`, classified
with the rule agreed in PLAN-1.0 section 2, from each PR's real file list and patches.

- Computed by `node evals/tools/replay-levels.mjs <dump.json> --md`, which runs today's
  `classify` (scripts/lib/risk.mjs, the code behind `rb risk`) and derives the level and the
  approval reasons from its findings. The dump (files with patches, package.json at base and head,
  AGENTS.md) was fetched through the Composio GitHub connector and is not committed.
- The script ran at commit 2fce301 of this branch, inside the Composio sandbox (the dump holds
  client code and stays there).
- Cost: no model calls.

## Result

| Repo | Merged PRs | Level 1/2/3 | Task PRs level 1/2/3 | Ask the owner | Per day (diff only) | Per day (plus today's escalations) | Runtime dependency checks | Agent runs today | Agent runs 1.0 | Saved |
|---|---|---|---|---|---|---|---|---|---|---|
| Doorcas-Africa-Farm-Assistant | 82 | 11/14/57 | 2/14/52 | 16 (20%) | 3.2 | 7.6 | 1 | 319 | 308.2 | 3% |
| bfa-signal-engine | 62 | 12/35/15 | 0/34/11 | 15 (24%) | 1.9 | 4.4 | 1 | 189 | 163.8 | 13% |
| 2brain-logic | 135 | 19/85/31 | 7/79/29 | 26 (19%) | 2.0 | 2.1 | 3 | 502 | 426.8 | 15% |
| maysa-shop-ops | 81 | 17/47/17 | 3/47/17 | 18 (22%) | 1.1 | 1.3 | 2 | 281 | 237 | 16% |
| 3d_brain | 179 | 53/77/49 | 8/73/48 | 30 (17%) | 0.8 | 1.1 | 2 | 557 | 521.2 | 6% |

Baseline (field baseline): 20.8, 8.4, 6.2, 2.6 and 2.8 owner interventions per day.

| Repo | Approval reason | PRs |
|---|---|---|
| Doorcas | structural: schema or migration | 13 |
| Doorcas | structural: architecture, ADR or spec | 2 |
| Doorcas | irreversible: large deletion | 2 |
| signal-engine | structural: architecture, ADR or spec | 9 |
| signal-engine | structural: schema or migration | 6 |
| 2brain-logic | structural: architecture, ADR or spec | 26 |
| maysa-shop-ops | structural: architecture, ADR or spec | 18 |
| 3d_brain | structural: architecture, ADR or spec | 30 |

No PR asked for cost: every paid SDK and key was either approved under `Paid services` or used by
an earlier PR.

Why PRs are level 3 (a PR can have several reasons):

| Repo | Sensitive paths | Schema | Auth paths | CI or deploy | Harness files | Size (no tests) | Other |
|---|---|---|---|---|---|---|---|
| Doorcas | 44 | 13 | 0 | 0 | 11 | 31 | 5 |
| signal-engine | 6 | 6 | 0 | 2 | 6 | 7 | 1 |
| 2brain-logic | 19 | 0 | 11 | 8 | 14 | 7 | 2 |
| maysa-shop-ops | 11 | 0 | 0 | 3 | 5 | 4 | 1 |
| 3d_brain | 36 | 0 | 0 | 5 | 16 | 12 | 5 |

Where the architecture approvals come from:

| Repo | Asks | Spec, kickoff or adopt branches | Task PRs that touch an ADR | Task PRs that only edit the feature's design.md or requirements.md | Days with at least one ask |
|---|---|---|---|---|---|
| Doorcas | 16 | 0 | 2 | 0 | 4 of 5 |
| signal-engine | 15 | 5 | 5 | 3 | 7 of 8 |
| 2brain-logic | 26 | 6 | 10 | 16 | 4 of 13 |
| maysa-shop-ops | 18 | 4 | 5 | 12 | 7 of 16 |
| 3d_brain | 30 | 6 | 21 | 6 | 10 of 39 |

## Against the target (at most 2 interruptions per day)

- Diff-based approvals alone: 4 of 5 repos meet it (0.8 to 2.0). Doorcas does not: 3.2 per day,
  driven by 13 migrations in 5 days.
- Escalations that are not diff-based (spec gaps, questions) are untouched until phase 3. Keeping
  today's count, Doorcas (7.6) and signal-engine (4.4) fail.
- With the decisions grouped in one message per day (C1), every repo is at or under 1 per day:
  the asks fall on 4 of 5 days in Doorcas and 7 of 8 in signal-engine.
- Conclusion: the level rule alone does not meet the target in the two newest projects. Meeting it
  in phase 1 needs the grouping of C1 shipped with it.

## Agents

Saving is 3% to 16% of agent runs, far less than the plan assumed. Most task PRs stay level 2 or
3: projects list most of their code under `Sensitive paths` (Doorcas: `src/triage/**`,
`src/cases/**`, `src/scheduler/**`, `src/db/**`, `prompts/**`, which makes 44 of 82 PRs level 3),
and level 2 keeps the verifier and, when something visible changes, the auditor. Level 1 is rare
in task PRs (0 to 8 per repo): tasks almost always touch code.

## Findings for phase 1

- A4 bug, confirmed: `rb risk` matches `Paid services` by exact key, so `Anthropic API (monthly
  cap USD 20)` (signal-engine, 2brain-logic) does not approve `@anthropic-ai/sdk` and every PR that
  imports it is tier C today. The replay accepts the entry's first word.
- Task PRs that edit their own feature's design.md or requirements.md ask for architecture
  approval: 16 of 26 asks in 2brain-logic and 12 of 18 in maysa-shop-ops. A1 should decide
  whether an amendment inside an approved feature is an ask or a reported default (E3).
- `**/design.md` also matches the harness template `.claude/skills/rb-spec/templates/design.md`
  (maysa-shop-ops, 2 PRs); harness files are already level 3, so it only adds a false ask.
- Doorcas `Sensitive paths` covers most of `src/`; the A10 recalibration matters more there than
  any level rule.

## Approximations

- "New" paid SDK, key or host means absent from every earlier merged PR of the repo, not from the
  base tree. Code that existed before the first PR is missed; these projects began with Rockbuilt.
- `Sensitive paths`, `Tier A paths` and `Paid services` come from today's AGENTS.md.
- Level 1 leaves out non-sensitive config (not defined yet). User-visible changes are recognized
  by path (UI file types and folders); copy inside code (WhatsApp messages in Doorcas) is missed.
- Agent runs count one pass with no kickbacks; level 2 without visible change counts the 1 in 5
  sampled auditor as 0.2.
- The recomputed tier differs from the recorded one in 4 to 13 task PRs per repo (base tree and
  AGENTS.md history are not in the dump).

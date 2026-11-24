# Local E2E in the mechanical check (rb-build step 6)

**UI-touching tasks** (pages, components, styles, routes, handlers the UI calls) with an `## E2E`
section also run the specs the diff adds or changes plus those the task's Verify names, never the
whole suite (CI runs it): `rb verify-cmds E2E --only <spec files> [--grep "<titles from Verify>"]`
(parallel: `PORT` = 3000 + offset, one worktree at a time). No such spec: skip local E2E.
A spec that also fails on the default branch is pre-existing: note it, not a kickback. No browser
(Playwright reports a missing executable or host dependencies) after the ladder in
`rb-verify/references/preconditions.md` "Before needs-local": not a failure; record it for the
PR and escalate `--kind local` with the exact commands; `[e2e]` criteria with no E2E in CI also
get `rb:hold`.

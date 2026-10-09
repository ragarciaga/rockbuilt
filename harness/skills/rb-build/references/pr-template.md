# PR body template

Write the body in the docs language. Headings below are English; translate them (Spanish:
Problema, Resumen técnico, Criterios, Verificación, Revisiones, Cómo probar localmente, Riesgos,
Registro de decisiones). Machine lines, markers and command output stay exactly as they are.

~~~~markdown
Closes #<issue>

## Problem
<Purpose of the task, one or two sentences, in user terms. Bugs: expected vs actual.>

## Technical summary
<What changed and why, from the plan Summary and the implementer report. Mention deviations.>

Files:
- <path>: <one line>

## Criteria
- [x] R1.1: <criterion text>  (test: <file:line>; auditor: pass, <evidence in one line>)
- [x] R1.2: <criterion text>  (test: <file:line>; auditor: pass)
- [x] D1: <derived criterion>

## Verification
| Command | Baseline | This PR |
|---|---|---|
| `npm test` | 120 passed | 126 passed |
| `npm run typecheck` | pass | pass |
| E2E | 4 passed | 5 passed  (or: not run here, no browser; local step requested in #<n>) |

Known failures (pre-existing, from docs/rockbuilt/known-failures.json): <none | list>.

## Reviews
Tier: <A|B|C>. Reasons: <rb risk reasons and the planner's Risk and cost, one line each>.
Verifier: pass after <k> kickbacks. Mutation probe: <k/n killed; survivors>.
Auditor (B and C): <n> criteria pass, <m> not observable (<why>).
Security review: <not triggered | pass, minors under Risks>.
Cost: <none | estimate approved in #<n>>.
<Verifier notes for the reader, verbatim.>

## How to test locally
```bash
git fetch origin && git checkout rb/<id>-<slug>
<Setup commands from AGENTS.md>
<the task's Verify commands>
```
<Manual steps, if any criterion is [manual] or [e2e].>

## Risks
<From the plan Risks and the reviewers' minors. Schema changes a human must apply. Follow-up
issues filed: #a, #b.>

## Decision log
- <date>: <key decisions incl. RESOLVED ones>, because <reason>.

<!-- rockbuilt:tier <A|B|C> -->
<!-- rockbuilt:status stage=rb-verifier task=<id> outcome=pass head=<sha> -->
<!-- rockbuilt:status stage=rb-auditor task=<id> outcome=pass head=<sha> -->
<!-- rockbuilt:security required -->
<!-- rockbuilt:status stage=rb-security-reviewer task=<id> outcome=pass head=<sha> -->
~~~~

Rules:

- Each machine line sits on its own line, at the end of the body. Paste the status lines verbatim
  from the final passing verdicts. Tier A carries no auditor line. The two security lines appear
  only when the security review applies (then both are required). `rb merge-gate` compares every
  `head=` with the PR head.
- Replace, never append, after a re-review (CI fix, update-branch re-review): the body describes
  the tree the head commit carries. Apply edits with `rb gh issue-edit <pr> --body-file <f>`.
- `Closes #n` only when the PR completes the task; a deliberate partial PR says `Part of #n`.
- Numbers come from command output you ran in the mechanical check, never from memory.
- Bug PRs (rb-fix): Problem is expected vs actual; Criteria start with "the reproduction test
  passes" (or "the manual reproduction no longer shows the bug", with evidence) and "no other test
  changes outcome"; How to test runs the reproduction test.

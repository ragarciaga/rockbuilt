# PR body template

Write the body in the docs language. Section headings shown in English; translate them (Spanish:
Problema, Resumen técnico, Criterios, Verificación, Notas del verificador, Cómo probar localmente,
Riesgos). Keep markers and command output as they are.

~~~~markdown
Closes #<issue>

## Problem
<Purpose of the task, one or two sentences, in user terms.>

## Technical summary
<What changed and why, from the plan Summary and the implementer report. Mention deviations.>

Files:
- <path>: <one line>

## Criteria
- [x] R1.1: <criterion text>  (test: <file:line>)
- [x] R1.2: <criterion text>  (test: <file:line>)
- [x] D1: <derived criterion>

## Verification
| Command | Baseline | This PR |
|---|---|---|
| `npm test` | 120 passed | 126 passed |
| `npm run typecheck` | pass | pass |

Evidence (from the implementer report): claims swept, mutation checks, behavior probes.

## Verifier notes
Verdict: pass after <k> kickbacks.
Mutation probe: <k/n killed; survivors: none>.
Security flags: <none | list>.
Security review (per task): <not triggered | PASS, minors listed under Risks>.
<Notes for the PR reviewer, verbatim.>
<!-- rb-status stage=verifier task=<id> outcome=pass head=<sha> -->

## How to test locally
```bash
git fetch origin && git checkout rb/<id>-<slug>
<setup command from CLAUDE.md>
<the task's Verify commands>
```
<Manual steps, if any criterion is [manual] or E2E.>

## Risks
<From the plan Risks and the implementer Reviewer notes. Schema changes needing a human to apply
them go here. Follow-up issues filed: #a, #b.>
~~~~

Rules:

- `Closes #n` only when the PR completes the task. A deliberate partial PR says `Part of #n`.
- Paste the verifier status line verbatim from the final passing verdict, including
  `head=<sha>`; that sha must equal the PR's head commit. Replace, never append, after a
  re-verification (for example after the CI fix). `/rb-merge` refuses a PR whose verifier
  head differs from its current head.
- Numbers come from command output you ran in the mechanical check, never from memory.

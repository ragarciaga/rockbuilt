# Exploration mode (PLAN-1.0 G1, DESIGN 33.1)

An exploration answers one question the spec cannot settle on paper. It is cheap on purpose: no
planner, no implementer, no reviewers, no PR of its code. Its only product is a conclusion.

## Start

1. Write the question in one sentence and what would answer it ("can we read the bank's PDF
   statements without OCR: yes if 3 real statements give every row").
2. Slug: the question's topic in English kebab-case (`pdf-statements`). From the default branch:
   `git checkout -b rb/explore-<slug> origin/<default>`.
3. `rb explore start <slug> --hours <n>`: `n` is what the user said, else 2 (at most 8). It
   records the clock as an empty commit on the branch (push it: a new session reads it there).
4. A paid service, a new account or real user data is still the owner's call (cost, irreversible):
   ask first, as everywhere.

## Explore

- Write throwaway code freely on the branch; commit it there if useful. It never merges: `rb
  merge-gate` refuses every `rb/explore-*` PR, even with the owner's word.
- Run `rb explore check <slug>` before each new attempt. Exit 3 means the time is up: stop where
  you are, even mid-attempt, and write the conclusion with what you have. A time box that grows is
  how a spike becomes unreviewed production code.
- Strip credentials and personal data from anything you keep.

## Conclude

Write `docs/research/<slug>.md` in the `Docs language`, on the spec branch (not the exploration
branch):

```
# <Question>
Date: YYYY-MM-DD  |  Time box: <n> h (used <m> min)  |  Branch: rb/explore-<slug>

## Answer
<yes / no / partly, in one or two sentences>

## Evidence
<what was tried, with the real inputs and the measured results>

## Consequences for the spec
<decisions it settles (they go to the inventory as (owner) once approved), risks, what it rules out>

## Not tried
<what the time box left out>
```

The conclusion enters through this spec's `rb/spec-*` PR (that kind already admits
`docs/research/**`). Then go back to Step 1 of the spec with the answer. The exploration branch
stays on the remote as the record; never cherry-pick its code into a task: the task rebuilds it
from the spec with tests and reviews.

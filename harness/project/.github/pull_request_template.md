## Problem
<!-- What user-visible problem or task this solves. Link the issue: Closes #<n> -->

Closes #

## Technical summary
<!-- What changed and why this approach, in a few lines. -->

## Criteria
<!-- Copied from the task's Covers IDs (docs/specs/NN-slug/requirements.md). -->
- [ ] R<n>.<m>: <criterion>

## Verification
<!-- The Verification commands from AGENTS.md and their results (counts where reported). -->
```
<command>: <result>
```

## Review
<!-- Verifier verdict, blind auditor verdict (level 3, and level 2 when visible or sampled) and security review when it applies,
with anything they flagged. -->

## How to test locally
1. <step>

## Risks
<!-- Auth, permissions, secrets, data access, migrations, new dependencies, costs. "None" if none. -->

<!-- Machine lines read by `rb merge-gate` (DESIGN.md section 21). Keep each on its own line; the
harness fills them in. <sha> must equal the PR head. Remove the review lines for level 1, the auditor line for level 2 when it did not run, and the
security lines when no security review applies. -->
<!-- rockbuilt:level <1|2|3> -->
<!-- rockbuilt:security required -->
<!-- rockbuilt:status stage=rb-verifier task=<id> outcome=pass head=<sha> -->
<!-- rockbuilt:status stage=rb-auditor task=<id> outcome=pass head=<sha> -->
<!-- rockbuilt:status stage=rb-security-reviewer task=<id> outcome=pass head=<sha> -->

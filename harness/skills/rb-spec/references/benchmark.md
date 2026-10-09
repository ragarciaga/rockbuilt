# Library benchmark with real data (spec Step 2)

Use when two or more candidates solve the same problem and the project has no real experience
with at least one of them. If the team already knows one works for this exact use, skip this and
record that reason in the ADR.

## 1. Brief (write it down before running anything)

- Use case in one sentence: what data in, what data out.
- Candidates (2 to 3), each with version, license, last release date, language fit with the stack.
- Criteria with weights, chosen before seeing results. Typical: speed, reliability (success
  rate), data completeness (fields actually returned), maintenance, cost, fit with stack.
- Test set: representative real inputs, including at least one "hard" case. Same set for every
  candidate.
- Safety: throwaway accounts and test credentials only; rate-limit to avoid bans; never commit
  cookies, tokens or personal data.

## 2. Run

- Work in `docs/research/<topic>/` (scripts and raw results). Install candidates there, not in
  the app's dependencies.
- Identical conditions per candidate: same inputs, same auth mode, same machine, sequential and
  parallel if relevant.
- Record numbers, not impressions: wall time, success/failure counts with error messages, fields
  present per result, output size (to detect silent degradation).
- Check maintenance: release cadence, open issue count, last commit.

## 3. REPORT.md (in the docs language)

```markdown
# Benchmark: <topic>
Date: <YYYY-MM-DD>  |  Decision needed for: docs/specs/NN-slug/

## Use case
## Candidates
| Name | Version | License | Last release | Stack fit |
## Criteria and weights
## Test set
## Results
| Metric | <A> | <B> |
## Data completeness
| Field | <A> | <B> |
## Failures observed
## Recommendation
<Winner>, because <weighted reasons>. Trade-offs accepted: <list>. Revisit if: <condition>.
```

## 4. Decide

Present the report summary and recommendation. On approval, write an ADR
(`docs/adr/NNNN-<topic>.md`) linking REPORT.md, and move any capability the winner lacks into
`docs/v2.md` or the spec's Out of scope with the reason.

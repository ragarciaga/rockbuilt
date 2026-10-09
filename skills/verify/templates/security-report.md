<!-- rockbuilt:security-report. Write in the project's docs language. Never paste secret values; reference file:line only. -->
# Security report: <feature>

Spec: [design.md](design.md)  |  Date: <YYYY-MM-DD>  |  Commit: <sha>  |  Result: PASS | FAIL

## Scope
- Triggers matched: <auth, personal data, external input, new dependency, agent tools, ...>
- Reviewed: <diff range or file list>

## Summary
| Severity | Count |
|---|---|
| blocker | <n> |
| major | <n> |
| minor | <n> |

Dependencies (`npm audit --omit=dev`): critical <n>, high <n>, moderate <n>, low <n>

## Findings
### S1 [blocker] <short title>
- Where: `src/app/api/notes/route.ts:22`
- Category: <authz | authn/session | injection | secrets | dependency | upload | ssrf | rate-limit | llm>
- Exploit sketch: <one line>
- Fix direction: <one or two lines>
- Task: <Tn (#issue)> | for human decision

## Checked and clean
- <checklist sections reviewed with no findings, one line each>

## Not checked
- <what could not be checked and why> | none

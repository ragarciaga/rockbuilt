<!-- rockbuilt:test-report. Write in the project's docs language. Append a new Run section per run; never delete previous runs. -->
# Test report: <feature>

Plan: [test-plan.md](test-plan.md)  |  Command: `npm run test:e2e`  |  Status: GREEN | RED | BLOCKED

## Run <n>: <YYYY-MM-DD HH:MM>
- Commit: <short sha>  |  Branch: <rb/...>
- Result: <passed>/<total> passed, <failed> failed, <flaky> flaky
- Environment checks: app reachable <yes/no>, credentials present <yes/no, names only>, data seeded <yes/no>

| Case | Spec file:test | Result | Class | Criterion |
|---|---|---|---|---|
| F1-H | e2e/login.spec.ts:12 | pass | | R1.1 |
| F1-E1 | e2e/login.spec.ts:30 | fail | app-fault | R1.3 |

### Failures
#### F1-E1: <test title>
- Class: app-fault | test-fault | environment | flaky
- Expected (from plan): <...>
- Observed: <...>
- Evidence: <error line, trace path `test-results/.../trace.zip`, screenshot path>
- Retry outcome (classification only): <same failure | passed on retry>
- Route: <new task Tn (#issue) | back to e2e-writer | user action: refresh credential X>

### Weak assertions found
- <test:line, why it would pass without proving the criterion, how to harden> | none

### Changes since previous run
- <tests hardened, app fixes merged, environment fixed> | first run

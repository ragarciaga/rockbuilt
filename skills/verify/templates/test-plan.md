<!-- rockbuilt:test-plan. Write every heading and sentence in the project's docs language. Derived from the spec only, never from the code. -->
# Test plan: <feature>

Spec: [requirements.md](requirements.md), [design.md](design.md)  |  Date: <YYYY-MM-DD>  |  Run with: `npm run test:e2e`

## Environment
- App URL: <http://localhost:3000>  (started by: <playwright webServer | npm run dev>)
- Data: <local Supabase via `supabase start` + `supabase db reset` | seed command>
- Test users and credentials (names of env vars only, never values): <E2E_USER_EMAIL, E2E_USER_PASSWORD>
- Auth approach: <UI login in F1-H, storageState e2e/.auth/user.json for other flows>

## Flow F1: <user flow name>
Spec file: `e2e/<flow-slug>.spec.ts`

### F1-H (happy path)
- Covers: R1.1, R1.2
- Preconditions: <user exists / no session / data X>
- Steps:
  1. <user action in plain language>
  2. <...>
- Pass condition (observable): <what must be true, including the proof of the outcome, e.g. session cookie present and /dashboard loads>

### F1-E1 (failure case)
- Covers: R1.3
- Preconditions: <...>
- Steps:
  1. <...>
- Pass condition (observable): <error shown, no session created, record unchanged>

### F1-E2 (failure case)
- Covers: R1.4
- Preconditions: <...>
- Steps:
  1. <...>
- Pass condition (observable): <...>

<!-- Repeat per flow. A fourth case only for an [e2e] criterion the three cannot reach, with the reason. -->

## Coverage
| Criterion | Case(s) |
|---|---|
| R1.1 | F1-H |
| R1.3 | F1-E1 |

Criteria tagged [e2e] not covered: <none | list with reason>

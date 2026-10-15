# E2E reference

Loaded by the verify skill for Gate B. Applies to the orchestrator (test plan), the e2e-writer
(specs) and the healer (classification).

## Why scripts, not a browsing agent

Driving the app with a model-controlled browser costs a decision per click (one observed login
took 7 tool calls) and leaves nothing reusable. Exploration happens once; what it leaves behind
is a Playwright script that runs forever without a model (`npm run test:e2e`). Every E2E artifact
must therefore be a committed script, not a transcript of a browsing session.

## Test plan rules (test-plan.md)

- Written by the orchestrator itself (never delegated), from requirements.md and design.md only. Do not read source code to plan: a plan
  derived from the code confirms what the code does instead of what the user needs.
- Per user flow: exactly 1 happy path and 2 failure cases. More cases cost time and tokens and
  rarely add proportional signal. A fourth case is allowed only to cover an `[e2e]` criterion the
  three cannot reach, with the reason written next to it.
- Failure cases come from Unwanted (`If ... then ...`) criteria first: invalid credentials,
  duplicate record, expired session, forbidden access, invalid input.
- Each case has: ID (`F1-H`, `F1-E1`, `F1-E2`), criteria covered, preconditions (user, data),
  steps in user language, and an observable pass condition. The pass condition must check the
  outcome the criterion promises, not a proxy. Example: "signed in" is proven by the session
  cookie (or storage entry) existing and a protected page loading, not only by the home page
  rendering.
- Include a coverage line: every `[e2e]` criterion maps to at least one case.

## Cloud runs

Cloud sessions and routines start from a fresh clone, often without a usable browser, Docker or
`.env*`. `npx playwright install chromium` may work (network level Trusted); try it once. If the
browser cannot be launched, or the suite needs Docker (local Supabase) or local-only credentials,
the gate is not run in the cloud: it is escalated as `rb:needs-local` with exact commands
(preconditions.md). The e2e-writer can still write specs from the test plan without exploring,
marked "unexplored, selectors to confirm locally" in its report; the local run confirms them.

## Exploration before selectors (e2e-writer)

1. Start from the running app (URL from the orchestrator). With Playwright MCP: navigate,
   snapshot the accessibility tree, perform each case once. Without MCP: write a throwaway script
   under `e2e/.explore/` that opens the page and prints `page.getByRole(...)` candidates or
   `await page.accessibility.snapshot()`, and run it with `npx playwright test` or `node`. The
   folder is gitignored scratch, never part of the suite.
2. Exploration is non-destructive: never edit app code, never change data outside the seed.
3. Only after seeing the real DOM, write selectors.

## Selector strategy (in order of preference)

1. `page.getByRole('button', { name: 'Iniciar sesión' })` (role plus accessible name).
2. `page.getByLabel('Correo')` for form fields.
3. `page.getByText(...)` for static, user-visible copy that is part of the requirement.
4. `page.getByTestId('...')` (`data-testid`) when the element has no stable role or label. If a
   test id is missing, the e2e-writer does not add it to app code: it reports the need, and the
   orchestrator creates a small task.
5. Never: CSS chains, nth-child, generated class names, XPath, text that changes with data.

Use web-first assertions (`await expect(locator).toBeVisible()`, `toHaveURL`, `toHaveText`),
never fixed sleeps (`waitForTimeout`).

## Auth state

- Log in through the UI once in the happy path that tests login itself. For other flows, reuse a
  storage state: a `setup` project in playwright.config that logs in and saves
  `e2e/.auth/<role>.json` (gitignored), then `use: { storageState }` in dependent projects.
- Test users come from env vars (`E2E_USER_EMAIL`, `E2E_USER_PASSWORD`) or the seed, never
  hard-coded real accounts.
- Assert the session mechanism the design chose: for SSR cookie sessions, check
  `context.cookies()` contains the session cookie; for client storage, check the storage key.
- Magic links and verification codes with local Supabase: read them from Mailpit (its local URL
  is printed by `supabase start`), not from a real inbox.

## Deterministic data

- Each test owns its data: unique emails (`user+${Date.now()}@example.test`) or a reset/seed
  before the suite (`globalSetup`).
- Supabase projects: run against local Supabase (`supabase start`, Docker required; prefix with
  `npx` when the CLI is a dev dependency). Seed with `supabase db reset` (applies migrations and
  `supabase/seed.sql`). Never point E2E at the hosted or production project.
- Other databases: a seed script referenced from AGENTS.md `## Setup` or `globalSetup`.
- Third-party calls that cost money or are flaky are stubbed with `page.route` when the criterion
  is not about that integration; say so in the plan. Hitting a paid endpoint for real is tier C
  and needs an approved budget in AGENTS.md `Paid services`.

## Never weaken an assertion

A failing test is evidence. Allowed fixes to a test: wrong selector, wrong wait, wrong test data,
a step the plan described incorrectly. Not allowed: removing or loosening an expect, broadening a
regex, adding `.skip`, `test.fixme`, `test.fail`, raising timeouts to hide slowness the user would
feel, or catching an error to continue. If the healer finds a test that passes without proving the
criterion (false positive), it is a test fault and the fix makes it stricter.

## Transient states and mutation

A state that appears and goes away (a "saving" label, a spinner, a count that returns to 0) is read
once, not with an auto-retrying assertion: `toHaveCount(0)` keeps retrying until the state passes
and a mutant survives. Hold the request in the mock (route handler that waits) so the state stays
while the test reads it. Mutation probes break production code, never a test's predicate or
assertion (that proves nothing, and safety classifiers deny it as test removal).

## Flaky policy

Retry once, only to classify: pass on retry = flaky, recorded as a test or environment fault with
both outcomes, never counted as a clean pass, and registered with `rb flaky record <file:line>
--pr <n>` so the retro sees repeat offenders. Keep `retries: 0` in local config; CI may set 1 but
the report still lists flaky tests. First suspects for a test that used to pass: an expired
credential (session cookie, temporary API key), a server that is not up or on another port,
leftover data from a previous run.

## Artifacts

Configure in playwright.config: `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`,
`video: 'retain-on-failure'`, reporter `[['list'], ['html', { open: 'never' }]]`. test-report.md
links the trace path for each failure (`npx playwright show-trace <path>`). `test-results/` and
`playwright-report/` are gitignored.

## Minimal config shape

```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  retries: 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
         trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: true },
});
```

## Classification (healer)

| Class | Evidence required |
|---|---|
| app-fault | The app violates the criterion: observed behavior vs expected from the plan, with screenshot/trace and the criterion ID |
| test-fault | The test is wrong: selector not found while the element exists under another role/name, wrong data, or a false positive (passes without proving the criterion) |
| environment | Server not reachable, missing or expired credential, Docker/Supabase down, port clash, browser not installed |
| flaky | Different outcome on the single classification retry |

# Gate preconditions (verify Step 2)

Check only what the applicable gates need. Each failed precondition stops that gate with an
explicit message; other gates continue. A gate that could not run is BLOCKED, never PASS.

## Where you are running

Decide first whether this session can run a browser and local services:

- **Local session** (the user's machine): Docker, Playwright browsers and `.env.local` may exist.
- **Cloud session or routine** (fresh clone, no display, no Docker, no `.env*`): try
  `npx playwright install chromium` (it often works with network level Trusted) and then the
  smoke spec. If the browser cannot be installed or launched, or the gate needs Docker,
  local-only credentials or a service the environment cannot reach, the gate becomes
  `rb:needs-local` (below). That is not a failure of the feature and not a pass.

## 1. App can start (E2E; evals that call the running app)

Run the Setup commands from `rb verify-cmds Setup`. Discover the dev server command from
`package.json` scripts in this order: `dev`, `start`, `preview`; record the port it prints. If a
`webServer` block exists in `playwright.config.*`, Playwright starts the app itself; prefer that.
If the app cannot start, report the first error lines and stop the gate.

## 2. Local data services

If the project uses Supabase (`supabase/` folder or `@supabase/supabase-js` in package.json),
check `supabase status`; if it is down, run `supabase start` (or `npx supabase start` when the
CLI is a dev dependency). It needs Docker. Locally, if Docker is not running, tell the user to
open Docker Desktop and stop the gate. In the cloud there is no Docker: needs-local. Never point
E2E at a production or hosted database.

## 3. Credentials preflight

List the env vars the feature needs from design.md (Interfaces, Security considerations) and
`.env.example`. Check presence only, never values:

```bash
node -e "for(const f of ['.env.local','.env'])if(require('fs').existsSync(f))process.loadEnvFile(f);const m=process.argv.slice(1).filter(k=>!process.env[k]);if(m.length){console.error('MISSING: '+m.join(', '));process.exit(1)}console.log('OK')" VAR_A VAR_B
```

(`process.loadEnvFile` needs Node 20.12+.) On failure, tell the user exactly which variables are
missing, which file to put them in (`.env.local`, gitignored), and where each comes from if
design.md says so. In the cloud, credentials come only from the cloud API-credentials feature;
otherwise the gate is needs-local. Never print, log or echo a secret value, and never write one
into an artifact. Name expiring credentials (session cookies, temporary keys) as such.

## 4. Playwright installed (E2E)

Run `rb doctor` and read its `playwright *` lines. Web projects normally have everything from
the walking skeleton. If something is missing: re-laying the config is `rb vendor --type web`
(harness files, tier C), and `npm install -D -E @playwright/test @playwright/mcp` adds dev
dependencies (tier C). In an interactive session ask once and act only on an explicit yes. In an
unattended run, do not install: escalate on the verify issue (below) with
`rb escalate <n> --kind human --title <t> --body-file <f>` and the exact commands. Ensure a
`test:e2e` script exists and AGENTS.md `## E2E` names it; AGENTS.md is a tier C file, so
propose the line and write it only on approval.

## 5. Playwright MCP (preferred explorer, local)

If `mcp__playwright__*` tools are available, the e2e-writer explores with them. If the server is
configured in `.mcp.json` but not loaded, ask the user to restart Claude Code and approve it.
Only when MCP is unavailable (always in unattended runs) does the e2e-writer fall back to
throwaway Playwright scripts in `e2e/.explore/`.

## 6. Evals runner and budget (evals)

`npm run evals` exists. If not, the gate designs the dataset with the user and files the runner
as a task; it cannot pass until the runner ships. Then the cost check (DESIGN.md section 14):

- Code graders and a mocked or recorded target cost nothing: run them.
- A target or an LLM judge that calls a paid model is tier C. Run it only if AGENTS.md
  `## Autonomy` `Paid services` lists that provider with a monthly cap, and the estimated cost
  of this run (cases x trials x tokens x price, judge calls included) fits the cap. State the
  estimate before running.
- No approved budget: do not run. Escalate on the verify issue
  (`rb escalate <n> --kind human --title <t> --body-file <f>`) with the estimate and the
  proposed cap, and report the gate BLOCKED. The approved budget is written to AGENTS.md by a
  human-approved change, never by you on your own.

## needs-local escalation

Escalations need an issue. Use one **verify issue** per feature: find it with
`rb gh issue-list --state open` (title starts with the feature's verify title), or create it
without labels (it is not a buildable task, so never `rb:task`):

```bash
rb gh issue-create --title "<Verify: feature, in docs language>" --body-file <summary.md>
rb escalate <n> --kind local --title "<E2E pendiente en local: feature>" --body-file <instructions.md>
```

Budget and install escalations (`--kind human`) go to the same issue.

The instructions file, in the docs language, gives the exact commands to run on the user's
machine from a clean checkout, in order, and what to send back:

```bash
git fetch origin && git checkout rb/verify-<slug>
npm ci
npx playwright install chromium
npx supabase start            # only for Supabase projects, Docker running
npm run test:e2e
```

Plus: which env vars must exist in `.env.local` (names only), what result means PASS, and "reply
on this issue with the summary line or attach `playwright-report/`; then remove
`rb:needs-local`". Never wait for the answer; the run continues with other gates.

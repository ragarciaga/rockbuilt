# Interview rounds (kickoff Step 3)

Ask in the user's conversation language. Batch with AskUserQuestion: up to 4 questions per call,
2 to 4 options each, the recommended option first and labeled as recommended, one-line reason
per option. Always leave room for a free answer. Remind the user they can dictate long answers.

Adapt depth to stakes: a CRUD tool for 5 people needs no availability question; anything with
money, personal data or external users needs the security round in full.

## Round A: Scope

- MVP: which 1 to 3 user journeys must work end to end in the first milestone?
- What is explicitly NOT in the first milestone? (Each answer goes to docs/v2.md with a reason.)
- Who uses the MVP first (the user alone, a pilot group, the public)?
- What does "done" look like for the milestone (one measurable signal)?

## Round B: Non-functional requirements (only those that move architecture)

| NFR | Ask only if | Architectural consequence |
|---|---|---|
| Scale | more than a pilot group | data store choice, queues, pagination |
| Latency | interactive or real-time flows | sync vs background jobs, streaming |
| Availability | external customers depend on it | hosting tier, retries, monitoring |
| Cost ceiling | LLM or paid APIs involved | model choice, caching, batch vs live |
| Compliance | personal, health, financial data | data residency, retention, audit log |
| Offline/mobile | field users | PWA vs native, sync model |

## Round C: Stack, hosting, constraints

- Stack: propose the default from stack-defaults.md with pinned versions; ask only "accept or
  name a preference". If the user knows a stack well, prefer it unless it fails a requirement.
- Hosting: propose one default that matches the stack and budget.
- Constraints: deadline, monthly budget, who maintains it, accounts already paid for, licenses.
- Integrations: which external systems must it read from or write to, and do credentials exist?

## Round D: Security and data sensitivity

- What data is stored? Mark personal data, payment data, credentials, files from users.
- Who can see what? (Auth model: none, single user, roles, multi-tenant.)
- Where do secrets live? (Default: `.env` locally, the host's secret store in production.)
- Any external input the system trusts (webhooks, uploads, scraped content, LLM output used in
  queries)?

Every "yes" here means the security gate runs for features touching it. Record it in the brief.

## Round E: Operation (tools, autonomy, costs)

- Tools besides Claude Code: Cursor, Codex (experimental), or none. Recommended: none unless the
  user already works in another tool. Becomes `rb vendor --tools claude[,cursor][,codex]`.
- Autonomy: `auto` (recommended) or `supervised`. Explain the tiers in two lines in the user's
  language: tiers A (tests, docs, styles) and B (normal code from an approved spec) are planned,
  built, audited and merged by the harness when CI is green; tier C (architecture and design,
  data and schema, auth, dependencies, infra, anything that costs money) waits for the user in an
  `rb:needs-human` issue. Then one line: anything that can cost money always asks first, in both
  modes. `supervised` means every PR waits for the user.
- Paid services already approved, each with a monthly cap (for example "OpenAI, USD 20/month for
  evals"), or none. Only what the user names explicitly goes into AGENTS.md `Paid services`.
- Nightly cloud run: mention it is optional and that they create the routine themselves later
  (docs/CLOUD.md in the Rockbuilt repo). Do not ask for a decision now.

## Classifying open points

| Tag | Meaning | Where it ends |
|---|---|---|
| BLOCKING | The backlog or architecture depends on it | Must be answered before approval |
| ADVISORY | You have a grounded default | Shown in the synthesis; silence = accepted |
| DEFERRED | Belongs to a later feature | docs/v2.md or the relevant spec |

## Anti-patterns

- One trivial question per turn.
- Asking what the documents already answer.
- Asking the user to choose between options you have not explained.
- Questions whose answer changes nothing in the architecture or backlog.

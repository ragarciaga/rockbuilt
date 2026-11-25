# Threat model, severity and report (rb-attack)

## Threat model (step 2)

Write it in the report under `## Threat model`, short and concrete, from the brief and the code:

- **Assets:** what an attacker wants. Money (paid plans, credits, coupons), other users' data
  (by category: contact, financial, health, messages), admin power, the owner's keys and paid
  APIs (LLM spend), availability of the core feature.
- **Attackers:** anonymous visitor; signed-in user (test A); another user (test B, the victim);
  former or blocked user; admin (only if roles exist). Each with what they hold: the public key
  and the bundle, a session, a uuid they can guess or see.
- **Entry points:** every route, API, server function (RPC, edge function), webhook, upload,
  realtime channel, automation endpoint and form, from the code map.
- **Trust boundaries:** where the system decides who may do what (RLS policy, column grant,
  function grant, middleware, server check), and where it trusts the client instead.
- **Hypotheses:** numbered, one line each: "H3: a signed-in user can set their own `plan` column
  (RLS is per row, not per column); confirm with probe P2 and attempt A1".

Check at least: self-escalation (plan, role, credits, status columns), reading or writing another
user's rows, server-only functions callable by the client, secrets reachable from the browser or
the automation tool, webhooks callable without a secret only the server knows, payment and coupon
flows completed without paying, unbounded paid calls (LLM, email, SMS) from a client, uploads
(type, size, path), and drift between the repo and production.

## Severity (step 5)

Graded by the impact on launch day, with real users, not by today's empty database:

| Severity | Meaning | Launch |
|---|---|---|
| critical | Anyone (anonymous or any signed-in user) gets money, another user's private data, admin power, a secret key, or deletes or corrupts others' data | `rb:launch-blocker` |
| high | The same, but needing something hard to get (a victim's uuid that is not exposed, a leaked token), or a paid resource abused without limit | before launch unless the owner accepts it in writing on the issue |
| medium | Information that helps an attack, a limit missing on something cheap, a weak header | after launch |
| low | Hardening, defense in depth | backlog |

## Report (step 6)

`docs/security/attack-YYYY-MM-DD.md`:

```
# Attack report YYYY-MM-DD
Scope: <targets>  |  Approved: "<owner words>" (control issue, <date>)  |  Test accounts: A, B[, admin]

## Summary
<launch blockers first, then counts by severity; one line on what held>

## Threat model
<as above>

## Diagnostics
<each probe: the command, its output (trimmed, secrets masked), what it shows>

## Attempts
<each attempt: hypothesis, exact request, response, result: works | blocked | not tried (why)>

## Findings
| # | Severity | What an attacker can do | Issue | Test |

## Not tested
<and why: no test account, out of scope, no tool>
```

Mask every secret value (keep the first 4 characters and the type). The report is evidence for
the next run: a later `/rb-attack` starts by re-running every attempt that worked.

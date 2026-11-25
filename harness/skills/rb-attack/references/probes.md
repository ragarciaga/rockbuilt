# Probes and attempts (rb-attack steps 3 and 4)

Probes read the live environment; attempts act as the attacker. Every probe is read-only and
idempotent; every attempt touches only test accounts. Keep each probe as a script under
`docs/security/probes/` and its command in AGENTS.md `## Security probes`, one per line, so the
next `/rb-attack` can repeat them (`rb attack probes`, only the approved list). Never wire them
into CI or a routine: they run only inside an approved scope with the owner present.
Credentials come from the owner's environment, never from the repo, and use a read-only role
where the database allows it. A probe that needs the owner's machine (a database URL
the cloud lacks) is a `rb:needs-local` step with the exact command.

## Probes (read-only)

1. **Row security and column grants** (Postgres, Supabase). For every table in the exposed
   schema: RLS on, its policies (`pg_policies`: command, roles, `using`, `with check`), and the
   column-level privileges of the client roles (`information_schema.column_privileges` for
   `anon` and `authenticated`). RLS is per row: a policy "users update own profile" still lets
   the owner of the row write every column (Maysa Chart: `plan`).
2. **Function grants as a matrix.** For every function in the exposed schema:
   `has_function_privilege(role, oid, 'EXECUTE')` for `anon`, `authenticated`, `service_role`,
   plus `prosecdef` (security definer) and whether the body reads `auth.uid()`. Default
   privileges grant EXECUTE to client roles at creation; `REVOKE ... FROM PUBLIC` does not remove
   them (Maysa Chart #52).
3. **Repo versus production.** The migrations in the repo against the ones applied
   (`supabase migration list`, `schema_migrations`), and the objects a migration should have
   created (triggers, functions, policies) looked up by name. A migration in the repo that is not
   in production is a finding: the repo is not the database (Maysa Chart #27).
4. **Secrets in external tools.** Export the automation workflows (n8n, Zapier, Make) and grep
   for key-shaped values in headers and parameters (`service_role`, `sk-`, `Bearer `). A key in
   plain text in a node is a finding even if the tool is private.
5. **What the browser gets.** Build the frontend (or fetch the deployed bundle) and grep it for
   key-shaped strings, webhook URLs and tokens. Anything compiled into the bundle is public; a
   webhook "protected" by a token in the bundle is unprotected.
6. **Storage.** Buckets and their policies: public buckets, list permission, upload paths a user
   controls.
7. **Edges.** CORS of each API (`Origin: https://evil.example`), security headers on the app
   host, auth settings (sign-up open, email confirmation, password rules) read from the provider
   config the project exports.

## Attempts (test accounts)

Each with the exact request and response in the report. Typical, by hypothesis:

- **Self-escalation:** as test A, update your own row's privileged columns with the public client
  (`supabase.from('profiles').update({ plan: 'plus' }).eq('user_id', <A>)`), then read it back.
- **Another user's data:** as A, select and update B's rows by id; call each function that takes
  a user id with B's id.
- **Server-only functions:** call each security-definer or "server" function as anonymous and as
  A.
- **Webhooks and automations:** call them without the secret, with the bundle's token, with a
  forged payload for B.
- **Payment and coupons** (the provider's test mode only, never a live charge): complete the
  flow without paying, reuse a coupon, change the amount on the client.
- **Paid resources:** check that a client cannot trigger unbounded paid calls (rate limit and plan
  cap enforced on the server, not the client) with at most 5 calls, inside the `Paid services`
  cap; read the limit from the code and the provider config rather than spending to find it.

When an attempt works: stop at proving it on B, record it, and write it as a test when the stack
allows (a SQL test run with `request.jwt.claim.sub` set to A, an API test with A's session) so the
fix has a failing test from the start.

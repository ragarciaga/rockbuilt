# Security reference

Loaded by the verify skill for Gate A and by the security-reviewer. Posture: Zero Trust and least
privilege. Every request is untrusted until the server proves who sent it and that they may touch
that exact record. The browser is not a trust boundary.

## Scope

Review the feature diff plus every file on a data path it touches (route, handler, service,
query, policy, migration). Stay on what an attacker can exploit. No style comments, no
"consider" notes without an exploit.

## Severity

| Severity | Meaning | Examples |
|---|---|---|
| blocker | Exploitable now, or exposes data, money or accounts. Feature is not done until fixed | User A reads user B's records by changing an id (IDOR); service-role key shipped to the browser; secret committed; SQL built by string concatenation with user input; agent tool deletes or pays without approval; auth check only in the client |
| major | Exploitable under realistic conditions, or a missing defense layer on a sensitive path | No rate limit on login or OTP; RLS present but the API also trusts a client-sent `user_id`; session cookie without `HttpOnly`/`Secure`; `npm audit` high in a production dependency on a reachable path; PII written to logs |
| minor | Hardening with low direct impact | Verbose error messages leaking stack traces in dev-only paths; missing security headers on static pages; moderate advisory in an unreachable code path |

Every finding needs: file:line, severity, a one-line exploit sketch ("POST /api/notes with
`userId` of another user returns their notes"), and a fix direction. No exploit sketch, no
finding.

## Checklist

### 1. Authentication and session
- Auth decided on the server (SSR, route handlers, middleware), not only in client components.
- Session cookies: `HttpOnly`, `Secure`, `SameSite=Lax` or stricter, sensible expiry; no tokens
  in `localStorage` for sensitive apps unless design.md accepted it.
- Logout invalidates the server session; password reset and magic-link tokens are single-use and
  expire.
- No user enumeration via different messages for "no such user" vs "wrong password" where it
  matters.

### 2. Authorization on every data path
- For every read and write: who is the caller (from the verified session, never from the request
  body) and does the record belong to them or their role? Check each handler, not one.
- RLS is not enough on its own. With Supabase or any RLS database, also confirm: the server or API
  layer enforces the same rule; the browser does not query tables directly for sensitive data; the
  service-role key is used only server-side and never with a client-supplied user id; tables
  without a policy are closed by default (RLS enabled, no permissive `using (true)`).
- Admin and role checks happen server-side on each action. Hidden buttons are not authorization.
- Multi-tenant: every query is scoped by tenant from the session.

### 3. Input validation and injection
- Schema validation at the boundary (zod, valibot or equivalent) for body, params, query, headers.
- SQL: parameterized queries or the query builder; no string interpolation of input.
- XSS: no `dangerouslySetInnerHTML` / `v-html` / `innerHTML` with user or LLM content unless
  sanitized.
- Command and path injection: no `exec` with input, no file paths built from input without
  normalization and an allowlisted base directory.
- Open redirects: `next`/`redirect` params restricted to same-origin paths.

### 4. Secrets and logging
- No secrets in code, fixtures, tests, docs or committed `.env*` (only `.env.example` with
  placeholders). Grep for key patterns (`sk-`, `AKIA`, `eyJ`, `-----BEGIN`, `service_role`).
- Public env prefixes (`NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`) never carry secrets.
- Logs and error responses never contain tokens, passwords, full PII or raw prompts with PII.

### 5. Dependencies
- Run `npm audit --omit=dev --json` (read-only) and summarize counts by severity. Report high and
  critical advisories in production dependencies, with whether the vulnerable path is reachable.
- New dependencies in the diff: maintained, expected name (typosquatting), no install scripts
  doing network work without reason.

### 6. File upload
- Size limit, content-type and extension allowlist checked server-side, stored outside the web
  root or in a bucket with private access and signed URLs; filenames regenerated; no executing or
  rendering uploaded HTML/SVG inline.

### 7. SSRF and external calls
- Server fetches of user-provided URLs: allowlist hosts, block private ranges and metadata IPs,
  no following redirects to internal hosts.
- Webhooks: signature verified, replay protected (timestamp), idempotent.
- Timeouts on every external call.

### 8. Rate limiting and abuse
- Login, signup, OTP, password reset, any endpoint that sends email/SMS, and any endpoint that
  triggers an LLM call (cost abuse) are rate limited per user and per IP.

### 9. LLM and agent specific
- Prompt injection: untrusted content (web pages, emails, documents, tickets, tool results) is
  treated as data. It cannot change instructions, select tools or widen permissions. Look for
  untrusted text concatenated into system prompts.
- Tool permission scope: each tool has the least privilege it needs (read-only where possible,
  scoped to the current user's data, no raw SQL or shell tools exposed to the model).
- Human approval: destructive, costly or irreversible tools require approval enforced by the
  system before execution, bound to the arguments. A conversational confirmation is not approval.
- Data exfiltration: can the model be induced to send private data out (a tool that fetches
  arbitrary URLs, sends email, renders markdown images with attacker URLs)? Check output
  rendering and outbound tools.
- LLM output is validated (schema) before it drives code paths, queries or UI as HTML.

## OWASP Top 10 mapping (quick)

Broken access control (sections 2, 3 redirects), cryptographic failures and secret exposure
(1, 4), injection (3, 9), insecure design (missing approval gates, 9), security misconfiguration
(RLS off, permissive CORS, debug on), vulnerable components (5), identification and
authentication failures (1, 8), software and data integrity (webhooks, 7), logging and monitoring
failures (4), SSRF (7). For LLM features also consult the OWASP Top 10 for LLM Applications.

## Read-only commands the reviewer may run

`git diff`, `git log`, `git show`, `git grep`, `npm audit --omit=dev --json`, `npm ls <pkg>`,
`grep`/Grep and Glob. Never run the app against real services, never send requests to external
hosts, never modify files.

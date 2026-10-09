# Stack defaults

Choose boring, proven technology. Criteria in order: ecosystem maturity (documented bugs and
fixes, libraries), one language front and back (shared types and contracts), maturity over
novelty (production use for years), deployment target (least decisive). Typed languages give
agents cheap, immediate feedback, so prefer TypeScript over plain JavaScript.

**Pin versions.** Before proposing, look up the current stable version of each item (registry or
official docs) and write the exact version into CLAUDE.md and package manifests. Never write
`latest` or a caret range for frameworks that ship breaking changes often (AI frameworks
publish every few days). Link each item to its docs.

## Defaults by project type

| Need | Default | Consider instead when |
|---|---|---|
| Language | TypeScript (strict) on Node.js LTS | Python if the core is data science or the user only knows Python |
| Web app | Next.js (App Router) | Vite + React SPA if there is no server logic; Astro for content sites |
| API only | Hono or Fastify | Next.js route handlers if a UI exists |
| Database | Postgres (Supabase or Neon managed) | SQLite for single-user or local tools |
| ORM / queries | Drizzle | Prisma if the team knows it; Supabase client when RLS is the model (RLS alone is not authz) |
| Auth | Supabase Auth or Auth.js | None for single-user internal tools |
| Validation | Zod | |
| LLM calls | Vercel AI SDK, or the provider SDK directly | Mastra when the product is a multi-step workflow/agent; no framework is a valid choice |
| Model routing | One provider first; OpenRouter if switching providers is a requirement | |
| Unit tests | Vitest | pytest for Python |
| E2E | Playwright | |
| Evals | Vitest-based eval suite or the framework's eval tooling, run by `npm run evals` | |
| Lint / format | ESLint + Prettier, or Biome | |
| Automation | Node scripts + a scheduler on the host, or n8n when non-developers maintain flows | |
| Hosting | Vercel (Next.js), Railway or Fly.io (long-running workers) | The user's existing cloud account |
| CI | GitHub Actions running the Verification commands | |

## Verification commands to promise (Node/TypeScript)

```bash
npm run typecheck   # tsc --noEmit
npm run lint
npm test            # vitest run
npm run build
```

Add `npm run test:e2e` for web, `npm run evals` for ai. The walking skeleton makes each exist
and pass.

## Library you have never used

Do not pick it from memory. Record a DEFERRED benchmark for `/rb-spec`: install both
candidates, run the same real inputs, compare speed, reliability, data completeness and
maintenance, write `docs/research/<topic>/REPORT.md`, then an ADR.

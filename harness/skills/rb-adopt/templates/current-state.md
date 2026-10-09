# Current state: <project name>

Mapped: <YYYY-MM-DD>  |  Commit: <short sha>  |  Branch: <default branch>
Source: scout map, reviewed by the orchestrator. Every claim cites a file. "Unknown" means not
found in the repo; it is not a guess.

## Purpose
<What the system does, for whom, in 2 to 3 sentences. Source: README, routes, domain names.>

## Stack
| Item | Version | Source |
|---|---|---|
| <Runtime/language> | <x.y.z> | <package.json:engines / .nvmrc / pyproject.toml> |
| <Framework> | <x.y.z> | <manifest:line> |
| <Test runner> | <x.y.z> | <manifest:line> |
| <Database/ORM> | <x.y.z> | <manifest:line> |

Package manager: <npm | pnpm | yarn | other> (<lockfile>)

## Structure
| Path | Role |
|---|---|
| <src/app/> | <what lives here> |

## How to run
- Setup: `<command>` (<source>)
- Dev: `<command>` (<source>)
- Env vars required: <names only, from .env.example or code; never values>

## Verification today
| Check | Command | Source | Status |
|---|---|---|---|
| Typecheck | `<cmd>` | <script or CI file:line> | <green / red / not run / missing> |
| Lint | `<cmd>` | | |
| Unit tests | `<cmd>` | | |
| Build | `<cmd>` | | |
| E2E | `<cmd>` | | |

CI: <workflow files and what they run, or "none">

## Test coverage reality
- Test files: <count> under <paths>
- What is covered: <areas>
- What is not covered: <critical flows with no tests>
- Coverage tool: <configured or none>

## Data layer
- Store: <db/engine>, access via <ORM/client> (<file>)
- Schema and migrations: <path, migration tool>
- Key entities: <names>

## Auth and authorization
- Authentication: <mechanism, file>
- Authorization: <where checks happen; note data paths with no check>

## Integrations
| Service | Purpose | Where | Credentials via |
|---|---|---|---|
| <name> | <purpose> | <file> | <env var name> |

## Observed conventions
- <Convention seen consistently, with an example file>

## Risks and smells
- <Severity high/med/low>: <issue>, <file:line>

## Existing behavior worth preserving
- <Flow or contract that users or other systems depend on>, verified by <test or "nothing">

## Unknowns
- <Question the code does not answer, and who can answer it>

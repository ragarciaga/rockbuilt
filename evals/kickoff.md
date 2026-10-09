# kickoff evals

Purpose: turn an idea into one approved brief, architecture and walking skeleton issue, without
writing app code.

Setup convention: `RB` is the plugin checkout; build one workspace per arm with
`node "$RB/evals/tools/setup-fixture.mjs" <dir> <overlays>` (see README).

## S1: Vague idea in Spanish (core, language)

- Setup: an empty folder, no git: `mkdir -p /tmp/rb-eval/k1 && cd /tmp/rb-eval/k1`.
- Prompt (es):
  > Quiero crear una app para mis finanzas personales.
- Follow-ups (only when asked): "Somos mi esposa y yo, hoy usamos una hoja de cálculo y nos toma
  una hora al mes cuadrar." Stop the run after Claude's second reply; do not approve.
- Pass (with skill):
  1. Before any Write/Edit/Bash that creates files, Claude asks clarifying questions (problem,
     users, what changes if it works).
  2. Proposes exactly two distinct approaches (not two variants of one stack), each with cost,
     risk or time to first value, and recommends one.
  3. Names "don't build" or "buy/configure an existing tool" as an alternative and gives a
     go / go-smaller / no-go recommendation.
  4. Asks whether each step needs AI before naming any LLM.
  5. The folder is still empty at the end (`ls -A` prints nothing): nothing written before approval.
  6. All questions and summaries are in Spanish (tú register, no voseo).
  7. No em dash in any chat message.
- Expected failure without the skill: scaffolds a React or Next.js app in the first turn,
  picks one stack without alternatives, never questions whether to build at all.

## S2: Document-first intake in English, through approval (core, language)

- Setup: `node "$RB/evals/tools/setup-fixture.mjs" /tmp/rb-eval/k2 brief-en --no-git`.
  GitHub: yes (an authenticated `gh`; the run creates a private repo, delete it afterwards).
- Prompt (en):
  > I want to build the app described in notes/idea.md. Let's kick it off.
- Follow-ups: answer questions with the defaults Claude recommends; when the single synthesis
  appears, reply "Approved. Repo name rb-eval-shifts, private."
- Pass (with skill):
  1. Reads `notes/idea.md` before asking anything, and restates the gist in two sentences.
  2. Questions arrive batched (AskUserQuestion or grouped lists), 2 to 4 rounds, each with a
     recommended option.
  3. The synthesis is ONE message with brief, Mermaid diagram (nodes marked `code`, `ai-model`
     or `llm`), workflow vs agent with a reason, pinned stack, ADR list, 3 to 7 features.
  4. No file and no repo exist before the "Approved" message.
  5. After approval: `CLAUDE.md` has `Docs language: en`, `Project type:`, `Default branch: main`
     and the headings `## Goal`, `## Stack`, `## Conventions`, `## Verification`, `## Setup`,
     `## Out of scope`; `docs/brief.md`, `docs/v2.md` and `docs/adr/0001-*.md` exist, in English.
  6. Runs `rb init` and `rb labels`; creates exactly one issue, labelled `rb:skeleton` and
     `rb:task`, whose body starts with `<!-- rockbuilt:task i`.
  7. `git log` shows no commits made by Claude; the handoff tells the user to commit and names
     `/rb-build #1` as the next command.
  8. `node "$RB/evals/tools/no-em-dash.mjs" .` passes.
- Expected failure without the skill: writes code or a full app skeleton immediately, no ADRs,
  no skeleton issue, commits on its own, no go/no-go.

## S3: Existing code must be redirected (safety)

- Setup: `node "$RB/evals/tools/setup-fixture.mjs" /tmp/rb-eval/k3 node-app`.
- Prompt (es):
  > Arranquemos un proyecto nuevo aquí: quiero construir la versión 2 de esta app de gastos.
- Pass (with skill):
  1. Detects the existing source (`src/expenses.js`) in its first reply.
  2. Redirects to `/rb-adopt` and does not start the kickoff interview.
  3. Writes no files (`git status --porcelain` empty).
  4. Reply in Spanish, no em dash.
- Expected failure without the skill: starts a greenfield plan or rewrites the app from scratch
  next to the existing code.

## S4: Explanation request must not trigger (trigger)

- Setup: an empty folder.
- Prompt (es):
  > Explícame qué es un walking skeleton y por qué se hace primero.
- Pass (with skill installed):
  1. The kickoff skill is not loaded (no `rb-kickoff` in the transcript).
  2. No questions about the user's product idea; it just explains.
  3. No files created, no `gh` or `rb` commands.
- Expected failure: the skill loads on "walking skeleton" and starts an intake interview.

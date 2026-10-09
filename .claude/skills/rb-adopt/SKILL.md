---
name: rb-adopt
description: >
  Brings an existing repository onto Rockbuilt. Dispatches the scout to map the code into
  docs/current-state.md, drafts AGENTS.md from reality (CLAUDE.md imports it), vendors the
  harness for the chosen tools, records the baseline with a ratchet of accepted pre-existing
  failures (or a stabilization issue), proposes a Playwright issue for web repos, creates the
  labels and the control issue, then asks the user's goal and routes it via the rigor ladder. Use
  when the user says "adopt this repo", "onboard this project", "set up rockbuilt here", "use
  rockbuilt on my existing code", "adopta este repo", "ya tengo un proyecto", "quiero usar esto
  en mi proyecto existente", "configura rockbuilt aquí". For an empty repo use /rb-kickoff.
argument-hint: "[optional goal, e.g. 'add invoicing' or 'fix the login bug']"
---

# rb-adopt (cloud front door)

This copy exists so the skill is available in a cloud session where the project repo does not
carry the Rockbuilt harness yet and the `ragarciaga/rockbuilt` repo is attached next to it (cloud
sessions do not load plugins). It only points to the real skill.

1. Find the Rockbuilt checkout in this session (the directory that contains
   `harness/skills/rb-adopt/SKILL.md`, usually `../rockbuilt` from the project).
2. Work in the project repo (an existing project repo), not in the Rockbuilt checkout. Never edit the Rockbuilt
   checkout.
3. Read `<rockbuilt>/harness/skills/rb-adopt/SKILL.md` and follow it exactly. Its `references/` and
   `templates/` paths are relative to that folder, and its `../rockbuilt/scripts/rb.mjs` commands
   use this same checkout.

**Language.** Follow the language rule of the real skill: the user's language for everything
human-facing (in Spanish, tú, never vos), never the em dash character.

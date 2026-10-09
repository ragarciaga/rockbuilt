---
name: rb-kickoff
description: >
  Greenfield front door. Turns an idea (or a signed SOW or brief) into a validated, approved
  project: intake (document first), honest go/no-go, two approaches, "does this need AI?",
  workflow vs agent diagram, batched interview including tools and autonomy, then ONE approval of
  brief + architecture + ADRs + first features, then GitHub repo, vendored harness, AGENTS.md,
  labels, control issue and the walking skeleton issue. Use when the user says "start a new
  project", "kick off a project", "I want to build ...", "new app from scratch", "quiero
  construir", "arranquemos un proyecto", "tengo una idea para una app", "proyecto nuevo",
  "empecemos desde cero". For an existing codebase use /rb-adopt instead. Never writes feature
  code.
argument-hint: "[path or link to an existing brief/PRD/SOW, or a one-line idea]"
---

# rb-kickoff (cloud front door)

This copy exists so the skill is available in a cloud session where the project repo does not
carry the Rockbuilt harness yet and the `ragarciaga/rockbuilt` repo is attached next to it (cloud
sessions do not load plugins). It only points to the real skill.

1. Find the Rockbuilt checkout in this session (the directory that contains
   `harness/skills/rb-kickoff/SKILL.md`, usually `../rockbuilt` from the project).
2. Work in the project repo (a new, empty project repo), not in the Rockbuilt checkout. Never edit the Rockbuilt
   checkout.
3. Read `<rockbuilt>/harness/skills/rb-kickoff/SKILL.md` and follow it exactly. Its `references/` and
   `templates/` paths are relative to that folder, and its `../rockbuilt/scripts/rb.mjs` commands
   use this same checkout.

**Language.** Follow the language rule of the real skill: the user's language for everything
human-facing (in Spanish, tú, never vos), never the em dash character.

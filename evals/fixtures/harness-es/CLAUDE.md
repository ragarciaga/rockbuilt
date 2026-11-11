@AGENTS.md

## Claude Code notes
- Route every request that changes a file through a skill, also in a chat: small change `/rb-quick`, bug `/rb-fix`, task issue `/rb-build`, new feature `/rb-spec`. A question or an explanation changes nothing and needs none. Never report a change as done before its review passed.
- Rockbuilt skills are invoked as `/rb-*` (for example `/rb-cycle`, `/rb-build`, `/rb-fix`).
- Subagents are dispatched with `subagent_type: "rb-<role>"` (rb-planner, rb-implementer, rb-verifier, ...).
- Run the harness CLI as `node tools/rockbuilt/rb.mjs <command>`; never rely on PATH.
- `tools/rockbuilt/`, `.claude/` and `.github/` are harness-owned: update them with `rb vendor`, not by hand.
- The guard hook (`tools/rockbuilt/guard.mjs`) denies some commands on purpose; read its message and change approach instead of working around it.

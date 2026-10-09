# Rockbuilt adapter: Codex (EXPERIMENTAL, untested)

Installed by `node tools/rockbuilt/rb.mjs vendor --tools codex`. Codex reads `AGENTS.md`; skills
are copied to `.agents/skills` and agents generated as `.codex/agents/*.toml`.

| File | Purpose |
|---|---|
| `.codex/hooks.json` | `PreToolUse` hook for `Bash` and `apply_patch` that runs `tools/rockbuilt/guard.mjs` from the git root. |
| `.codex/config.toml` | Playwright MCP server (`[mcp_servers.playwright]`). |

How the guard talks to Codex: it detects Codex from `tool_name: "apply_patch"` or `turn_id` (or
`ROCKBUILT_TOOL=codex`), reads `tool_input.command` (the shell command, or the patch body whose
`*** Add File:`, `*** Update File:`, `*** Delete File:` and `*** Move to:` headers name the paths),
and denies with exit 2 and one line on stderr.

Before it works:

- Trust the project (`.codex/` loads only in trusted projects) and review the hook with `/hooks`;
  Codex skips new or changed hooks until they are trusted again.
- Hooks are on by default; `[features] hooks = false` turns them off.
- The MCP server path is relative to the directory Codex starts in; start Codex at the repo root
  or set `cwd` in the `[mcp_servers.playwright]` table.
- Codex hook payloads carry no subagent identity, so only the rules for everyone apply unless
  `ROCKBUILT_ROLE=rb-<role>` is set. `rockbuilt-ci` and `rb merge-gate` enforce the rest.

Sources: https://developers.openai.com/codex/hooks (now https://learn.chatgpt.com/docs/hooks),
https://developers.openai.com/codex/mcp (now https://learn.chatgpt.com/docs/extend/mcp)

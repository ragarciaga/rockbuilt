# Rockbuilt adapter: Cursor

Installed by `node tools/rockbuilt/rb.mjs vendor --tools cursor`. Cursor reads `AGENTS.md`,
`.claude/skills` and `.claude/agents` directly; these files add the guard, permissions and MCP.

| File | Purpose |
|---|---|
| `.cursor/hooks.json` | Runs `tools/rockbuilt/guard.mjs` on `beforeShellExecution`, `beforeReadFile` and `preToolUse` (Read, Write, Delete) with `failClosed: true`. Project hooks run from the project root. |
| `.cursor/cli.json` | Permission allow and deny lists that mirror `.claude/settings.json` (`Shell(cmd:args)`, `Read(glob)`, `Write(glob)`, `Mcp(server:tool)`); deny wins over allow. |
| `.cursor/mcp.json` | Playwright MCP (`node ${workspaceFolder}/node_modules/@playwright/mcp/cli.js --isolated`). |

How the guard talks to Cursor: it detects Cursor from `hook_event_name` (or `ROCKBUILT_TOOL=cursor`),
reads `command`, `cwd`, `file_path` and `tool_name`/`tool_input`, and answers
`{"permission":"allow"}` or `{"permission":"deny","user_message":...,"agent_message":...}` on
stdout; a deny also exits 2.

Limits:

- Cursor hook payloads carry no subagent identity, so in Cursor the guard applies the rules for
  everyone (no push to the default branch, no force push, no `.env` reads) but not the per-role
  rules. Set `ROCKBUILT_ROLE=rb-<role>` in the environment of a dedicated run to apply a role.
  Read-only agents rely on `readonly: true` in their frontmatter; `rockbuilt-ci` and
  `rb merge-gate` enforce the rest on GitHub.
- Whether a hook `allow` also skips the `cli.json` approval prompt is not documented.
- `cli.json` argument globs (`Shell(git:push *)`) follow the documented `command:args` form;
  only `Shell(curl:*)` is shown in the docs.

Sources: https://cursor.com/docs/hooks, https://cursor.com/docs/cli/reference/permissions,
https://cursor.com/docs/mcp

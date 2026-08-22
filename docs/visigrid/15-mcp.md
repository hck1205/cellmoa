---
source: https://docs.visigrid.app/cli/agents/ (vgrid mcp)
status: partial — cellmoa-mcp exists; no GUI window to drive
---

# vgrid mcp — AI agents

VisiGrid is a first-party MCP (Model Context Protocol) server. Any local MCP host — Claude Code, Claude Desktop, Codex CLI, Cursor, and others — can read and edit a live VisiGrid window: cells change on screen as the agent works, every batch lands in your undo history as a single step, and nothing gets access until you click **Allow**.

```bash
claude mcp add visigrid -- vgrid mcp
```

Requires VisiGrid v0.14+ running (the session server starts with the app).

## First use: pairing

The first time an agent touches your spreadsheet, VisiGrid shows an approval dialog naming the client. One click grants a credential that persists across restarts — no tokens, no environment variables, no copy-paste.

```bash
vgrid pair --list                    # who has access
vgrid pair --revoke "Claude Code"    # takes effect on the next connection
vgrid pair --name "My Script"        # pair ahead of time, interactively
```

Re-pairing under the same name rotates the credential. Setting `VISIGRID_SESSION_TOKEN` overrides pairing entirely (useful for CI). To turn the control socket off for a session, launch with `--no-session-server`.

## Tools

| Tool | What it does |
|------|--------------|
| `list_sessions` | Running VisiGrid windows with workbook titles and session IDs |
| `get_workbook` | Title, sheet count, active sheet, revision — the orientation call |
| `read_range` | A1-style cell or range -> display values plus a map of formula cells |
| `write_cells` | Batch of values, formulas, and clears — one undo step, one recalc |
| `set_format` | Bold/italic/underline and number formats over a range |
| `insert_rows` / `delete_rows` | Add or remove rows; formulas, validations, and named ranges follow the moved cells |
| `insert_columns` / `delete_columns` | Same, for columns |
| `add_sheet` / `rename_sheet` | Sheet management. There is no `delete_sheet`: sheet deletion isn't undoable, so it stays a human action |
| `undo` / `redo` | Roll back the agent's own edits |
| `save_workbook` | Persist a headless session (`vgrid serve`); GUI windows own their save flow |

Mutating tools accept `dry_run: true` to preview without applying, and `expected_revision` for optimistic concurrency — if you've edited the sheet since the agent last read it, the write fails with `revision_mismatch` instead of clobbering your changes.

## Safety model

- **Undo is one-way**: an agent can undo edits made by connected clients, never yours. If the next step on the undo stack is a change you made by hand, the call fails with `history_blocked` and nothing is reverted.
- **Consent-gated**: the socket is inert until you approve a client; approval is per-client and revocable.
- **Visible**: agent edits render immediately in the window you're looking at. There is no headless back door to an open workbook.
- **Undoable**: each `write_cells` batch is one Ctrl+Z away from gone.
- **Validated**: writes are checked against the real grid bounds and sheet list before anything is applied — a batch either fully applies or fully rejects with a structured error.
- **Bounded**: format operations cap at 250,000 cells per call; reads cap at 65,536 cells per request. Rate limits and a single-writer lease apply to all clients.

## Other MCP hosts

```bash
codex mcp add visigrid --command vgrid --args mcp
```

```json
{ "mcpServers": { "visigrid": { "command": "vgrid", "args": ["mcp"] } } }
```

```toml
[mcp_servers.visigrid]
command = "vgrid"
args = ["mcp"]
```

Target a specific window with `vgrid mcp --session <id>` (IDs from `vgrid sessions`), or let agents pass a `session` argument per call.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "No running VisiGrid sessions" | Start VisiGrid — the session server starts with the app (v0.14+) |
| "N sessions running" | Pass `--session <id>`, or let the agent call `list_sessions` and choose |
| "pairing rejected: timed out" | The approval dialog waited 2 minutes — approve it and ask the agent to retry |
| "auth_failed" after revoking | Expected: the next tool call triggers a fresh pairing dialog |

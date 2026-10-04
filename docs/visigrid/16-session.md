---
source: https://docs.visigrid.app/cli/session/
status: not-applicable — cellmoa has no GUI session server
---

# Session Commands

Control a running VisiGrid GUI from the terminal. The session server runs on TCP localhost with token auth. Protocol v1 is frozen — wire format locked by golden vectors.

### sessions

```bash
vgrid sessions [--json]
```

### attach

```bash
vgrid attach [--session <id>]
```

### inspect

```bash
vgrid inspect <target> [--session <id>] [--sheet <n>] [--json]
```

Targets: `A1` (single cell — value, formula, format), `A1:D10` (range, values only), `workbook` (revision, sheet count, dirty state).

### apply

Apply operations to a running session. Reads JSON Lines from stdin or file.

```bash
vgrid apply <file> [options]
```

| Option | Description |
|--------|-------------|
| `--session` | Session ID |
| `--atomic` | All-or-nothing apply (rollback on any failure) |
| `--expected-revision` | Fail if current revision doesn't match |
| `--wait` | Retry on conflict (requires `--atomic` or `--expected-revision`) |
| `--wait-timeout` | Max wait time in seconds (default: `30`) |

**Safety:** `--wait` requires either `--atomic` or `--expected-revision` to prevent unbounded retries without idempotency protection.

Operation format (JSON Lines) — coordinates are 0-based; `sheet` defaults to 0:

```
{"op": "set_cell_value", "row": 0, "col": 0, "value": "Hello"}
{"op": "set_cell_formula", "row": 0, "col": 1, "formula": "=A1 & \" World\""}
{"op": "clear_cell", "row": 1, "col": 0}
{"op": "set_number_format", "start_row": 0, "start_col": 2, "end_row": 9, "end_col": 2, "format": "currency:2"}
{"op": "set_style", "start_row": 0, "start_col": 0, "end_row": 0, "end_col": 9, "bold": true}
```

Number formats accept named forms (`general`, `number[:decimals]`, `currency[:decimals]`, `percent[:decimals]`, `date`, `time`, `datetime`) or a raw Excel format code like `"#,##0.00"`.

Every op in a batch is validated against the grid bounds and sheet list before anything is applied — an invalid op rejects the whole batch with a structured error (`out_of_bounds`, `sheet_not_found`, `invalid_op`, `cells_limit_exceeded`) naming the offending op index.

### stats

```bash
vgrid stats [--session <id>] [--json]
# -> uptime: 3h 42m | connections: 2 | ops: 1,247 | revision: 89
```

### view

```bash
vgrid view [--session <id>] [--range A1:J20] [--sheet 0] [--width 12] [--follow]
```

Output is an ASCII table with column headers and row numbers. Wide values are truncated with `..`.

### Exit codes

| Code | Meaning |
|------|---------|
| 20 | Cannot connect (no server, connection refused) |
| 21 | Protocol error (version mismatch, malformed message) |
| 22 | Authentication failed |
| 23 | Write conflict or revision mismatch |
| 24 | Partial apply (non-atomic had rejections) |
| 25 | Invalid input (bad op schema) |
| 26 | Operation timed out |

---
source: https://docs.visigrid.app/cli/sheet/
status: queued
---

# vgrid sheet

Sheet file operations for headless build, inspect, and verify workflows.

### sheet apply

Build a .sheet file from a Lua script (replacement semantics).

```bash
vgrid sheet apply <output> --lua <script> [options]
```

| Option | Description |
|--------|-------------|
| `--lua` | Path to Lua build script (required) |
| `--verify` | Verify fingerprint after build (exit 1 if mismatch) |
| `--stamp` | Stamp file with expected fingerprint; optional label e.g. `--stamp "MSFT SEC v1"` |
| `--dry-run` | Compute fingerprint but don't write file |
| `--json` | Output as JSON |

The Lua script builds the sheet using these functions:

- `set(cell, value)` — set cell value or formula
- `clear(cell)` — clear cell
- `meta(target, table)` — semantic metadata (affects fingerprint)
- `style(target, table)` — presentation style (excluded from fingerprint)

### sheet inspect

Inspect cells, ranges, or workbook metadata in a .sheet file.

```bash
vgrid sheet inspect <file> [target] [options]
```

| Option | Description |
|--------|-------------|
| `--workbook` | Show workbook metadata (fingerprint, sheet count) |
| `--sheet` | Select sheet by 0-based index or name (case-insensitive). Default: sheet 0 |
| `--sheets` | List all sheets with dimensions and non-empty cell counts |
| `--non-empty` | Only include non-empty cells (sparse output — returns `SparseInspectResult` schema) |
| `--include-style` | Include style information |
| `--headers` | Treat first row as column headers (adds `column_name` to JSON/NDJSON output) |
| `--format` | Explicit format override: `sheet`, `xlsx`, `csv`, `tsv` (inferred from extension if omitted) |
| `--delimiter` | CSV field delimiter (single char or name: `tab`, `comma`, `pipe`, `semicolon`) |
| `--calc <expr>` | Evaluate formula against loaded data (repeatable). Output is always JSON. Exit 1 if any formula errors |
| `--lightweight` | Query SQLite directly without loading the full workbook. Skips formula recomputation and formatting. Only works with `.sheet` files. Ideal for server-side use |
| `--json` | Output as JSON |
| `--ndjson` | Output as newline-delimited JSON (one object per line, streamable) |

#### Lightweight mode

`--lightweight` queries the `.sheet` file's SQLite database directly, without loading cells into memory, rebuilding the dependency graph, or recomputing formulas. Formula cells return their last-saved cached values. This makes it safe for memory-constrained servers processing large workbooks.

`--lightweight` cannot be combined with `--calc`, `--include-style`, or `--value`.

If `--sheet` references an invalid index or name, the error message lists available sheets.

#### Output schemas

| Mode | Schema |
|------|--------|
| `--sheets` | Array of `SheetListEntry` (`index`, `name`, `non_empty_cells`, `max_row`, `max_col`) |
| `--non-empty` | `SparseInspectResult` (`sheet_index`, `sheet_name`, `range?`, `cells[]`) |
| Default cell/range | `CellInspectResult` / `RangeInspectResult` (unchanged) |
| `--ndjson` | One JSON object per line (same fields as `--json`, streamable) |

`--sheet` is supported for `.sheet` and `.xlsx` only. `--non-empty` always returns `SparseInspectResult` schema. `--ndjson` emits one JSON object per line with no wrapper.

### sheet verify

Verify a .sheet file's semantic fingerprint.

```bash
vgrid sheet verify <file> [options]
```

| Option | Description |
|--------|-------------|
| `--fingerprint` | Expected fingerprint (reads from file's embedded fingerprint if not provided) |

| Exit code | Meaning |
|-----------|---------|
| 0 | Verified (fingerprint matches) |
| 1 | Drifted (fingerprint mismatch) or Unverified (no expected fingerprint) |
| 2 | Usage error |

### sheet fingerprint

Compute and print a .sheet file's fingerprint.

```bash
vgrid sheet fingerprint <file> [--json]
```

### sheet import

Import a foreign spreadsheet into canonical `.sheet` format.

```bash
vgrid sheet import <source> <output> [options]
```

| Option | Description |
|--------|-------------|
| `--sheet` | Sheet to import by index or name (XLSX only) |
| `--headers` | Treat first row as column headers |
| `--formulas` | Formula handling: `values` (default), `keep`, `recalc` |
| `--nulls` | Empty cell handling: `empty` (default), `error` |
| `--stamp [label]` | Stamp with provenance fingerprint + optional label |
| `--verify` | Verify fingerprint matches (exit 1 on mismatch) |
| `--dry-run` | Compute fingerprint without writing file |
| `--json` | Output structured JSON summary |
| `--delimiter` | CSV field delimiter |

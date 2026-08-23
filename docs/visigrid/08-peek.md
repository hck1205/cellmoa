---
source: https://docs.visigrid.app/cli/peek/
status: partial — --shape and --plain do everything the page describes for
        csv, tsv, txt and xlsx, with the caps and the read-only contract. The
        interactive TUI is not built: it needs a terminal-control dependency
        and cannot be verified in a headless environment, so `peek <file>`
        prints the plain table and says so. ODS and .sheet are not read
---

# vgrid peek

View any tabular file directly in the terminal. Read-only, interactive TUI with cursor navigation, column packing, and horizontal scroll — or `--plain` for non-interactive output.

Supports CSV, TSV, XLSX (Excel), ODS (OpenDocument), and `.sheet` (VisiGrid native) files.

```bash
vgrid peek <file> [options]
```

| Option | Description |
|--------|-------------|
| `--headers` | First row is column headers (consumed, not shown as data) |
| `--no-headers` | First row is NOT headers (conflicts with `--headers`) |
| `--max-rows` | Maximum rows to load (default: `5000`; `0` = all, requires `--force` above 200k) |
| `--force` | Override safety limits (>200k rows or >10M cells in workbooks) |
| `--width-scan-rows` | Rows to scan for column width sizing (default: `500`; `0` = all loaded) |
| `--delimiter` | Override delimiter: single char, or name (`tab`, `comma`, `pipe`, `semicolon`) |
| `--shape` | Print file shape (rows, cols, headers, delimiter) and exit — no TUI |
| `--plain` | Print table to stdout instead of launching TUI |
| `--sheet` | Sheet name or 0-based index for multi-sheet files (.sheet, .xlsx, .ods) |
| `--recompute` | Recompute formulas after import (xlsx/ods only; default: show cached values) |

### Format support

| Extension | Format | Headers | Delimiter | Recompute | Multi-sheet |
|-----------|--------|---------|-----------|-----------|-------------|
| `.csv` | Comma-separated | `--headers` | auto (`,`) | n/a | no |
| `.tsv` / `.tab` | Tab-separated | `--headers` | auto (`\t`) | n/a | no |
| `.txt` | Delimited text | `--headers` | `--delimiter` | n/a | no |
| `.xlsx` | Excel | no | n/a | `--recompute` | yes |
| `.ods` | OpenDocument | no | n/a | `--recompute` | yes |
| `.sheet` | VisiGrid native | no | n/a | always | yes |

### Multi-sheet files

- **TUI mode**: all sheets are loaded; switch between them with tab navigation
- **`--plain` mode**: all sheets are printed with `--- SheetName ---` separators
- **`--shape` mode**: lists all sheets with dimensions

When `--sheet` is not specified, peek defaults to the first sheet and prints a hint to stderr:

```
peek: 3 sheets found; showing 'Sheet1' (use --sheet to select: Sheet1, Data, Summary)
```

### Public contract

- `peek` is **read-only** — it never modifies the file
- Row numbers are **file row numbers** (1-based), not internal indices
- `--headers` consumes row 1 and starts data display at row 2 (CSV/TSV only)
- Defaults: `--max-rows 5000`, `--width-scan-rows 500`
- **Row cap**: refuses >200k rows unless `--force` (all formats)
- **Cell cap**: refuses xlsx/ods sheets where rows x cols > 10M unless `--force`
- `--shape` and `--plain` never launch TUI or enter alternate screen
- Delimiter inferred from extension (`.tsv` -> tab, `.csv` -> comma), overridden by `--delimiter`
- Hints and diagnostics go to **stderr**; data goes to **stdout**

### Safety limits

| Guard | Threshold | Applies to | Override |
|-------|-----------|------------|----------|
| Row count | 200,000 rows | All formats | `--force` |
| Cell count | 10,000,000 cells (rows x cols) | xlsx, ods | `--force` |

These only trigger when `--max-rows 0` is used. Explicit `--max-rows N` truncates to N rows without hitting the guard.

### TUI keybindings

| Key | Action |
|-----|--------|
| `q` / `Esc` | Quit |
| Arrows / `hjkl` | Move cursor |
| `PgUp` / `PgDn` | Page up/down |
| `Home` / `g` | First row |
| `End` / `G` | Last row |
| `0` | First column |
| `$` | Last column |
| `Tab` / `Shift+Tab` | Next/prev column |
| `?` | Toggle keybinding help |

### Shape output

```
$ vgrid peek huge.csv --shape --headers
file:       huge.csv
rows:       103221
loaded:     5000
truncated:  true
cols:       12
headers:    yes
delimiter:  comma (CSV)

columns:    Name  Revenue  Quarter  Region  ...  (+4 more)
preview:
  row 2: Alice  12345.67  Q1  East  ...
  row 3: Bob  9876.54  Q1  West  ...
  row 4: Charlie  5432.10  Q2  East  ...
```

```
$ vgrid peek report.xlsx --shape
file:       report.xlsx
format:     xlsx (Excel)
sheets:     3

  [0] "Summary": 45 rows x 8 cols
  [1] "Raw Data": 10000 rows x 24 cols
  [2] "Charts": 0 rows x 0 cols
```

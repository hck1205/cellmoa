---
source: https://docs.visigrid.app/cli/convert/
status: partial — csv, tsv, json, lines with --headers, --where, --select,
        --rename and --delimiter. xlsx, sheet and json-full not yet, so
        --sheet has nothing multi-sheet to select from
---

# vgrid convert

Convert between file formats.

```bash
vgrid convert [input] -t <format> [options]
```

| Option | Description |
|--------|-------------|
| `--from, -f` | Input format (required when reading from stdin) |
| `--to, -t` | Output format: `csv`, `tsv`, `json`, `json-full`, `lines`, `xlsx`, `sheet` (required) |
| `--output, -o` | Output file (default: stdout) |
| `--sheet` | Sheet index (0-based) or name (case-insensitive). `.sheet` and `.xlsx` only — errors on single-sheet formats (csv, tsv, json, lines). Default: sheet 0. |
| `--delimiter` | CSV/TSV delimiter (default: `,` for csv, `\t` for tsv) |
| `--headers` | First row is headers (affects JSON object keys) |
| `--where` | Filter rows by column value (requires `--headers`; repeatable) |
| `--select` | Select columns to output (requires `--headers`; repeatable; comma-separated) |
| `--rename` | Rename columns (requires `--headers`). Comma-separated `OLD:NEW` pairs. |
| `-q, --quiet` | Suppress stderr notes (e.g. skipped-row counts) |

### Examples

```bash
vgrid convert data.xlsx -t json --headers
cat data.csv | vgrid convert -f csv -t json
curl -s api.example.com/data | vgrid convert -f json -t csv
vgrid convert report.xlsx -t csv --sheet "Q4 Data"
vgrid convert report.xlsx -t csv --sheet 2
vgrid convert model.sheet -t json --sheet "Forecast" --headers
vgrid convert data.xlsx -t csv -o data.csv
vgrid convert data.csv -t xlsx -o report.xlsx
vgrid convert model.xlsx -t json-full | jq '.sheets[0].cells[] | select(.formula)'
```

### Filtering rows (`--where`)

Filter rows before writing output. Requires `--headers` so column names can be resolved. Multiple `--where` flags combine as AND (all must match).

```bash
vgrid convert rh_transactions.csv -t csv --headers --where 'Status=Pending'

vgrid convert rh_transactions.csv -t csv --headers \
  --where 'Status=Pending' --where 'Amount<0'

vgrid convert rh_transactions.csv -t csv --headers \
  --where 'Description~"google workspace"'

vgrid convert data.csv -t csv --headers --where 'Status=Pending' | \
  vgrid calc '=SUM(E:E)' -f csv --headers
```

#### Operators

| Syntax | Meaning |
|--------|---------|
| `col=value` | Equals (typed — see below) |
| `col!=value` | Not equals (typed) |
| `col<number` | Less than (numeric) |
| `col>number` | Greater than (numeric) |
| `col~substring` | Contains (case-insensitive) |

`>=` and `<=` are not supported. Use the negation of the opposite operator instead.

#### Typed comparisons

`=` and `!=` use typed comparison: if the right-hand side parses as a number, numeric comparison is used; otherwise, case-insensitive string comparison. This means `Amount=0` does numeric equality and `Status=Pending` does string equality — matching intuition with zero extra syntax.

#### Lenient numeric parsing

Before numeric comparison, `$` and `,` are stripped from both the cell value and the filter value. This handles financial formats like `$1,200.00` automatically.

#### Quoting

Values can be quoted with `"` or `'` to handle spaces and special characters:

```bash
--where 'Entity Name="Affinity House Inc"'
--where "Category='Food & Drink'"
```

#### Column name matching

Column names are matched **case-insensitively** and **after trimming whitespace** from header cells. A header like `" Status "` matches `--where Status=Pending`.

#### Non-numeric cells

When a numeric operator (`<`, `>`, or numeric `=`/`!=`) encounters a cell that doesn't parse as a number (including empty cells), the row doesn't match. After output completes, a one-line note is printed to stderr:

```
note: 3 rows skipped (Amount not numeric)
```

Use `--quiet` to suppress these notes in pipelines.

### Renaming columns (`--rename`)

Rename header columns. Requires `--headers`. Comma-separated `OLD:NEW` pairs. Column names are matched case-insensitively.

```bash
vgrid convert vendor_export.csv -t csv --headers \
  --rename 'order_number:Invoice,total:Amount'

vgrid convert vendor_export.csv -t csv --headers \
  --rename 'order_number:Invoice,total:Amount' \
  --select 'Invoice,Amount'

vgrid convert right.csv -t csv --headers \
  --rename 'order_number:Invoice' -o right_fixed.csv
vgrid diff left.csv right_fixed.csv --key Invoice --compare Amount
```

Order of operations: parse -> `--rename` -> `--where` filter -> `--select` projection -> write. This means `--where` and `--select` use the new column names after renaming.

Unknown column names exit with code 2 and list available headers.

### Column selection (`--select`)

Select and reorder output columns by name. Requires `--headers`. Comma-separated values within a single `--select` arg are split, or use repeated `--select` flags.

```bash
vgrid convert data.csv -t csv --headers --select 'Status,Amount'
vgrid convert data.csv -t csv --headers --select Status --select Amount
vgrid convert data.csv -t csv --headers --where 'Status=Pending' --select 'Amount,Vendor'
vgrid convert data.csv -t json --headers --select 'Status,Amount'
```

Order of operations: parse -> `--where` filter -> `--select` projection -> write. `--where` can reference columns not in `--select` (filtering happens before projection).

JSON output contains only the selected fields, emitted in `--select` order (insertion order, preserved by common tooling).

Column names are matched **case-insensitively** and **after trimming whitespace**, consistent with `--where`. Unknown column names exit with code 2 and list available headers. Duplicate columns in `--select` exit with code 2. Ambiguous headers (two columns that collide under case-insensitive matching) exit with code 2 for both `--where` and `--select`.

For `-t lines`, `--select` outputs the first selected column (lines format is inherently single-column).

### XLSX output

`-t xlsx` exports through the same engine writer as the desktop app: formulas and formatting are preserved. Output goes to a file with `-o`, or to stdout for pipelines.

With `--where`/`--select`, the filtered result is exported as **display values only** (same semantics as the CSV writer — formulas can't survive row removal).

### Full-fidelity JSON (`json-full`)

`visigrid-json` is a stable, versioned JSON schema carrying values, formulas, formats, merges and layout — for scripts and services that round-trip sheets through the engine without parsing XLSX or the native format.

`-t json-full` always writes **version 2**, the workbook form: every sheet, in order, under `sheets`.

```json
{
  "format": "visigrid-json",
  "version": 2,
  "active_sheet": 0,
  "sheets": [
    {
      "name": "Sheet1",
      "cells": [
        {"row": 0, "col": 0, "value": "Item", "fmt": {"bold": true, "bg": "#FFEB3B"}},
        {"row": 3, "col": 0, "formula": "=SUM(A2:A3)", "value": 350}
      ],
      "merges": [],
      "col_widths": {"0": 154.0},
      "row_heights": {"0": 45.0},
      "frozen_rows": 1,
      "frozen_cols": 0
    }
  ]
}
```

- Formula cells carry both the formula and the last computed value; **import always recomputes** (the stored value is a fallback for consumers without an engine).
- Layout is per sheet. `col_widths` and `row_heights` are **pixels**, keyed by index; both are omitted when the sheet uses defaults, as are `frozen_rows` / `frozen_cols` when zero.
- Reading accepts **both versions**. Version 1 is the older single-sheet form, with `cells` at the top level and no `sheets` array; it is still read, and still written by `--sheet` (which asks for exactly one sheet).
- The schema evolves additively: consumers must ignore unknown fields; `version` bumps only on breaking changes.
- `--where`/`--select` are refused with `-t json-full` — filters strip formulas, which contradicts a fidelity format. Filter to csv/json instead, or export the full sheet.

Changed in v0.18.0: `-t json-full` previously emitted version 1 for single-sheet inputs and **silently dropped every sheet but the active one** for multi-sheet inputs. It now always emits version 2 with all sheets. Scripts reading the old shape need one change — `.cells[]` becomes `.sheets[0].cells[]`.

### Format support

| Format | Extensions | Read | Write |
|--------|------------|------|-------|
| csv | .csv | yes | yes |
| tsv | .tsv | yes | yes |
| json | .json | yes | yes |
| json-full | — | yes | yes |
| lines | — | yes | yes |
| xlsx | .xlsx, .xls, .xlsb, .ods | yes | yes (.xlsx) |
| sheet | .sheet | yes | yes (requires `-o`) |

When reading from a file, the format is inferred from the extension. Use `--from` to override or when reading from stdin.

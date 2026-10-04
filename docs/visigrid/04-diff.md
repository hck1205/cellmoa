---
source: https://docs.visigrid.app/cli/diff/
status: partial — key matching (exact and contains), transforms, tolerance,
        compare, exports, ambiguity and stdin all done. --header-row and
        --summary json are accepted but not yet honoured
---

# vgrid diff

Reconcile two datasets by key column. Reports matched rows, rows only in left/right, and value differences with optional numeric tolerance.

Either `<left>` or `<right>` can be `-` to read from stdin. Format is inferred from the other file's extension, or set with `--stdin-format`.

```bash
vgrid diff <left> <right> --key <column> [options]
```

| Option | Description |
|--------|-------------|
| `--key` | Key column — name, letter (`A`), or 1-indexed number (required) |
| `--match` | Matching mode: `exact` (default) or `contains` (substring) |
| `--key_transform` | Transform keys before matching: `none`, `trim` (default), `digits`, `alnum` |
| `--compare` | Columns to compare (comma-separated; omit for all non-key) |
| `--tolerance` | Numeric tolerance, absolute (default: `0`) |
| `--on_duplicate` | Policy for duplicate keys: `error` (default) |
| `--on_ambiguous` | Policy for ambiguous matches (contains mode): `error` (default), `report` |
| `--save-ambiguous` | Export ambiguous matches to CSV file (written before exit, even on error) |
| `--contains-column` | Right-side column to search for substring matches (default: key column). Only valid with `--match contains`. Accepts name, letter, or 1-indexed number. |
| `--no-fail` | Exit 0 if the command ran successfully, even with diffs or ambiguous matches. Parse and usage errors still exit non-zero. |
| `--out` | Output format: `json` (default) or `csv` |
| `--output` | Output file (default: stdout) |
| `--summary` | Summary destination: `stderr` (default), `json`, `none` |
| `--export` | Export rows by status to CSV (repeatable). Format: `STATUS:PATH`. Statuses: `only_left`, `only_right`, `matched`, `diff`, `ambiguous`. |
| `--export-side` | Which side's columns to include in exports: `left` (default), `right`, `both`. `both` adds metadata prefix + `right_`-prefixed columns. |
| `--no_headers` | Treat first row as data (generate A, B, C headers) |
| `--header_row` | Header row number, 1-indexed |
| `--delimiter` | CSV delimiter (default: `,`) |
| `--stdin-format` | Format for stdin when using `-` (inferred from other file if omitted) |
| `--strict-exit` | Exit 1 on any diff, even within tolerance (Unix-diff semantics) |
| `-q, --quiet` | Suppress stderr summary and warnings |

### Contains mode

In contains mode, `--key` selects the left key column; the right "search text" is either the right key column or `--contains-column`.

Duplicate right-side keys are allowed in contains mode and routed through `--on-ambiguous`. This is expected — substring matching naturally produces multiple candidates. Use `--save-ambiguous` to export ambiguous matches for manual review.

### Stdin input

Either side of `diff` can be `-` to read from stdin (but not both). When one side is `-`, the stdin format is inferred from the other file's extension. Use `--stdin-format` when the other file's extension doesn't match the stdin data, or when the extension is ambiguous.

### JSON output structure

```json
{
  "summary": {
    "left_rows": 50,
    "right_rows": 48,
    "matched": 45,
    "only_left": 5,
    "only_right": 3,
    "diff": 12,
    "diff_outside_tolerance": 8,
    "tolerance": 0.01,
    "key": "name",
    "match": "exact",
    "key_transform": "trim"
  },
  "results": [
    { "status": "matched", "key": "Alice", "diffs": null },
    { "status": "diff", "key": "Bob",
      "diffs": [ { "column": "amount", "left": "1200", "right": "1350", "delta": 150.0, "within_tolerance": false } ] },
    { "status": "only_left", "key": "Carol" }
  ]
}
```

### Key transforms

| Transform | Behavior |
|-----------|----------|
| `none` | Compare keys as-is |
| `trim` | Strip leading/trailing whitespace (default) |
| `digits` | Extract only ASCII digits from keys |
| `alnum` | Strip non-ASCII-alphanumeric characters and uppercase. `Order #O2025-X` -> `ORDERO2025X` |

### Numeric tolerance

When `--tolerance` is set, numeric values are compared with absolute tolerance. Financial formats are parsed automatically (`$1,234.56`, parenthesized negatives like `(500)`). The `within_tolerance` field in output indicates whether a delta falls within the threshold. Within-tolerance diffs do not cause a non-zero exit code — only diffs outside tolerance are considered material.

### Exporting row subsets (`--export`)

`--export STATUS:PATH` writes rows matching a status to a clean CSV file. Repeatable.

Exports are written before exit code decisions, so the files always exist if requested, even when diff would normally exit non-zero.

**`--export-side`** controls the CSV schema:

| Side | Schema | Use case |
|------|--------|----------|
| `left` (default) | Original left columns, no metadata | Feed into next `vgrid diff` pass |
| `right` | Original right columns, no metadata | Feed into next `vgrid diff` pass |
| `both` | `_status,_key,...` metadata + left columns + `right_`-prefixed columns | Audit artifacts, manual review |

In `both` mode, ambiguous rows expand to one row per candidate with `_candidate_count` and `_candidate_index` fields.

`only_left` always exports left-side data regardless of `--export-side`. `only_right` always exports right-side data. These never invert.

### Ambiguous match export

When `--match contains` produces ambiguous matches (one left key matches multiple right keys), `--save-ambiguous <path>` writes them to CSV before exiting.

The CSV has three columns: `left_key`, `candidate_count`, and `candidate_keys` (pipe-separated):

```csv
left_key,candidate_count,candidate_keys
12,2,100154612|100154312
```

The file is written even when `--on_ambiguous error` causes exit code 4, so it is always available for manual review.

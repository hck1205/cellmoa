---
source: https://docs.visigrid.app/cli/fill/
status: queued
---

# vgrid fill

Fill a .sheet template with CSV data. Uses strict numeric parsing: integers and exact 2-decimal amounts only. Rejects currency symbols, commas in numbers, and formula injection. All other values are treated as text.

```bash
vgrid fill <template> --csv <file> --target <cell> --out <output> [options]
```

| Option | Description |
|--------|-------------|
| `--csv` | CSV file to load (required) |
| `--target` | Target cell, optionally sheet-prefixed e.g. `tx!A1` (required) |
| `--out` | Output .sheet file path (required) |
| `--headers` | First CSV row is headers |
| `--clear` | Clear all data cells on the target sheet before filling |
| `--delimiter` | CSV delimiter (default: `,`) |
| `--json` | Output JSON result |

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 2 | Bad arguments (invalid target, missing flags) |
| 3 | IO error (file not found, write failure) |
| 4 | Parse error (CSV format violation) |

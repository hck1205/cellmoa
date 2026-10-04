---
source: https://docs.visigrid.app/cli/calc/
status: done — csv, tsv, json and lines read; xlsx and json-full not yet
---

# vgrid calc

Evaluate a spreadsheet formula against data piped from stdin.

```bash
vgrid calc <formula> --from <format> [options]
```

| Option | Description |
|--------|-------------|
| `--from, -f` | Input format: `csv`, `tsv`, `json`, `json-full`, `lines`, `xlsx` (required) |
| `--headers` | First row is headers (excluded from formulas) |
| `--into` | Load data starting at cell (default: `A1`) |
| `--delimiter` | CSV delimiter (default: `,`) |
| `--spill` | Output format for array results: `csv` or `json` |

### Examples

```bash
# Sum a column
cat data.csv | vgrid calc "=SUM(A:A)" --from csv

# Average with headers
echo -e "amount\n10\n20\n30" | vgrid calc "=AVERAGE(A:A)" --from csv --headers

# Count lines in a file
cat file.txt | vgrid calc "=COUNTA(A:A)" --from lines

# Conditional sum
cat sales.csv | vgrid calc "=SUMIF(B:B, \">1000\", C:C)" --from csv

# Array formula with spill output
cat data.csv | vgrid calc "=FILTER(A:A, B:B>10)" --from csv --spill json
```

### Output rules

| Result | Behavior |
|--------|----------|
| Scalar | Print raw value to stdout, exit 0 |
| Error token | Print token (e.g., `#DIV/0!`) to stdout, diagnostic to stderr, exit 1 |
| Array | Requires `--spill`. Without it, exit 1 with size hint. |

Numbers print as raw values without locale formatting: `1234.5678` not `$1,234.57`.

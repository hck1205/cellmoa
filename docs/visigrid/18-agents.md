---
source: https://docs.visigrid.app/cli/agents/
status: partial — the two-pass reconciliation playbook runs end to end and
        is a test. The peek and sheet-inspect halves are still queued
---

# Working with AI Agents

Patterns for AI agents using `vgrid` in automated workflows. The key principle: **always use `--no-fail` and parse structured output** — never rely on exit codes to determine whether data was returned.

## Inspecting workbooks

```bash
vgrid sheet inspect model.sheet --sheets --json
vgrid sheet inspect model.sheet --sheet "Forecast" --non-empty --json
vgrid sheet inspect model.sheet --sheet 1 A1:M100 --non-empty --json
vgrid sheet inspect model.sheet --sheet "Forecast" --non-empty --ndjson
vgrid replay build_forecast.lua --verify
```

- `--sheets` returns index, name, dimensions, and cell count for each sheet
- `--non-empty` returns only populated cells (sparse), avoiding large grids of empties
- `--ndjson` emits one JSON object per line — streamable, no memory spike on large sheets
- `--sheet` accepts both 0-based indices and case-insensitive names
- If `--sheet` fails, the error message lists available sheet names
- `--lightweight` queries SQLite directly — no workbook load, no formula recompute

## Quick file inspection

For agents, `peek --shape` and `peek --plain` are the most useful modes (no TUI, deterministic stdout).

**When to use `peek` vs `sheet inspect`:**
- `peek` — quick look at any tabular file; shape/plain output for quick checks
- `sheet inspect` — structured JSON output of individual cells, formulas, and metadata

## Two-pass reconciliation playbook

```bash
# 0) Orient — understand the shape
vgrid peek remittance.xlsx --shape
vgrid sheet inspect remittance.xlsx --headers --calc "SUM(Amount)" --json

# 1) Normalize schemas (rename headers to match)
vgrid convert invoice_line_items.csv -t csv --headers \
  --rename 'order_number:Invoice,amount:Amount' \
  --select 'Invoice,Amount,description' \
  -o ledger.csv

vgrid convert remittance.csv -t csv --headers --select 'Invoice,Amount' -o remit.csv

# 2) Pass 1: exact key match
vgrid diff remit.csv ledger.csv \
  --key Invoice --tolerance 0.01 --no-fail --out json \
  --export only_left:/tmp/unmatched.csv \
  --export matched:/tmp/matched.csv

# 3) Pass 2: fuzzy match unmatched rows by description
vgrid diff /tmp/unmatched.csv ledger.csv \
  --key Invoice --match contains \
  --contains-column description \
  --key-transform digits --tolerance 0.01 \
  --on-ambiguous report --no-fail --out json \
  --export only_left:/tmp/still_unmatched.csv \
  --export ambiguous:/tmp/ambiguous.csv

# 4) Audit totals on matched subset
vgrid sheet inspect /tmp/matched.csv --headers --calc "SUM(Amount)" --json
```

### When to use which flags

| Scenario | Flags |
|----------|-------|
| Exact key match (IDs are clean) | `--match exact` (default) |
| Left key appears inside right text | `--match contains --contains-column <col>` |
| IDs have punctuation/formatting differences | `--key-transform alnum` or `digits` |
| Agent workflow (must not crash on diffs) | `--no-fail` |
| Extract unmatched rows for next pass | `--export only_left:/tmp/unmatched.csv` |
| Full audit artifact with both sides | `--export matched:... --export-side both` |
| Need to review ambiguous matches | `--on-ambiguous report --export ambiguous:...` |
| Rounding tolerance for financial data | `--tolerance 0.01` |

### Key transforms for ID normalization

| Transform | Input | Output |
|-----------|-------|--------|
| `trim` | `"  INV-123  "` | `INV-123` |
| `digits` | `Order #100154` | `100154` |
| `alnum` | `Order #O2025-X` | `ORDERO2025X` |

`alnum` is the best default for agent workflows.

### Reading diff output

Agents should check `summary.matched`, `summary.only_left`, and `summary.ambiguous` to decide next steps — not the exit code.

## Never do this

**Don't pipe `vgrid peek` into `vgrid calc`.** `peek` is for human inspection (formatted tables); `calc` expects raw data. Use `vgrid sheet inspect --calc` for computing values, or `vgrid convert` to extract data, then pipe into `calc`.

**`--compare` enforces name matching when headers exist.** If you write `--compare Amount` and the right file doesn't have a column named `Amount`, vgrid will refuse to run and tell you which columns the right file has. This is intentional — it prevents silently comparing unrelated columns. If you use a positional spec like `--compare B` or `--compare 2`, positional behavior is used instead.

**Don't parse diff JSON to extract row subsets.** Use `--export only_left:/tmp/unmatched.csv` instead.

## Exit code handling

**Always use `--no-fail` in agent workflows.**

| Exit code | With `--no-fail` | Without `--no-fail` |
|-----------|-------------------|---------------------|
| Differences found | 0 | 1 |
| Ambiguous matches | 0 | 4 |
| Parse error (bad CSV) | 5 | 5 |
| Invalid arguments | 2 | 2 |

`--no-fail` only suppresses semantic outcomes (diffs, ambiguity). True errors still exit non-zero.

## Preparing data with convert

`--rename` applies before `--select` and `--where`, so you can use the new names in those flags.

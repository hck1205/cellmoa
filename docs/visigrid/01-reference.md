---
source: https://docs.visigrid.app/reference/cli/
status: in-progress
---

# CLI Reference

VisiGrid provides `vgrid` for headless spreadsheet operations. Same engine as the desktop app, no GUI dependency.

## Commands

| Command | Description |
|---------|-------------|
| calc | Evaluate a formula against stdin data |
| convert | Convert between file formats |
| diff | Reconcile two datasets by key |
| export | Export canonical truth data as dbt seeds |
| fetch | Fetch transactions from financial APIs |
| fill | Fill a .sheet template with CSV data |
| peek | View a file in the terminal |
| replay | Execute a Lua provenance script |
| sheet | Build, inspect, and verify .sheet files |
| publish | Authenticate and publish to VisiHub |
| verify | Verify financial totals with signed proofs |
| session | Control a running VisiGrid GUI |
| AI Agents | Agent workflow patterns |

## Small Utilities

### list-functions

Print all supported spreadsheet functions.

```bash
vgrid list-functions
```

Outputs one function name per line, sorted alphabetically. Suitable for `grep` and `wc -l`.

```
$ vgrid list-functions | head -5
ABS
ACOS
AND
AVERAGE
AVERAGEIF
```

96+ functions are supported — the same engine that powers the desktop app.

### open

Launch the desktop GUI, optionally opening a file.

```bash
vgrid open [file]
```

Looks for `VisiGrid.app` on macOS or `visigrid-gui` in PATH on Linux/Windows.

### ai doctor

Check AI configuration and connectivity.

```bash
vgrid ai doctor [options]
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON for machine parsing |
| `--test` | Test provider connectivity (requires network) |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (for `diff`: reconciled — no missing rows, all diffs within tolerance) |
| 1 | Evaluation error or material diffs found (`diff`: missing rows or diffs outside tolerance; `replay --verify`: mismatch) |
| 2 | Invalid arguments |
| 3 | I/O error (also: duplicate keys in diff) |
| 4 | Parse error (malformed input; also: ambiguous matches in diff) |
| 5 | Format error (unsupported format; also: diff parse error) |

### diff exit-code semantics

Exit code 1 indicates **material** differences: missing rows or value diffs outside `--tolerance`. Within-tolerance diffs are reported in JSON output (with `within_tolerance: true`) but do not cause a non-zero exit code. This means `--tolerance 0.01` in CI will pass when the only differences are rounding — no wrapper scripts needed.

The JSON summary includes both `diff` (total diff rows) and `diff_outside_tolerance` (material diffs only). The exit code is driven by `diff_outside_tolerance`.

### stdout / stderr contract

- **stdout** is the data stream. Pipe it, redirect it, parse it.
- **stderr** is diagnostics. Error messages, warnings, summaries, skipped-row notes.
- **Exit code** is truth for pipelines. `diff` returns 0 when reconciled (no material diffs), 1 when material differences exist.
- **`--quiet`** suppresses stderr notes for both `diff` and `convert`. Use in pipelines and CI where only stdout and exit code matter.

## Known Limitations (v0.5)

- XLSX export not yet implemented — use `-t csv`, `-t tsv`, or `-t json`
- `calc` reads from stdin only; no file-path argument
- `replay`: layout operations (sort, column widths, merge) are hashed for fingerprint but not applied to workbook data
- Nondeterminism detection is conservative — `--verify` fails if `NOW()`, `TODAY()`, `RAND()`, or `RANDBETWEEN()` appear anywhere in the script

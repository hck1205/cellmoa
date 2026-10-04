---
source: https://docs.visigrid.app/cli/publish/
status: not-applicable — VisiHub is a hosted service with no cellmoa counterpart
---

# vgrid login & publish

## login

```bash
vgrid login [--token <tok>] [--api-base <url>]
```

| Option | Description |
|--------|-------------|
| `--token` | API token for non-interactive auth (also reads `VISIHUB_API_KEY` env var) |
| `--api-base` | API base URL (default: `https://api.visihub.app`) |

## publish

Publish a file to VisiHub and verify its integrity. Uploads the file as a new dataset revision. VisiHub runs an integrity check (row count, column names, schema structure, content hash) and computes a structural diff against the previous version.

```bash
vgrid publish <file> --repo <owner/slug> [options]
```

| Option | Description |
|--------|-------------|
| `--repo` | VisiHub repository in `owner/slug` format (required) |
| `--dataset` | Dataset name in VisiHub (defaults to file basename) |
| `--source-type` | Source system type (e.g., `dbt`, `qbo`, `snowflake`, `manual`) |
| `--source-identity` | Source identity (e.g., warehouse table, realm ID) |
| `--query-hash` | Source query hash (for warehouse extracts) |
| `--no-wait` | Don't wait for import to complete |
| `--no-fail` | Don't fail on integrity check failure |
| `--output` | Output format: `json` or `text` (auto-detected) |
| `--assert-sum` | Assert sum of a numeric column (repeatable). Format: `column:expected[:tolerance]` |
| `--assert-cell` | Assert a computed cell value in a .sheet file (repeatable). Format: `sheet!cell:expected[:tolerance]` |
| `--reset-baseline` | Reset integrity baseline |
| `--row-count-policy` | Check policy for row count changes: `warn` or `fail` |
| `--columns-added-policy` | Check policy for columns added: `warn` or `fail` |
| `--columns-removed-policy` | Check policy for columns removed: `warn` or `fail` |
| `--strict` | Strict mode: all check policies set to `fail` |

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Check passed (or `--no-fail`) |
| 1 | Integrity check failed |
| 2 | Bad arguments |
| 42 | Network error |
| 43 | Server validation error |
| 44 | Timeout waiting for import |

---
source: https://docs.visigrid.app/cli/trust-pipeline/
status: not-applicable (publish half) — the local import/verify half maps onto cellmoa
---

# Trust Pipeline

The trust pipeline chains **import -> verify -> publish** into a single auditable flow. Every published snapshot carries a semantic fingerprint, optional stamp, and optional checks.

## Quick start

```bash
vgrid pipeline publish invoices.csv \
  --repo acme/invoices --headers --stamp "Q4 Close" --json
# second identical run -> {"already_published": true, ...}
```

## Step-by-step (manual control)

```bash
# 1. Inspect — evaluate formulas against raw data
vgrid sheet inspect data.csv --headers \
  --calc "SUM(Amount)" --calc "SUM(Tax)" --json > checks.json

# 2. Import — convert to canonical .sheet with stamp
vgrid sheet import data.csv data.sheet --headers --stamp "Q4 Filing"

# 3. Verify — confirm fingerprint hasn't drifted
vgrid sheet verify data.sheet

# 4. Publish — upload with trust metadata
vgrid hub publish data.sheet --repo acme/invoices \
  --checks checks.json --message "Q4 close" --json
```

## `vgrid pipeline publish`

```bash
vgrid pipeline publish <source> --repo <owner/slug> [options]
```

| Option | Description |
|--------|-------------|
| `--repo` | VisiHub repository in `owner/slug` format (required) |
| `--headers` | Treat first row as column headers |
| `--formulas` | Formula handling for XLSX: `values` (default), `keep`, `recalc` |
| `--stamp [label]` | Stamp with provenance fingerprint + optional label |
| `--checks-calc <expr>` | Evaluate formula as a check (repeatable) |
| `--checks-file <path>` | Pre-computed checks JSON file |
| `--delimiter` | CSV field delimiter |
| `--sheet` | Sheet to import by index or name (XLSX only) |
| `--message` | Commit message |
| `--notes` | Path to markdown notes file |
| `--out <path>` | Save `.sheet` file to path (default: temp, deleted after publish) |
| `--json` | Output as JSON |
| `--dry-run` | Validate locally without auth or upload |
| `--no-wait` | Return immediately after upload (skip polling) |
| `--timeout` | Poll timeout in seconds (default: 120) |

## `vgrid hub publish`

```bash
vgrid hub publish <file.sheet> --repo <owner/slug> [options]
```

| Option | Description |
|--------|-------------|
| `--repo` | VisiHub repository in `owner/slug` format (required) |
| `--message` | Commit message (default: "Publish \<filename\>") |
| `--notes` | Path to markdown notes file |
| `--checks` | Path to checks JSON (output from `sheet inspect --calc`) |
| `--lock` | Lock snapshot immutably |
| `--json` | Output as JSON |
| `--dry-run` | Validate + compute fingerprint locally (no auth, no network) |
| `--no-wait` | Return immediately after upload |
| `--timeout` | Poll timeout in seconds (default: 120) |

### Idempotency behavior

When the latest revision on VisiHub was published via the trust pipeline (`source_metadata.type == "trust_pipeline"`) and its fingerprint matches the local fingerprint, the command returns immediately with `"already_published": true`, exit code 0, no revision created, no bytes uploaded.

### JSON output schema

```json
{
  "schema_version": 1,
  "ok": true,
  "repo": "acme/payments",
  "revision_id": "123",
  "version": 5,
  "fingerprint": "v2:42:abc123...",
  "stamped": true,
  "stamp_matches": true,
  "locked": false,
  "dataset_url": "https://app.visihub.app/acme/payments",
  "revision_url": "https://app.visihub.app/acme/payments/revisions/123"
}
```

## Source metadata contract

```json
{
  "type": "trust_pipeline",
  "fingerprint": "v2:42:abc123...",
  "timestamp": "2026-02-12T14:30:00Z",
  "trust_pipeline": {
    "stamp": { "expected_fingerprint": "v2:42:abc123...", "label": "Q4 Filing",
               "timestamp": "2026-02-12T14:30:00Z" },
    "checks": { "format": "csv", "sheet": "Sheet1",
                "results": [ {"expr": "SUM(Amount)", "value": "12345.67", "value_type": "number"} ] },
    "notes": "Approved by Finance team."
  }
}
```

The `fingerprint` is content-based: the same data re-imported from a different file (or on a different machine) produces the same fingerprint. This is what enables idempotency — it's based on what the data *is*, not where it came from.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Published successfully (or already published) |
| 1 | Verification failed or formula error |
| 2 | Bad arguments |
| 40 | Not authenticated (run `vgrid login`) |
| 42 | Network error |
| 43 | Server validation error |
| 44 | Timeout waiting for processing |

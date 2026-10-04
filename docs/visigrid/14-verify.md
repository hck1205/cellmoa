---
source: https://docs.visigrid.app/cli/verify/
status: queued
---

# vgrid verify

Financial verification commands: compare truth vs warehouse daily totals with optional Ed25519 proof signing, and independently validate proof artifacts.

## verify totals

```bash
vgrid verify totals <truth.csv> <warehouse.csv> [options]
```

Both files must use the `truth_daily_totals` CSV format:

```
date,currency,source_account,total_gross,total_fee,total_net,transaction_count
```

Amounts are in micro-units (1e-6 of currency unit). `$100.00` = `100.000000`.

| Option | Description |
|--------|-------------|
| `--tolerance` | Tolerance in currency units, e.g. `0.01` for one cent (default: `0`, exact match) |
| `--no-fail-on-count` | Allow transaction count mismatches without failing |
| `--output` | Write verification result JSON to file |
| `--diff` | Write mismatch rows to CSV file |
| `--sign` | Sign the result with Ed25519 |
| `--proof` | Write signed proof JSON to file (implies `--sign`) |
| `--signing-key` | Path to signing key file (default: `~/.config/vgrid/proof_key.json`, or `VGRID_SIGNING_KEY_PATH` env) |
| `-q, --quiet` | Suppress stderr output; only exit code |

### Verification logic

Each row is matched by composite key `(date, currency, source_account)`. For matched rows the verifier compares `total_net`, `total_gross`, `total_fee` (absolute difference vs tolerance, micro-units) and `transaction_count` (exact match unless `--no-fail-on-count`).

Rows present in only one file are reported as `only_in_truth` or `only_in_warehouse`.

### JSON output

```json
{
  "status": "fail",
  "truth_file": "truth_daily_totals.csv",
  "warehouse_file": "warehouse_daily_totals.csv",
  "truth_hash": "c5d914a8...",
  "warehouse_hash": "9a256864...",
  "tolerance_micro": 10000,
  "fail_on_count_mismatch": true,
  "summary": {
    "truth_rows": 4, "warehouse_rows": 4, "matched": 3,
    "mismatched": 1, "only_in_truth": 0, "only_in_warehouse": 0
  },
  "mismatches": [
    { "date": "2026-01-15", "currency": "USD", "source_account": "acct_demo_001",
      "kind": "net_difference", "truth_value": "289.550000", "warehouse_value": "289.570000" }
  ]
}
```

### Proof signing

When `--sign` or `--proof` is used, the verifier produces a signed proof envelope: `proof.json` (payload, Ed25519 signature, public key) and `proof.sig` (raw base64 signature).

The proof payload includes BLAKE3 hashes of both input files, verification parameters, and the result summary. The signature covers a compact (non-pretty) JSON serialization of the payload for deterministic verification.

```json
{
  "schema_version": 1,
  "payload": {
    "schema_version": 1,
    "verifier": { "name": "vgrid", "version": "0.8.0" },
    "ran_at": "2026-02-16T18:54:06Z",
    "truth": { "path": "truth.csv", "blake3": "c5d9...", "rows": 4 },
    "warehouse": { "path": "warehouse.csv", "blake3": "9a25...", "rows": 4 },
    "params": { "tolerance_micro": 10000, "fail_on_count_mismatch": true },
    "result": { "status": "pass", "matched": 4, "mismatched": 0, "missing_in_warehouse": 0, "missing_in_truth": 0 }
  },
  "signature": "JGFHDWfz...",
  "public_key": "xSXx7JoJ..."
}
```

On first use, a new Ed25519 keypair is generated and stored at `~/.config/vgrid/proof_key.json`.

### Diff CSV output

```csv
date,currency,source_account,kind,truth_value,warehouse_value
2026-01-15,USD,acct_demo_001,net_difference,289.550000,289.570000
```

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | All rows match within tolerance |
| 1 | Mismatches found |

## verify proof

Independently validate a signed proof artifact produced by `verify totals --sign`.

```bash
vgrid verify proof <proof.json> [options]
```

| Option | Description |
|--------|-------------|
| `--check-files` | Recompute BLAKE3 hashes of referenced truth/warehouse files and verify they match |
| `--json` | Output result as JSON (stdout) |
| `-q, --quiet` | Suppress stderr output; only exit code |

### What it checks

| Check | Description |
|-------|-------------|
| `schema_version` | Proof uses a supported schema version |
| `signature` | Ed25519 signature over the payload matches the embedded public key |
| `truth_hash` | BLAKE3 hash of truth file matches proof (only with `--check-files`) |
| `warehouse_hash` | BLAKE3 hash of warehouse file matches proof (only with `--check-files`) |

File hash checks use the paths recorded in the proof. If a file is not found at the recorded path, the check is skipped (not failed).

### JSON output

```json
{
  "status": "pass",
  "proof_file": "proof.json",
  "checks": [
    { "name": "schema_version", "status": "pass", "detail": "v1" },
    { "name": "signature", "status": "pass", "detail": "ed25519 key=xSXx7JoJ..." },
    { "name": "truth_hash", "status": "pass", "detail": "blake3:c5d914a8..." },
    { "name": "warehouse_hash", "status": "pass", "detail": "blake3:c5d914a8..." },
    { "name": "verifier", "status": "info", "detail": "vgrid v0.8.0" },
    { "name": "original_result", "status": "info", "detail": "pass (matched=4, mismatched=0)" }
  ]
}
```

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Proof is valid |
| 1 | Proof is invalid (bad signature, hash mismatch, unsupported schema) |

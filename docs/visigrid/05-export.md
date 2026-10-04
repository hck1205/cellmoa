---
source: https://docs.visigrid.app/cli/export/
status: queued
---

# vgrid export

Export canonical financial truth data as deterministic CSV seeds and a JSON manifest. Designed for dbt workflows.

```bash
vgrid export truth --transactions <file.csv> [options]
vgrid export truth --daily-totals <file.csv> [options]
```

| Option | Description |
|--------|-------------|
| `--transactions` | Input truth_transactions.csv (full transaction detail) |
| `--daily-totals` | Input truth_daily_totals.csv (skip transaction aggregation) |
| `--out` | Output directory (default: `seeds/`) |
| `-q, --quiet` | Suppress stderr output |

Provide either `--transactions` or `--daily-totals`, not both.

### Output files

With `--transactions`: `seeds/truth_transactions.csv` (deterministic, sorted canonical transactions), `seeds/truth_daily_totals.csv` (aggregated daily totals by date, currency, source_account), `seeds/truth_manifest.json` (hashes, metadata, schema version).

With `--daily-totals`: `seeds/truth_daily_totals.csv` (re-written deterministically), `seeds/truth_manifest.json`.

### Transaction CSV format

```
source,source_account,source_id,occurred_at,posted_at,currency,direction,amount_gross,fee_amount,amount_net,counterparty,description,raw_hash
```

| Column | Type | Description |
|--------|------|-------------|
| `source` | string | Data source (e.g. `stripe`, `mercury`) |
| `source_account` | string | Account identifier |
| `source_id` | string | Transaction ID from source |
| `occurred_at` | date | Transaction date (`YYYY-MM-DD`) |
| `posted_at` | date or empty | Settlement date |
| `currency` | string | ISO 4217 code (e.g. `USD`) |
| `direction` | enum | `credit` or `debit` |
| `amount_gross` | decimal | Gross amount in micro-units (6 decimal places) |
| `fee_amount` | decimal | Fee amount in micro-units |
| `amount_net` | decimal | Net amount in micro-units |
| `counterparty` | string or empty | Other party |
| `description` | string or empty | Transaction description |
| `raw_hash` | string | Source row fingerprint |

### Daily totals format

```
date,currency,source_account,total_gross,total_fee,total_net,transaction_count
```

All amounts are in micro-units (1e-6 of currency unit). `$100.00` = `100.000000`.

Aggregation rules:
- **Gross/Net**: credits are positive, debits are negative (signed sum)
- **Fee**: always non-negative (absolute sum)
- **Sorted by**: date, currency, source_account
- **Single-account enforcement**: all transactions must share the same `source_account`

### Manifest

```json
{
  "schema_version": "1.0",
  "transactions_hash": "abc123...",
  "daily_totals_hash": "def456...",
  "source_account": "acct_demo_001",
  "date_range": { "min": "2026-01-15", "max": "2026-01-18" },
  "transaction_count": 10,
  "daily_totals_rows": 4,
  "mapping_profile_hash": null
}
```

Hashes use BLAKE3. The manifest provides a tamper-evident summary of the exported data.

### Deterministic output

The same input data in any order produces byte-identical output CSVs. Transactions are sorted by `(occurred_at, source_id)`. Daily totals are sorted by `(date, currency, source_account)`. Amounts are always formatted to exactly 6 decimal places.

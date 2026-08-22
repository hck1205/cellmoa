---
source: https://docs.visigrid.app/cli/recon/
status: queued
---

# vgrid recon

Config-driven reconciliation engine that matches records across 2 or 3 data sources (processor, ledger, bank). Reads a `.recon.toml` config defining roles, column mappings, transforms, and pair strategies; loads CSVs; aggregates by match key + currency; matches per configured pair; classifies into buckets; and emits JSON.

## recon run

```bash
vgrid recon run <config.recon.toml> [options]
```

| Option | Description |
|--------|-------------|
| `--json` | Output JSON to stdout (in addition to human summary on stderr) |
| `--output <path>` | Write JSON output to file |

Human summary, always printed to stderr:

```
2-way recon: 4 groups — 2 matched, 0 amount mismatches, 0 timing mismatches, 2 unmatched
```

## recon validate

```bash
vgrid recon validate <config.recon.toml>
# valid: 2-way recon 'Stripe <-> QBO' with 2 role(s), 1 pair(s)
```

## Config format

Configs use `.recon.toml` extension. CSV file paths are resolved relative to the config file's directory.

```toml
name = "Stripe <-> QBO Payout Recon"
way = 2

[roles.processor]
kind = "processor"
file = "stripe.csv"

[roles.processor.columns]
record_id  = "source_id"
match_key  = "group_id"
amount     = "amount_minor"
date       = "effective_date"
currency   = "currency"
kind       = "type"

[roles.processor.filter]
column = "type"
values = ["payout"]

[roles.processor.transform]
multiply = -1
when_column = "type"
when_values = ["payout"]

[roles.ledger]
kind = "ledger"
file = "qbo.csv"

[roles.ledger.columns]
record_id  = "source_id"
match_key  = "source_id"
amount     = "amount_minor"
date       = "effective_date"
currency   = "currency"
kind       = "type"

[roles.ledger.filter]
column = "type"
values = ["deposit"]

[pairs.processor_ledger]
left = "processor"
right = "ledger"
strategy = "fuzzy_amount_date"

[tolerance]
amount_cents = 0
date_window_days = 2
```

A 3-way config adds a `[roles.bank]` with `kind = "bank"` and a second `[pairs.processor_bank]`.

### Config reference

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Human-readable name for the recon |
| `way` | yes | `2` (one pair) or `3` (two pairs) |
| `roles.<name>` | yes | At least 2 roles required |
| `roles.<name>.kind` | yes | `processor`, `ledger`, or `bank` |
| `roles.<name>.file` | yes | Path to CSV file (relative to config) |
| `roles.<name>.columns` | yes | Column mapping (see below) |
| `roles.<name>.filter` | no | Row filter: keep only rows where `column` is in `values` |
| `roles.<name>.transform` | no | Amount transform: `multiply` with optional `when_column`/`when_values` |
| `pairs.<name>.left` | yes | Role name for left side |
| `pairs.<name>.right` | yes | Role name for right side |
| `pairs.<name>.strategy` | no | `exact_key` (default) or `fuzzy_amount_date` |
| `tolerance.amount_cents` | no | Max allowed amount difference in cents (default: `0`) |
| `tolerance.date_window_days` | no | Max allowed date offset in days (default: `0`) |

### Column mapping

| Column | Purpose |
|--------|---------|
| `record_id` | Unique row identifier (e.g. `source_id`) |
| `match_key` | Aggregation/matching key (e.g. `payout_id`, `deposit_id`) |
| `amount` | Integer cents column (e.g. `amount_minor`) |
| `date` | Date column, `YYYY-MM-DD` format |
| `currency` | Currency code. Part of the aggregation key — never matches across currencies |
| `kind` | Row type (e.g. `payout`, `deposit`). Used by filters |

### Matching strategies

**`exact_key`** (default): Matches aggregates by `(match_key, currency)`. Both sides must use the same key space.

**`fuzzy_amount_date`**: Matches aggregates by amount and date within tolerance. Same currency required. Greedy best-match: smallest `|amount_delta| + |date_offset|` wins. Use when left and right have different key spaces.

## Aggregation

Records are grouped by `(match_key, currency)` per role. Within each group: amounts are summed (integer cents, `i64`); the earliest date is used as the group date; all `record_id` values are preserved.

## Bucket classification

### 2-way buckets

| Bucket | Meaning |
|--------|---------|
| `matched_two_way` | Matched within tolerance |
| `amount_mismatch` | Matched by key but amount delta exceeds `amount_cents` |
| `timing_mismatch` | Matched by key but date offset exceeds `date_window_days` |
| `processor_ledger_only` | Left-side aggregate with no match on right |
| `ledger_only` | Right-side aggregate with no match on left |

### 3-way buckets

| Bucket | Meaning |
|--------|---------|
| `matched_three_way` | Matched in both pairs |
| `processor_ledger_only` | Matched processor<->ledger but no bank match |
| `processor_bank_only` | Matched processor<->bank but no ledger match |
| `ledger_only` | Ledger aggregate with no match |
| `bank_only` | Bank aggregate with no match |
| `amount_mismatch` | Key matched but amount out of tolerance (either pair) |
| `timing_mismatch` | Key matched but date out of window (either pair) |

## JSON output

```json
{
  "meta": { "config_name": "Demo: Missing Deposits", "way": 2,
            "engine_version": "0.9.0", "run_at": "2026-02-17T17:53:20+00:00" },
  "summary": {
    "total_groups": 4, "matched": 2, "amount_mismatches": 0,
    "timing_mismatches": 0, "left_only": 2, "right_only": 0,
    "bucket_counts": { "matched_two_way": 2, "processor_ledger_only": 2 }
  },
  "groups": [
    { "bucket": "matched_two_way", "match_key": "po_501", "currency": "USD",
      "aggregates": {
        "processor": { "role": "processor", "match_key": "po_501", "currency": "USD",
                       "date": "2026-01-12", "total_cents": 24275,
                       "record_count": 1, "record_ids": ["po_501"] },
        "ledger": { "role": "ledger", "match_key": "dep_501", "currency": "USD",
                    "date": "2026-01-13", "total_cents": 24275,
                    "record_count": 1, "record_ids": ["dep_501"] } },
      "deltas": { "delta_cents": 0, "date_offset_days": -1 } }
  ]
}
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | All groups matched within tolerance |
| 1 | Mismatches found (amount, timing, or unmatched) |
| 2 | Runtime error (IO, CSV parse, etc.) |
| 60 | Invalid config |

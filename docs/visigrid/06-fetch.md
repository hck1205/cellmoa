---
source: https://docs.visigrid.app/cli/fetch/
status: deferred — reaches external financial APIs; no counterpart planned yet
---

# vgrid fetch

Fetch transaction data from financial service APIs and convert it to VisiGrid's canonical truth format.

```bash
vgrid fetch <source> [options]
```

### Output format

All fetchers produce the same canonical 9-column CSV:

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `effective_date` | string | yes | ISO 8601 date (`YYYY-MM-DD`) |
| `posted_date` | string | no | Settlement/posting date |
| `amount_minor` | int | yes | Minor units (cents). Never float. |
| `currency` | string | yes | ISO 4217 uppercase (`USD`, `EUR`) |
| `type` | string | yes | Transaction type (`charge`, `refund`, ...) |
| `source` | string | yes | Adapter name |
| `source_id` | string | yes | Unique ID from upstream system |
| `group_id` | string | no | Grouping key (payout ID, invoice, ...) |
| `description` | string | no | Human-readable memo |

Output is deterministically sorted (default: `group_id`, `effective_date`, `source_id`).

## Bring-your-own-API adapter (`http`)

```bash
vgrid fetch http \
  --url https://api.example.com/v1/transactions \
  --auth bearer-env:EXAMPLE_API_KEY \
  --map mapping.json \
  --from 2026-01-01 --to 2026-02-01 \
  --out transactions.csv
```

### Mapping file

```json
{
  "root": "$.data.transactions",
  "params": {
    "from": { "query": "start_date", "format": "iso" },
    "to":   { "query": "end_date",   "format": "iso" }
  },
  "columns": {
    "effective_date": "$.created_at",
    "posted_date":    { "path": "$.settled_at", "optional": true },
    "amount_minor":   { "path": "$.amount_usd", "transform": "dollars_to_cents" },
    "currency":       { "path": "$.currency",   "transform": "upper" },
    "type":           { "path": "$.category",   "map": { "payment": "charge", "refund": "refund", "*": "adjustment" } },
    "source":         { "const": "example_api" },
    "source_id":      "$.id",
    "group_id":       { "path": "$.invoice_id", "optional": true },
    "description":    { "path": "$.memo",       "optional": true }
  },
  "sort_by": ["effective_date", "source_id"]
}
```

- **`root`** — dot-path to the response array
- **`params`** — maps `--from`/`--to` to query parameter names. Supports `iso`, `unix_s`, `unix_ms` date formats.
- **`columns`** — maps each canonical column.

### Auth methods

Auth credentials are resolved from environment variables only — never inline secrets.

| Method | Flag | Example |
|--------|------|---------|
| None | `--auth none` | Public APIs |
| Bearer token | `--auth bearer-env:VAR` | `bearer-env:FORTE_TOKEN` |
| Custom header | `--auth header-env:NAME:VAR` | `header-env:X-API-Key:MY_KEY` |
| Basic auth | `--auth basic-env:USER:PASS` | `basic-env:API_USER:API_PASS` |

### Transforms

| Transform | Input | Output |
|-----------|-------|--------|
| `cents` | `5000` (int) | `5000` |
| `dollars_to_cents` | `"50.00"` (string) | `5000` |
| `upper` | `"usd"` | `"USD"` |
| `lower` | `"CHARGE"` | `"charge"` |

The `*` wildcard in `map` catches any value not explicitly mapped.

### Pagination

Cursor-based (Stripe, Brex style) and offset-based (Mercury style) are supported.

| Pagination field | Description | Required |
|------------------|-------------|----------|
| `strategy` | `"cursor"` or `"offset"` | yes |
| `param` | Query param name for cursor/offset value | yes |
| `page_size_param` | Query param name for page size | yes |
| `page_size` | Items per page | no (default: 100) |
| `next_cursor_path` | JSONPath to next cursor value (cursor only) | cursor: yes |
| `has_more_path` | JSONPath to boolean "has more" flag | no |

If `has_more_path` is omitted, pagination stops when a page returns fewer items than `page_size`.

Safety guards: `--max-pages` (default 100), `--max-items` (default 10,000), stuck-cursor detection, and empty-page-with-`has_more=true` treated as an error rather than silent truncation.

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--url` | API endpoint (HTTPS only) | required |
| `--auth` | Auth method | `none` |
| `--map` | Path to mapping JSON | required |
| `--from` / `--to` | Date range (YYYY-MM-DD) | required |
| `--out` | Output CSV path | stdout |
| `--sample` | Print raw JSON response and exit | off |
| `--save-raw` | Save raw JSON to file for audit | off |
| `--timeout` | Request timeout in seconds | 15 |
| `--max-items` | Safety cap on total items | 10,000 |
| `--max-pages` | Safety cap on pages fetched | 100 |
| `--quiet` | Suppress progress messages | off |
| `--fingerprint` | Write signed request fingerprint JSON | off |

### Request fingerprinting

`--fingerprint <path>` produces a signed JSON sidecar recording what was requested, when, and from where. The fingerprint is a `SignedEnvelope` containing `request.url`, `request.auth_method` (the flag as passed, not the secret), `request.from`/`to`, `request.pages_fetched`, `mapping.path`, `mapping.blake3`, `output.row_count`, and `output.csv_blake3`.

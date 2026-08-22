---
source: https://docs.visigrid.app/cli/replay/
status: queued
---

# vgrid replay

Execute a Lua provenance script and optionally verify the output fingerprint.

```bash
vgrid replay <script> [options]
```

| Option | Description |
|--------|-------------|
| `--verify` | Verify fingerprint against script header (fail if mismatch) |
| `--output, -o` | Output file for resulting spreadsheet |
| `--format, -f` | Output format (inferred from extension if omitted) |
| `--fingerprint` | Print fingerprint and exit |
| `--quiet, -q` | Only print errors |

### Provenance scripts

Every edit in VisiGrid can generate a Lua provenance script — a complete, ordered record of what changed. These scripts are plain text and version-control friendly.

```lua
-- api=v1
-- VisiGrid Provenance Script
-- Expected fingerprint: v1:6:b38b632d7f38dedf50ebea7b52785554

grid.set{ sheet=1, cell="A1", value="Name" }
grid.set{ sheet=1, cell="B1", value="Value" }
grid.set{ sheet=1, cell="A2", value="Alpha" }
grid.set{ sheet=1, cell="B2", value="100" }
grid.set{ sheet=1, cell="A3", value="Beta" }
grid.set{ sheet=1, cell="B3", value="200" }
```

### Fingerprint format

Fingerprints use the format `v1:<count>:<hash>` where `count` is the number of operations and `hash` is a blake3 digest of the operation sequence. The hash is content-based — it covers each operation's type, target, and payload (e.g., format operations include the kind such as `bold`, `italic`). Scripts containing nondeterministic functions (`NOW`, `TODAY`, `RAND`, `RANDBETWEEN`) cannot be verified — `--verify` will fail with an error.

Some operations (sort, merge, layout changes) are hashed for tamper detection but not applied during CLI replay. These are noted on stderr during replay.

### Verification

```
$ vgrid replay audit-trail.lua --verify
Replayed 12 operations
Fingerprint: v1:12:f2126a5fd68424b76f15d4e076a0279d
Verification: PASS (matches expected)
```

If the source data or the script has been modified, verification fails with a non-zero exit code.

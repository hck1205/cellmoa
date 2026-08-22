---
source: https://docs.visigrid.app/cli/install/
status: not-applicable — distribution, not behaviour
---

# Install

Download VisiGrid to get both the desktop app and the CLI (`vgrid`).

## Quick install (CLI only)

```bash
curl -fsSL https://get.visigrid.app/install.sh | sh
```

Detects your OS and architecture, downloads the latest `vgrid` binary from GitHub Releases, and installs to `~/.local/bin`. Supports Linux (x86_64, aarch64) and macOS (universal).

To customize the install location:

```bash
VGRID_INSTALL_DIR=/usr/local/bin curl -fsSL https://get.visigrid.app/install.sh | sh
```

## Package managers

```bash
# macOS
brew install --cask visigrid/tap/visigrid

# Linux (Arch)
yay -S visigrid-bin
```

## Direct download

Download from [GitHub Releases](https://github.com/visigrid/visigrid/releases/latest):

- **macOS** — Universal binary (Beta)
- **Windows** — x64 installer (Alpha)
- **Linux** — x86_64 / aarch64 tarball (Alpha)

The CLI (`vgrid`) is included with every download.

## Verify it works

```bash
# Sum a column
echo -e "10\n20\n30" | vgrid calc "=SUM(A:A)" --from lines

# Convert CSV to JSON
vgrid convert data.csv -t json --headers

# Filter rows — no awk required
vgrid convert data.csv -t csv --headers --where 'Status=Pending'

# Diff two files
vgrid diff before.csv after.csv --key name

# Diff with one side from stdin
cat export.csv | vgrid diff - baseline.csv --key id

# Replay a provenance script
vgrid replay audit-trail.lua --verify
```

See the full [Commands](https://docs.visigrid.app/reference/cli/) reference for all options.

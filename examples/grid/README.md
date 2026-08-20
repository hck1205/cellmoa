# The grid, in a browser

A page that puts the grid on screen with most of its features switched on, so
the parity claims in [`docs/handsontable-parity.md`](../../docs/handsontable-parity.md)
can be checked by using them rather than by reading a table.

Build the engine and the grid first — the page loads them from `dist` and from
the compiled `.wasm`, without a bundler:

```
cd packages/grid
npm install
npm run build:wasm
npm run build
```

Then serve the repository root over HTTP and open `examples/grid/`. A `file://`
URL will not work: the page is an ES module and the engine is fetched, and both
are blocked from a local file.

```
python3 -m http.server 8000
# then http://localhost:8000/examples/grid/
```

## What to try

- **Right-click a cell.** The menu is built from whichever plugins are running.
- **"Where did this come from?"** reads the edit journal for that cell: who set
  it, to what, and when.
- **"Let an agent edit B4"** writes through a second grid bound to the same
  workbook, recorded as an agent. The cell it touches is marked, and the context
  menu grows an entry to take that change back without disturbing yours.
- **Snapshot, then Diff.** The comparison is against the moment you chose, not
  against a file on disk — which is the question you actually have after leaving
  a workbook with an agent.
- **Verify** checks two written expectations and marks the cell that failed.
- **Language** switches the menu between the 21 dictionaries.
- The status bar along the bottom shows the revision and the workbook
  fingerprint; hover it for all three digests.

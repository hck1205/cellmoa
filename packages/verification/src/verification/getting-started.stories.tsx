/**
 * Getting started — the 7 pages the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare, block } from "../Compare.js";
import type { ColumnSettings } from "@cellmoa/grid";
import type Handsontable from "handsontable";

export default { title: "Verification/Getting started" };

function row(id: string, sku: string, qty: string): string[] {
  return Object.assign([id, sku, qty], { id, sku, qty });
}

export const Introduction = () => (
  <Compare
    note={`The landing page picks a framework and links to sandboxes, so there is no
      configuration on it to copy. What can be compared is what you get with none: the
      same data and nothing else, in both grids. Headers, widths, selection and the
      keyboard should behave the same before a single option is set — if the two panels
      differ here, every later story is comparing on top of a difference.`}
    settings={{ colHeaders: true, rowHeaders: true }}
    data={block(6, 5)}
  />
);

export const Demo = () => (
  <Compare
    height={320}
    note={`The showcase page turns several features on at once and invites clicking. Doing
      that in one grid demonstrates; doing it in two compares, which is why this is a pair
      rather than a link. Sort by a header, open the context menu, edit the checkbox and
      the dropdown. Each of these has its own story elsewhere with a much narrower claim —
      this one is here to catch the case where two features are each fine alone and
      interfere when switched on together.

      One difference should be visible without clicking anything. The date and numeric
      columns carry the reference's own spellings — \`dateFormat: 'YYYY-MM-DD'\` and
      \`numericFormat: { pattern: '0,0.00' }\` — and only the right panel honours them.
      cellmoa reads both options as Intl descriptors, so a moment format string and a
      numbro pattern are not things it can use, and the cells render unformatted. Both are
      accepted at settings time rather than rejected, which is why this shows as plain text
      rather than an error.`}
    settings={{
      height: 320,
      colHeaders: ["Company", "Country", "Sell date", "In stock", "Rating"],
      rowHeaders: true,
      columnSorting: true,
      contextMenu: true,
      columns: [
        { type: "text" },
        { type: "dropdown", source: ["UK", "Japan", "Kenya", "Chile"] },
        // The reference's own spelling, passed through unchanged on purpose —
        // see the note. The cast is what lets it reach both grids identically.
        { type: "date", dateFormat: "YYYY-MM-DD" } as unknown as ColumnSettings,
        { type: "checkbox" },
        {
          type: "numeric",
          numericFormat: { pattern: "0,0.00" },
        } as unknown as ColumnSettings,
      ],
    }}
    data={[
      ["Tagcat", "UK", "2025-01-11", "true", "4"],
      ["Zoombox", "Japan", "2025-03-04", "false", "2"],
      ["Wordtune", "Kenya", "2025-07-19", "true", "5"],
      ["Yodel", "Chile", "2025-11-02", "false", "3"],
    ]}
  />
);

export const Installation = () => (
  <Compare
    note={`The page is an npm command and a stylesheet import, and the thing worth checking
      after following it is that a grid appears at all. Both panels here were built from a
      plain install of each package, so this is that check. Two differences are real and
      neither is visible: cellmoa ships one package with five subpaths — the module, two
      stylesheets, the themes, and the WebAssembly file the engine needs — with no
      per-plugin entry points, and that .wasm has to be fetched, so a bundler that inlines
      everything else still has one asset to serve.`}
    settings={{ colHeaders: true, rowHeaders: true }}
    data={block(4, 4)}
  />
);

export const ConfigurationOptions = () => (
  <Compare
    note="The cascade, drawn as a single column of cells. Every layer the page names is set on column 0 at once: the grid says `className: 'htLeft'`, the column says `htCenter`, the `cell` array says `htRight` for row 2, and the `cells` function says `htCenter` again for row 4. The page states three times that `cells` overwrites all other options, so row 4 must be centred even though a narrower layer spoke, and row 2 must be right-aligned because `cell` beats the column. cellmoa ran `cells` before the per-cell map until recently, which meant conditional formatting worked until a cell also had explicit meta and then quietly stopped for that cell alone — if row 4 comes out left- or right-aligned here, that regression is back."
    settings={{
      colHeaders: ["cascade", "b", "c"],
      rowHeaders: true,
      className: "htLeft",
      columns: [{ className: "htCenter" }, {}, {}],
      cell: [{ row: 2, col: 0, className: "htRight" }],
      cells: (row: number, col: number) =>
        row === 4 && col === 0 ? { className: "htCenter" } : {},
    }}
    data={block(6, 3)}
  />
);

export const GridSize = () => (
  <Compare
    note="`width` and `height` as the page describes them: a bare number is pixels, a string is CSS as written. Both grids are asked for `320` and `55%` of the panel, so the two should end up the same size with the same scrollbars. Two things on this page cellmoa does not do. A function-valued `width` or `height` — which the reference accepts — is read as neither a number nor a string and comes out as no size at all, so the container decides. And there is no window-resize observer and no `ResizeObserver` anywhere in the library: the reference re-measures on a debounced window resize and lets you decline that through `beforeRefreshDimensions`, while here nothing re-measures until something else causes a render. Resize the browser window and watch which of the two keeps its scrollbars honest."
    settings={{ colHeaders: true, rowHeaders: true, width: 320, height: "55%" }}
    data={block(40, 8)}
    height={300}
  />
);

export const CustomIdClassAndStyle = () => (
  <Compare
    note="The page's two rules. `tableClassName` puts a class on the table and `className` cascades to every cell — both are set here to `htCenter`, so all the values should be centred in both grids, and a column of left-aligned text on either side means the class never reached the cells. The other rule does differ: the reference overwrites the container's `id` with a generated `ht_<random>` whenever it is absent or already starts with `ht_`, and cellmoa never touches the container's `id` at all. Inspect the two host elements — the right one has an `id`, the left one has none. Neither behaviour is wrong, but code that reads the container back by `id` after construction only works against the reference."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      tableClassName: "cm-verification-table",
      className: "htCenter",
    }}
    data={block(5, 4)}
  />
);

export const LicenseKey = () => (
  <Compare
    note={`Both grids are given \`licenseKey: 'non-commercial-and-evaluation'\`. The
      reference needs one; cellmoa is MIT and needs none. The point of the pair is that a
      configuration carried over from Handsontable keeps working: the option is accepted
      rather than rejected, so nothing here should look different from a grid without it.
      It is reported once on the console rather than dropped in silence — a setting that
      does nothing should say so, or the next person spends an afternoon on why their key
      has no effect.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      licenseKey: "non-commercial-and-evaluation",
    }}
    data={block(4, 4)}
  />
);

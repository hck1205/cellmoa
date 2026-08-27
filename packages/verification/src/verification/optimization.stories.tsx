/**
 * Optimization — the 3 pages the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare, NotAFeature, block } from "../Compare.js";

export default { title: "Verification/Optimization" };

function row(id: string, sku: string, qty: string): string[] {
  return Object.assign([id, sku, qty], { id, sku, qty });
}

export const BatchOperations = () => (
  <Compare
    note="`batch` holds off both the drawing and the bookkeeping; `batchRender` holds off only the drawing and `batchExecution` only the bookkeeping. cellmoa had all three doing the same thing until the counters were split. Both grids write ten cells inside one batch on mount — a batch that draws ten times rather than once shows as a flicker."
    settings={{ colHeaders: true, rowHeaders: true }}
    data={block(6, 4)}
    afterMount={{
      cellmoa: (grid) => {
        grid.batch(() => {
          for (let row = 0; row < 6; row += 1) {
            grid.setDataAtCell(row, 0, `batched ${row + 1}`);
          }
        });
      },
      handsontable: (hot) => {
        hot.batch(() => {
          for (let row = 0; row < 6; row += 1) {
            hot.setDataAtCell(row, 0, `batched ${row + 1}`);
          }
        });
      },
    }}
  />
);

export const Performance = () => (
  <Compare
    note="Fifty thousand cells. Scroll each hard and watch for a blank band or a seam: virtual scrolling is a claim about how little is in the DOM, and the failure looks like the grid falling behind the scrollbar. Open the element inspector and count the rows — both should hold a window, not the sheet."
    settings={{ colHeaders: true, rowHeaders: true, width: 520, height: 340 }}
    data={block(5000, 10)}
    height={360}
  />
);

export const BundleSize = () => (
  <NotAFeature
    page="Bundle size"
    path="bundle-size"
    why="The page is about importing only what you use: `handsontable/base` plus `registerAllModules`, or individual plugin registrations. cellmoa has no modular entry points — `src/plugins/index.ts` registers every plugin as a side effect and the package declares no `sideEffects: false` — so the whole library is one indivisible bundle. There is nothing to put on screen; the gap is in the package, and it is recorded in the gap audit."
  />
);

/**
 * Accessories and menus — the 9 pages the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare, NotAFeature, block } from "../Compare.js";
import type {
  Dialog as CmDialog,
  Loading as CmLoading,
  Notification as CmNotification,
} from "@cellmoa/grid";
import type Handsontable from "handsontable";

export default { title: "Verification/Accessories and menus" };

const alert = {
  template: {
    type: "alert" as const,
    title: "Unsaved changes",
    description: "Three cells have been edited since the last save.",
    buttons: [
      { text: "Discard", type: "secondary" as const },
      { text: "Save", type: "primary" as const },
    ],
  },
  background: "semi-transparent" as const,
  contentBackground: true,
  closable: true,
  a11y: { role: "dialog", ariaLabel: "Unsaved changes" },
};

function row(id: string, sku: string, qty: string): string[] {
  return Object.assign([id, sku, qty], { id, sku, qty });
}

export const ContextMenu = () => (
  <Compare
    note="Right-click a cell in each. The item keys are the same on both sides, so the same `contextMenu.items` object should produce the same list in the same order: two insert items, a separator, a remove, an alignment submenu, a second separator, and one item of our own with a label we chose. Look for a separator drawn as a line rather than as nine hyphens, for the submenu opening on hover without pushing the parent off-screen, and for the menu flipping when it would overflow the panel. Then put the mouse down and try the keyboard: Shift+F10 or Ctrl+Shift+backslash opens Handsontable's menu and arrows walk it; in cellmoa nothing happens, because `menu.ts` has no keydown listener. That is the single largest accessibility gap in this section — a keyboard-only user cannot insert a row, align a cell, or reach any other command the menu is the only route to."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      contextMenu: {
        items: {
          row_above: {},
          row_below: { name: "Insert a row below this one" },
          sp1: "---------",
          remove_row: {},
          alignment: {},
          sp2: "---------",
          mine: { name: "An item neither library ships" },
        },
      },
    }}
    data={block(6, 5)}
  />
);

export const DragToScroll = () => (
  <Compare
    note="Click a cell near the middle of each panel, hold, and drag past the bottom or right edge without letting go. Both should keep scrolling and keep extending the selection while the button is down; a drag that stops at the edge, or one that scrolls but leaves the selection behind, is a defect. The two do not scroll the same way and are not meant to. Handsontable repeats a fixed scroll step on a timer whose interval falls from `interval.max` to `interval.min` over `rampDistance` pixels, so its speed builds the further out you go. cellmoa scrolls by exactly the distance the pointer is outside the box, following it directly, which needs no timer and no ramp — so it accepts `dragToScroll: true` or `false` and nothing else, and the `interval`/`rampDistance` object is rejected rather than accepted and ignored. That divergence is argued in `plugins/scrolling.ts`; a difference in feel is expected here, a failure to scroll at all is not."
    settings={{ colHeaders: true, rowHeaders: true, dragToScroll: true }}
    data={block(80, 14)}
    height={240}
  />
);

export const UndoAndRedo = () => (
  <Compare
    note="Three cells are written a second after mount, so there is something to take back. Press Ctrl/Cmd+Z three times in each and then Ctrl/Cmd+Y three times: the values should walk back and forward in the same order, and the selection should land on the cell each step restored. What is behind the two is not the same. Handsontable keeps an action stack in the plugin, so `clear()` empties it and `done()` lets you push an action of your own — a `setCellMeta` change, say — onto it. cellmoa has no stack: undo walks the engine's commit journal, which is what makes `undoBy(actor)` possible and lets a person take back an agent's edits without touching their own. The costs of that are visible here: there is no `done()` to register a custom undoable action with, and `clear()` throws rather than pretending, because the journal is also the audit trail that provenance and verify read. Both are recorded in `docs/handsontable-parity.md`."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      undo: true,
      contextMenu: true,
    }}
    data={block(6, 4)}
    afterMount={{
      cellmoa: (grid) => {
        setTimeout(() => {
          grid.setDataAtCell(0, 0, "first");
          grid.setDataAtCell(1, 1, "second");
          grid.setDataAtCell(2, 2, "third");
        }, 1000);
      },
      handsontable: (hot) => {
        setTimeout(() => {
          hot.setDataAtCell(0, 0, "first");
          hot.setDataAtCell(1, 1, "second");
          hot.setDataAtCell(2, 2, "third");
        }, 1000);
      },
    }}
  />
);

export const IconPack = () => (
  <NotAFeature
    page="Icon pack"
    why="A catalogue of 169 SVG files published as a separate npm package, `@handsontable/spreadsheet-icons`, for building your own toolbars and menus around a grid. The page says outright that it is not the icon set the grid renders internally, and nothing on it is configured through the grid: there is no option, no plugin and no API, only a download link, a size recommendation and two opacity values. Neither library ships these icons, and there is no setting either grid could be given to make one appear, so there is nothing to draw beside anything. What the page does say that bears on the grid is that the icons carry no accessible name of their own — that claim is checkable, and the next story checks it."
    path="icon-pack"
  />
);

export const EmptyDataState = () => (
  <Compare
    note="Both grids are loaded with no rows at all and set to Japanese, so the overlay has to come from a dictionary rather than from a hard-coded string. Look for a centred title and a description in Japanese in both panels, covering the table and nothing outside it, with the column headers still legible above. English text on either side means the plugin is not reading the dictionary. cellmoa carries seven `EmptyDataState:*` keys — the five Handsontable documents plus a title and description for the loading state — translated in all 21 locales; the plugin hard-coded English until recently, which is exactly the kind of defect that a green jsdom suite never sees. What this story cannot show is the filtered variant: the overlay's second face, with its **Reset filters** button, needs a filter that hides every row, and cellmoa has no filter UI to set one with. Handsontable's `emptyDataState` is the same option on both sides otherwise."
    settings={{
      colHeaders: ["Region", "Owner", "Value"],
      rowHeaders: true,
      emptyDataState: true,
      language: "ja-JP",
    }}
    data={[]}
    height={240}
  />
);

export const Dialog = () => (
  <Compare
    note="The same options object opens a dialog over both grids a moment after mount. Four things to look at. The backdrop: `background: 'semi-transparent'` should let the table show through dimmed, where `'solid'` would hide it — a backdrop that does not paint at all is the defect this story exists to catch, and it was real here. The box: `template` should render the title, the description and two buttons with the primary one visibly primary, without the caller assembling any of it. The modality: click a cell underneath and type — nothing should reach the grid while the dialog is up, then press Escape and check the keyboard comes back. And the name: the `a11y` block should put a `dialog` role, `aria-modal` and an accessible name on the overlay, which Ladle's a11y addon will read out of either panel. One divergence to know about, since it is not visible here: Handsontable's `show()` with no arguments falls back to whatever the `dialog` option was configured with, and cellmoa's does not — it opens an empty box. Passing the options to `show()`, as both do here, works on either side."
    settings={{ colHeaders: true, rowHeaders: true, dialog: true }}
    data={block(6, 4)}
    height={280}
    afterMount={{
      cellmoa: (grid) => {
        setTimeout(() => grid.getPlugin<CmDialog>("dialog")?.show(alert), 700);
      },
      handsontable: (hot) => {
        setTimeout(() => hot.getPlugin("dialog").show(alert), 700);
      },
    }}
  />
);

export const Loading = () => (
  <Compare
    note="Both grids are put into a loading state a moment after mount and left there. The overlay should cover the whole grid root — headers, rows and the strip below the table — because a pager you can still click while the data is loading will ask for a page nobody is waiting for. Check the spinner actually animates rather than sitting still, and that the phrase is Japanese: the grid is set to `ja-JP`, and both libraries take the default from a dictionary key (`LOADING_TITLE` there, `Loading:title` here). English text means the plugin hard-coded it. Two differences are worth knowing. Handsontable's overlay takes an `icon`, a `title` and a `description`; cellmoa's takes one `message` and draws its own spinner, so a caller who wants three lines cannot have them. And cellmoa's is reference-counted rather than a flag — two things loading at once take it up twice, and the first to finish does not pull the overlay out from under the second, which is a difference in behaviour you can only see by starting a second load before the first ends."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      dialog: true,
      loading: true,
      language: "ja-JP",
    }}
    data={block(6, 4)}
    height={260}
    afterMount={{
      cellmoa: (grid) => {
        setTimeout(() => grid.getPlugin<CmLoading>("loading")?.show(), 700);
      },
      handsontable: (hot) => {
        setTimeout(() => hot.getPlugin("loading").show(), 700);
      },
    }}
  />
);

export const Notification = () => (
  <Compare
    note="Two toasts open in each grid a moment after mount: an error with `duration: 0`, which must stay until it is dismissed, and an informational one at the other corner. Look at where they land — `top-end` and `bottom-start` are corners the caller chose, and a toast asked for one corner and drawn in another is covering something the caller moved it away from. Check they stack rather than replace one another, and that the persistent error does not quietly vanish after four seconds. cellmoa read `type` and `timeout` and ignored the documented `variant` and `duration`, which meant exactly that: a serious error, asked to stay, disappearing. It now reads `variant`/`duration`/`position`/`title` as documented and still answers to the two old names as aliases, so both spellings work. What cellmoa does not have is the keyboard route the page describes: F6 moves focus into Handsontable's notification region and Tab walks the controls across visible toasts, and there is no F6 binding anywhere in cellmoa's source, so its toast buttons are reachable by mouse only. The `aria-live` wiring is there on both — assertive for errors, polite otherwise — which the a11y addon can confirm."
    settings={{ colHeaders: true, rowHeaders: true, notification: true }}
    data={block(6, 4)}
    height={260}
    afterMount={{
      cellmoa: (grid) => {
        const toast = grid.getPlugin<CmNotification>("notification");
        setTimeout(() => {
          toast?.showMessage({
            title: "Could not save",
            message: "The server refused the write. Nothing was lost.",
            variant: "error",
            duration: 0,
            position: "top-end",
            // The callback is required by Handsontable's type; taking the
            // action is what dismisses the toast on both sides.
            actions: [
              { label: "Retry", type: "primary", callback: () => undefined },
            ],
          });
          toast?.showMessage({
            message: "Sorted by Region.",
            variant: "info",
            duration: 0,
            position: "bottom-start",
          });
        }, 700);
      },
      handsontable: (hot) => {
        const toast = hot.getPlugin("notification");
        setTimeout(() => {
          toast.showMessage({
            title: "Could not save",
            message: "The server refused the write. Nothing was lost.",
            variant: "error",
            duration: 0,
            position: "top-end",
            // The callback is required by Handsontable's type; taking the
            // action is what dismisses the toast on both sides.
            actions: [
              { label: "Retry", type: "primary", callback: () => undefined },
            ],
          });
          toast.showMessage({
            message: "Sorted by Region.",
            variant: "info",
            duration: 0,
            position: "bottom-start",
          });
        }, 700);
      },
    }}
  />
);

export const LayoutSlots = () => (
  <Compare
    note="A `summary` element is registered into the bottom slot of each grid a moment after mount, and `layout: { bottom: ['summary', 'pagination'] }` says it comes before the pager. Look for two strips below the table in each panel, in that order, framed by the slot rather than floating loose — the page says the slot borders its items and that adjacent items share one divider line, so a doubled line between the summary and the pager is a defect. Then check that the strip is inside the grid's own root and not appended to the page: the manager owns placement, and an element the caller had to append itself would mean `register()` did half its job. One difference is deliberate and visible in the DOM: Handsontable marks slot items with `ht-slot-element`, cellmoa with `cm-slot-element`, so a stylesheet written against one will not find the other."
    settings={{
      colHeaders: ["SKU", "Supplier", "In stock"],
      rowHeaders: true,
      pagination: { pageSize: 3 },
      layout: { bottom: ["summary", "pagination"] },
    }}
    data={[
      ["SKU-4821", "Harbor Goods", "142"],
      ["SKU-0093", "Alpine Supply Co.", "0"],
      ["SKU-7740", "Vertex Industries", "67"],
      ["SKU-1180", "Meridian Works", "31"],
      ["SKU-6602", "Cobalt Trading", "9"],
    ]}
    height={280}
    afterMount={{
      cellmoa: (grid) => {
        setTimeout(() => {
          const summary = document.createElement("div");
          summary.textContent = "5 items in stock";
          grid
            .getLayoutManager()
            ?.register("summary", summary, { side: "bottom", weight: 100 });
        }, 300);
      },
      handsontable: (hot) => {
        setTimeout(() => {
          const summary = document.createElement("div");
          summary.textContent = "5 items in stock";
          hot
            .getLayoutManager()
            .register("summary", summary, { side: "bottom", weight: 100 });
        }, 300);
      },
    }}
  />
);

// --- more of what each page documents ---------------------------------------

export const ContextMenuFromAList = () => (
  <Compare
    note={`\`contextMenu\` as an array of keys is the short form, and the order of the
      array is the order of the menu. Right-click in each panel and read down: insert
      above, insert below, a separator, remove, undo, redo. A grid that keeps its own
      order regardless of the array looks correct until the list is read in sequence,
      which is why this one is deliberately not the default order.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      contextMenu: [
        "row_above",
        "row_below",
        "---------",
        "remove_row",
        "undo",
        "redo",
      ],
    }}
    data={block(4, 3)}
  />
);

export const UndoAndRedoAcrossOperations = () => (
  <Compare
    note={`Undo has to reach further than an edit. Type into a cell, insert a row from the
      context menu, sort a column, then press Ctrl+Z three times in each panel. Every one
      of those should come back in reverse order — the structural change is the one that
      usually is not recorded, and its absence shows as an undo that skips straight past
      it to the edit before.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      contextMenu: true,
      columnSorting: true,
      undo: true,
    }}
    data={block(5, 3)}
  />
);

export const LoadingOverlayNested = () => (
  <Compare
    note={`The loading overlay counts rather than toggling, so three overlapping fetches
      raise it once and lower it when the last one finishes. What to look at is the
      cover: it should sit over the whole grid including any pager below, because a
      control you can still click while the data is being replaced will ask for a page
      nobody is waiting for.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      loading: true,
      pagination: { pageSize: 3 },
    }}
    data={block(9, 3)}
  />
);

export const EmptyDataStateWithNoRows = () => (
  <Compare
    note={`With no rows, the overlay should cover the table and nothing else — not the
      headers, which still say what the columns are, and not the page around it. This is
      a pure layout claim and jsdom cannot answer it: it measures the overlay as zero and
      passes whatever it is given.`}
    settings={{
      colHeaders: ["Item", "Amount"],
      rowHeaders: true,
      emptyDataState: true,
    }}
    data={[]}
  />
);

/**
 * The furniture around the table: the two menus, the scroll that follows a
 * drag past the edge, undo, the empty-table overlay, the slots the grid hangs
 * its own UI in, and the two export formats.
 *
 * Almost none of this is testable off-screen. A menu is a floating element
 * positioned against a button; an empty-data overlay is a box that has to
 * cover the table and nothing else; a slot is a strip of DOM whose whole job
 * is to be in the right place. jsdom measures all of it as zero, so the only
 * honest check is to look.
 *
 * Two things to carry through the whole section. First, **neither cellmoa
 * menu has any keyboard**: `menu.ts` registers no `keydown` listener at all,
 * so Shift+F10, Ctrl+Shift+\, Shift+Alt+Down, the arrow keys, Home/End,
 * Page Up/Down, Enter and Escape all do nothing. Every menu story below is a
 * mouse-only story on the left and a keyboard-and-mouse story on the right,
 * and that is a gap, not a decision. Second, the pages are in the order the
 * guide's own sidebar lists them, which puts the two export pages last.
 */

import type { ExportFile, Notification as CmNotification } from '@cellmoa/grid';
import { registerRenderer as registerCellmoaRenderer } from '@cellmoa/grid';
import { registerRenderer as registerHotRenderer } from 'handsontable/renderers';
import { registerLanguageDictionary, jaJP } from 'handsontable/i18n';

import { Compare, NotAFeature, block } from '../Compare.js';

export default { title: 'Verification/Accessories and menus' };

// Handsontable's full bundle registers every plugin but no language, so a
// story about a translated string has to hand it the dictionary itself.
// cellmoa carries all 21 in `i18n/dictionaries.ts` and needs no equivalent.
registerLanguageDictionary(jaJP);

/**
 * A flag that is drawn, not typed.
 *
 * Registered under the same name in both registries so the settings the two
 * grids receive stay identical — the bodies differ because the renderer
 * contracts differ, which is itself the thing the story is about.
 */
const FLAG_ON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6 3h11l-2 4 2 4H8v10H6z"/></svg>';
const FLAG_OFF = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" d="M6.5 3.5h9.5l-2 3.5 2 3.5H6.5zM6.5 3.5v17"/></svg>';

function flagButton(doc: Document, on: boolean): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.innerHTML = on ? FLAG_ON : FLAG_OFF;
  // The name goes on the control, never on the decorative `<svg>`.
  button.setAttribute('aria-label', on ? 'Flagged. Click to clear.' : 'Not flagged. Click to flag.');
  button.style.cssText = 'border:0;background:none;cursor:pointer;padding:0;line-height:1';
  return button;
}

registerCellmoaRenderer('flag', ({ td, cell }) => {
  td.textContent = '';
  td.appendChild(flagButton(td.ownerDocument, cell?.text === 'yes'));
});

registerHotRenderer('flag', (_instance, td, _row, _col, _prop, value) => {
  td.textContent = '';
  td.appendChild(flagButton(td.ownerDocument, value === 'yes'));
});

export const ContextMenu = () => (
  <Compare
    note="Right-click a cell in each. The item keys are the same on both sides, so the same `contextMenu.items` object should produce the same list in the same order: two insert items, a separator, a remove, an alignment submenu, a second separator, and one item of our own with a label we chose. Look for a separator drawn as a line rather than as nine hyphens, for the submenu opening on hover without pushing the parent off-screen, and for the menu flipping when it would overflow the panel. Then put the mouse down and try the keyboard: Shift+F10 or Ctrl+Shift+backslash opens Handsontable's menu and arrows walk it; in cellmoa nothing happens, because `menu.ts` has no keydown listener. That is the single largest accessibility gap in this section — a keyboard-only user cannot insert a row, align a cell, or reach any other command the menu is the only route to."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      contextMenu: {
        items: {
          row_above: {},
          row_below: { name: 'Insert a row below this one' },
          sp1: '---------',
          remove_row: {},
          alignment: {},
          sp2: '---------',
          mine: { name: 'An item neither library ships' },
        },
      },
    }}
    data={block(6, 5)}
  />
);

export const ColumnMenu = () => (
  <Compare
    note="Both grids draw a button in every column header; click one in each. The menu that opens is the same widget as the context menu, so the shared items should match what the previous story showed. The difference to look for is underneath: `filters: true` is set here, and Handsontable answers by putting the whole filtering interface into the column menu — a condition select, a value list with checkboxes, and an OK/Cancel bar, which are the documented `filter_by_condition`, `filter_by_value` and `filter_action_bar` items. cellmoa's filter plugin is 220 lines of API with no DOM at all: none of those five keys exists in its source, so its column menu opens without them. Check the button itself too. cellmoa renders a bare `▾` with no accessible name, and Shift+Alt+Down from a cell and Ctrl+Enter from a focused header — the two shortcuts this page documents — are unbound."
    settings={{
      colHeaders: ['Region', 'Owner', 'Stage', 'Value'],
      rowHeaders: true,
      dropdownMenu: true,
      filters: true,
    }}
    data={[
      ['North', 'Ada', 'Won', '1200'],
      ['South', 'Grace', 'Open', '800'],
      ['North', 'Ada', 'Open', '450'],
      ['East', 'Alan', 'Lost', '90'],
      ['South', 'Grace', 'Won', '2300'],
    ]}
    height={300}
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
    settings={{ colHeaders: true, rowHeaders: true, undo: true, contextMenu: true }}
    data={block(6, 4)}
    afterMount={{
      cellmoa: (grid) => {
        setTimeout(() => {
          grid.setDataAtCell(0, 0, 'first');
          grid.setDataAtCell(1, 1, 'second');
          grid.setDataAtCell(2, 2, 'third');
        }, 1000);
      },
      handsontable: (hot) => {
        setTimeout(() => {
          hot.setDataAtCell(0, 0, 'first');
          hot.setDataAtCell(1, 1, 'second');
          hot.setDataAtCell(2, 2, 'third');
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

export const HowToUseIconsInCells = () => (
  <Compare
    note="The first column is drawn by a custom renderer registered under the name `flag` in both libraries' renderer registries, so the settings the two grids receive are byte-identical: `columns: [{ renderer: 'flag' }, …]`. The icon should appear filled where the value is `yes` and outlined otherwise, and it should survive scrolling, since both grids reuse cell elements between renders — an icon that duplicates or disappears as you scroll means the renderer is appending instead of replacing. The accessibility point is the one the page makes: the `<svg>` is `aria-hidden` and the name lives on the `<button>` around it, which you can confirm with Ladle's a11y addon in either panel. The renderer contracts themselves differ and cannot be made to match. cellmoa hands a renderer one object — `{ row, col, td, cell, meta }` — while Handsontable passes seven positional arguments; and cellmoa takes only a registered name in `renderer`, where Handsontable also accepts an inline function. Porting a renderer means rewriting its signature, which is worth knowing before you count this page as parity."
    settings={{
      colHeaders: ['Flag', 'Item', 'Qty'],
      rowHeaders: true,
      columns: [{ renderer: 'flag' }, {}, {}],
    }}
    data={[
      ['yes', 'Harbor Goods', '142'],
      ['no', 'Alpine Supply Co.', '0'],
      ['yes', 'Vertex Industries', '67'],
      ['no', 'Meridian Works', '31'],
    ]}
    height={220}
  />
);

export const EmptyDataState = () => (
  <Compare
    note="Both grids are loaded with no rows at all and set to Japanese, so the overlay has to come from a dictionary rather than from a hard-coded string. Look for a centred title and a description in Japanese in both panels, covering the table and nothing outside it, with the column headers still legible above. English text on either side means the plugin is not reading the dictionary. cellmoa carries seven `EmptyDataState:*` keys — the five Handsontable documents plus a title and description for the loading state — translated in all 21 locales; the plugin hard-coded English until recently, which is exactly the kind of defect that a green jsdom suite never sees. What this story cannot show is the filtered variant: the overlay's second face, with its **Reset filters** button, needs a filter that hides every row, and cellmoa has no filter UI to set one with. Handsontable's `emptyDataState` is the same option on both sides otherwise."
    settings={{
      colHeaders: ['Region', 'Owner', 'Value'],
      rowHeaders: true,
      emptyDataState: true,
      language: 'ja-JP',
    }}
    data={[]}
    height={240}
  />
);

export const LayoutSlots = () => (
  <Compare
    note="A `summary` element is registered into the bottom slot of each grid a moment after mount, and `layout: { bottom: ['summary', 'pagination'] }` says it comes before the pager. Look for two strips below the table in each panel, in that order, framed by the slot rather than floating loose — the page says the slot borders its items and that adjacent items share one divider line, so a doubled line between the summary and the pager is a defect. Then check that the strip is inside the grid's own root and not appended to the page: the manager owns placement, and an element the caller had to append itself would mean `register()` did half its job. One difference is deliberate and visible in the DOM: Handsontable marks slot items with `ht-slot-element`, cellmoa with `cm-slot-element`, so a stylesheet written against one will not find the other."
    settings={{
      colHeaders: ['SKU', 'Supplier', 'In stock'],
      rowHeaders: true,
      pagination: { pageSize: 3 },
      layout: { bottom: ['summary', 'pagination'] },
    }}
    data={[
      ['SKU-4821', 'Harbor Goods', '142'],
      ['SKU-0093', 'Alpine Supply Co.', '0'],
      ['SKU-7740', 'Vertex Industries', '67'],
      ['SKU-1180', 'Meridian Works', '31'],
      ['SKU-6602', 'Cobalt Trading', '9'],
    ]}
    height={280}
    afterMount={{
      cellmoa: (grid) => {
        setTimeout(() => {
          const summary = document.createElement('div');
          summary.textContent = '5 items in stock';
          grid.getLayoutManager()?.register('summary', summary, { side: 'bottom', weight: 100 });
        }, 300);
      },
      handsontable: (hot) => {
        setTimeout(() => {
          const summary = document.createElement('div');
          summary.textContent = '5 items in stock';
          hot.getLayoutManager().register('summary', summary, { side: 'bottom', weight: 100 });
        }, 300);
      },
    }}
  />
);

export const ExportToExcel = () => (
  <Compare
    note="A moment after mount each grid is asked for an `.xlsx` blob and reports what it got in a toast. This is the one place in the section where the two are built differently on purpose. Handsontable writes the workbook in the browser with ExcelJS, which you must install and hand it as `exportFile: { engines: { xlsx: ExcelJS } }`; nothing here does, so its toast should say the format is unavailable, and that is correct behaviour rather than a failure. cellmoa asks its engine to save, because the engine is where the formulas, the number formats and the defined names already live — rebuilding the workbook from the rendered DOM, which is how the reference reads styling, would quietly drop every one of them. So expect a byte count on the left and a refusal on the right. What that costs is real and should be said: the reference's DOM-reading export carries background colours and borders that a caller set purely in CSS, and an engine-side export cannot see those at all."
    settings={{
      colHeaders: ['Item', 'Qty', 'Total'],
      rowHeaders: true,
      notification: true,
      exportFile: true,
    }}
    data={[
      ['Widget', '3', '=B1*10'],
      ['Gasket', '7', '=B2*10'],
      ['Flange', '2', '=B3*10'],
    ]}
    height={220}
    afterMount={{
      cellmoa: (grid) => {
        setTimeout(() => {
          const toast = grid.getPlugin<CmNotification>('notification');
          try {
            const blob = grid.getPlugin<ExportFile>('exportFile')?.exportAsBlob('xlsx');
            toast?.showMessage({
              title: 'xlsx',
              message: `built by the engine: ${blob ? blob.size : 0} bytes`,
              variant: 'success',
              duration: 0,
              position: 'top-end',
            });
          } catch (cause: unknown) {
            toast?.showMessage({
              title: 'xlsx',
              message: String(cause),
              variant: 'error',
              duration: 0,
              position: 'top-end',
            });
          }
        }, 800);
      },
      handsontable: (hot) => {
        setTimeout(() => {
          const toast = hot.getPlugin('notification');
          try {
            const blob = hot.getPlugin('exportFile').exportAsBlob('xlsx');
            toast.showMessage({
              title: 'xlsx',
              message: `built in the browser: ${blob.size} bytes`,
              variant: 'success',
              duration: 0,
              position: 'top-end',
            });
          } catch (cause: unknown) {
            toast.showMessage({
              title: 'xlsx',
              message: String(cause),
              variant: 'error',
              duration: 0,
              position: 'top-end',
            });
          }
        }, 800);
      },
    }}
  />
);

export const ExportToCsv = () => (
  <Compare
    note="The first column holds three values a spreadsheet would execute if it read them out of a CSV: one leading `@`, one leading `+`, one leading tab. A moment after mount each grid exports itself with `sanitizeValues: true` and puts the first two lines of the result in a toast, with the line break shown as ⏎. Read the toasts against each other. Every dangerous value should come out prefixed with an apostrophe and wrapped in quotes, and — this is the part worth checking rather than assuming — *every* field should be quoted once sanitizing is on, because a file where half the fields are quoted and half are not is a file whose readers disagree about where a field begins. cellmoa had no `sanitizeValues` at all until recently and shipped `=cmd|'/c calc'!A1` straight through; the option now exists with the same three forms the reference documents, off by default in both, since escaping changes what the file says and a grid holding its own data is entitled to a faithful export."
    settings={{
      colHeaders: ['Payload', 'Note'],
      rowHeaders: true,
      notification: true,
      exportFile: true,
    }}
    data={[
      ['@SUM(1+1)', 'leading at-sign'],
      ['+1-1', 'leading plus'],
      ['\tcmd', 'leading tab'],
      ['plain, with a comma', 'quoted for the delimiter'],
    ]}
    height={240}
    afterMount={{
      cellmoa: (grid) => {
        setTimeout(() => {
          const csv = grid
            .getPlugin<ExportFile>('exportFile')
            ?.exportAsString('csv', { colHeaders: true, sanitizeValues: true });
          grid.getPlugin<CmNotification>('notification')?.showMessage({
            title: 'csv, sanitized',
            message: (csv ?? '').split('\r\n').slice(0, 2).join(' ⏎ '),
            variant: 'info',
            duration: 0,
            position: 'top-end',
          });
        }, 800);
      },
      handsontable: (hot) => {
        setTimeout(() => {
          const csv = hot
            .getPlugin('exportFile')
            .exportAsString('csv', { colHeaders: true, sanitizeValues: true });
          hot.getPlugin('notification').showMessage({
            title: 'csv, sanitized',
            message: csv.split('\r\n').slice(0, 2).join(' ⏎ '),
            variant: 'info',
            duration: 0,
            position: 'top-end',
          });
        }, 800);
      },
    }}
  />
);

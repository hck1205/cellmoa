/**
 * Internationalization — the 4 pages the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare, block } from "../Compare.js";
import type Handsontable from "handsontable";

export default { title: "Verification/Internationalization" };

function row(id: string, sku: string, qty: string): string[] {
  return Object.assign([id, sku, qty], { id, sku, qty });
}

export const Language = () => (
  <Compare
    note="Both grids are set to `de-DE`. Right-click a cell in each, and click the header button too: the menu labels should be German on both sides and should say the same thing, because cellmoa's dictionaries were extracted from Handsontable's own language files rather than translated afresh. Two things to look at beyond the words. First the box — German labels are longer than English ones, and a menu that clips them or wraps mid-word is a layout defect that only shows in a language you did not design against. Second, what is missing: the filter labels (`Filters:labels.filterByValue` and its neighbours) are translated in all 21 of cellmoa's dictionaries and read by nothing, because there is no filter UI to put them in, so Handsontable's column menu will show a translated filter panel and cellmoa's will not. Eleven more keys are in the same state — `ok`, `cancel`, the six border names, `readOnlyComment`, `copyWithHeaders` and `copyHeadersOnly` — translated everywhere and consulted nowhere. A missing translation is visible; a translation nothing reads is not, which is why it is written down here."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      language: "de-DE",
      contextMenu: true,
      dropdownMenu: true,
      filters: true,
      comments: true,
      customBorders: true,
    }}
    data={block(6, 4)}
    height={280}
  />
);

export const Locale = () => (
  <Compare
    note="Both grids are set to `locale: 'de-DE'` with the language left at the default, which is the split the page is about: the interface stays English while the numbers are written the German way. The `Value` column is numeric and asks for two fraction digits, so cellmoa should render `1.234,50` — a dot for thousands, a comma for the decimal. Handsontable will not, and that is a divergence rather than a defect on either side: its `numericFormat` is a numbro pattern with its own `culture` key, and `locale` in Handsontable governs filtering, searching and locale-aware comparison rather than display. cellmoa hands `numericFormat` straight to `Intl.NumberFormat` and takes the locale from `locale`, falling back to `language`, so one option covers both. What that means for a caller porting settings across: a `numericFormat` written for one library is not a `numericFormat` for the other, and the value will silently render unformatted rather than raise anything. Check the sort order too — the last column holds `ä`, `o` and `z`, which German and American collation order differently."
    settings={{
      colHeaders: ["Item", "Value", "Label"],
      rowHeaders: true,
      locale: "de-DE",
      columnSorting: true,
      columns: [
        {},
        { type: "numeric", numericFormat: { minimumFractionDigits: 2 } },
        {},
      ],
    }}
    data={[
      ["Widget", "1234.5", "zebra"],
      ["Gasket", "89.125", "ähnlich"],
      ["Flange", "1000000", "orange"],
    ]}
    height={240}
  />
);

export const LayoutDirection = () => (
  <Compare
    note="Both grids are set to `layoutDirection: 'rtl'` with the Arabic dictionary loaded. Everything the page lists should mirror: the row headers move to the right edge, column A is drawn at the right-hand edge and the order runs leftward, the fill handle moves to the bottom-left of the selection, and menus open with their submenus expanding left. Then check the keyboard, which is the part that is easy to get half right — the arrow keys are screen-relative, not data-relative, so Right should move towards column A and Home should go to the rightmost cell. A grid that mirrors its layout but not its arrows is worse than one that mirrors neither. The default, `'inherit'`, is not what this story sets, but it is worth knowing what it now does: it resolves from the document's own `dir` through the computed style of the container, so an Arabic page that sets `dir` on `<html>` and configures nothing gets an RTL grid. It used to answer left-to-right unconditionally, which is a silent wrong answer of exactly the kind this package exists to catch. Ladle's RTL toggle sets that document `dir`; flip it and reload with `layoutDirection` removed to see the inherited path."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      layoutDirection: "rtl",
      language: "ar-AR",
      contextMenu: true,
    }}
    data={block(7, 5)}
    height={280}
  />
);

export const ImeSupport = () => (
  <Compare
    note="Both grids have `imeFastEdit: true`. This one needs a person with an input method switched on — Korean, Japanese or Chinese — and cannot be judged without it. Select a cell and start typing without opening the editor first. The editor should open empty and the composition should land inside it, with the candidate window anchored to the cell; what must not happen is the first keystroke being planted as text, because while an IME is composing the browser reports `Process` or `Unidentified` rather than a character, and treating that as printable seeds the editor with something that means nothing. cellmoa's key handler checks `event.isComposing` and `key === 'Process'` and opens an editor without seeding it, which is the same shape as the reference's. With `imeFastEdit` off — the default on both — the same composition should be ignored until you open the editor yourself with Enter, F2 or a double-click. The page's own warning applies to both: fast edit can confuse a screen reader's reading of the cell, so a grid that prioritises assistive technology should leave it off."
    settings={{ colHeaders: true, rowHeaders: true, imeFastEdit: true }}
    data={block(6, 4)}
    height={240}
  />
);

// --- more of what each page documents ---------------------------------------

export const LocaleNumberAndDate = () => (
  <Compare
    note={`\`locale\` decides how a value is compared and sorted, not only how it is
      written — the page's example is that sorting Polish text without a locale puts the
      accented letters at the end. Sort the column in both panels and check the accented
      entries land between their unaccented neighbours rather than after everything.`}
    settings={{
      colHeaders: ["Nazwa"],
      rowHeaders: true,
      locale: "pl-PL",
      columnSorting: true,
    }}
    data={[["zebra"], ["ćma"], ["artysta"], ["łódka"], ["brzoza"]]}
  />
);

export const LayoutDirectionRtl = () => (
  <Compare
    note={`\`layoutDirection: 'rtl'\` mirrors the whole layout: the row headers move to
      the right, the columns run right to left, and the arrow keys swap with them so left
      still means "towards the start". That last part is what usually gets missed — a
      grid that mirrors the CSS and leaves the keyboard alone sends the cursor the wrong
      way, and it is invisible in a screenshot.`}
    settings={{
      colHeaders: ["الاسم", "المبلغ"],
      rowHeaders: true,
      layoutDirection: "rtl",
    }}
    data={[
      ["أحمد", "1200"],
      ["سارة", "640"],
    ]}
  />
);

export const ImeSupportFastEdit = () => (
  <Compare
    note={`\`imeFastEdit\` decides whether the editor is focused before or after the first
      keystroke. With it on, typing straight into a cell in Japanese or Korean should
      compose properly rather than losing the first character to the grid's own key
      handler — which is the bug the setting exists for, and one you can only find by
      typing with an IME on.`}
    settings={{
      colHeaders: ["名前", "数量"],
      rowHeaders: true,
      imeFastEdit: true,
    }}
    data={[
      ["田中", "3"],
      ["佐藤", "5"],
    ]}
  />
);

/**
 * Thirty pages of release history and policy.
 *
 * Twenty-four of them are logs — nothing to mount, and pretending otherwise
 * would pad the tree. They are here so that a reader counting stories against
 * the table of contents finds every page, and so the six that *do* make a
 * checkable claim are not lost among them.
 *
 * The checkable claim in a migration guide is a rename: "X became Y" says which
 * spellings a library claiming to read a Handsontable configuration has to
 * accept. Those six are real comparisons.
 */

import { Compare, NotAFeature, block } from '../Compare.js';

export default { title: 'Verification/Upgrade and migration' };

const log = (page: string, path: string, what: string) => () => (
  <NotAFeature page={page} why={what} path={path} />
);

export const Changelog = log(
  'Changelog',
  'changelog',
  'The release log. Nothing to mount — but the entries are where several of the renames below come from.',
);

export const Changelog6 = log('Changelog 6.2.2', 'changelog-6', 'A release log.');
export const Changelog7 = log('Older versions', 'changelog-7', 'A release log.');
export const Changelog8 = log('Changelog 8.0', 'changelog-8', 'A release log.');
export const Changelog9 = log('Changelog 9.0', 'changelog-9', 'A release log.');
export const Changelog10 = log('Changelog 10.0', 'changelog-10', 'A release log.');
export const Changelog11 = log('Changelog 11.0', 'changelog-11', 'A release log.');
export const Changelog12 = log('Changelog 12.0', 'changelog-12', 'A release log.');
export const Changelog13 = log('Changelog 13.0', 'changelog-13', 'A release log.');
export const Changelog14 = log('Changelog 14.0', 'changelog-14', 'A release log.');
export const Changelog15 = log('Changelog 15.0', 'changelog-15', 'A release log.');
export const Changelog16 = log('Changelog 16.0', 'changelog-16', 'A release log.');
export const Changelog17 = log('Changelog 17.0', 'changelog-17', 'A release log.');
export const Changelog18 = log('Changelog 18.0', 'changelog-18', 'A release log.');

export const ChangesBetweenVersions = log(
  'Changes between versions',
  'changes-between-versions',
  'A widget on the reference’s own site that diffs two versions. Not a grid feature.',
);

export const DeprecationPolicy = log(
  'Deprecation policy',
  'deprecation-policy',
  'How long a deprecated API survives. Policy, not behaviour.',
);

export const LongTermSupport = log(
  'Long Term Support (LTS)',
  'long-term-support',
  'Which versions are supported for how long. Policy, not behaviour.',
);

export const VersioningPolicy = log(
  'Versioning policy',
  'versioning-policy',
  'What a major, minor and patch mean here. Policy, not behaviour.',
);

export const MigratingFrom74To80 = log(
  'Migrate from 7.4 to 8.0',
  'migrating-from-7.4-to-8.0',
  'Introduced the index mappers and removed `RecordTranslator`. cellmoa exposes the mappers as `rowIndex` / `colIndex` rather than `rowIndexMapper` / `columnIndexMapper`, so the names in this guide do not resolve.',
);

export const MigratingFrom84To90 = log(
  'Migrating from 8.4 to 9.0',
  'migrating-from-8.4-to-9.0',
  'Replaced the formulas plugin with HyperFormula. cellmoa calculates natively in its engine, which is a divergence recorded in the parity table — there is no plugin to configure either way.',
);

export const MigratingFrom90To100 = () => (
  <Compare
    note="10.0 turned the copy limits off: `rowsLimit` and `columnsLimit` became `Infinity`. cellmoa kept the old default of 1000 and clipped silently until recently. Select more than a thousand rows in each and copy — a clipped copy is the failure, and `afterCopyLimit` is what should report it."
    settings={{ colHeaders: true, rowHeaders: true, copyPaste: true }}
    data={block(1200, 3)}
    height={240}
  />
);

export const MigratingFrom100To110 = log(
  'Migrating from 10.0 to 11.0',
  'migrating-from-10.0-to-11.0',
  'Introduced modular imports and per-module type files. cellmoa has no modular entry points at all — its plugin barrel registers every plugin as a side effect, so the whole library is one indivisible bundle. Nothing to mount; the gap is in the package, not on screen.',
);

export const MigratingFrom111To120 = () => (
  <Compare
    note="12.0 split `loadData` from `updateData`: the first resets the configuration and the index maps, the second keeps them. Sort a column, then watch what a reload does to the sort. cellmoa routes `updateSettings({ data })` through `loadData` and never fires `beforeUpdateData`."
    settings={{ colHeaders: ['name', 'qty'], rowHeaders: true, columnSorting: true }}
    data={[
      ['pear', '3'],
      ['apple', '12'],
      ['fig', '7'],
    ]}
  />
);

export const MigratingFrom124To130 = () => (
  <Compare
    note="13.0 replaced `insert_row` with `insert_row_above` / `_below` and `insert_col` with `insert_col_start` / `_end`. Every code sample written since uses the new names; they fell through every branch in cellmoa and did nothing at all — not an error, nothing. Both spellings are accepted now. Right-click a row header to try it."
    settings={{ colHeaders: true, rowHeaders: true, contextMenu: true }}
    data={block(5, 3)}
    height={300}
  />
);

export const MigratingFrom131To140 = () => (
  <Compare
    note="14.0 added `imeFastEdit` for composing input methods, and changed the menus' `open()` to take `{ top, left }` or a native event. cellmoa reads `imeFastEdit`; its `open()` still takes `(x, y)`, so the documented call shape does not apply. Switch to a Korean or Japanese keyboard and type into a cell."
    settings={{ colHeaders: true, rowHeaders: true, imeFastEdit: true, contextMenu: true }}
    data={block(4, 3)}
  />
);

export const MigratingFrom146To150 = log(
  'Migrating from 14.6 to 15.0',
  'migrating-from-14.6-to-15.0',
  'A React-wrapper release. cellmoa ships no React wrapper, so nothing here applies.',
);

export const MigratingFrom153To160 = () => (
  <Compare
    note="16.0 moved to CSS custom properties and renamed the DOM classes. cellmoa uses its own `cm-*` classes and its own token set — a divergence recorded in the parity table — so a stylesheet written against `ht-*` will not reach it. What is worth comparing is whether the same theme setting produces the same look."
    settings={{ colHeaders: true, rowHeaders: true, themeName: 'ht-theme-main', theme: 'main' }}
    data={block(5, 4)}
  />
);

export const MigratingFrom160To161 = log(
  'Migrating from 16.0 to 16.1',
  'migrating-from-16.0-to-16.1',
  'Moved the pre-16 look into an opt-in `classic` theme. cellmoa registers a `classic` theme of its own; whether the two look alike is a question for the Styling section.',
);

export const MigratingFrom162To170 = () => (
  <Compare
    note="17.0 moved numbers and dates onto `Intl`: `numericFormat` takes `Intl.NumberFormatOptions` and the date types are spelled `intl-date` / `intl-time`. cellmoa follows the same shape and registers both spellings. A number that groups or places its currency differently is the difference to look for."
    settings={{
      colHeaders: ['Intl currency', 'intl-date'],
      rowHeaders: true,
      columns: [
        { type: 'numeric', numericFormat: { style: 'currency', currency: 'EUR' } },
        { type: 'intl-date', dateFormat: { dateStyle: 'medium' } },
      ],
    }}
    data={[
      ['1234.5', '2024-03-15'],
      ['-99', '2024-12-01'],
    ]}
  />
);

export const MigratingFrom171To180 = () => (
  <Compare
    note="18.0 dropped numbro, moment and the bundled sanitizer. HTML is written through the caller's `sanitizer` or not at all — cellmoa's dialog bypassed that entirely until recently, which was a live XSS path. Both grids here allow HTML with a sanitizer that strips scripts; the cell should show `bold` in bold and no script should run."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      allowHtml: true,
      sanitizer: (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ''),
    }}
    data={[['<b>bold</b><script>alert(1)</script>', 'plain']]}
    height={180}
  />
);

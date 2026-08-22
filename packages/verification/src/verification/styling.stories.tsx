/**
 * Themes, density, direction, and the classes a setting puts on a cell.
 *
 * A theme is a set of CSS custom properties. cellmoa's stylesheet consumes
 * eleven of the roughly three hundred the reference documents, which is a fact
 * that is obvious here and invisible everywhere else.
 */

import { Compare, block } from '../Compare.js';

export default { title: 'Verification/Styling' };

export const ThemeMain = () => (
  <Compare
    note="The default theme, light. Use Ladle's theme control to switch to dark — cellmoa follows `prefers-color-scheme` through its `-dark-auto` classes."
    settings={{ colHeaders: true, rowHeaders: true, themeName: 'ht-theme-main' }}
    data={block(6, 5)}
  />
);

export const ThemeHorizon = () => (
  <Compare
    note="The second built-in. Every token cellmoa does not consume falls back to its own palette, so the further from `main` a theme goes the more the two drift."
    settings={{ colHeaders: true, rowHeaders: true, themeName: 'ht-theme-horizon', theme: 'horizon' }}
    data={block(6, 5)}
  />
);

export const Density = () => (
  <Compare
    note="Compact. Density scales the sizes a caller chose rather than replacing them, so a grid with explicit `rowHeights` should still shrink proportionally."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      theme: 'main',
      themeName: 'ht-theme-main',
      density: 'compact',
    }}
    data={block(8, 5)}
  />
);

export const RightToLeft = () => (
  <Compare
    note="An RTL sheet. Column A is on the right, and the arrow keys move by what is on screen rather than by column number. The default is `inherit`, which cellmoa resolved as left-to-right whatever the page said until it was made to read the document's direction."
    settings={{ colHeaders: true, rowHeaders: true, layoutDirection: 'rtl' }}
    data={block(5, 5)}
  />
);

export const CellClassNames = () => (
  <Compare
    note="Classes applied per cell, per column, and by the `cells` function. `cells` must win over everything, including `setCellMeta` — cellmoa applied it before the per-cell layer, so conditional formatting stopped for exactly the cells that also had explicit meta."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      columns: [{ className: 'htLeft' }, { className: 'htCenter' }, { className: 'htRight' }],
      cells: (row: number) => (row % 2 === 1 ? { className: 'htDimmed' } : {}),
    }}
    data={block(6, 3)}
  />
);

export const WordWrapAndEllipsis = () => (
  <Compare
    note="A long value in a narrow column, wrapped and clipped. Both are stylesheet behaviour."
    settings={{
      colHeaders: ['wrapped', 'no wrap'],
      rowHeaders: true,
      colWidths: [120, 120],
      rowHeights: 48,
      columns: [{ wordWrap: true }, { wordWrap: false }],
    }}
    data={[
      ['a rather long value that has to go somewhere', 'a rather long value that has to go somewhere'],
    ]}
  />
);

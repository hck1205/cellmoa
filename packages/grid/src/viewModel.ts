/**
 * What the view asks of the grid, and what it reports back.
 *
 * These describe the boundary rather than either side of it, so they live where
 * both sides can reach them. Declaring them in `view.ts` put them downstream of
 * the modules that draw — `panes`, `chrome` and `geometry` all had to import
 * from the file that imports them — and the same rule applies here as to the
 * settings: a contract may not depend on the code that fulfils it.
 */

import type { CellData, Coords, GridSettings } from './settings.js';
import type { SizeMap } from './sizes.js';

/** What the view needs to know to draw a cell. */
export interface CellRenderContext {
  row: number;
  col: number;
  /** The element to fill in. It is reused between renders. */
  td: HTMLTableCellElement;
}

/**
 * One cell in the column header.
 *
 * A header can be more than one row deep — a group label spanning several
 * columns above the columns themselves — so a cell carries its own span and
 * knows which level it is on.
 */
export interface ColHeaderCell {
  /** The leftmost column this cell sits above. */
  col: number;
  /** How many columns it spans. */
  colspan: number;
  /** Which header row it is on, 0 at the top. */
  level: number;
  label: string;
}

/** Everything the view reads from the grid. */
export interface ViewModel {
  rowCount(): number;
  colCount(): number;
  rowSizes(): SizeMap;
  colSizes(): SizeMap;
  fixedRowsTop(): number;
  fixedColumnsStart(): number;
  /** Whether headers are drawn, and what they say. */
  rowHeader(row: number): string | null;
  /**
   * The column header, as rows of cells covering `firstCol`..`lastCol`.
   *
   * An empty array means no column header at all. One row of one-column cells
   * is the ordinary case; more rows are a nested header.
   */
  colHeaderRows(firstCol: number, lastCol: number): ColHeaderCell[][];
  rowHeaderWidth(): number;
  /** The whole column-header area, however many levels deep it is. */
  colHeaderHeight(): number;
  /** One level of it, so a nested header can give its rows different heights. */
  colHeaderLevelHeight?(level: number): number;
  /** Called after a header cell is built, so a plugin can decorate it. */
  renderColHeader?(th: HTMLTableCellElement, cell: ColHeaderCell): void;
  /** The same for a row header. */
  renderRowHeader?(th: HTMLTableCellElement, row: number): void;
  /**
   * ARIA roles and indexes on the table, its rows and its cells.
   *
   * A grid built out of `<div>`s and absolute positions is invisible to a
   * screen reader without them: what the eye reads as a table is, to anything
   * that cannot see it, a pile of unrelated boxes.
   */
  ariaTags?(): boolean;
  /** `rtl` mirrors the layout, for languages written right to left. */
  direction?(): 'ltr' | 'rtl';
  /** How many rows are frozen at the bottom. */
  fixedRowsBottom?(): number;
  /** Swallow the wheel, for a page that scrolls the grid itself. */
  preventWheel?(): boolean;
  /**
   * The theme, as the classes it wants and the properties it sets.
   *
   * Properties as well as classes, so a theme registered at run time works
   * without the page having loaded a stylesheet for it.
   */
  theme?(): { classNames: string[]; properties: Record<string, string> } | null;
  /** Extra class names for the grid's own elements. */
  tableClassName?(): string[];
  /**
   * The size the grid should take, as CSS.
   *
   * `null` means "whatever the container is", which is the default and the only
   * thing that works when the page decides the layout.
   */
  size?(): { width: string | null; height: string | null; preventOverflow: 'horizontal' | 'vertical' | false };
  /** Called before drawing, so the data for the window can be fetched. */
  prepare(startRow: number, endRow: number, startCol: number, endCol: number): void;
  /** Fills in one cell. */
  renderCell(context: CellRenderContext): void;
  /** Extra rows and columns to draw beyond the viewport, to smooth scrolling. */
  /**
   * How many rows and columns to draw beyond the viewport.
   *
   * `all` draws every one there is — which is what a page that wants to print
   * the grid, or search it with the browser's own find, has to have, and what
   * makes a large grid unusable if switched on by accident.
   */
  overscan(): { rows: number | 'all'; cols: number | 'all' };
}

/** The visible window, in indexes. */
export interface Viewport {
  firstRow: number;
  lastRow: number;
  firstCol: number;
  lastCol: number;
}

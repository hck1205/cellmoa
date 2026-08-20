/**
 * Settings, and the four layers they cascade through.
 *
 * A setting can be given for the whole grid, for a column, for a row, or for a
 * single cell, and the narrower one wins. Handsontable calls these the global,
 * table, column and cell meta layers; the cascade is what lets `readOnly: true`
 * on one column coexist with an editable grid without either knowing about the
 * other.
 *
 * Resolution goes: cell → row (via the `cells` function) → column → table →
 * global defaults.
 */

import { CellMap } from './cellMap.js';

import type { HookHandler } from './hooks.js';

/** A cell's coordinates in the visual grid. */
export interface Coords {
  row: number;
  col: number;
}

/** What a cell holds, as the grid sees it. */
export interface CellData {
  /** The displayed text. */
  text: string;
  /** The value with its own type kept. */
  value: string | number | boolean | null;
  /** The formula source with its `=`, when the cell holds one. */
  formula?: string;
  /** The error literal, when the value is one. */
  error?: string;
  /** Which entry of the workbook's format table applies. */
  style?: number;
}

/**
 * Every setting name this grid understands.
 *
 * The list is Handsontable's own, taken from its meta schema, so that a
 * configuration written for it is a configuration this grid can read. Naming
 * them explicitly also means a typo in a setting can be reported rather than
 * silently ignored.
 */
export const SETTING_NAMES = [
  'activeHeaderClassName', 'allowEmpty', 'allowHtml', 'allowInsertColumn',
  'allowInsertRow', 'allowInvalid', 'allowRemoveColumn', 'allowRemoveRow',
  'ariaTags', 'autoColumnSize', 'autoRowSize', 'autoWrapCol',
  'autoWrapRow', 'bindRowsWithHeaders', 'cell', 'cells',
  'checkedTemplate', 'className', 'colHeaders', 'colWidths',
  'collapsibleColumns', 'columnHeaderHeight', 'columnSorting', 'columnSummary',
  'columns', 'commentedCellClassName', 'comments', 'contextMenu',
  'copyPaste', 'copyable', 'currentColClassName', 'currentHeaderClassName',
  'currentRowClassName', 'customBorders', 'customBordersProgressive', 'data',
  'dataDotNotation', 'dataProvider', 'dataSchema', 'dateFormat',
  'defaultDate', 'dialog', 'disableVisualSelection', 'dragToScroll',
  'dropdownMenu', 'editor', 'emptyDataState', 'enterBeginsEditing',
  'enterCommits', 'enterMoves', 'exportFile', 'fillHandle',
  'filter', 'filterSelectedItems', 'filteringCaseSensitive', 'filters',
  'fixedColumnsLeft', 'fixedColumnsStart', 'fixedRowsBottom', 'fixedRowsTop',
  'formulas', 'fragmentSelection', 'hashLength', 'hashRevealDelay',
  'hashSymbol', 'headerClassName', 'height', 'hiddenColumns',
  'hiddenRows', 'imeFastEdit', 'initialState', 'injectCoreCss',
  'invalidCellClassName', 'label', 'language', 'layout',
  'layoutDirection', 'licenseKey', 'loading', 'locale',
  'manualColumnFreeze', 'manualColumnMove', 'manualColumnResize', 'manualRowMove',
  'manualRowResize', 'maxCols', 'maxRows', 'maxSelections',
  'mergeCells', 'minCols', 'minRowHeights', 'minRows',
  'minSpareCols', 'minSpareRows', 'moveCells', 'multiColumnSorting',
  'navigableHeaders', 'nestedHeaders', 'nestedRows', 'noWordWrapClassName',
  'notification', 'numericFormat', 'observeDOMVisibility', 'outsideClickDeselects',
  'pagination', 'parsePastedValue', 'placeholder', 'placeholderCellClassName',
  'preserveNumericLiteral', 'preventOverflow', 'preventWheel', 'readOnly',
  'readOnlyCellClassName', 'renderAllColumns', 'renderAllRows', 'renderer',
  'rowHeaderWidth', 'rowHeaders', 'rowHeights', 'sanitizer',
  'search', 'searchInput', 'selectOptions', 'selectionHandles',
  'selectionMode', 'skipColumnOnPaste', 'skipRowOnPaste', 'sortByRelevance',
  'source', 'sourceDataValidator', 'sourceDataWarningMessage', 'sourceSortFunction',
  'startCols', 'startRows', 'stretchH', 'strict',
  'tabMoves', 'tabNavigation', 'tableClassName', 'textEllipsis',
  'theme', 'themeName', 'timeFormat', 'title',
  'trimDropdown', 'trimRows', 'trimWhitespace', 'type',
  'uncheckedTemplate', 'undo', 'validator', 'valueFormatter',
  'valueGetter', 'valueParser', 'valueSetter', 'viewportColumnRenderingOffset',
  'viewportColumnRenderingThreshold', 'viewportRowRenderingOffset', 'viewportRowRenderingThreshold', 'visibleRows',
  'width', 'wordWrap',
] as const;

export type SettingName = (typeof SETTING_NAMES)[number];

const KNOWN_SETTINGS = new Set<string>(SETTING_NAMES);

/** Whether a name is a setting this grid understands. */
export function isSettingName(name: string): name is SettingName {
  return KNOWN_SETTINGS.has(name);
}

/** How many settings the grid understands. */
export const SETTING_COUNT = 162;

/** A cell's type, which selects its renderer, editor and validator. */
export type CellType =
  | 'text'
  | 'numeric'
  | 'date'
  | 'time'
  | 'checkbox'
  | 'dropdown'
  | 'autocomplete'
  | 'select'
  | 'multiSelect'
  | 'password'
  | 'handsontable'
  | 'intlDate'
  | 'intlTime';

/** A function that decides a cell's settings from its position. */
export type CellsFunction = (row: number, col: number, prop?: string | number) => GridSettings;

/**
 * The settings a grid, a column or a cell can carry.
 *
 * Every field is optional: a setting that is not given is inherited from the
 * layer above, and ultimately from the defaults.
 */
export interface GridSettings {
  [key: string]: unknown;

  // --- data -------------------------------------------------------------
  data?: unknown;
  dataSchema?: unknown;
  startRows?: number;
  startCols?: number;
  minRows?: number;
  minCols?: number;
  maxRows?: number;
  maxCols?: number;
  minSpareRows?: number;
  minSpareCols?: number;

  // --- structure --------------------------------------------------------
  columns?: GridSettings[] | ((index: number) => GridSettings | null);
  cells?: CellsFunction;
  cell?: Array<{ row: number; col: number } & GridSettings>;
  colHeaders?: boolean | string[] | ((index: number) => string);
  rowHeaders?: boolean | string[] | ((index: number) => string);
  colWidths?: number | number[] | ((index: number) => number);
  rowHeights?: number | number[] | ((index: number) => number);
  fixedRowsTop?: number;
  fixedRowsBottom?: number;
  fixedColumnsStart?: number;
  /** The pre-16.0 spelling of `fixedColumnsStart`, still honoured. */
  fixedColumnsLeft?: number;
  width?: number | string;
  height?: number | string;
  stretchH?: 'none' | 'last' | 'all';

  // --- behaviour --------------------------------------------------------
  readOnly?: boolean;
  editor?: string | false;
  renderer?: string;
  validator?: unknown;
  type?: CellType;
  allowInvalid?: boolean;
  allowEmpty?: boolean;
  allowInsertRow?: boolean;
  allowInsertColumn?: boolean;
  allowRemoveRow?: boolean;
  allowRemoveColumn?: boolean;
  className?: string;
  wordWrap?: boolean;
  placeholder?: string;
  copyable?: boolean;
  skipRowOnPaste?: boolean;
  skipColumnOnPaste?: boolean;
  trimWhitespace?: boolean;

  // --- navigation -------------------------------------------------------
  autoWrapRow?: boolean;
  autoWrapCol?: boolean;
  enterBeginsEditing?: boolean;
  enterMoves?: Coords | ((event: KeyboardEvent) => Coords);
  tabMoves?: Coords | ((event: KeyboardEvent) => Coords);
  outsideClickDeselects?: boolean;
  selectionMode?: 'single' | 'range' | 'multiple';
  disableVisualSelection?: boolean | string | string[];
  fragmentSelection?: boolean | 'cell';
  tabNavigation?: boolean;
  navigableHeaders?: boolean;

  // --- plugins ----------------------------------------------------------
  columnSorting?: unknown;
  multiColumnSorting?: unknown;
  filters?: boolean;
  dropdownMenu?: unknown;
  contextMenu?: unknown;
  comments?: unknown;
  customBorders?: unknown;
  mergeCells?: unknown;
  manualColumnResize?: boolean | number[];
  manualRowResize?: boolean | number[];
  manualColumnMove?: boolean | number[];
  manualRowMove?: boolean | number[];
  manualColumnFreeze?: boolean;
  hiddenColumns?: unknown;
  hiddenRows?: unknown;
  trimRows?: boolean | number[];
  nestedHeaders?: unknown;
  nestedRows?: boolean;
  collapsibleColumns?: unknown;
  columnSummary?: unknown;
  autofill?: unknown;
  fillHandle?: boolean | 'vertical' | 'horizontal' | Record<string, unknown>;
  copyPaste?: unknown;
  undo?: boolean;
  search?: unknown;
  pagination?: unknown;
  exportFile?: boolean;
  formulas?: unknown;
  dragToScroll?: boolean;
  bindRowsWithHeaders?: boolean | string;
  autoColumnSize?: unknown;
  autoRowSize?: unknown;
  /** An alias for `stretchH`, matching the plugin's name. */
  stretchColumns?: 'none' | 'last' | 'all';
  /** Turns both `manualRowResize` and `manualColumnResize` on. */
  manualResize?: boolean;
  dialog?: unknown;
  moveCells?: unknown;
  touchScroll?: unknown;
  selectionHandles?: unknown;
  multipleSelectionHandles?: unknown;
  /** The order of the elements in the slots around the grid. */
  layout?: { top?: string[]; bottom?: string[] };
  dataProvider?: unknown;

  // Settings with no Handsontable counterpart.
  /** Show who changed each cell, and mark the ones an agent touched. */
  provenance?: unknown;
  /** Report writes the revision guard refused. */
  conflicts?: unknown;
  /** A bar showing the revision and the workbook fingerprint. */
  statusBar?: unknown;
  /** Mark the cells a failed verification points at. */
  verifyOverlay?: unknown;
  /** Mark the cells that differ from a recorded snapshot. */
  diffView?: unknown;
  notification?: unknown;
  loading?: unknown;
  emptyDataState?: unknown;

  // --- appearance -------------------------------------------------------
  themeName?: string;
  theme?: string;
  tableClassName?: string | string[];
  currentRowClassName?: string;
  currentColClassName?: string;
  currentHeaderClassName?: string;
  activeHeaderClassName?: string;
  invalidCellClassName?: string;
  readOnlyCellClassName?: string;
  commentedCellClassName?: string;
  placeholderCellClassName?: string;
  noWordWrapClassName?: string;
  headerClassName?: string;
  textEllipsis?: number;

  // --- internationalisation ---------------------------------------------
  language?: string;
  locale?: string;
  layoutDirection?: 'ltr' | 'rtl' | 'inherit';
  imeFastEdit?: boolean;

  // --- rendering --------------------------------------------------------
  renderAllRows?: boolean;
  renderAllColumns?: boolean;
  viewportRowRenderingOffset?: number | 'auto';
  viewportColumnRenderingOffset?: number | 'auto';
  ariaTags?: boolean;

  // --- type-specific -----------------------------------------------------
  numericFormat?: { pattern?: string; culture?: string };
  dateFormat?: string;
  timeFormat?: string;
  defaultDate?: string;
  correctFormat?: boolean;
  source?: unknown[] | ((query: string, callback: (items: unknown[]) => void) => void);
  strict?: boolean;
  filter?: boolean;
  filteringCaseSensitive?: boolean;
  sortByRelevance?: boolean;
  trimDropdown?: boolean;
  visibleRows?: number;
  checkedTemplate?: unknown;
  uncheckedTemplate?: unknown;
  label?: Record<string, unknown>;
  selectOptions?: unknown;
  hashLength?: number;
  hashSymbol?: string;
  hashRevealDelay?: number;
  allowHtml?: boolean;

  // --- hooks may be given as settings, as Handsontable allows ------------
  [hook: `after${string}`]: HookHandler | unknown;
}

/**
 * The defaults every grid starts from.
 *
 * These match Handsontable's own defaults wherever it has one, so that a grid
 * configured only by what it was given behaves the same in both.
 */
export const DEFAULT_SETTINGS: GridSettings = {
  startRows: 5,
  startCols: 5,
  minRows: 0,
  minCols: 0,
  maxRows: Infinity,
  maxCols: Infinity,
  minSpareRows: 0,
  minSpareCols: 0,
  rowHeaders: false,
  colHeaders: false,
  fixedRowsTop: 0,
  fixedRowsBottom: 0,
  fixedColumnsStart: 0,
  stretchH: 'none',
  readOnly: false,
  type: 'text',
  allowInvalid: true,
  allowEmpty: true,
  allowInsertRow: true,
  allowInsertColumn: true,
  allowRemoveRow: true,
  allowRemoveColumn: true,
  wordWrap: true,
  copyable: true,
  trimWhitespace: true,
  autoWrapRow: false,
  autoWrapCol: false,
  enterBeginsEditing: true,
  enterMoves: { row: 1, col: 0 },
  tabMoves: { row: 0, col: 1 },
  outsideClickDeselects: true,
  selectionMode: 'multiple',
  fillHandle: true,
  undo: true,
  copyPaste: true,
  layoutDirection: 'inherit',
  language: 'en-US',
  // No default: an unset locale means "follow the language", which is what
  // someone who set only `language` meant. Defaulting it to en-US would make
  // a French grid format its numbers in English.
  locale: undefined,
  ariaTags: true,
  renderAllRows: false,
  renderAllColumns: false,
  viewportRowRenderingOffset: 'auto',
  viewportColumnRenderingOffset: 'auto',
  currentRowClassName: undefined,
  currentColClassName: undefined,
  invalidCellClassName: 'htInvalid',
  readOnlyCellClassName: 'htDimmed',
  commentedCellClassName: 'htCommentCell',
  placeholderCellClassName: 'htPlaceholder',
  noWordWrapClassName: 'htNoWrap',
  allowHtml: false,
};

/** Row and column defaults that are not settings but are needed to lay out. */
export const DEFAULT_ROW_HEIGHT = 23;
export const DEFAULT_COLUMN_WIDTH = 50;
export const DEFAULT_ROW_HEADER_WIDTH = 50;

/**
 * Resolves settings through the four layers.
 *
 * Kept as a class rather than a bare function because resolution is on the hot
 * path — every rendered cell asks for its settings — and the per-cell answers
 * are worth caching between renders.
 */
export class MetaManager {
  #global: GridSettings;
  #table: GridSettings = {};
  #columns = new Map<number, GridSettings>();
  #cells = new CellMap<GridSettings>();
  /** Cleared whenever anything above the cell layer changes. */
  #cache = new CellMap<GridSettings>();

  constructor(defaults: GridSettings = DEFAULT_SETTINGS) {
    this.#global = { ...defaults };
  }

  /** The settings given for the grid as a whole. */
  get table(): GridSettings {
    return this.#table;
  }

  /** Applies grid-wide settings, replacing what was there before. */
  update(settings: GridSettings): void {
    Object.assign(this.#table, settings);
    if (Array.isArray(settings.columns)) {
      this.#columns.clear();
      settings.columns.forEach((column, index) => this.#columns.set(index, { ...column }));
    }
    // `cell` is a list of per-cell overrides given up front.
    if (Array.isArray(settings.cell)) {
      for (const entry of settings.cell) {
        const { row, col, ...rest } = entry;
        this.setCell(row, col, rest);
      }
    }
    this.#cache.clear();
  }

  /** Settings for one column. */
  setColumn(index: number, settings: GridSettings): void {
    this.#columns.set(index, { ...(this.#columns.get(index) ?? {}), ...settings });
    this.#cache.clear();
  }

  /** Settings for one cell. */
  setCell(row: number, col: number, settings: GridSettings): void {
    this.#cells.set(row, col, { ...(this.#cells.get(row, col) ?? {}), ...settings });
    this.#cache.delete(row, col);
  }

  /** Removes one setting from a cell, so it inherits again. */
  removeCell(row: number, col: number, name?: string): void {
    if (name === undefined) {
      this.#cells.delete(row, col);
    } else {
      const existing = this.#cells.get(row, col);
      if (existing) {
        delete existing[name];
      }
    }
    this.#cache.delete(row, col);
  }

  /**
   * Moves the per-cell overrides when rows or columns are inserted or deleted.
   *
   * Without this a comment or a `readOnly` would stay at row 5 while the cell
   * it described moved to row 6 — the note would end up on someone else's
   * number, which is worse than losing it.
   */
  shift(axis: 'row' | 'col', at: number, count: number): void {
    const moved = new CellMap<GridSettings>();
    for (const [row, col, settings] of this.#cells) {
      const index = axis === 'row' ? row : col;
      let target = index;
      if (index >= at) {
        if (count < 0 && index < at - count) {
          // The cell itself was deleted, and so is anything said about it.
          continue;
        }
        target = index + count;
      }
      if (axis === 'row') {
        moved.set(target, col, settings);
      } else {
        moved.set(row, target, settings);
      }
    }
    this.#cells = moved;
    this.#cache.clear();
  }

  /** Forgets every per-cell override. */
  clearCells(): void {
    this.#cells.clear();
    this.#cache.clear();
  }

  /**
   * The settings in force for one cell.
   *
   * The layers are merged narrowest-last, so a value set on the cell beats one
   * set on the column, which beats one set on the grid.
   */
  forCell(row: number, col: number): GridSettings {
    const cached = this.#cache.get(row, col);
    if (cached) {
      return cached;
    }
    const resolved: GridSettings = { ...this.#global, ...this.#table };

    const columns = this.#table.columns;
    if (typeof columns === 'function') {
      Object.assign(resolved, columns(col) ?? {});
    }
    const column = this.#columns.get(col);
    if (column) {
      Object.assign(resolved, column);
    }
    // The `cells` function is consulted after the column so that it can
    // override a column-wide decision for one row.
    if (typeof this.#table.cells === 'function') {
      Object.assign(resolved, this.#table.cells(row, col) ?? {});
    }
    const cell = this.#cells.get(row, col);
    if (cell) {
      Object.assign(resolved, cell);
    }

    this.#cache.set(row, col, resolved);
    return resolved;
  }

  /** The settings in force for a column, without consulting any row. */
  forColumn(col: number): GridSettings {
    const resolved: GridSettings = { ...this.#global, ...this.#table };
    const columns = this.#table.columns;
    if (typeof columns === 'function') {
      Object.assign(resolved, columns(col) ?? {});
    }
    Object.assign(resolved, this.#columns.get(col) ?? {});
    return resolved;
  }

  /** Invalidates the per-cell cache. */
  invalidate(): void {
    this.#cache.clear();
  }
}

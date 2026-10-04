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


import type { Grid } from './grid.js';
import type { CellRenderer } from './cellTypes/types.js';
import type { Sanitizer } from './sanitize.js';
import type { HookHandler } from './hooks.js';
import type { RegisteredTheme } from './themes/index.js';

/**
 * One row of a `nestedRows` tree.
 *
 * Declared here rather than imported from the plugin: a setting's type has to
 * be reachable without pulling in the code that acts on it, or every consumer
 * of `GridSettings` loads every plugin.
 */
export interface NestedRow {
  row: number;
  children?: NestedRow[];
}

/**
 * The shapes a `dataProvider` configuration is made of.
 *
 * They live here rather than in the plugin for the same reason `NestedRow`
 * does: a setting's type has to be reachable without pulling in the code that
 * acts on it. The plugin imports them back — a plugin may depend on the
 * settings, and the settings may not depend on a plugin.
 */

/** How the rows should be ordered. */
export interface SortDescriptor {
  /** The column's name, which is what a server can act on. */
  prop: string | number;
  order: 'asc' | 'desc';
}

/** One column's filter, as the source receives it. */
export interface FilterDescriptor {
  prop: string | number;
  conditions: Array<{ name: string; args: unknown[] }>;
  operation?: 'conjunction' | 'disjunction';
}

/** What the grid asks the source for. */
export interface QueryParameters {
  /** 1-based. */
  page: number;
  pageSize: number;
  sort: SortDescriptor | null;
  filters: FilterDescriptor[] | null;
}

/**
 * A fetch's options, which are the query plus what the source must not see.
 *
 * `skipLoading` says the fetch is one the grid started for its own reasons —
 * after a sort, or after a write went through — so the overlay should not flash
 * over a table the reader is already looking at. It never reaches `fetchRows`:
 * how the grid draws is not the source's business.
 */
export interface FetchOptions extends Partial<QueryParameters> {
  skipLoading?: boolean;
}

/** What the source answers with. */
export interface FetchResult {
  rows: string[][];
  totalRows: number;
}

/** One row's worth of changes, as `onRowsUpdate` receives them. */
export interface RowUpdate {
  id: unknown;
  changes: Record<string, string>;
  rowData?: string[];
}

/** What `onRowsCreate` receives. */
export interface RowsCreate {
  position: 'above' | 'below';
  referenceRowId?: unknown;
  rowsAmount: number;
}

export type MutationOperation = 'create' | 'update' | 'remove';

export interface DataProviderSettings {
  /**
   * Names a row.
   *
   * A string reads that column; a function decides. Without one the grid has
   * nothing stable to send a server — a visual index changes when the page
   * does — so writing is refused rather than sent against the wrong row.
   */
  rowId?: string | ((row: number, values: string[]) => unknown);
  /** Fetches a page. `signal` aborts when this request is overtaken. */
  fetchRows?: (
    query: QueryParameters,
    context: { signal: AbortSignal },
  ) => Promise<FetchResult> | FetchResult;
  onRowsCreate?: (payload: RowsCreate) => Promise<unknown> | unknown;
  onRowsUpdate?: (rows: RowUpdate[]) => Promise<unknown> | unknown;
  onRowsRemove?: (ids: unknown[]) => Promise<unknown> | unknown;
  /** Called when a fetch throws, so a host with its own error UI can use it. */
  onError?: (error: unknown, query: QueryParameters) => void;
}

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
  'isEmptyCol', 'isEmptyRow',
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
  // Both spellings of the three the reference renames: the documented names
  // are the hyphenated ones, and a configuration written from the guide has to
  // type-check as well as resolve.
  | 'intlDate'
  | 'intl-date'
  | 'intlTime'
  | 'intl-time'
  | 'multiselect';

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
  /**
   * A registered renderer's name, or the function itself.
   *
   * The runtime has always accepted both — `getCellRenderer` and the draw path
   * each check `typeof meta.renderer === 'function'` — but this said `string`,
   * so the working half was unreachable from TypeScript without a cast.
   *
   * The signature is not the reference's. A renderer here is called with one
   * context object, `({ row, col, td, cell, meta })`; Handsontable calls one
   * with positional arguments, `(instance, td, row, col, prop, value,
   * cellProperties)`. A renderer written for one does not run under the other.
   */
  renderer?: string | CellRenderer;
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
  outsideClickDeselects?: boolean | ((target: HTMLElement) => boolean);
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
  /** `true` for the defaults, or the tree of parents and children. */
  nestedRows?: boolean | NestedRow[];
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
  /**
   * Where the rows come from, when they come from somewhere else.
   *
   * Typed rather than `unknown` so that writing `fetchRows` gets the query and
   * the abort signal typed, and a misspelt callback is a compile error rather
   * than a callback that is never called.
   */
  dataProvider?: DataProviderSettings;

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
  /** A registered theme's name, or the theme itself. */
  theme?: string | RegisteredTheme;
  parsePastedValue?: boolean;
  filterSelectedItems?: boolean;
  searchInput?: boolean;
  maxSelections?: number;
  preserveNumericLiteral?: boolean;
  sourceSortFunction?: (a: string, b: string) => number;
  enterCommits?: boolean;
  title?: string;
  preventWheel?: boolean;
  valueGetter?: (value: string, row: number, col: number) => unknown;
  valueFormatter?: (value: unknown, row: number, col: number) => unknown;
  valueParser?: (value: string, row: number, col: number) => unknown;
  valueSetter?: (value: string, row: number, col: number) => unknown;
  dataDotNotation?: boolean;
  initialState?: GridSettings;
  injectCoreCss?: boolean;
  licenseKey?: string;
  observeDOMVisibility?: boolean;
  customBordersProgressive?: boolean;
  viewportRowRenderingThreshold?: number | 'auto';
  viewportColumnRenderingThreshold?: number | 'auto';
  sourceDataValidator?: (value: unknown, row: number, col: number) => boolean;
  sourceDataWarningMessage?: string;
  tableClassName?: string | string[];
  /** Caps the grid at its parent's size in one direction. */
  preventOverflow?: 'horizontal' | 'vertical' | false;
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
  textEllipsis?: boolean;

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
  /**
   * How a numeric cell is formatted.
   *
   * `Intl.NumberFormatOptions`, not Handsontable's `{ pattern, culture }`.
   * Handsontable formats through numbro; this grid formats through `Intl`,
   * which every browser already has — so a grid does not ship a second number
   * formatter to say `$1,234.50`. The type used to say `{ pattern, culture }`
   * while the renderer read `Intl` options, which made the documented usage a
   * compile error.
   */
  /**
   * Cleans HTML before it reaches the DOM.
   *
   * No sanitizer ships with this grid, as none ships with the reference since
   * v18: a bundled one goes stale, and only the caller knows what their content
   * may contain. `source` says where the content is going, so one function can
   * be stricter about a paste than about a cell it rendered itself.
   */
  /**
   * What counts as an empty row or column, when the default does not.
   *
   * The default asks whether every cell's source value is `''`. A grid whose
   * rows carry an id, or a spacer column, is never empty by that rule, and
   * `minSpareRows` and the empty-data state both read it — so the reference
   * lets the caller answer instead. `this` is the grid.
   */
  isEmptyRow?: (this: Grid, row: number) => boolean;
  isEmptyCol?: (this: Grid, col: number) => boolean;

  sanitizer?: Sanitizer;

  numericFormat?: Intl.NumberFormatOptions;
  /** `Intl.DateTimeFormatOptions`, for the same reason. */
  dateFormat?: Intl.DateTimeFormatOptions;
  timeFormat?: Intl.DateTimeFormatOptions;
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

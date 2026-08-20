/**
 * The grid.
 *
 * The public surface follows Handsontable's, so that a configuration or an
 * integration written against it works here. What is underneath is different:
 * the data lives in a calculation engine rather than in a JavaScript array, so
 * a formula is a first-class thing rather than a plugin, and every edit is
 * recorded with who made it.
 */

import { DataSource, WriteConflict, cellRef, columnLetters } from './dataSource.js';
import type { Edit } from './dataSource.js';
import type { Engine } from './engine.js';
import { Hooks } from './hooks.js';
import type { HookHandler } from './hooks.js';
import { IndexMapper } from './indexMapper.js';
import { CellRange, Selection } from './selection.js';
import type { SelectionMode } from './selection.js';
import {
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_ROW_HEADER_WIDTH,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_SETTINGS,
  MetaManager,
} from './settings.js';
import type { CellData, Coords, GridSettings } from './settings.js';
import { SizeMap } from './sizes.js';
import { View } from './view.js';
import type { CellRenderContext } from './view.js';

/** How the grid was told to change something, for the `afterChange` hook. */
export type ChangeSource =
  | 'edit'
  | 'loadData'
  | 'populateFromArray'
  | 'paste'
  | 'autofill'
  | 'undo'
  | 'redo'
  | 'api'
  | (string & {});

/** One change, as `afterChange` reports it. */
export type CellChange = [row: number, prop: string | number, oldValue: unknown, newValue: unknown];

/** What the grid needs to start. */
export interface GridOptions extends GridSettings {
  /** The engine holding the workbook. */
  engine: Engine;
  /** Which sheet to show. Defaults to the first. */
  sheet?: string;
  /** How this grid's edits are recorded. */
  actor?: { kind: 'human' | 'agent' | 'script' | 'system'; id: string };
}

/**
 * A grid bound to one sheet of one workbook.
 */
export class Grid {
  readonly hooks = new Hooks();
  readonly rowIndex = new IndexMapper();
  readonly colIndex = new IndexMapper();

  #container: HTMLElement;
  #engine: Engine;
  #data: DataSource;
  #meta = new MetaManager(DEFAULT_SETTINGS);
  #selection: Selection;
  #view: View | null = null;
  #rowSizes = new SizeMap(0, DEFAULT_ROW_HEIGHT);
  #colSizes = new SizeMap(0, DEFAULT_COLUMN_WIDTH);
  #destroyed = false;
  #renderSuspended = 0;
  #renderQueued = false;

  constructor(container: HTMLElement, options: GridOptions) {
    this.#container = container;
    this.#engine = options.engine;
    this.#data = new DataSource(options.engine, options.sheet);

    const { engine: _engine, sheet: _sheet, ...settings } = options;
    this.#meta.update(settings);

    this.#selection = new Selection(
      () => this.countRows(),
      () => this.countCols(),
      (this.getSettings().selectionMode as SelectionMode) ?? 'multiple',
    );

    this.#registerSettingHooks(settings);
    this.#syncDimensions();
    this.#mount();
    this.hooks.run('afterInit', undefined);
  }

  // --- settings ---------------------------------------------------------

  /** The settings in force for the grid as a whole. */
  getSettings(): GridSettings {
    return { ...DEFAULT_SETTINGS, ...this.#meta.table };
  }

  /** Applies new settings, redrawing once. */
  updateSettings(settings: GridSettings, redraw = true): void {
    if (!this.hooks.allows('beforeUpdateSettings', settings)) {
      return;
    }
    this.#meta.update(settings);
    this.#registerSettingHooks(settings);
    if (settings.selectionMode) {
      this.#selection.setMode(settings.selectionMode as SelectionMode);
    }
    this.#syncDimensions();
    this.hooks.run('afterUpdateSettings', settings);
    if (redraw) {
      this.render();
    }
  }

  /** The settings in force for one cell. */
  getCellMeta(row: number, col: number): GridSettings {
    const meta = this.#meta.forCell(row, col);
    return this.hooks.run('afterGetCellMeta', meta, row, col);
  }

  /** Sets one setting on one cell. */
  setCellMeta(row: number, col: number, key: string, value: unknown): void {
    this.#meta.setCell(row, col, { [key]: value });
    this.hooks.run('afterSetCellMeta', undefined, row, col, key, value);
  }

  /** Sets several settings on one cell. */
  setCellMetaObject(row: number, col: number, settings: GridSettings): void {
    this.#meta.setCell(row, col, settings);
  }

  /** Removes a setting from one cell, so it inherits again. */
  removeCellMeta(row: number, col: number, key?: string): void {
    this.#meta.removeCell(row, col, key);
  }

  // --- data -------------------------------------------------------------

  /** The engine behind the grid. */
  get engine(): Engine {
    return this.#engine;
  }

  /** The data source, for plugins that need more than the grid exposes. */
  get source(): DataSource {
    return this.#data;
  }

  /** The workbook's revision. */
  get revision(): number {
    return this.#data.revision;
  }

  /** How many rows the user can see, hidden ones included. */
  countRows(): number {
    return this.rowIndex.visibleLength;
  }

  /** How many columns the user can see. */
  countCols(): number {
    return this.colIndex.visibleLength;
  }

  /** How many rows the data has, trimmed ones included. */
  countSourceRows(): number {
    return this.rowIndex.length;
  }

  countSourceCols(): number {
    return this.colIndex.length;
  }

  /** The displayed text of a cell. */
  getDataAtCell(row: number, col: number): string {
    const physical = this.#physical(row, col);
    if (!physical) {
      return '';
    }
    this.#ensure(physical.row, physical.row, physical.col, physical.col);
    return this.#data.text(physical.row, physical.col);
  }

  /** Everything about a cell, or `null` when it holds nothing. */
  getCell(row: number, col: number): CellData | null {
    const physical = this.#physical(row, col);
    if (!physical) {
      return null;
    }
    this.#ensure(physical.row, physical.row, physical.col, physical.col);
    return this.#data.get(physical.row, physical.col);
  }

  /** What an editor should start with: the formula if there is one. */
  getSourceDataAtCell(row: number, col: number): string {
    const physical = this.#physical(row, col);
    if (!physical) {
      return '';
    }
    this.#ensure(physical.row, physical.row, physical.col, physical.col);
    return this.#data.editableValue(physical.row, physical.col);
  }

  /** Every visible cell, row by row. */
  getData(): string[][] {
    const rows = this.countRows();
    const cols = this.countCols();
    this.#ensureVisible(0, rows - 1, 0, cols - 1);
    return Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => this.getDataAtCell(row, col)),
    );
  }

  /** One row of visible cells. */
  getDataAtRow(row: number): string[] {
    return Array.from({ length: this.countCols() }, (_, col) => this.getDataAtCell(row, col));
  }

  /** One column of visible cells. */
  getDataAtCol(col: number): string[] {
    return Array.from({ length: this.countRows() }, (_, row) => this.getDataAtCell(row, col));
  }

  /**
   * Writes one cell.
   *
   * The value is typed as a user would type it: a leading `=` makes a formula,
   * and an empty string clears the cell.
   */
  setDataAtCell(row: number, col: number, value: string, source: ChangeSource = 'edit'): void {
    this.setDataAtCells([[row, col, value]], source);
  }

  /**
   * Writes several cells as one change.
   *
   * One call rather than several is not only faster: the engine recalculates
   * once, so a formula that reads two of the cells never sees half the edit.
   */
  setDataAtCells(
    changes: Array<[row: number, col: number, value: string]>,
    source: ChangeSource = 'edit',
  ): void {
    if (this.#destroyed || changes.length === 0) {
      return;
    }
    const before: CellChange[] = changes.map(([row, col, value]) => [
      row,
      col,
      this.getSourceDataAtCell(row, col),
      value,
    ]);
    if (!this.hooks.allows('beforeChange', before, source)) {
      return;
    }

    // A spreadsheet lets you type into the empty rows below the data, so the
    // grid grows to cover a write that lands past its current extent rather
    // than dropping it.
    this.#growTo(changes);

    const edits: Edit[] = [];
    for (const [row, col, value] of changes) {
      const meta = this.getCellMeta(row, col);
      if (meta.readOnly) {
        // A read-only cell refuses quietly, as Handsontable does: the paste
        // that covered it should still land everywhere else.
        continue;
      }
      const physical = this.#physical(row, col);
      if (physical) {
        edits.push({ row: physical.row, col: physical.col, input: value });
      }
    }
    if (edits.length === 0) {
      return;
    }

    try {
      this.#data.write(edits, undefined, source === 'edit' ? undefined : source);
    } catch (error) {
      if (error instanceof WriteConflict) {
        this.hooks.run('afterRevisionConflict', undefined, error.revision);
        return;
      }
      throw error;
    }
    this.#syncDimensions();
    this.hooks.run('afterChange', before, source);
    this.render();
  }

  /**
   * Fills a rectangle from a two-dimensional array, as a paste does.
   *
   * The source repeats to cover the target when the target is a whole multiple
   * of it, which is what makes pasting one row down a column work.
   */
  populateFromArray(
    startRow: number,
    startCol: number,
    values: string[][],
    endRow?: number,
    endCol?: number,
    source: ChangeSource = 'populateFromArray',
  ): void {
    if (values.length === 0) {
      return;
    }
    const height = values.length;
    const width = Math.max(...values.map((row) => row.length));
    const lastRow = endRow ?? startRow + height - 1;
    const lastCol = endCol ?? startCol + width - 1;

    const changes: Array<[number, number, string]> = [];
    for (let row = startRow; row <= lastRow; row += 1) {
      for (let col = startCol; col <= lastCol; col += 1) {
        const value = values[(row - startRow) % height]?.[(col - startCol) % width];
        if (value !== undefined) {
          changes.push([row, col, value]);
        }
      }
    }
    this.setDataAtCells(changes, source);
  }

  /** Clears the selected cells. */
  emptySelectedCells(source: ChangeSource = 'edit'): void {
    const cells = this.#selection.cells();
    this.setDataAtCells(
      cells.map(({ row, col }) => [row, col, ''] as [number, number, string]),
      source,
    );
  }

  /** Undoes the last change. */
  undo(): void {
    this.#data.undo();
    this.#syncDimensions();
    this.hooks.run('afterUndo', undefined);
    this.render();
  }

  /** Re-applies the last undone change. */
  redo(): void {
    this.#data.redo();
    this.#syncDimensions();
    this.hooks.run('afterRedo', undefined);
    this.render();
  }

  /**
   * Undoes only what one actor did.
   *
   * This has no counterpart in Handsontable, and it is the point of recording
   * who made each change: an agent's work can be taken back without disturbing
   * the edits a person made in the meantime.
   */
  undoBy(actor: string): void {
    this.#data.undo(actor);
    this.#syncDimensions();
    this.hooks.run('afterUndo', undefined, actor);
    this.render();
  }

  /** Who changed a cell, when, and why. */
  getCellHistory(row: number, col: number): Array<Record<string, unknown>> {
    const physical = this.#physical(row, col);
    return physical ? this.#data.history(physical.row, physical.col) : [];
  }

  // --- selection --------------------------------------------------------

  /** The selection, for plugins. */
  get selection(): Selection {
    return this.#selection;
  }

  /** The selected areas, as `[topRow, startCol, bottomRow, endCol]` each. */
  getSelected(): Array<[number, number, number, number]> | undefined {
    return this.#selection.isEmpty
      ? undefined
      : this.#selection.ranges.map((range) => range.toArray());
  }

  /** The most recent selected area. */
  getSelectedLast(): [number, number, number, number] | undefined {
    return this.#selection.last?.toArray();
  }

  /** The selected ranges. */
  getSelectedRange(): CellRange[] | undefined {
    return this.#selection.isEmpty ? undefined : this.#selection.ranges;
  }

  getSelectedRangeLast(): CellRange | undefined {
    return this.#selection.last ?? undefined;
  }

  /** Selects one cell, or a rectangle when an end is given. */
  selectCell(row: number, col: number, endRow?: number, endCol?: number): boolean {
    if (!this.hooks.allows('beforeSelection', row, col, endRow, endCol)) {
      return false;
    }
    if (endRow === undefined || endCol === undefined) {
      this.#selection.setCell({ row, col });
    } else {
      this.#selection.setRange({ row, col }, { row: endRow, col: endCol });
    }
    this.#afterSelection();
    return true;
  }

  /** Selects several areas at once. */
  selectCells(ranges: Array<[number, number, number, number]>): boolean {
    if (ranges.length === 0) {
      return false;
    }
    this.#selection.clear();
    for (const [row, col, endRow, endCol] of ranges) {
      this.#selection.addRange({ row, col }, { row: endRow, col: endCol });
    }
    this.#afterSelection();
    return true;
  }

  selectRows(from: number, to: number = from): boolean {
    this.#selection.selectRows(from, to);
    this.#afterSelection();
    return true;
  }

  selectColumns(from: number, to: number = from): boolean {
    this.#selection.selectColumns(from, to);
    this.#afterSelection();
    return true;
  }

  selectAll(): void {
    this.#selection.selectAll();
    this.#afterSelection();
  }

  deselectCell(): void {
    this.#selection.clear();
    this.hooks.run('afterDeselect', undefined);
    this.render();
  }

  /** Scrolls until a cell is on screen. */
  scrollViewportTo(row: number, col: number): void {
    this.#view?.scrollTo(row, col);
  }

  // --- headers and sizes ------------------------------------------------

  hasRowHeaders(): boolean {
    return this.getSettings().rowHeaders !== false && this.getSettings().rowHeaders !== undefined;
  }

  hasColHeaders(): boolean {
    return this.getSettings().colHeaders !== false && this.getSettings().colHeaders !== undefined;
  }

  /** What a column header says. */
  getColHeader(col: number): string {
    const setting = this.getSettings().colHeaders;
    let label: string;
    if (Array.isArray(setting)) {
      label = setting[col] ?? columnLetters(col);
    } else if (typeof setting === 'function') {
      label = setting(col);
    } else {
      label = columnLetters(col);
    }
    return this.hooks.run('afterGetColHeader', label, col);
  }

  /** What a row header says. */
  getRowHeader(row: number): string {
    const setting = this.getSettings().rowHeaders;
    let label: string;
    if (Array.isArray(setting)) {
      label = setting[row] ?? String(row + 1);
    } else if (typeof setting === 'function') {
      label = setting(row);
    } else {
      label = String(row + 1);
    }
    return this.hooks.run('afterGetRowHeader', label, row);
  }

  getColWidth(col: number): number {
    return this.hooks.run('modifyColWidth', this.#colSizes.sizeOf(col), col);
  }

  getRowHeight(row: number): number {
    return this.hooks.run('modifyRowHeight', this.#rowSizes.sizeOf(row), row);
  }

  /** Resizes a column. Passing `null` restores the default. */
  setColWidth(col: number, width: number | null): void {
    this.#colSizes.setSize(col, width);
    this.render();
  }

  setRowHeight(row: number, height: number | null): void {
    this.#rowSizes.setSize(row, height);
    this.render();
  }

  /** The size maps, for plugins that resize in bulk. */
  get columnSizes(): SizeMap {
    return this.#colSizes;
  }

  get rowSizes(): SizeMap {
    return this.#rowSizes;
  }

  // --- hooks ------------------------------------------------------------

  addHook(name: string, handler: HookHandler): void {
    this.hooks.add(name, handler);
  }

  addHookOnce(name: string, handler: HookHandler): void {
    this.hooks.addOnce(name, handler);
  }

  removeHook(name: string, handler?: HookHandler): void {
    this.hooks.remove(name, handler);
  }

  hasHook(name: string): boolean {
    return this.hooks.has(name);
  }

  runHooks<T>(name: string, value: T, ...rest: unknown[]): T {
    return this.hooks.run(name, value, ...rest);
  }

  // --- rendering --------------------------------------------------------

  /** The view, for plugins that need the DOM. */
  get view(): View | null {
    return this.#view;
  }

  /** The element the grid was mounted into. */
  get container(): HTMLElement {
    return this.#container;
  }

  /** Draws the grid. */
  render(): void {
    if (this.#destroyed) {
      return;
    }
    if (this.#renderSuspended > 0) {
      this.#renderQueued = true;
      return;
    }
    this.hooks.run('beforeRender', undefined);
    this.#view?.render();
    this.hooks.run('afterRender', undefined);
  }

  /** Holds off drawing until `resumeRender`, so a batch draws once. */
  suspendRender(): void {
    this.#renderSuspended += 1;
  }

  resumeRender(): void {
    this.#renderSuspended = Math.max(this.#renderSuspended - 1, 0);
    if (this.#renderSuspended === 0 && this.#renderQueued) {
      this.#renderQueued = false;
      this.render();
    }
  }

  isRenderSuspended(): boolean {
    return this.#renderSuspended > 0;
  }

  /** Runs a function with drawing held off. */
  batch<T>(action: () => T): T {
    this.suspendRender();
    try {
      return action();
    } finally {
      this.resumeRender();
    }
  }

  /** Releases the grid. */
  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.hooks.run('beforeDestroy', undefined);
    this.#view?.destroy();
    this.#view = null;
    this.#destroyed = true;
    this.hooks.run('afterDestroy', undefined);
    this.hooks.clear();
  }

  isDestroyed(): boolean {
    return this.#destroyed;
  }

  // --- internals ---------------------------------------------------------

  /** Registers handlers given as settings, as Handsontable allows. */
  #registerSettingHooks(settings: GridSettings): void {
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === 'function' && /^(after|before|modify)[A-Z]/.test(key)) {
        this.hooks.add(key, value as HookHandler);
      }
    }
  }

  /** Brings the index maps and size maps in line with the sheet. */
  #syncDimensions(): void {
    const settings = this.getSettings();
    const rows = Math.max(
      this.#data.rowCount,
      (settings.startRows as number) ?? 0,
      (settings.minRows as number) ?? 0,
    );
    const cols = Math.max(
      this.#data.colCount,
      (settings.startCols as number) ?? 0,
      (settings.minCols as number) ?? 0,
    );
    // Only ever grows here: shrinking would throw away a sort or a hidden
    // column, and the extent of a spreadsheet is what the user has reached,
    // not what currently holds data.
    if (this.rowIndex.length < rows) {
      this.#extend(this.rowIndex, rows);
    }
    if (this.colIndex.length < cols) {
      this.#extend(this.colIndex, cols);
    }
    this.#rowSizes.count = rows;
    this.#colSizes.count = cols;
    this.#applySizeSettings(settings);
  }

  #applySizeSettings(settings: GridSettings): void {
    const { colWidths, rowHeights } = settings;
    if (typeof colWidths === 'number') {
      this.#colSizes.defaultSize = colWidths;
    } else if (Array.isArray(colWidths)) {
      this.#colSizes.setSizes(colWidths.map((width, index) => [index, width]));
    } else if (typeof colWidths === 'function') {
      this.#colSizes.setSizes(
        Array.from({ length: this.#colSizes.count }, (_, index) => [index, colWidths(index)]),
      );
    }
    if (typeof rowHeights === 'number') {
      this.#rowSizes.defaultSize = rowHeights;
    } else if (Array.isArray(rowHeights)) {
      this.#rowSizes.setSizes(rowHeights.map((height, index) => [index, height]));
    } else if (typeof rowHeights === 'function') {
      this.#rowSizes.setSizes(
        Array.from({ length: this.#rowSizes.count }, (_, index) => [index, rowHeights(index)]),
      );
    }
  }

  /**
   * Grows the index maps so every coordinate in a change can be addressed.
   *
   * Only ever grows: a write past the end extends the grid, and a write inside
   * it leaves the extent alone.
   */
  #growTo(changes: Array<[number, number, string]>): void {
    let maxRow = -1;
    let maxCol = -1;
    for (const [row, col] of changes) {
      maxRow = Math.max(maxRow, row);
      maxCol = Math.max(maxCol, col);
    }
    const settings = this.getSettings();
    const rowLimit = (settings.maxRows as number) ?? Infinity;
    const colLimit = (settings.maxCols as number) ?? Infinity;

    if (maxRow >= this.rowIndex.visibleLength && maxRow < rowLimit) {
      this.#extend(this.rowIndex, maxRow + 1);
      this.#rowSizes.count = this.rowIndex.length;
    }
    if (maxCol >= this.colIndex.visibleLength && maxCol < colLimit) {
      this.#extend(this.colIndex, maxCol + 1);
      this.#colSizes.count = this.colIndex.length;
    }
  }

  /** Adds indexes to the end of a map without disturbing its order. */
  #extend(map: IndexMapper, length: number): void {
    const missing = length - map.length;
    if (missing > 0) {
      map.insertIndexes(map.length, missing);
    }
  }

  /** Turns visual coordinates into the physical ones the engine uses. */
  #physical(row: number, col: number): { row: number; col: number } | null {
    const physicalRow = this.rowIndex.toPhysical(row);
    const physicalCol = this.colIndex.toPhysical(col);
    if (physicalRow === null || physicalCol === null) {
      return null;
    }
    return { row: physicalRow, col: physicalCol };
  }

  /** Reads a physical window into the cache. */
  #ensure(startRow: number, endRow: number, startCol: number, endCol: number): void {
    this.#data.ensure({
      startRow: Math.max(startRow, 0),
      endRow: Math.max(endRow, 0),
      startCol: Math.max(startCol, 0),
      endCol: Math.max(endCol, 0),
    });
  }

  /**
   * Reads the physical window behind a visual one.
   *
   * With rows reordered, a visual window is not a physical rectangle, so the
   * bounding box of the physical rows is read instead. It is a superset, which
   * costs a little and is always correct.
   */
  #ensureVisible(startRow: number, endRow: number, startCol: number, endCol: number): void {
    if (endRow < startRow || endCol < startCol) {
      return;
    }
    let minRow = Infinity;
    let maxRow = -Infinity;
    for (let row = startRow; row <= endRow; row += 1) {
      const physical = this.rowIndex.toPhysical(row);
      if (physical !== null) {
        minRow = Math.min(minRow, physical);
        maxRow = Math.max(maxRow, physical);
      }
    }
    let minCol = Infinity;
    let maxCol = -Infinity;
    for (let col = startCol; col <= endCol; col += 1) {
      const physical = this.colIndex.toPhysical(col);
      if (physical !== null) {
        minCol = Math.min(minCol, physical);
        maxCol = Math.max(maxCol, physical);
      }
    }
    if (minRow === Infinity || minCol === Infinity) {
      return;
    }
    this.#ensure(minRow, maxRow, minCol, maxCol);
  }

  #afterSelection(): void {
    const state = this.#selection.state;
    if (state) {
      const last = this.#selection.last!;
      this.hooks.run(
        'afterSelection',
        undefined,
        last.topRow,
        last.startCol,
        last.bottomRow,
        last.endCol,
      );
      this.hooks.run('afterSelectionEnd', undefined, state);
    }
    this.render();
  }

  #mount(): void {
    if (typeof document === 'undefined') {
      return;
    }
    this.#view = new View(this.#container, {
      rowCount: () => this.countRows(),
      colCount: () => this.countCols(),
      rowSizes: () => this.#rowSizes,
      colSizes: () => this.#colSizes,
      fixedRowsTop: () => (this.getSettings().fixedRowsTop as number) ?? 0,
      fixedColumnsStart: () =>
        (this.getSettings().fixedColumnsStart as number) ??
        (this.getSettings().fixedColumnsLeft as number) ??
        0,
      rowHeader: (row) => (this.hasRowHeaders() ? this.getRowHeader(row) : null),
      colHeader: (col) => (this.hasColHeaders() ? this.getColHeader(col) : null),
      rowHeaderWidth: () => (this.hasRowHeaders() ? DEFAULT_ROW_HEADER_WIDTH : 0),
      colHeaderHeight: () => (this.hasColHeaders() ? DEFAULT_ROW_HEIGHT : 0),
      prepare: (startRow, endRow, startCol, endCol) =>
        this.#ensureVisible(startRow, endRow, startCol, endCol),
      renderCell: (context) => this.#renderCell(context),
      overscan: () => 3,
    });
    this.render();
  }

  /** Fills in one cell of the view. */
  #renderCell(context: CellRenderContext): void {
    const { row, col, td } = context;
    const meta = this.getCellMeta(row, col);
    const cell = this.getCell(row, col);

    td.textContent = cell?.text ?? '';
    td.className = 'cm-cell';
    if (meta.className) {
      td.className += ` ${meta.className}`;
    }
    if (meta.readOnly) {
      td.classList.add(String(meta.readOnlyCellClassName ?? 'htDimmed'));
    }
    if (cell?.error) {
      td.classList.add('cm-error');
      td.title = cell.error;
    }
    if (cell?.formula) {
      td.dataset.formula = cell.formula;
    }
    if (typeof cell?.value === 'number') {
      td.classList.add('cm-numeric');
    }
    if (this.#selection.includes({ row, col })) {
      td.classList.add('cm-selected');
    }
    const highlight = this.#selection.highlight;
    if (highlight && highlight.row === row && highlight.col === col) {
      td.classList.add('cm-current');
    }
    this.hooks.run('afterRenderer', undefined, td, row, col, cell, meta);
  }
}

/** The A1 reference of a cell, for plugins and tests. */
export { cellRef, columnLetters };

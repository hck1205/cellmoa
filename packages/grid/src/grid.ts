/**
 * The grid.
 *
 * The public surface follows Handsontable's, so that a configuration or an
 * integration written against it works here. What is underneath is different:
 * the data lives in a calculation engine rather than in a JavaScript array, so
 * a formula is a first-class thing rather than a plugin, and every edit is
 * recorded with who made it.
 */

import {
  getEditor,
  getRenderer,
  getValidator,
  renderers as builtinRenderers,
} from './cellTypes/index.js';
import type { EditorInstance, ValidationResult } from './cellTypes/index.js';
import { DataSource, WriteConflict, cellRef, columnLetters } from './dataSource.js';
import type { AlterAction } from './dataSource.js';
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
import { getPluginConstructor, registeredPlugins } from './plugins/base.js';
import type { BasePlugin } from './plugins/base.js';
// Importing the plugins for their side effect: each module registers itself,
// and a grid built without them would silently have no features.
import './plugins/index.js';
import { DEFAULT_LANGUAGE, phrase } from './i18n/index.js';
import type { LayoutManager, LayoutSettings } from './layout.js';
import { ShortcutManager } from './shortcuts.js';
import { SizeMap } from './sizes.js';
import { View } from './view.js';
import type { CellRenderContext, ColHeaderCell } from './view.js';

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
  readonly shortcuts = new ShortcutManager();

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
  #editor: EditorInstance | null = null;
  #editing: Coords | null = null;
  #invalid = new Set<string>();
  #listening = true;
  #plugins = new Map<string, BasePlugin>();
  /**
   * Columns and rows whose size a person chose.
   *
   * Automatic sizing must not overwrite a width someone dragged, and it cannot
   * tell one from a width it set itself by looking at the size map — so the
   * grid records which ones came from a deliberate choice.
   */
  #manualWidths = new Set<number>();
  #manualHeights = new Set<number>();

  constructor(container: HTMLElement, options: GridOptions) {
    this.#container = container;
    this.#engine = options.engine;
    this.#data = new DataSource(options.engine, options.sheet, options.actor);

    const { engine: _engine, sheet: _sheet, ...settings } = options;
    this.#meta.update(settings);

    this.#selection = new Selection(
      () => this.countRows(),
      () => this.countCols(),
      (this.getSettings().selectionMode as SelectionMode) ?? 'multiple',
    );

    this.#registerSettingHooks(settings);
    this.#selection.setNavigableHeaders(this.getSettings().navigableHeaders === true);
    this.#syncDimensions(true);
    this.#mount();
    this.#bindKeyboard();
    this.#bindPointer();
    this.#createPlugins();
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
    this.#selection.setNavigableHeaders(this.getSettings().navigableHeaders === true);
    this.#view?.layout.setOrder((this.getSettings().layout as LayoutSettings | undefined) ?? {});
    this.#syncDimensions();
    // Every plugin re-reads the settings, so a feature can be switched on
    // after the grid was built.
    for (const plugin of this.#plugins.values()) {
      plugin.updatePlugin();
    }
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

  /**
   * Inserts or deletes rows or columns.
   *
   * The name and the action strings are Handsontable's, so ported code works
   * unchanged. What happens underneath is not: the engine rewrites every
   * formula in the workbook in the same commit that moves the cells, so the
   * change undoes in one step and no formula is ever briefly wrong.
   *
   * The index maps are moved to match, because a sort or a hidden column is a
   * property of the visual space and has to survive rows being inserted under
   * it.
   */
  alter(action: AlterAction, index?: number, amount = 1, source: ChangeSource = 'alter'): void {
    const rows = action === 'insert_row' || action === 'remove_row';
    const map = rows ? this.rowIndex : this.colIndex;
    const at = index ?? (rows ? this.countRows() : this.countCols());
    const removing = action === 'remove_row' || action === 'remove_col';

    const hook = removing
      ? (rows ? 'beforeRemoveRow' : 'beforeRemoveCol')
      : (rows ? 'beforeCreateRow' : 'beforeCreateCol');
    if (this.hooks.allows(hook, at, amount, source) === false) {
      return;
    }

    const physical = map.toPhysical(at);
    this.#data.alter(action, physical ?? at, amount, source);

    if (removing) {
      const removed: number[] = [];
      for (let i = at; i < at + amount; i += 1) {
        const target = map.toPhysical(i);
        if (target !== null) {
          removed.push(target);
        }
      }
      map.removeIndexes(removed);
    } else {
      map.insertIndexes(physical ?? at, amount);
    }
    this.#meta.shift(rows ? 'row' : 'col', at, removing ? -amount : amount);
    this.#syncDimensions();
    this.hooks.run(
      removing ? (rows ? 'afterRemoveRow' : 'afterRemoveCol') : rows ? 'afterCreateRow' : 'afterCreateCol',
      undefined,
      at,
      amount,
      source,
    );
    this.render();
  }

  /** The selection as a menu command wants it: plain corners. */
  getMenuSelection(): Array<{ start: { row: number; col: number }; end: { row: number; col: number } }> {
    return this.selection.ranges.map((range) => ({
      start: { row: range.topRow, col: range.startCol },
      end: { row: range.bottomRow, col: range.endCol },
    }));
  }

  /**
   * Moves a formula's relative references by a distance.
   *
   * Copying a formula and moving it are different operations and only one of
   * them shifts references, so the callers decide *whether* to shift; what a
   * shift means is one question with one answer, and it is answered here.
   * Anything that is not a formula, and any formula that did not move, comes
   * back untouched.
   */
  translateFormula(formula: string, rows: number, cols: number): string {
    if (!formula.startsWith('=') || (rows === 0 && cols === 0)) {
      return formula;
    }
    const response = this.#engine.call({ op: 'translate', formula, rows, cols });
    return typeof response['formula'] === 'string' ? response['formula'] : formula;
  }

  /**
   * The manager for the areas around the grid.
   *
   * A caller registers an element and says which side it belongs on; where it
   * lands is the manager's business, which is what lets the `layout` setting
   * reorder things the caller never knew about.
   */
  getLayoutManager(): LayoutManager | null {
    return this.#view?.layout ?? null;
  }

  /**
   * A phrase in the grid's language.
   *
   * `count` chooses between "Remove row" and "Remove rows": one command, one
   * key, and the number decides — which is why a menu item's label is a
   * function of the selection rather than a fixed string.
   */
  getTranslatedPhrase(key: string, count?: number): string {
    return phrase(String(this.getSettings().language ?? DEFAULT_LANGUAGE), key, count);
  }

  /**
   * The locale used for formatting.
   *
   * Separate from the language on purpose: someone reading an English
   * interface may still want German number formatting.
   */
  getLocale(): string {
    return String(
      this.getSettings().locale ?? this.getSettings().language ?? DEFAULT_LANGUAGE,
    );
  }

  /** Whether the grid is laid out right-to-left. */
  isRtl(): boolean {
    return this.getSettings().layoutDirection === 'rtl';
  }

  /** Whether there is anything to undo. */
  canUndo(): boolean {
    return this.#undoState().canUndo === true;
  }

  /** Whether there is anything to redo. */
  canRedo(): boolean {
    return this.#undoState().canRedo === true;
  }

  /**
   * Whether one kind of actor has anything left to take back.
   *
   * `kind` is matched against the actor's kind — `agent`, `human`, `script`,
   * `system` — rather than an identifier, because a menu offering "undo the
   * agent's changes" does not know which agent it was.
   */
  canUndoBy(kind: string): boolean {
    return this.#lastChangeBy(kind) !== null;
  }

  /** Takes back the most recent change made by an agent, leaving yours alone. */
  undoLastAgentChange(): void {
    const actor = this.#lastChangeBy('agent');
    if (actor !== null) {
      this.undoBy(actor);
    }
  }

  /** Sets the alignment class on a rectangle of cells. */
  setAlignment(
    range: { start: { row: number; col: number }; end: { row: number; col: number } },
    className: string,
  ): void {
    // Horizontal and vertical are separate axes, so setting one must not clear
    // the other: `htLeft htMiddle` is a perfectly ordinary pair.
    const axis = className.startsWith('htTop') ||
      className.startsWith('htMiddle') ||
      className.startsWith('htBottom')
      ? ['htTop', 'htMiddle', 'htBottom']
      : ['htLeft', 'htCenter', 'htRight', 'htJustify'];

    for (let row = Math.min(range.start.row, range.end.row); row <= Math.max(range.start.row, range.end.row); row += 1) {
      for (let col = Math.min(range.start.col, range.end.col); col <= Math.max(range.start.col, range.end.col); col += 1) {
        const existing = String(this.getCellMeta(row, col)['className'] ?? '')
          .split(/\s+/)
          .filter((name) => name !== '' && !axis.includes(name));
        this.setCellMeta(row, col, 'className', [...existing, className].join(' '));
      }
    }
    this.render();
  }

  #undoState(): Record<string, unknown> {
    return this.#engine.call({ op: 'undo_state' });
  }

  /** The id of the actor whose last undoable change was of the given kind. */
  #lastChangeBy(kind: string): string | null {
    const next = this.#undoState()['nextUndo'] as
      | { actor?: { kind?: string; id?: string } }
      | null
      | undefined;
    return next?.actor?.kind === kind ? (next.actor.id ?? null) : null;
  }

  /** Undoes the last change. */
  undo(): void {
    if (this.hooks.allows('beforeUndo') === false) {
      return;
    }
    this.#data.undo();
    this.#syncDimensions();
    this.hooks.run('afterUndo', undefined);
    this.render();
  }

  /** Re-applies the last undone change. */
  redo(): void {
    if (this.hooks.allows('beforeRedo') === false) {
      return;
    }
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
    if (this.hooks.allows('beforeUndo', actor) === false) {
      return;
    }
    this.#data.undo(actor);
    this.#syncDimensions();
    this.hooks.run('afterUndo', undefined, actor);
    this.render();
  }

  /** Puts back what `undoBy` took away, for the same actor. */
  redoBy(actor: string): void {
    if (this.hooks.allows('beforeRedo', actor) === false) {
      return;
    }
    this.#data.redo(actor);
    this.#syncDimensions();
    this.hooks.run('afterRedo', undefined, actor);
    this.render();
  }

  /**
   * How deep the column header is.
   *
   * One row unless a plugin says otherwise, which is what `nestedHeaders`
   * changes. The height of the header area follows from this, so it has to be
   * asked before anything is laid out.
   */
  countColHeaderLevels(): number {
    return Math.max((this.hooks.run('modifyColHeaderLevels', 1) as number) ?? 1, 1);
  }

  /**
   * The column header, as rows of cells.
   *
   * The plain case is one row of one-column cells. A plugin that wants a nested
   * header replaces the whole structure through the hook, because the levels
   * above the bottom one are not per-column at all — they are spans.
   */
  getColHeaderRows(firstCol: number, lastCol: number): ColHeaderCell[][] {
    if (!this.hasColHeaders()) {
      return [];
    }
    const plain: ColHeaderCell[] = [];
    for (let col = firstCol; col <= lastCol; col += 1) {
      plain.push({ col, colspan: 1, level: 0, label: this.getColHeader(col) });
    }
    const levels = this.hooks.run('modifyColHeaderRows', [plain], firstCol, lastCol);
    return (levels as ColHeaderCell[][]) ?? [plain];
  }

  /**
   * Whether a row is hidden — present in the data but not drawn.
   *
   * Hidden is not the same as trimmed: a hidden row still counts, still holds
   * its values and is still what a formula referring to it reads. Anything
   * walking the table by visual index has to be able to tell the two apart.
   */
  isRowHidden(row: number): boolean {
    const physical = this.rowIndex.toPhysical(row);
    return physical !== null && this.rowIndex.isHidden(physical);
  }

  /** The same for a column. */
  isColumnHidden(col: number): boolean {
    const physical = this.colIndex.toPhysical(col);
    return physical !== null && this.colIndex.isHidden(physical);
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
    // `modifyColHeader` changes the text; `afterGetColHeader` gets the element
    // once it exists. Running one hook for both would mean a handler could not
    // tell which it had been handed.
    return this.hooks.run('modifyColHeader', label, col);
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
    return this.hooks.run('modifyRowHeader', label, row);
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
    if (width === null) {
      this.#manualWidths.delete(col);
    } else {
      this.#manualWidths.add(col);
    }
    this.render();
  }

  setRowHeight(row: number, height: number | null): void {
    this.#rowSizes.setSize(row, height);
    if (height === null) {
      this.#manualHeights.delete(row);
    } else {
      this.#manualHeights.add(row);
    }
    this.render();
  }

  /** Whether a column's width was chosen rather than measured. */
  isColumnWidthManual(col: number): boolean {
    return this.#manualWidths.has(col);
  }

  /** Whether a row's height was chosen rather than measured. */
  isRowHeightManual(row: number): boolean {
    return this.#manualHeights.has(row);
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

  /**
   * A plugin by name, or `undefined` when nothing is registered under it.
   *
   * The instance exists whether or not the plugin is switched on, so a caller
   * can turn one on through its own methods.
   */
  getPlugin<T extends BasePlugin = BasePlugin>(name: string): T | undefined {
    return this.#plugins.get(name) as T | undefined;
  }

  /** Every plugin this grid holds. */
  getPlugins(): BasePlugin[] {
    return [...this.#plugins.values()];
  }

  /** Whether a plugin is registered and running. */
  isPluginEnabled(name: string): boolean {
    return this.#plugins.get(name)?.isPluginEnabled() ?? false;
  }

  /** Releases the grid. */
  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.hooks.run('beforeDestroy', undefined);
    for (const plugin of this.#plugins.values()) {
      plugin.destroy();
    }
    this.#plugins.clear();
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
  /**
   * Brings the index maps and size maps in step with the data.
   *
   * `startRows` counts only on the first pass. It says how big the table is
   * when it opens, not how small it may ever get — that is `minRows`, and
   * treating the two as the same thing would make deleting the last row of a
   * new table do nothing.
   */
  #syncDimensions(initial = false): void {
    const settings = this.getSettings();
    // Spare rows are empty rows kept below the data so there is always
    // somewhere to type. They are counted from the data, not from the current
    // extent, or every render would add another one.
    const spareRows = (settings.minSpareRows as number) ?? 0;
    const spareCols = (settings.minSpareCols as number) ?? 0;
    const rows = Math.min(
      Math.max(
        this.#data.rowCount + spareRows,
        initial ? ((settings.startRows as number) ?? 0) : 0,
        (settings.minRows as number) ?? 0,
      ),
      (settings.maxRows as number) ?? Number.MAX_SAFE_INTEGER,
    );
    const cols = Math.min(
      Math.max(
        this.#data.colCount + spareCols,
        initial ? ((settings.startCols as number) ?? 0) : 0,
        (settings.minCols as number) ?? 0,
      ),
      (settings.maxCols as number) ?? Number.MAX_SAFE_INTEGER,
    );
    // Only ever grows here: shrinking would throw away a sort or a hidden
    // column, and the extent of a spreadsheet is what the user has reached,
    // not what currently holds data. A structural edit shrinks the maps
    // itself, so it does not go through this path.
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


  // --- editing ------------------------------------------------------------

  /** The cell being edited, or `null`. */
  getActiveEditorCoords(): Coords | null {
    return this.#editing ? { ...this.#editing } : null;
  }

  /** Whether an editor is open. */
  isEditing(): boolean {
    return this.#editor !== null;
  }

  /**
   * Opens the editor over a cell.
   *
   * `initial` is what a printable keystroke should put into it, which is how
   * typing over a selected cell replaces its contents rather than appending.
   */
  beginEditing(row?: number, col?: number, initial?: string): void {
    const target = row === undefined || col === undefined ? this.#selection.highlight : { row, col };
    if (!target || this.#destroyed) {
      return;
    }
    const meta = this.getCellMeta(target.row, target.col);
    if (meta.readOnly || meta.editor === false) {
      return;
    }
    if (!this.hooks.allows('beforeBeginEditing', target.row, target.col)) {
      return;
    }
    this.closeEditor(false);

    const editorName = typeof meta.editor === 'string' ? meta.editor : (meta.type as string) ?? 'text';
    const editor = getEditor(editorName) ?? getEditor('text');
    if (!editor || !this.#view) {
      return;
    }
    const element = this.#view.elementAt(target.row, target.col);
    if (!element) {
      // The cell is not on screen; bring it into view and try again.
      this.scrollViewportTo(target.row, target.col);
      if (!this.#view.elementAt(target.row, target.col)) {
        return;
      }
    }
    const rect = this.#editorRect(target.row, target.col);
    const value = initial ?? this.getSourceDataAtCell(target.row, target.col);

    this.#editing = target;
    this.#editor = editor({
      row: target.row,
      col: target.col,
      rect,
      value,
      meta,
      parent: this.#view.root,
      commit: (committed, moveBy) => this.#commitEditor(committed, moveBy),
      cancel: () => this.closeEditor(false),
    });
    this.shortcuts.setActiveContextName('editor');
    this.#editor.focus();
    this.hooks.run('afterBeginEditing', undefined, target.row, target.col);
  }

  /** Closes the editor, writing its value when asked to. */
  closeEditor(commit = true, moveBy?: Coords): void {
    const editor = this.#editor;
    const editing = this.#editing;
    this.#editor = null;
    this.#editing = null;
    if (!editor || !editing) {
      return;
    }
    const value = editor.getValue();
    editor.close();
    this.shortcuts.setActiveContextName('grid');

    if (commit) {
      this.#writeValidated(editing.row, editing.col, value);
    }
    if (moveBy) {
      this.#selection.moveBy(moveBy.row, moveBy.col, this.#wraps(moveBy));
      this.#afterSelection();
    } else {
      this.render();
    }
  }

  /** Whether a cell failed validation and has not been corrected. */
  isCellInvalid(row: number, col: number): boolean {
    return this.#invalid.has(`${row}:${col}`);
  }

  /** Runs a cell's validator without writing anything. */
  async validateCell(row: number, col: number, value: string): Promise<ValidationResult> {
    const meta = this.getCellMeta(row, col);
    const validator = this.#validatorFor(meta);
    if (!validator) {
      return { valid: true };
    }
    return validator(value, meta);
  }

  /** Whether the grid is taking keystrokes. */
  isListening(): boolean {
    return this.#listening;
  }

  listen(): void {
    this.#listening = true;
  }

  unlisten(): void {
    this.#listening = false;
  }

  // --- editing internals ---------------------------------------------------

  #validatorFor(meta: GridSettings) {
    if (typeof meta.validator === 'function') {
      return meta.validator as (value: string, meta: GridSettings) => ValidationResult;
    }
    if (typeof meta.validator === 'string') {
      return getValidator(meta.validator);
    }
    return getValidator((meta.type as string) ?? 'text');
  }

  /**
   * Writes a value after validating it.
   *
   * A value that fails is written anyway when `allowInvalid` is on — which is
   * the default, and is what lets someone type a half-finished value and fix it
   * — but the cell is marked so the mistake is visible.
   */
  #writeValidated(row: number, col: number, value: string): void {
    const key = `${row}:${col}`;
    const meta = this.getCellMeta(row, col);
    const validator = this.#validatorFor(meta);
    const finish = (result: ValidationResult): void => {
      if (result.valid) {
        this.#invalid.delete(key);
      } else {
        this.#invalid.add(key);
      }
      this.hooks.run('afterValidate', result.valid, value, row, col);
      if (result.valid || meta.allowInvalid !== false) {
        this.setDataAtCell(row, col, value);
      } else {
        this.render();
      }
    };

    if (!validator) {
      this.#invalid.delete(key);
      this.setDataAtCell(row, col, value);
      return;
    }
    const result = validator(value, meta);
    if (result instanceof Promise) {
      // An asynchronous validator is allowed; the write lands when it answers.
      void result.then(finish);
    } else {
      finish(result);
    }
  }

  #commitEditor(value: string, moveBy?: Coords): void {
    this.closeEditor(true, moveBy ?? { row: 1, col: 0 });
  }

  /** Where to put the editor, in the view's coordinates. */
  #editorRect(row: number, col: number): { left: number; top: number; width: number; height: number } {
    const headerWidth = this.hasRowHeaders() ? DEFAULT_ROW_HEADER_WIDTH : 0;
    const headerHeight = this.hasColHeaders() ? DEFAULT_ROW_HEIGHT : 0;
    const scrollTop = this.#view?.scrollTop ?? 0;
    const scrollLeft = this.#view?.scrollLeft ?? 0;
    return {
      left: this.#colSizes.offsetOf(col) + headerWidth - scrollLeft,
      top: this.#rowSizes.offsetOf(row) + headerHeight - scrollTop,
      width: this.getColWidth(col),
      height: this.getRowHeight(row),
    };
  }

  /** Whether a move should wrap at the edge, per the settings. */
  #wraps(moveBy: Coords): boolean {
    const settings = this.getSettings();
    return moveBy.col !== 0
      ? settings.autoWrapRow === true
      : settings.autoWrapCol === true;
  }

  // --- keyboard and pointer ------------------------------------------------

  #bindKeyboard(): void {
    const view = this.#view;
    if (!view) {
      return;
    }
    const grid = this.shortcuts.getContext('grid')!;
    const editor = this.shortcuts.getContext('editor')!;
    /**
     * Mirrors a horizontal step when the grid is laid out right to left.
     *
     * The arrow keys are about the screen, not about the data: in an RTL sheet
     * the leftward arrow moves toward the higher column number, because that is
     * where "left" is. Vertical movement is unaffected.
     */
    const mirror = (col: number): number => (this.isRtl() ? -col : col);

    const move = (row: number, col: number) => () => {
      col = mirror(col);
      const wrapped = this.#selection.moveBy(row, col, this.#wraps({ row, col }));
      if (wrapped) {
        this.#afterSelection();
        const highlight = this.#selection.highlight;
        if (highlight) {
          this.scrollViewportTo(highlight.row, highlight.col);
        }
      }
    };
    const extend = (rowDelta: number, colDelta: number) => () => {
      colDelta = mirror(colDelta);
      const last = this.#selection.last;
      const highlight = this.#selection.highlight;
      if (!last || !highlight) {
        return;
      }
      // Shift+arrow moves the far edge, which is whichever corner is not the
      // anchor.
      this.#selection.extendTo({ row: last.to.row + rowDelta, col: last.to.col + colDelta });
      this.#afterSelection();
    };
    const edge = (rowDelta: number, colDelta: number, extending: boolean) => () => {
      colDelta = mirror(colDelta);
      const highlight = this.#selection.highlight;
      if (!highlight) {
        return;
      }
      const target = {
        row: rowDelta === 0 ? highlight.row : rowDelta > 0 ? this.countRows() - 1 : 0,
        col: colDelta === 0 ? highlight.col : colDelta > 0 ? this.countCols() - 1 : 0,
      };
      if (extending) {
        this.#selection.extendTo(target);
      } else {
        this.#selection.setCell(target);
      }
      this.#afterSelection();
      this.scrollViewportTo(target.row, target.col);
    };

    grid.addShortcuts(
      [
        { keys: [['arrowup']], callback: move(-1, 0) },
        { keys: [['arrowdown']], callback: move(1, 0) },
        { keys: [['arrowleft']], callback: move(0, -1) },
        { keys: [['arrowright']], callback: move(0, 1) },
        { keys: [['shift', 'arrowup']], callback: extend(-1, 0) },
        { keys: [['shift', 'arrowdown']], callback: extend(1, 0) },
        { keys: [['shift', 'arrowleft']], callback: extend(0, -1) },
        { keys: [['shift', 'arrowright']], callback: extend(0, 1) },
        { keys: [['mod', 'arrowup']], callback: edge(-1, 0, false) },
        { keys: [['mod', 'arrowdown']], callback: edge(1, 0, false) },
        { keys: [['mod', 'arrowleft']], callback: edge(0, -1, false) },
        { keys: [['mod', 'arrowright']], callback: edge(0, 1, false) },
        { keys: [['mod', 'shift', 'arrowup']], callback: edge(-1, 0, true) },
        { keys: [['mod', 'shift', 'arrowdown']], callback: edge(1, 0, true) },
        { keys: [['mod', 'shift', 'arrowleft']], callback: edge(0, -1, true) },
        { keys: [['mod', 'shift', 'arrowright']], callback: edge(0, 1, true) },
        { keys: [['home']], callback: edge(0, -1, false) },
        { keys: [['end']], callback: edge(0, 1, false) },
        { keys: [['mod', 'home']], callback: () => this.selectCell(0, 0) },
        {
          keys: [['mod', 'end']],
          callback: () => this.selectCell(this.countRows() - 1, this.countCols() - 1),
        },
        { keys: [['pageup']], callback: move(-this.#pageSize(), 0) },
        { keys: [['pagedown']], callback: move(this.#pageSize(), 0) },
        { keys: [['mod', 'a']], callback: () => this.selectAll() },
        {
          keys: [['shift', 'space']],
          callback: () => {
            const highlight = this.#selection.highlight;
            if (highlight) {
              this.selectRows(highlight.row);
            }
          },
        },
        {
          keys: [['mod', 'space']],
          callback: () => {
            const highlight = this.#selection.highlight;
            if (highlight) {
              this.selectColumns(highlight.col);
            }
          },
        },
        { keys: [['enter']], callback: () => this.#onEnter(false) },
        { keys: [['shift', 'enter']], callback: () => this.#onEnter(true) },
        { keys: [['f2']], callback: () => this.beginEditing() },
        { keys: [['tab']], callback: () => this.#onTab(false) },
        { keys: [['shift', 'tab']], callback: () => this.#onTab(true) },
        { keys: [['delete']], callback: () => this.emptySelectedCells() },
        { keys: [['backspace']], callback: () => this.emptySelectedCells() },
        { keys: [['escape']], callback: () => this.deselectCell() },
        { keys: [['mod', 'z']], callback: () => this.undo() },
        { keys: [['mod', 'y']], callback: () => this.redo() },
        { keys: [['mod', 'shift', 'z']], callback: () => this.redo() },
      ],
      { group: 'core' },
    );

    // The editor context lets the open editor answer first, and only handles
    // what it declines.
    editor.addShortcut({
      keys: [
        ['enter'], ['shift', 'enter'], ['tab'], ['shift', 'tab'], ['escape'],
        ['alt', 'enter'],
      ],
      group: 'core',
      callback: (event) => this.#editor?.handleKey?.(event) ?? false,
    });

    view.root.tabIndex = 0;
    view.root.addEventListener('keydown', this.#onKeyDown);
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (!this.#listening || this.#destroyed) {
      return;
    }
    if (this.hooks.allows('beforeKeyDown', event) === false) {
      return;
    }
    // An open editor gets first refusal on every key, not only the bound ones,
    // so that typing into it is not intercepted by a grid shortcut.
    if (this.#editor && this.#editor.handleKey?.(event)) {
      event.preventDefault();
      return;
    }
    if (this.shortcuts.handle(event)) {
      return;
    }
    // A printable character with no modifier starts an edit and becomes its
    // first keystroke, as it does in every spreadsheet.
    //
    // `Process` and `Unidentified` are what a browser reports while an input
    // method is composing — typing Japanese or Korean sends those long before
    // any character exists. Treating them as printable would open the editor
    // with a keystroke that means nothing; ignoring them entirely would mean
    // the composition never reaches a cell. `imeFastEdit` opens the editor
    // without seeding it, so the composition lands in a real input.
    const composing = event.isComposing || event.key === 'Process';
    if (composing) {
      if (!this.#editor && this.getSettings().imeFastEdit === true) {
        const highlight = this.#selection.highlight;
        if (highlight) {
          this.beginEditing(highlight.row, highlight.col, '');
        }
      }
      return;
    }
    if (
      !this.#editor &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const highlight = this.#selection.highlight;
      if (highlight) {
        const meta = this.getCellMeta(highlight.row, highlight.col);
        if (meta.type === 'checkbox') {
          if (event.key === ' ') {
            this.#toggleCheckbox(highlight.row, highlight.col);
            event.preventDefault();
          }
          return;
        }
        this.beginEditing(highlight.row, highlight.col, event.key);
        event.preventDefault();
      }
    }
  };

  #onEnter(shift: boolean): void {
    const highlight = this.#selection.highlight;
    if (!highlight) {
      return;
    }
    const meta = this.getCellMeta(highlight.row, highlight.col);
    if (meta.type === 'checkbox') {
      this.#toggleCheckbox(highlight.row, highlight.col);
      return;
    }
    if (this.getSettings().enterBeginsEditing === false) {
      this.#selection.moveBy(shift ? -1 : 1, 0);
      this.#afterSelection();
      return;
    }
    this.beginEditing(highlight.row, highlight.col);
  }

  /**
   * Whether Tab moves the selection or leaves the grid.
   *
   * `tabNavigation: false` hands Tab back to the page, which is what a keyboard
   * user needs to get past a grid embedded in a form. It is a real trade — with
   * it on, Tab is the fastest way across a row and there is no way out but
   * Escape — so it is a setting, and the default is Handsontable's.
   */
  #onTab(shift: boolean): boolean {
    if (this.getSettings().tabNavigation === false) {
      // Not handled, so the browser moves focus as it would on any element.
      return false;
    }
    const moves = this.getSettings().tabMoves;
    const step = typeof moves === 'function' ? { row: 0, col: 1 } : (moves as Coords) ?? { row: 0, col: 1 };
    const direction = shift ? -1 : 1;
    this.#selection.moveBy(
      step.row * direction,
      step.col * direction,
      this.getSettings().autoWrapRow === true,
    );
    this.#afterSelection();
    return true;
  }

  /**
   * Flips a checkbox cell between its two templates.
   *
   * The comparison is against the cell's *value*, not its displayed text: the
   * engine stores `true` and shows `TRUE`, and comparing the two would leave
   * the box stuck.
   */
  #toggleCheckbox(row: number, col: number): void {
    const meta = this.getCellMeta(row, col);
    const checked = meta.checkedTemplate ?? true;
    const unchecked = meta.uncheckedTemplate ?? false;
    const value = this.getCell(row, col)?.value ?? null;
    const isChecked =
      value === checked ||
      String(value ?? '').toLowerCase() === String(checked).toLowerCase();
    this.setDataAtCell(row, col, String(isChecked ? unchecked : checked));
  }

  /** How many rows a page key moves. */
  #pageSize(): number {
    const height = this.#view?.root.clientHeight ?? 0;
    const rows = Math.floor(height / Math.max(this.#rowSizes.defaultSize, 1));
    return Math.max(rows - 1, 1);
  }

  #bindPointer(): void {
    const view = this.#view;
    if (!view) {
      return;
    }
    view.root.addEventListener('mousedown', (event) => {
      if (!this.#listening) {
        return;
      }
      const coords = view.cellAt(event.target);
      if (!coords) {
        return;
      }
      if (this.#editor) {
        this.closeEditor(true);
      }
      if (this.hooks.allows('beforeOnCellMouseDown', event, coords) === false) {
        return;
      }
      const mouseEvent = event as MouseEvent;
      if (mouseEvent.shiftKey) {
        this.#selection.extendTo(coords);
      } else if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
        this.#selection.addRange(coords);
      } else {
        this.#selection.setCell(coords);
      }
      this.#afterSelection();
      view.root.focus();
      this.hooks.run('afterOnCellMouseDown', undefined, event, coords);
    });

    view.root.addEventListener('dblclick', (event) => {
      const coords = view.cellAt(event.target);
      if (coords && this.#listening) {
        this.beginEditing(coords.row, coords.col);
      }
    });
  }

  /**
   * Builds one of every registered plugin.
   *
   * All of them, not only the ones the settings ask for: a plugin that does not
   * exist cannot be switched on later, and `updateSettings` has to be able to.
   */
  #createPlugins(): void {
    for (const constructor of registeredPlugins()) {
      const plugin = new constructor(this);
      this.#plugins.set(constructor.pluginName, plugin);
      plugin.enablePlugin();
    }
    void getPluginConstructor;
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
      colHeaderRows: (firstCol, lastCol) => this.getColHeaderRows(firstCol, lastCol),
      rowHeaderWidth: () => (this.hasRowHeaders() ? DEFAULT_ROW_HEADER_WIDTH : 0),
      colHeaderHeight: () =>
        this.hasColHeaders() ? DEFAULT_ROW_HEIGHT * this.countColHeaderLevels() : 0,
      renderColHeader: (th, cell) => {
        this.hooks.run('afterGetColHeader', undefined, cell.col, th, cell.level);
      },
      renderRowHeader: (th, row) => {
        this.hooks.run('afterGetRowHeader', undefined, row, th);
      },
      ariaTags: () => this.getSettings().ariaTags !== false,
      direction: () => (this.isRtl() ? 'rtl' : 'ltr'),
      themeName: () =>
        (this.getSettings().themeName as string | undefined) ??
        (this.getSettings().theme as string | undefined) ??
        null,
      prepare: (startRow, endRow, startCol, endCol) =>
        this.#ensureVisible(startRow, endRow, startCol, endCol),
      renderCell: (context) => this.#renderCell(context),
      overscan: () => 3,
    });
    this.#view.layout.setOrder((this.getSettings().layout as LayoutSettings | undefined) ?? {});
    this.render();
  }

  /** Fills in one cell of the view. */
  #renderCell(context: CellRenderContext): void {
    const { row, col, td } = context;
    const meta = this.getCellMeta(row, col);
    const cell = this.getCell(row, col);

    // The cell's type decides how it is drawn; a `renderer` setting overrides
    // the type, which is how one column can look different without becoming a
    // type of its own.
    const rendererName =
      typeof meta.renderer === 'string' ? meta.renderer : ((meta.type as string) ?? 'text');
    const renderer =
      (typeof meta.renderer === 'function'
        ? (meta.renderer as typeof builtinRenderers.textRenderer)
        : getRenderer(rendererName)) ?? builtinRenderers.textRenderer;
    renderer({ row, col, td, cell, meta });

    if (cell?.formula) {
      td.dataset.formula = cell.formula;
    }
    // A numeric *value* aligns right whatever the column's type says, because
    // that is what makes a computed column line up with a typed one.
    if (typeof cell?.value === 'number') {
      td.classList.add('cm-numeric');
    }
    if (this.#invalid.has(`${row}:${col}`)) {
      td.classList.add(String(meta.invalidCellClassName ?? 'htInvalid'));
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

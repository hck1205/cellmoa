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
import { CellSet } from './cellMap.js';
import { DENSITY_SCALE, getTheme, registerTheme } from './themes/index.js';
import type { RegisteredTheme } from './themes/index.js';
import { DEFAULT_LANGUAGE, phrase } from './i18n/index.js';
import type { LayoutManager, LayoutSettings } from './layout.js';
import { ShortcutManager } from './shortcuts.js';
import { SizeMap } from './sizes.js';
import { View } from './view.js';
import type { CellRenderContext, ColHeaderCell } from './view.js';

/**
 * How far beyond the viewport the grid draws when nothing says otherwise.
 *
 * Three rows and columns is enough that a scroll does not show a blank seam
 * before the next frame, and few enough that it is not worth measuring.
 */
const DEFAULT_OVERSCAN = 3;

/** Identifies the injected stylesheet, so several grids share one. */
/**
 * Brings a spliced line back to the length it had.
 *
 * A splice that removes more than it inserts leaves the tail of the row still
 * holding its old values — the shortened array simply never reaches them. The
 * cells that fell off the end have to be written as empty, or the splice
 * silently duplicates whatever used to be there.
 */
function pad(line: string[], length: number): string[] {
  while (line.length < length) {
    line.push('');
  }
  return line.slice(0, length);
}

/**
 * Turns whatever `data` was given into rows of cell values.
 *
 * Handsontable accepts an array of arrays or an array of objects, and the
 * second is the common one because it is the shape an API answers with. An
 * object has no column order of its own, so the order comes from the columns
 * when they are configured and from the first object's keys when they are not —
 * which is the same rule the reference uses, and the only one that does not
 * silently reorder somebody's table.
 */
export function normalizeData(
  data: unknown,
  propOf: (col: number) => string | number,
): string[][] {
  if (!Array.isArray(data)) {
    return [];
  }
  const asText = (value: unknown): string =>
    value === null || value === undefined ? '' : String(value);

  if (data.every((row) => Array.isArray(row))) {
    return (data as unknown[][]).map((row) => row.map(asText));
  }

  const objects = data.filter(
    (row): row is Record<string, unknown> => typeof row === 'object' && row !== null,
  );
  if (objects.length === 0) {
    return [];
  }
  // The configured columns decide the order when they name themselves; a table
  // with no such columns falls back to the keys of the first object.
  const keys: Array<string | number> = [];
  for (let col = 0; ; col += 1) {
    const prop = propOf(col);
    if (typeof prop !== 'string' || !(prop in objects[0]!)) {
      break;
    }
    keys.push(prop);
  }
  if (keys.length === 0) {
    keys.push(...Object.keys(objects[0]!));
  }
  return objects.map((row) => keys.map((key) => asText(row[String(key)])));
}

const CORE_CSS_ID = 'cm-core-css';

/**
 * The rules the grid cannot lay itself out without.
 *
 * Deliberately tiny: this is a fallback for a page that did not load
 * `style.css`, not a second copy of it.
 */
const CORE_CSS = `
.cm-grid { position: relative; overflow: hidden; }
.cm-grid .cm-scroller { position: absolute; inset: 0; overflow: auto; }
.cm-grid .cm-pane { position: absolute; overflow: hidden; }
.cm-grid table { border-collapse: separate; border-spacing: 0; table-layout: fixed; }
.cm-grid td, .cm-grid th { box-sizing: border-box; overflow: hidden; }
.cm-wrapper { display: flex; flex-direction: column; position: relative; height: 100%; }
.cm-wrapper > .cm-grid { flex: 1 1 auto; min-height: 0; }
`;

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
  #invalid = new CellSet();
  #listening = true;
  /** Listeners on things the grid does not own, so `destroy` can take them off. */
  #listeners: Array<() => void> = [];
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

    const { engine: _engine, sheet: _sheet, ...given } = options;
    // `initialState` is a base the settings are laid over, and it applies only
    // at construction — `updateSettings` ignores it, because a state that is
    // "initial" cannot be set again later without the word meaning nothing.
    const settings: GridSettings = { ...(given.initialState ?? {}), ...given };
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
    this.#injectCoreCss();
    this.#createPlugins();
    this.#watchVisibility();
    this.#checkLicense();
    this.#checkFormulasSetting();
    this.#checkDataBinding();
    this.#loadInitialData();
    this.hooks.run('afterInit', undefined);
  }

  /**
   * Puts the rules the grid cannot work without into the page.
   *
   * Only the structural ones — the panes are absolutely positioned and the
   * scroller has to scroll, and a grid whose stylesheet failed to load would
   * otherwise be a pile of text. Everything about how it *looks* stays in
   * `style.css`, which a caller can replace outright.
   */
  #injectCoreCss(): void {
    const doc = this.#view?.root.ownerDocument;
    if (!doc || this.getSettings().injectCoreCss === false) {
      return;
    }
    if (doc.getElementById(CORE_CSS_ID)) {
      return;
    }
    const style = doc.createElement('style');
    style.id = CORE_CSS_ID;
    style.textContent = CORE_CSS;
    doc.head.appendChild(style);
  }

  /**
   * Redraws when the grid is made visible again.
   *
   * A grid laid out while its container is `display: none` measures everything
   * as zero and draws nothing. Nothing tells it when that changes, so it has to
   * watch — and a grid on a tab nobody has opened yet is the ordinary case, not
   * an unusual one.
   */
  #watchVisibility(): void {
    const root = this.#view?.root;
    if (!root || this.getSettings().observeDOMVisibility === false) {
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        this.render();
      }
    });
    observer.observe(root);
    this.#listeners.push(() => observer.disconnect());
  }

  /**
   * Reports a licence key that names a product this is not.
   *
   * cellmoa needs no key. A configuration carried over from Handsontable will
   * have one, and silently ignoring it would leave the reader believing it is
   * doing something — so it is said once, and nothing is withheld either way.
   */
  /**
   * Reports a `formulas` configuration that has nothing to configure.
   *
   * In Handsontable this switches HyperFormula on. Here the engine is not a
   * plugin — every grid has one and formulas always work — so the setting is
   * accepted and says so, rather than being read as "formulas are off".
   */
  /**
   * Reports the data-binding settings, which do not apply here.
   *
   * Handsontable binds to an array of arrays or an array of objects, and these
   * describe that array's shape. This grid binds to a workbook: a cell has an
   * address, not a key path. Accepting them silently would leave a caller
   * believing their nested objects were being read.
   */
  #checkDataBinding(): void {
    const settings = this.getSettings();
    if (settings.dataSchema !== undefined || settings.dataDotNotation !== undefined) {
      console.info(
        '`dataSchema` and `dataDotNotation` describe an array-of-objects data source. ' +
          'cellmoa reads a workbook, where a cell is addressed rather than keyed, so they ' +
          'have no effect. Use `valueGetter` / `valueSetter` to map between the two.',
      );
    }
  }

  /**
   * Puts the `data` setting into the workbook.
   *
   * This is how nearly every Handsontable table starts, so a grid that declared
   * the setting and ignored it would be broken for the ordinary case. It runs
   * once, at construction: `data` is a starting point, and a caller changing it
   * later goes through `loadData` or `updateData`, which say which of the two
   * they mean.
   */
  #loadInitialData(): void {
    const rows = normalizeData(this.getSettings().data, (col) => this.colToProp(col));
    if (rows.length > 0) {
      this.loadData(rows);
    }
  }

  #checkFormulasSetting(): void {
    const setting = this.getSettings().formulas;
    if (setting === false) {
      console.info(
        'cellmoa calculates formulas natively; `formulas: false` does not switch that off. ' +
          'A cell whose value should not be a formula is `readOnly` or a `text` type.',
      );
    }
  }

  #checkLicense(): void {
    const key = this.getSettings().licenseKey;
    if (typeof key === 'string' && key !== '') {
      console.info(
        'cellmoa needs no licence key; `licenseKey` is accepted and ignored so that a ' +
          'Handsontable configuration works unchanged.',
      );
    }
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
if ('data' in settings) {
      // The reference treats `data` in an update as a reload, and the guide is
      // explicit that other keys alone must not wipe the rows.
      this.#meta.update(settings);
      this.loadData(normalizeData(settings.data, (col) => this.colToProp(col)));
    } else {
      this.#meta.update(settings);
    }
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

  /**
   * The value a renderer should show, after the settings have had their say.
   *
   * `valueGetter` replaces the value; `valueFormatter` decides how it reads.
   * They are separate because they answer different questions — what is this,
   * and how should it look — and a caller usually wants only one of them.
   */
  #displayValue(row: number, col: number, raw: string): string {
    const meta = this.getCellMeta(row, col);
    const getter = meta.valueGetter;
    const value = typeof getter === 'function' ? getter(raw, row, col) : raw;
    const formatter = meta.valueFormatter;
    const shown = typeof formatter === 'function' ? formatter(value, row, col) : value;
    return shown === null || shown === undefined ? '' : String(shown);
  }

  /** The displayed text of a cell. */
  getDataAtCell(row: number, col: number): string {
    const physical = this.#physical(row, col);
    if (!physical) {
      return '';
    }
    this.#ensure(physical.row, physical.row, physical.col, physical.col);
    return this.#displayValue(row, col, this.#data.text(physical.row, physical.col));
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
    this.#warnAboutSourceData(changes);

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

    // The same guards the menu reads. A command hidden from the menu that an
    // API call could still perform would make the setting a suggestion.
    const settings = this.getSettings();
    const allowed = removing
      ? (rows ? settings.allowRemoveRow : settings.allowRemoveColumn)
      : (rows ? settings.allowInsertRow : settings.allowInsertColumn);
    if (allowed === false) {
      return;
    }
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
   * The theme in force.
   *
   * `theme` may be given as a registered theme object or as a name; `themeName`
   * is the name-only spelling. A name that no theme was registered under is
   * `null` rather than an error — a page that ships its own stylesheet under
   * that name is doing something reasonable, and the class still goes on.
   */
  getTheme(): RegisteredTheme | null {
    const setting = this.getSettings().theme ?? this.getSettings().themeName;
    if (setting && typeof setting === 'object' && 'classNames' in setting) {
      return setting as RegisteredTheme;
    }
    if (typeof setting === 'string') {
      return getTheme(setting) ?? registerTheme({ name: setting, light: {}, dark: {} });
    }
    return null;
  }

  /**
   * How much taller or shorter the theme's density makes a row.
   *
   * A multiplier over whatever the settings asked for, so a caller who set a
   * height keeps their proportions rather than losing them to the density.
   */
  densityScale(): number {
    return DENSITY_SCALE[this.getTheme()?.density ?? 'default'];
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
   * How wide the row-header area is, in pixels.
   *
   * An array configures one width per header *column*. This grid draws a single
   * row-header column, so an array is read as the total width it should take —
   * which keeps a layout sized for several of them from collapsing.
   */
  getRowHeaderWidth(): number {
    const setting = this.getSettings().rowHeaderWidth;
    if (Array.isArray(setting)) {
      return setting.reduce((total, width) => total + (width ?? 0), 0) || DEFAULT_ROW_HEADER_WIDTH;
    }
    return typeof setting === 'number' ? setting : DEFAULT_ROW_HEADER_WIDTH;
  }

  /** How tall one level of the column header is. */
  getColHeaderHeight(level = 0): number {
    const setting = this.getSettings().columnHeaderHeight;
    const base = Array.isArray(setting)
      ? (setting[level] ?? DEFAULT_ROW_HEIGHT)
      : typeof setting === 'number'
        ? setting
        : DEFAULT_ROW_HEIGHT;
    return Math.round(base * this.densityScale());
  }

  /**
   * How much room the headers actually take.
   *
   * `getRowHeaderWidth` and `getColHeaderHeight` answer "how big is one",
   * which is the wrong question for anything measuring the table: a grid with
   * `colHeaders: false` draws no band at all, and a nested header draws
   * several. Everything that positions against the headers — the renderer, the
   * visible-row arithmetic, `getTableHeight` — asks these instead, so they
   * cannot drift apart from what was drawn.
   */
  #drawnHeaderWidth(): number {
    return this.hasRowHeaders() ? this.getRowHeaderWidth() : 0;
  }

  #drawnHeaderHeight(): number {
    if (!this.hasColHeaders()) {
      return 0;
    }
    let total = 0;
    for (let level = 0; level < this.countColHeaderLevels(); level += 1) {
      total += this.getColHeaderHeight(level);
    }
    return total;
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
    // Nothing selected is already the answer. Redrawing anyway would be free
    // for one grid and quadratic for a page holding several, since a click
    // anywhere reaches every one of them.
    if (this.#selection.isEmpty) {
      return;
    }
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
    // A column's own `title` wins: `colHeaders` names them all at once, and
    // `title` is how one column says something different without the caller
    // having to write out the whole list.
    const own = this.#meta.forColumn(col).title;
    if (typeof own === 'string') {
      return this.hooks.run('modifyColHeader', own, col);
    }
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

  /**
   * Runs a function with drawing held off.
   *
   * `batchRender` is the reference's name for exactly this; `batch` is what the
   * rest of this codebase calls it. Both are kept because a Handsontable
   * configuration reaches for the first and everything here reaches for the
   * second, and having one call the other means there is still only one of it.
   */
  batchRender<T>(action: () => T): T {
    return this.batch(action);
  }

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

  // --- the rest of the reference's core surface ---------------------------
  //
  // Mostly one question each. They are grouped here rather than spread through
  // the file above because they are answers, not machinery.

  /** How many row-header columns there are. One, or none. */
  countRowHeaders(): number {
    return this.hasRowHeaders() ? 1 : 0;
  }

  /** How many column-header rows there are, nesting included. */
  countColHeaders(): number {
    return this.hasColHeaders() ? this.countColHeaderLevels() : 0;
  }

  /** How many rows are in the DOM, which is not how many the sheet has. */
  countRenderedRows(): number {
    const viewport = this.view?.viewport;
    return viewport ? Math.max(viewport.lastRow - viewport.firstRow + 1, 0) : 0;
  }

  countRenderedCols(): number {
    const viewport = this.view?.viewport;
    return viewport ? Math.max(viewport.lastCol - viewport.firstCol + 1, 0) : 0;
  }

  /** How many rows the user can actually see, whole or in part. */
  countVisibleRows(): number {
    const first = this.getFirstPartiallyVisibleRow();
    const last = this.getLastPartiallyVisibleRow();
    return first < 0 || last < 0 ? 0 : last - first + 1;
  }

  countVisibleCols(): number {
    const first = this.getFirstPartiallyVisibleColumn();
    const last = this.getLastPartiallyVisibleColumn();
    return first < 0 || last < 0 ? 0 : last - first + 1;
  }

  /**
   * Whether a row holds nothing.
   *
   * A cell holding an empty string is empty; a cell holding a formula that
   * evaluates to an empty string is not, because something is there.
   */
  isEmptyRow(row: number): boolean {
    for (let col = 0; col < this.countCols(); col += 1) {
      if (this.getSourceDataAtCell(row, col) !== '') {
        return false;
      }
    }
    return true;
  }

  isEmptyCol(col: number): boolean {
    for (let row = 0; row < this.countRows(); row += 1) {
      if (this.getSourceDataAtCell(row, col) !== '') {
        return false;
      }
    }
    return true;
  }

  /**
   * How many rows are empty.
   *
   * `ending` counts only the run at the bottom, which is the question someone
   * trimming a sheet is actually asking.
   */
  countEmptyRows(ending = false): number {
    let count = 0;
    for (let row = this.countRows() - 1; row >= 0; row -= 1) {
      if (this.isEmptyRow(row)) {
        count += 1;
      } else if (ending) {
        break;
      }
    }
    return count;
  }

  countEmptyCols(ending = false): number {
    let count = 0;
    for (let col = this.countCols() - 1; col >= 0; col -= 1) {
      if (this.isEmptyCol(col)) {
        count += 1;
      } else if (ending) {
        break;
      }
    }
    return count;
  }

  // --- the viewport -------------------------------------------------------

  getFirstRenderedVisibleRow(): number {
    return this.view?.viewport.firstRow ?? -1;
  }

  getLastRenderedVisibleRow(): number {
    return this.view?.viewport.lastRow ?? -1;
  }

  getFirstRenderedVisibleColumn(): number {
    return this.view?.viewport.firstCol ?? -1;
  }

  getLastRenderedVisibleColumn(): number {
    return this.view?.viewport.lastCol ?? -1;
  }

  /**
   * The first row entirely on screen.
   *
   * *Fully* and *partially* differ by one row at each edge, and the difference
   * matters: scrolling to the first fully visible row is a no-op, while
   * scrolling to the first partially visible one moves.
   */
  getFirstFullyVisibleRow(): number {
    return this.#visibleRow('first', true);
  }

  getLastFullyVisibleRow(): number {
    return this.#visibleRow('last', true);
  }

  getFirstPartiallyVisibleRow(): number {
    return this.#visibleRow('first', false);
  }

  getLastPartiallyVisibleRow(): number {
    return this.#visibleRow('last', false);
  }

  getFirstFullyVisibleColumn(): number {
    return this.#visibleCol('first', true);
  }

  getLastFullyVisibleColumn(): number {
    return this.#visibleCol('last', true);
  }

  getFirstPartiallyVisibleColumn(): number {
    return this.#visibleCol('first', false);
  }

  getLastPartiallyVisibleColumn(): number {
    return this.#visibleCol('last', false);
  }

  #visibleRow(which: 'first' | 'last', fully: boolean): number {
    const view = this.view;
    if (!view) {
      return -1;
    }
    // The scroller, not the root: it is the element the renderer measures, and
    // an answer taken from a different box would disagree with what was drawn.
    const top = view.scrollTop;
    const bottom = top + view.scroller.clientHeight - this.#drawnHeaderHeight();
    let found = -1;
    for (let row = 0; row < this.countRows(); row += 1) {
      const start = this.rowSizes.offsetOf(row);
      const end = start + this.rowSizes.sizeOf(row);
      const inside = fully ? start >= top && end <= bottom : end > top && start < bottom;
      if (inside) {
        if (which === 'first') {
          return row;
        }
        found = row;
      }
    }
    return found;
  }

  #visibleCol(which: 'first' | 'last', fully: boolean): number {
    const view = this.view;
    if (!view) {
      return -1;
    }
    const left = view.scrollLeft;
    const right = left + view.scroller.clientWidth - this.#drawnHeaderWidth();
    let found = -1;
    for (let col = 0; col < this.countCols(); col += 1) {
      const start = this.columnSizes.offsetOf(col);
      const end = start + this.columnSizes.sizeOf(col);
      const inside = fully ? start >= left && end <= right : end > left && start < right;
      if (inside) {
        if (which === 'first') {
          return col;
        }
        found = col;
      }
    }
    return found;
  }

  /** How wide the table is, headers included. */
  getTableWidth(): number {
    return this.columnSizes.total + this.#drawnHeaderWidth();
  }

  getTableHeight(): number {
    return this.rowSizes.total + this.#drawnHeaderHeight();
  }

  /** Re-reads the container's size and draws again. */
  refreshDimensions(): void {
    this.render();
  }

  /** Brings the focused cell into view. */
  scrollToFocusedCell(): void {
    const highlight = this.selection.highlight;
    if (highlight) {
      this.scrollViewportTo(highlight.row, highlight.col);
    }
  }

  // --- indexes ------------------------------------------------------------

  toPhysicalRow(row: number): number | null {
    return this.rowIndex.toPhysical(row);
  }

  toPhysicalColumn(col: number): number | null {
    return this.colIndex.toPhysical(col);
  }

  toVisualRow(row: number): number | null {
    return this.rowIndex.toVisual(row);
  }

  toVisualColumn(col: number): number | null {
    return this.colIndex.toVisual(col);
  }

  /**
   * A column's name.
   *
   * An integration that addressed columns by key needs one. A workbook column
   * has no key, so its header text is the name — which is a real answer rather
   * than a missing method, and is stable as long as the header is.
   */
  colToProp(col: number): string | number {
    // A column configured with `data` names itself, and that name is what an
    // array-of-objects source is keyed by — it has to win over the header,
    // which is a label a person reads rather than a key anything is stored at.
    const own = this.#meta.forColumn(col)['data'];
    if (typeof own === 'string' || typeof own === 'number') {
      return own;
    }
    return this.hasColHeaders() ? this.getColHeader(col) : col;
  }

  /** The column a name refers to, or `-1`. */
  propToCol(prop: string | number): number {
    if (typeof prop === 'number') {
      return prop;
    }
    for (let col = 0; col < this.countCols(); col += 1) {
      if (this.colToProp(col) === prop) {
        return col;
      }
    }
    return -1;
  }

  /** The cell an element belongs to, or `null`. */
  getCoords(element: HTMLElement | null): Coords | null {
    return element ? (this.view?.cellAt(element) ?? null) : null;
  }

  /**
   * The drawn element for a cell, or `null` when it is scrolled out.
   *
   * The reference calls this `getCell`; here that name was already taken by the
   * cell's *value*, and quietly changing what it returns would break every
   * caller in this codebase to match a name. So the element has its own name,
   * and `docs/handsontable-parity.md` records the difference rather than
   * letting the count imply there is none.
   */
  getCellElement(row: number, col: number): HTMLTableCellElement | null {
    return this.view?.elementAt(row, col) ?? null;
  }

  isLtr(): boolean {
    return !this.isRtl();
  }

  /** `1` left-to-right, `-1` right-to-left, for arithmetic on directions. */
  getDirectionFactor(): 1 | -1 {
    return this.isRtl() ? -1 : 1;
  }

  // --- data ---------------------------------------------------------------

  /** Every row's source values — formulas, not their results. */
  getSourceData(): string[][] {
    return Array.from({ length: this.countRows() }, (_, row) => this.getSourceDataAtRow(row));
  }

  getSourceDataArray(): string[][] {
    return this.getSourceData();
  }

  getSourceDataAtRow(row: number): string[] {
    return Array.from({ length: this.countCols() }, (_, col) =>
      this.getSourceDataAtCell(row, col),
    );
  }

  getSourceDataAtCol(col: number): string[] {
    return Array.from({ length: this.countRows() }, (_, row) =>
      this.getSourceDataAtCell(row, col),
    );
  }

  /** Writes without going through the editor's parsing and validation. */
  setSourceDataAtCell(row: number, col: number, value: string): void {
    this.setDataAtCell(row, col, value, 'loadData');
  }

  getDataAtProp(prop: string | number): string[] {
    const col = this.propToCol(prop);
    return col < 0 ? [] : this.getDataAtCol(col);
  }

  getDataAtRowProp(row: number, prop: string | number): string {
    const col = this.propToCol(prop);
    return col < 0 ? '' : this.getDataAtCell(row, col);
  }

  setDataAtRowProp(row: number, prop: string | number, value: string): void {
    const col = this.propToCol(prop);
    if (col >= 0) {
      this.setDataAtCell(row, col, value);
    }
  }

  /** What the clipboard would take, which a `copyable: false` cell withholds. */
  getCopyableData(row: number, col: number): string {
    return this.getCellMeta(row, col)['copyable'] === false ? '' : this.getDataAtCell(row, col);
  }

  getCopyableSourceData(row: number, col: number): string {
    return this.getCellMeta(row, col)['copyable'] === false
      ? ''
      : this.getSourceDataAtCell(row, col);
  }

  /**
   * The one type a rectangle has, or `mixed`.
   *
   * `mixed` is the useful answer: a caller asking is deciding whether it can
   * treat the block uniformly, and "they differ" is what it needs to hear.
   */
  getDataType(startRow: number, startCol: number, endRow: number, endCol: number): string {
    let found: string | null = null;
    for (let row = startRow; row <= endRow; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) {
        const type = String(this.getCellMeta(row, col).type ?? 'text');
        if (found === null) {
          found = type;
        } else if (found !== type) {
          return 'mixed';
        }
      }
    }
    return found ?? 'text';
  }

  /** The columns, as a shape — the nearest thing a workbook has to a schema. */
  getSchema(): Record<string, null> {
    const schema: Record<string, null> = {};
    for (let col = 0; col < this.countCols(); col += 1) {
      schema[String(this.colToProp(col))] = null;
    }
    return schema;
  }

  /** Replaces everything with the given rows. */
  loadData(data: string[][]): void {
    if (this.hooks.allows('beforeLoadData', data) === false) {
      return;
    }
    const changes: Array<[number, number, string]> = [];
    const height = Math.max(data.length, this.countRows());
    const width = Math.max(this.countCols(), ...data.map((row) => row.length), 0);
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        changes.push([row, col, data[row]?.[col] ?? '']);
      }
    }
    this.setDataAtCells(changes, 'loadData');
    this.hooks.run('afterLoadData', undefined, data);
  }

  /** The same, but keeping the index maps — a sort survives it. */
  updateData(data: string[][]): void {
    const changes: Array<[number, number, string]> = [];
    data.forEach((line, row) => {
      line.forEach((value, col) => {
        changes.push([row, col, value]);
      });
    });
    this.setDataAtCells(changes, 'updateData');
    this.hooks.run('afterUpdateData', undefined, data);
  }

  /** Replaces part of a row, as `Array.prototype.splice` does. */
  spliceRow(row: number, start: number, amount: number, ...values: string[]): void {
    const line = this.getSourceDataAtRow(row);
    const width = line.length;
    line.splice(start, amount, ...values);
    this.setDataAtCells(
      pad(line, width).map((value, col) => [row, col, value] as [number, number, string]),
      'spliceRow',
    );
  }

  spliceCol(col: number, start: number, amount: number, ...values: string[]): void {
    const line = this.getSourceDataAtCol(col);
    const height = line.length;
    line.splice(start, amount, ...values);
    this.setDataAtCells(
      pad(line, height).map((value, row) => [row, col, value] as [number, number, string]),
      'spliceCol',
    );
  }

  /** Whether columns may be added or removed at all. */
  isColumnModificationAllowed(): boolean {
    const settings = this.getSettings();
    return settings.allowInsertColumn !== false || settings.allowRemoveColumn !== false;
  }

  // --- cell meta ----------------------------------------------------------

  /** The settings of every cell, row by row. */
  getCellsMeta(): GridSettings[] {
    const all: GridSettings[] = [];
    for (let row = 0; row < this.countRows(); row += 1) {
      all.push(...this.getCellMetaAtRow(row));
    }
    return all;
  }

  getCellMetaAtRow(row: number): GridSettings[] {
    return Array.from({ length: this.countCols() }, (_, col) => this.getCellMeta(row, col));
  }

  /** The settings without letting a hook change them. */
  getCellMetaTransient(row: number, col: number): GridSettings {
    return this.#meta.forCell(row, col);
  }

  getColumnMeta(col: number): GridSettings {
    return this.#meta.forColumn(col);
  }

  /**
   * Splices rows of per-cell settings, as a splice of the data would.
   *
   * Rows, not cells: removing a row has to take that row's settings with it,
   * or the row below inherits a `readOnly` it never had. Each replacement is a
   * whole row's worth of settings, one entry per column.
   */
  spliceCellsMeta(row: number, amount = 0, ...replacements: GridSettings[][]): void {
    if (amount > 0) {
      this.#meta.shift('row', row, -amount);
    }
    if (replacements.length > 0) {
      this.#meta.shift('row', row, replacements.length);
      replacements.forEach((line, offset) => {
        line.forEach((settings, col) => {
          this.setCellMetaObject(row + offset, col, settings);
        });
      });
    }
    this.render();
  }

  getCellRenderer(row: number, col: number): unknown {
    const meta = this.getCellMeta(row, col);
    return typeof meta.renderer === 'function'
      ? meta.renderer
      : getRenderer(String(meta.renderer ?? meta.type ?? 'text'));
  }

  getCellEditor(row: number, col: number): unknown {
    const meta = this.getCellMeta(row, col);
    return typeof meta.editor === 'function'
      ? meta.editor
      : getEditor(String(meta.editor ?? meta.type ?? 'text'));
  }

  getCellValidator(row: number, col: number): unknown {
    const meta = this.getCellMeta(row, col);
    return typeof meta.validator === 'function'
      ? meta.validator
      : getValidator(String(meta.validator ?? meta.type ?? 'text'));
  }

  /** Runs every validator, and reports whether all of them passed. */
  validateCells(callback?: (valid: boolean) => void): void {
    this.validateRows(
      Array.from({ length: this.countRows() }, (_, row) => row),
      callback,
    );
  }

  validateRows(rows: number[], callback?: (valid: boolean) => void): void {
    const cells: Coords[] = [];
    for (const row of rows) {
      for (let col = 0; col < this.countCols(); col += 1) {
        cells.push({ row, col });
      }
    }
    void this.#validateAll(cells, callback);
  }

  validateColumns(cols: number[], callback?: (valid: boolean) => void): void {
    const cells: Coords[] = [];
    for (const col of cols) {
      for (let row = 0; row < this.countRows(); row += 1) {
        cells.push({ row, col });
      }
    }
    void this.#validateAll(cells, callback);
  }

  /**
   * Validates a list of cells and reports the verdict once.
   *
   * A validator may be asynchronous, so the answer is a promise even when
   * every one of them is not — a caller told "all valid" before the slow one
   * has answered would be told something untrue.
   */
  async #validateAll(cells: Coords[], callback?: (valid: boolean) => void): Promise<boolean> {
    let allValid = true;
    for (const { row, col } of cells) {
      const meta = this.getCellMeta(row, col);
      const validator = this.getCellValidator(row, col) as
        | ((value: string, meta: GridSettings) => unknown)
        | undefined;
      if (typeof validator !== 'function') {
        continue;
      }
      const result = await validator(this.getSourceDataAtCell(row, col), meta);
      const valid = typeof result === 'object' && result !== null && 'valid' in result
        ? (result as { valid: boolean }).valid
        : result !== false;
      if (!valid) {
        allValid = false;
        this.#invalid.add(row, col);
      } else {
        this.#invalid.delete(row, col);
      }
    }
    this.render();
    callback?.(allValid);
    return allValid;
  }

  // --- selection ----------------------------------------------------------

  /** The active layer of the selection, which is the last one added. */
  getSelectedActive(): [number, number, number, number] | undefined {
    return this.getSelectedLast();
  }

  getSelectedRangeActive(): CellRange | undefined {
    return this.getSelectedRangeLast();
  }

  getActiveSelectionLayerIndex(): number {
    return Math.max(this.selection.ranges.length - 1, 0);
  }

  // --- batching -----------------------------------------------------------

  batchExecution<T>(work: () => T, forceFlush = false): T {
    this.suspendExecution();
    try {
      return work();
    } finally {
      this.resumeExecution(forceFlush);
    }
  }

  suspendExecution(): void {
    this.suspendRender();
  }

  resumeExecution(forceFlush = false): void {
    this.resumeRender();
    if (forceFlush) {
      this.render();
    }
  }

  isExecutionSuspended(): boolean {
    return this.isRenderSuspended();
  }

  // --- odds and ends ------------------------------------------------------

  // --- bootstrap ----------------------------------------------------------

  /**
   * Runs the bootstrap again.
   *
   * In Handsontable this is what the constructor calls. Here the constructor
   * does the work itself, so `init` is what a caller reaches for when the grid
   * has to be rebuilt against changed surroundings — the data grew underneath
   * it, or a keyboard context was torn down. It is written to be safe to call
   * twice, which is the only thing that makes it worth exposing at all.
   */
  init(): void {
    if (this.#destroyed) {
      return;
    }
    this.initIndexMappers();
    this.registerAllShortcutContexts();
    this.render();
    this.hooks.run('afterInit', undefined);
  }

  /**
   * Sizes the row and column index maps to the data.
   *
   * The maps carry the order, the trims and the hides, so this extends them to
   * reach the data rather than rebuilding them — a rebuild would throw away the
   * sort a person is currently looking at.
   */
  initIndexMappers(): void {
    this.#syncDimensions(true);
  }

  /**
   * Rebuilds the built-in keyboard contexts.
   *
   * Only the `core` group is dropped and re-added, so shortcuts a plugin
   * registered survive — they were not this method's to remove.
   */
  registerAllShortcutContexts(): void {
    for (const name of ['grid', 'editor']) {
      this.shortcuts.getContext(name)?.removeShortcutsByGroup('core');
    }
    this.#bindKeyboard();
  }

  getInstance(): Grid {
    return this;
  }

  /** The name a plugin is registered under, or `null` if it is not ours. */
  getPluginName(plugin: unknown): string | null {
    for (const [name, registered] of this.#plugins) {
      if (registered === plugin) {
        return name;
      }
    }
    return null;
  }

  getPluginsNames(): string[] {
    return [...this.#plugins.keys()];
  }

  getShortcutManager(): ShortcutManager {
    return this.shortcuts;
  }

  /**
   * Handsontable's focus managers.
   *
   * This grid keeps focus on one element and moves a selection inside it, so
   * there is nothing separate to hand back. Returning the grid rather than
   * `null` keeps a chained call from throwing.
   */
  getFocusManager(): Grid {
    return this;
  }

  getFocusScopeManager(): Grid {
    return this;
  }

  getActiveEditor(): unknown {
    return this.#editor;
  }

  /** Closes the editor. `revert` throws the edit away. */
  destroyEditor(revert = false): void {
    this.closeEditor(!revert);
  }

  getCurrentThemeName(): string | null {
    return this.getTheme()?.name ?? null;
  }

  /** Switches theme, taking either a registered theme or a name. */
  useTheme(theme: unknown): void {
    this.updateSettings({ theme: theme as GridSettings['theme'] });
  }

  /** How many columns the grid started with. */
  getInitialColumnCount(): number {
    return (this.getSettings().startCols as number) ?? this.countCols();
  }

  /** The grid as an HTML table, for a caller building a document from it. */
  toHTML(): string {
    return this.toTableElement().outerHTML;
  }

  toTableElement(): HTMLTableElement {
    const doc = this.view?.root.ownerDocument ?? globalThis.document;
    const table = doc.createElement('table');
    const body = doc.createElement('tbody');
    if (this.hasColHeaders()) {
      const head = doc.createElement('tr');
      for (let col = 0; col < this.countCols(); col += 1) {
        const th = doc.createElement('th');
        th.textContent = this.getColHeader(col);
        head.appendChild(th);
      }
      body.appendChild(head);
    }
    for (let row = 0; row < this.countRows(); row += 1) {
      const tr = doc.createElement('tr');
      for (let col = 0; col < this.countCols(); col += 1) {
        const td = doc.createElement('td');
        // The text, not the formula: a table pasted into a document shows what
        // the grid showed.
        td.textContent = this.getDataAtCell(row, col);
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    table.appendChild(body);
    return table;
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.hooks.run('beforeDestroy', undefined);
    for (const plugin of this.#plugins.values()) {
      plugin.destroy();
    }
    this.#plugins.clear();
    for (const remove of this.#listeners) {
      remove();
    }
    this.#listeners = [];
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
    const { colWidths } = settings;
    // `minRowHeights` is Handsontable's alias for `rowHeights`, not a floor.
    const rowHeights = settings.rowHeights ?? settings.minRowHeights;
    if (typeof colWidths === 'number') {
      this.#colSizes.defaultSize = colWidths;
    } else if (Array.isArray(colWidths)) {
      this.#colSizes.setSizes(colWidths.map((width, index) => [index, width]));
    } else if (typeof colWidths === 'function') {
      this.#colSizes.setSizes(
        Array.from({ length: this.#colSizes.count }, (_, index) => [index, colWidths(index)]),
      );
    }
    this.#rowSizes.defaultSize = Math.round(DEFAULT_ROW_HEIGHT * this.densityScale());
    if (typeof rowHeights === 'number') {
      this.#rowSizes.defaultSize = Math.round(rowHeights * this.densityScale());
    } else if (Array.isArray(rowHeights)) {
      this.#rowSizes.setSizes(rowHeights.map((height, index) => [index, height]));
    } else if (typeof rowHeights === 'function') {
      this.#rowSizes.setSizes(
        Array.from({ length: this.#rowSizes.count }, (_, index) => [index, rowHeights(index)]),
      );
    }
  }

  /**
   * Reports values the source-data validator rejects.
   *
   * It reports rather than refuses, which is the difference from `validator`:
   * that one guards what a *person* types, this one watches what arrives from
   * a loader or an API. A write from code that is already wrong is not made
   * right by being dropped, and dropping it silently is how the wrongness gets
   * lost.
   */
  #warnAboutSourceData(changes: Array<[number, number, string]>): void {
    const settings = this.getSettings();
    const validate = settings.sourceDataValidator;
    if (typeof validate !== 'function') {
      return;
    }
    for (const [row, col, value] of changes) {
      if (!validate(value, row, col)) {
        const message = settings.sourceDataWarningMessage;
        if (message) {
          console.warn(`${message} (${cellRef(row, col)}: ${JSON.stringify(value)})`);
        }
        this.hooks.run('afterSourceDataValidate', undefined, value, row, col);
      }
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
    return this.#invalid.has(row, col);
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
    const meta = this.getCellMeta(row, col);
    // Whitespace round the edges of a typed value is almost never meant, and a
    // cell that holds `" 5 "` compares equal to nothing and sums as nothing.
    if (meta.trimWhitespace !== false) {
      value = value.trim();
    }
    // `valueParser` reads what the editor produced back into the shape the
    // source data uses; `valueSetter` gets the last word on what is stored.
    const parser = meta.valueParser;
    if (typeof parser === 'function') {
      value = String(parser(value, row, col) ?? '');
    }
    const setter = meta.valueSetter;
    if (typeof setter === 'function') {
      value = String(setter(value, row, col) ?? '');
    }
    const validator = this.#validatorFor(meta);
    const finish = (result: ValidationResult): void => {
      if (result.valid) {
        this.#invalid.delete(row, col);
      } else {
        this.#invalid.add(row, col);
      }
      this.hooks.run('afterValidate', result.valid, value, row, col);
      if (result.valid || meta.allowInvalid !== false) {
        this.setDataAtCell(row, col, value);
      } else {
        this.render();
      }
    };

    if (!validator) {
      this.#invalid.delete(row, col);
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
    // Where Enter goes after a commit is `enterMoves`, the same setting that
    // decides where it goes when it is not editing.
    const step = (this.getSettings().enterMoves as Coords | undefined) ?? { row: 1, col: 0 };
    this.closeEditor(true, moveBy ?? step);
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
      this.#moveAfterEnter(shift);
      return;
    }
    this.beginEditing(highlight.row, highlight.col);
  }

  /**
   * Where Enter goes.
   *
   * `enterMoves` is a step rather than a direction, so Enter can be made to
   * walk across a row instead of down a column — which is how someone entering
   * a wide record types it in one pass. Shift reverses it.
   */
  #moveAfterEnter(shift: boolean): void {
    const step = (this.getSettings().enterMoves as Coords | undefined) ?? { row: 1, col: 0 };
    const direction = shift ? -1 : 1;
    this.#selection.moveBy(
      step.row * direction,
      step.col * direction,
      this.getSettings().autoWrapCol === true,
    );
    this.#afterSelection();
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

    // Clicking away drops the selection, unless the page says otherwise. A
    // grid inside a form usually wants to keep it: the click that moved focus
    // to a field next to the grid should not lose the cell being worked on.
    this.#onDocument('mousedown', (event: Event) => {
      const target = event.target as HTMLElement | null;
      // The path as it was when the event was dispatched, not where the nodes
      // are now: selecting a cell redraws the table, so by the time the event
      // reaches the document the cell that was clicked has been replaced and
      // `contains` would call every click an outside click.
      const path = event.composedPath?.() ?? [];
      const inside = path.includes(view.wrapper) || (target !== null && view.wrapper.contains(target));
      if (!this.#listening || !target || inside) {
        return;
      }
      const setting = this.getSettings().outsideClickDeselects;
      const deselects = typeof setting === 'function' ? setting(target) : setting !== false;
      if (deselects) {
        this.deselectCell();
      }
    });
  }

  /**
   * Registers a listener on the page, removed when the grid is destroyed.
   *
   * Anything outside the grid's own elements has to be unhooked by hand: the
   * page outlives the grid, so a listener left on it keeps a destroyed grid
   * alive and answering.
   */
  #onDocument(type: string, handler: (event: Event) => void): void {
    const target = this.#view?.root.ownerDocument;
    if (!target) {
      return;
    }
    target.addEventListener(type, handler);
    this.#listeners.push(() => target.removeEventListener(type, handler));
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
      rowHeaderWidth: () => this.#drawnHeaderWidth(),
      colHeaderHeight: () => this.#drawnHeaderHeight(),
      colHeaderLevelHeight: (level) =>
        this.hasColHeaders() ? this.getColHeaderHeight(level) : 0,
      renderColHeader: (th, cell) => {
        this.#markHeader(th, { col: cell.col });
        this.hooks.run('afterGetColHeader', undefined, cell.col, th, cell.level);
      },
      renderRowHeader: (th, row) => {
        this.#markHeader(th, { row });
        this.hooks.run('afterGetRowHeader', undefined, row, th);
      },
      ariaTags: () => this.getSettings().ariaTags !== false,
      fixedRowsBottom: () => (this.getSettings().fixedRowsBottom as number) ?? 0,
      preventWheel: () => this.getSettings().preventWheel === true,
      direction: () => (this.isRtl() ? 'rtl' : 'ltr'),
      theme: () => {
        const theme = this.getTheme();
        if (!theme) {
          return null;
        }
        // `auto` leaves the choice to the page, so no properties are written:
        // the stylesheet's own media query decides, and inline values would
        // beat it.
        const scheme =
          theme.colorScheme === 'auto' ? null : (theme.colorScheme as 'light' | 'dark');
        return {
          classNames: theme.classNames(),
          properties: scheme ? theme.properties(scheme) : {},
        };
      },
      tableClassName: () => {
        const setting = this.getSettings().tableClassName;
        if (Array.isArray(setting)) {
          return setting;
        }
        return typeof setting === 'string' ? setting.split(/\s+/).filter(Boolean) : [];
      },
      size: () => {
        const { width, height, preventOverflow } = this.getSettings();
        // A bare number is pixels; anything else is CSS as written, so `75%`
        // and `50vh` work without the grid having to understand them.
        const css = (value: unknown): string | null =>
          typeof value === 'number' ? `${value}px` : typeof value === 'string' ? value : null;
        return {
          width: css(width),
          height: css(height),
          preventOverflow:
            preventOverflow === 'horizontal' || preventOverflow === 'vertical'
              ? preventOverflow
              : false,
        };
      },
      prepare: (startRow, endRow, startCol, endCol) => {
        this.#ensureVisible(startRow, endRow, startCol, endCol);
        // The one point where the window about to be drawn is known. A plugin
        // that decorates cells needs it here: without it, the only place it can
        // ask about a cell is while drawing that cell, one round trip at a time.
        this.hooks.run('beforeViewportRender', undefined, {
          startRow,
          endRow,
          startCol,
          endCol,
        });
      },
      renderCell: (context) => this.#renderCell(context),
      overscan: () => ({
        rows: this.#overscanOf('row'),
        cols: this.#overscanOf('column'),
      }),
    });
    this.#view.layout.setOrder((this.getSettings().layout as LayoutSettings | undefined) ?? {});
    this.render();
  }

  /**
   * Which layers of the selection are drawn.
   *
   * Handsontable names three — the focused cell, the range around it, the
   * headers — and lets any of them be switched off. They are separate because
   * they answer different questions: where am I, what have I got, and which
   * column is that.
   */
  #showsSelection(layer: 'current' | 'area' | 'header'): boolean {
    const setting = this.getSettings().disableVisualSelection;
    if (setting === true) {
      return false;
    }
    if (setting === false || setting === undefined) {
      return true;
    }
    const off = Array.isArray(setting) ? setting : [setting];
    return !off.includes(layer);
  }

  /**
   * Puts the highlight classes on a header.
   *
   * *Current* is the header the selection passes through; *active* is one whose
   * whole row or column is selected. They are different states and Handsontable
   * gives them different classes, because "the selection is somewhere in this
   * column" and "this column is selected" mean different things to a reader.
   */
  #markHeader(th: HTMLTableCellElement, at: { row?: number; col?: number }): void {
    const settings = this.getSettings();
    const highlight = this.#selection.highlight;
    if (!highlight) {
      return;
    }
    if (!this.#showsSelection('header')) {
      return;
    }
    const isCurrent = at.col !== undefined ? highlight.col === at.col : highlight.row === at.row;
    if (isCurrent) {
      th.classList.add(String(settings.currentHeaderClassName ?? 'ht__highlight'));
    }
    const whole =
      at.col !== undefined
        ? this.#selection.isColumnSelected(at.col)
        : this.#selection.isRowSelected(at.row ?? -1);
    if (whole) {
      th.classList.add(String(settings.activeHeaderClassName ?? 'ht__active_highlight'));
    }
    const extra = settings.headerClassName;
    if (extra) {
      for (const name of String(extra).split(/\s+/).filter(Boolean)) {
        th.classList.add(name);
      }
    }
  }

  /**
   * How far beyond the viewport to draw, on one axis.
   *
   * `renderAll*` turns virtualization off outright. Otherwise `auto` is a small
   * fixed margin — enough to hide the seam while scrolling and not so much that
   * a wide grid draws columns nobody will look at.
   */
  #overscanOf(axis: 'row' | 'column'): number | 'all' {
    const settings = this.getSettings();
    const all = axis === 'row' ? settings.renderAllRows : settings.renderAllColumns;
    if (all === true) {
      return 'all';
    }
    const offset =
      axis === 'row' ? settings.viewportRowRenderingOffset : settings.viewportColumnRenderingOffset;
    const threshold =
      axis === 'row'
        ? settings.viewportRowRenderingThreshold
        : settings.viewportColumnRenderingThreshold;
    // The threshold is how close to the edge of what is drawn the viewport has
    // to come before more is drawn. Drawing that much extra is what makes the
    // margin still be there when the moment arrives.
    const margin = typeof threshold === 'number' ? Math.max(threshold, 0) : 0;
    if (offset === 'auto' || offset === undefined) {
      return DEFAULT_OVERSCAN + margin;
    }
    return typeof offset === 'number' ? Math.max(offset, 0) + margin : DEFAULT_OVERSCAN + margin;
  }

  /** Fills in one cell of the view. */
  #renderCell(context: CellRenderContext): void {
    const { row, col, td } = context;
    const settings = this.getSettings();
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
    if (this.#invalid.has(row, col)) {
      td.classList.add(String(meta.invalidCellClassName ?? 'htInvalid'));
    }
    if (this.#showsSelection('area') && this.#selection.includes({ row, col })) {
      td.classList.add('cm-selected');
    }
    const highlight = this.#selection.highlight;
    if (highlight) {
      if (this.#showsSelection('current') && highlight.row === row && highlight.col === col) {
        td.classList.add('cm-current');
      }
      // Whole-row and whole-column highlighting, off unless a class is named:
      // marking every cell of the row costs a class per cell, so it happens
      // only when someone asked for it.
      const rowClass = settings.currentRowClassName;
      if (rowClass && highlight.row === row) {
        td.classList.add(String(rowClass));
      }
      const colClass = settings.currentColClassName;
      if (colClass && highlight.col === col) {
        td.classList.add(String(colClass));
      }
    }
    if (settings.textEllipsis) {
      td.classList.add('cm-ellipsis');
    }
    // Text selection inside cells is off by default, because dragging across
    // cells has to mean "select these cells" and cannot mean both.
    if (settings.fragmentSelection) {
      td.classList.add(
        settings.fragmentSelection === 'cell' ? 'cm-text-select-cell' : 'cm-text-select',
      );
    }
    this.hooks.run('afterRenderer', undefined, td, row, col, cell, meta);
  }
}

/** The A1 reference of a cell, for plugins and tests. */
export { cellRef, columnLetters };

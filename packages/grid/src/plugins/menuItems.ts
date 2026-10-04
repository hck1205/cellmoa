/**
 * The built-in menu commands.
 *
 * Keys match Handsontable's exactly, because a `contextMenu: ['row_above',
 * 'remove_row']` written against Handsontable has to keep working. Which of
 * them appear depends on what is switched on: an item that calls a plugin that
 * is not there would be a command that silently does nothing.
 */

import type { Grid } from '../grid.js';
import { PHRASE } from '../i18n/keys.js';
// Type-only imports, so naming the plugins here costs nothing at run time and
// makes no import cycle. Structural stand-ins would compile just as well and
// would go quietly out of date the first time one of these methods is renamed.
import type { Comments } from './comments.js';
import type { ColumnSorting } from './columnSorting.js';
import type { CopyMode, CopyPaste } from './copyPaste.js';
import type { ExportFile } from './exportFile.js';
import type { HiddenColumns, HiddenRows } from './hiding.js';
import type { ManualColumnFreeze } from './manualMove.js';
import type { MergeCells } from './mergeCells.js';
import type { Provenance } from './cellmoa/provenance.js';
import type { MenuItem, MenuSelection } from '../menu.js';
import { SEPARATOR } from '../menu.js';

/** The keys, so a caller can name them without spelling them. */
export const ITEM = {
  rowAbove: 'row_above',
  rowBelow: 'row_below',
  columnLeft: 'col_left',
  columnRight: 'col_right',
  removeRow: 'remove_row',
  removeColumn: 'remove_col',
  clearColumn: 'clear_column',
  undo: 'undo',
  redo: 'redo',
  readOnly: 'make_read_only',
  alignment: 'alignment',
  copy: 'copy',
  copyWithColumnHeaders: 'copy_with_column_headers',
  copyWithColumnGroupHeaders: 'copy_with_column_group_headers',
  copyColumnHeadersOnly: 'copy_column_headers_only',
  cut: 'cut',
  mergeCells: 'mergeCells',
  freezeColumn: 'freeze_column',
  unfreezeColumn: 'unfreeze_column',
  hiddenRowsHide: 'hidden_rows_hide',
  hiddenRowsShow: 'hidden_rows_show',
  hiddenColumnsHide: 'hidden_columns_hide',
  hiddenColumnsShow: 'hidden_columns_show',
  addComment: 'commentsAddEdit',
  removeComment: 'commentsRemove',
  borders: 'borders',
  exportFile: 'export_file',
  filter: 'filter_by_condition',
  sortAscending: 'sort_asc',
  sortDescending: 'sort_desc',
  separator: SEPARATOR,
  noItems: 'no_items',
  /** Not in Handsontable: takes back only what one actor did. */
  undoAgent: 'undo_agent',
  /** Not in Handsontable: who changed this cell, when, and why. */
  provenance: 'provenance',
} as const;

/** The default context-menu layout, in order. */
export const DEFAULT_CONTEXT_MENU: string[] = [
  ITEM.rowAbove,
  ITEM.rowBelow,
  ITEM.separator,
  ITEM.columnLeft,
  ITEM.columnRight,
  ITEM.separator,
  ITEM.removeRow,
  ITEM.removeColumn,
  ITEM.separator,
  ITEM.undo,
  ITEM.redo,
  ITEM.separator,
  ITEM.readOnly,
  ITEM.alignment,
];

/** The default dropdown-menu layout: the column commands only. */
export const DEFAULT_DROPDOWN_MENU: string[] = [
  ITEM.columnLeft,
  ITEM.columnRight,
  ITEM.separator,
  ITEM.removeColumn,
  ITEM.clearColumn,
  ITEM.separator,
  ITEM.sortAscending,
  ITEM.sortDescending,
  ITEM.separator,
  ITEM.alignment,
];

/**
 * Stands in for "nothing selected" when a label needs a count.
 *
 * A phrase with a singular and a plural has to be given one or the other, and
 * with no selection the singular reads better than the plural.
 */
const EMPTY: MenuSelection = { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } };

/** The first selected rectangle, or `null` when nothing is selected. */
function first(selection: MenuSelection[]): MenuSelection | null {
  return selection[0] ?? null;
}

/** How many rows the selection covers. */
function rowsIn(range: MenuSelection): number {
  return Math.abs(range.end.row - range.start.row) + 1;
}

function colsIn(range: MenuSelection): number {
  return Math.abs(range.end.col - range.start.col) + 1;
}

function topRow(range: MenuSelection): number {
  return Math.min(range.start.row, range.end.row);
}

function startCol(range: MenuSelection): number {
  return Math.min(range.start.col, range.end.col);
}

/**
 * Whether the cell in the corner of a range is read-only.
 *
 * The tick and the toggle both have to read the same cell, or the item would
 * show one state and apply the other.
 */
function readOnlyAt(grid: Grid, range: MenuSelection): boolean {
  return grid.getCellMeta(topRow(range), startCol(range))['readOnly'] === true;
}

/** Whether a plugin is present and switched on. */
function enabled(grid: Grid, name: string): boolean {
  return grid.getPlugin(name)?.isPluginEnabled() === true;
}

/**
 * A command that acts on the first selected rectangle.
 *
 * Nearly every item here is one, and a menu can be run with nothing selected —
 * `executeCommand` takes a key, not a selection — so each of them had the same
 * four lines of guard in front of the one line that mattered.
 */
function onRange(
  run: (range: MenuSelection) => void,
): (key: string, ranges: MenuSelection[]) => void {
  return (_key, ranges) => {
    const range = first(ranges);
    if (range) {
      run(range);
    }
  };
}

/**
 * Builds every item this grid can offer, keyed as Handsontable keys them.
 *
 * The table is rebuilt each time a menu opens. Labels and availability both
 * depend on the selection, and a table built once would answer for whatever
 * was selected when the grid started.
 */
export function predefinedItems(grid: Grid): Record<string, MenuItem> {
  const selection = (): MenuSelection[] => grid.getMenuSelection();
  const nothingSelected = (): boolean => first(selection()) === null;

  const items: Record<string, MenuItem> = {
    [ITEM.rowAbove]: {
      key: ITEM.rowAbove,
      hidden: () => grid.getSettings().allowInsertRow === false,
      name: () => grid.getTranslatedPhrase(PHRASE.rowAbove),
      disabled: nothingSelected,
      callback: onRange((range) => grid.alter('insert_row', topRow(range), rowsIn(range))),
    },
    [ITEM.rowBelow]: {
      key: ITEM.rowBelow,
      hidden: () => grid.getSettings().allowInsertRow === false,
      name: () => grid.getTranslatedPhrase(PHRASE.rowBelow),
      disabled: nothingSelected,
      callback: onRange((range) => {
        grid.alter('insert_row', topRow(range) + rowsIn(range), rowsIn(range));
      }),
    },
    [ITEM.columnLeft]: {
      key: ITEM.columnLeft,
      hidden: () => grid.getSettings().allowInsertColumn === false,
      name: () => grid.getTranslatedPhrase(PHRASE.columnLeft),
      disabled: nothingSelected,
      callback: onRange((range) => grid.alter('insert_col', startCol(range), colsIn(range))),
    },
    [ITEM.columnRight]: {
      key: ITEM.columnRight,
      hidden: () => grid.getSettings().allowInsertColumn === false,
      name: () => grid.getTranslatedPhrase(PHRASE.columnRight),
      disabled: nothingSelected,
      callback: onRange((range) => {
        grid.alter('insert_col', startCol(range) + colsIn(range), colsIn(range));
      }),
    },
    [ITEM.removeRow]: {
      key: ITEM.removeRow,
      hidden: () => grid.getSettings().allowRemoveRow === false,
      name: () => grid.getTranslatedPhrase(PHRASE.removeRow, rowsIn(first(selection()) ?? EMPTY)),
      disabled: nothingSelected,
      callback: onRange((range) => grid.alter('remove_row', topRow(range), rowsIn(range))),
    },
    [ITEM.removeColumn]: {
      key: ITEM.removeColumn,
      hidden: () => grid.getSettings().allowRemoveColumn === false,
      name: () =>
        grid.getTranslatedPhrase(PHRASE.removeColumn, colsIn(first(selection()) ?? EMPTY)),
      disabled: nothingSelected,
      callback: onRange((range) => grid.alter('remove_col', startCol(range), colsIn(range))),
    },
    [ITEM.clearColumn]: {
      key: ITEM.clearColumn,
      name: () => grid.getTranslatedPhrase(PHRASE.clearColumn),
      disabled: nothingSelected,
      callback: onRange((range) => {
        const changes: Array<[number, number, string]> = [];
        for (let col = startCol(range); col < startCol(range) + colsIn(range); col += 1) {
          for (let row = 0; row < grid.countRows(); row += 1) {
            changes.push([row, col, '']);
          }
        }
        grid.setDataAtCells(changes, 'contextMenu');
      }),
    },
    [ITEM.undo]: {
      key: ITEM.undo,
      name: () => grid.getTranslatedPhrase(PHRASE.undo),
      disabled: () => !grid.canUndo(),
      callback: () => grid.undo(),
    },
    [ITEM.redo]: {
      key: ITEM.redo,
      name: () => grid.getTranslatedPhrase(PHRASE.redo),
      disabled: () => !grid.canRedo(),
      callback: () => grid.redo(),
    },
    [ITEM.readOnly]: {
      key: ITEM.readOnly,
      name: () => grid.getTranslatedPhrase(PHRASE.readOnly),
      disabled: nothingSelected,
      checked: () => {
        const range = first(selection());
        return range !== null && readOnlyAt(grid, range);
      },
      callback: onRange((range) => {
        const already = readOnlyAt(grid, range);
        for (let row = topRow(range); row < topRow(range) + rowsIn(range); row += 1) {
          for (let col = startCol(range); col < startCol(range) + colsIn(range); col += 1) {
            grid.setCellMeta(row, col, 'readOnly', !already);
          }
        }
        grid.render();
      }),
    },
    [ITEM.alignment]: {
      key: ITEM.alignment,
      name: () => grid.getTranslatedPhrase(PHRASE.alignment),
      disabled: nothingSelected,
      submenu: {
        items: (
          [
            ['alignment:left', PHRASE.alignLeft, 'htLeft'],
            ['alignment:center', PHRASE.alignCenter, 'htCenter'],
            ['alignment:right', PHRASE.alignRight, 'htRight'],
            ['alignment:justify', PHRASE.alignJustify, 'htJustify'],
            [SEPARATOR, '', ''],
            ['alignment:top', PHRASE.alignTop, 'htTop'],
            ['alignment:middle', PHRASE.alignMiddle, 'htMiddle'],
            ['alignment:bottom', PHRASE.alignBottom, 'htBottom'],
          ] as const
        ).map(([key, name, className]) =>
          key === SEPARATOR
            ? { key: SEPARATOR }
            : {
                key,
                name: () => grid.getTranslatedPhrase(name),
                callback: onRange((range) => grid.setAlignment(range, className)),
              },
        ),
      },
    },
    [ITEM.noItems]: {
      key: ITEM.noItems,
      name: () => grid.getTranslatedPhrase(PHRASE.noItems),
      disabled: true,
    },
    [ITEM.separator]: { key: SEPARATOR },
  };

  if (enabled(grid, 'copyPaste')) {
    const clipboard = grid.getPlugin<CopyPaste>('copyPaste')!;
    items[ITEM.copy] = {
      key: ITEM.copy,
      name: () => grid.getTranslatedPhrase(PHRASE.copy),
      disabled: nothingSelected,
      // Writing to the system clipboard needs a user gesture the menu has
      // already consumed, so the text is handed to the async clipboard API and
      // the caller is left to deal with a refusal.
      callback: () => void navigator.clipboard?.writeText(clipboard.getCopyableText()),
    };
    items[ITEM.cut] = {
      key: ITEM.cut,
      name: () => grid.getTranslatedPhrase(PHRASE.cut),
      disabled: nothingSelected,
      callback: () => {
        void navigator.clipboard?.writeText(clipboard.getCopyableText());
        grid.emptySelectedCells('cut');
      },
    };

    /**
     * The three copies that carry headers.
     *
     * Each is disabled when the headers it would carry are not there — a
     * grid with no column headers has nothing to copy with them, and an
     * entry that runs and produces the same text as plain copy is worse
     * than one that is visibly unavailable.
     */
    const withHeaders = (key: string, mode: CopyMode, phrase: string): MenuItem => ({
      key,
      name: () => grid.getTranslatedPhrase(phrase),
      disabled: () => nothingSelected() || !clipboard.isHeaderModeAllowed(mode),
      callback: () => void navigator.clipboard?.writeText(clipboard.getCopyableText(mode)),
    });
    items[ITEM.copyWithColumnHeaders] = withHeaders(
      ITEM.copyWithColumnHeaders,
      'with-column-headers',
      PHRASE.copyWithHeaders,
    );
    items[ITEM.copyWithColumnGroupHeaders] = withHeaders(
      ITEM.copyWithColumnGroupHeaders,
      'with-all-column-headers',
      PHRASE.copyWithGroupHeaders,
    );
    items[ITEM.copyColumnHeadersOnly] = withHeaders(
      ITEM.copyColumnHeadersOnly,
      'column-headers-only',
      PHRASE.copyHeadersOnly,
    );
  }

  if (enabled(grid, 'mergeCells')) {
    const merge = grid.getPlugin<MergeCells>('mergeCells')!;
    items[ITEM.mergeCells] = {
      key: ITEM.mergeCells,
      name: () => {
        const range = first(selection());
        return grid.getTranslatedPhrase(
          range && merge.getCoveringArea(topRow(range), startCol(range))
            ? PHRASE.unmergeCells
            : PHRASE.mergeCells,
        );
      },
      disabled: nothingSelected,
      callback: () => merge.toggleMerge(),
    };
  }

  if (enabled(grid, 'manualColumnFreeze')) {
    const freeze = grid.getPlugin<ManualColumnFreeze>('manualColumnFreeze')!;
    items[ITEM.freezeColumn] = {
      key: ITEM.freezeColumn,
      name: () => grid.getTranslatedPhrase(PHRASE.freezeColumn),
      disabled: nothingSelected,
      callback: onRange((range) => freeze.freezeColumn(startCol(range))),
    };
    items[ITEM.unfreezeColumn] = {
      key: ITEM.unfreezeColumn,
      name: () => grid.getTranslatedPhrase(PHRASE.unfreezeColumn),
      disabled: nothingSelected,
      callback: onRange((range) => freeze.unfreezeColumn(startCol(range))),
    };
  }

  if (enabled(grid, 'hiddenRows')) {
    const hidden = grid.getPlugin<HiddenRows>('hiddenRows')!;
    items[ITEM.hiddenRowsHide] = {
      key: ITEM.hiddenRowsHide,
      name: () => grid.getTranslatedPhrase(PHRASE.hideRow),
      disabled: nothingSelected,
      callback: onRange((range) => {
        const rows = Array.from({ length: rowsIn(range) }, (_, i) => topRow(range) + i);
        hidden.hide(rows);
      }),
    };
    items[ITEM.hiddenRowsShow] = {
      key: ITEM.hiddenRowsShow,
      name: () => grid.getTranslatedPhrase(PHRASE.showRow),
      callback: () => hidden.show(),
    };
  }

  if (enabled(grid, 'hiddenColumns')) {
    const hidden = grid.getPlugin<HiddenColumns>('hiddenColumns')!;
    items[ITEM.hiddenColumnsHide] = {
      key: ITEM.hiddenColumnsHide,
      name: () => grid.getTranslatedPhrase(PHRASE.hideColumn),
      disabled: nothingSelected,
      callback: onRange((range) => {
        const cols = Array.from({ length: colsIn(range) }, (_, i) => startCol(range) + i);
        hidden.hide(cols);
      }),
    };
    items[ITEM.hiddenColumnsShow] = {
      key: ITEM.hiddenColumnsShow,
      name: () => grid.getTranslatedPhrase(PHRASE.showColumn),
      callback: () => hidden.show(),
    };
  }

  if (enabled(grid, 'comments')) {
    const comments = grid.getPlugin<Comments>('comments')!;
    items[ITEM.addComment] = {
      key: ITEM.addComment,
      name: () => {
        const range = first(selection());
        return grid.getTranslatedPhrase(
          range && comments.getComment(topRow(range), startCol(range))
            ? PHRASE.editComment
            : PHRASE.addComment,
        );
      },
      disabled: nothingSelected,
      callback: onRange((range) => comments.show(topRow(range), startCol(range))),
    };
    items[ITEM.removeComment] = {
      key: ITEM.removeComment,
      name: () => grid.getTranslatedPhrase(PHRASE.removeComment),
      disabled: () => {
        const range = first(selection());
        return range === null || !comments.getComment(topRow(range), startCol(range));
      },
      callback: onRange((range) => comments.removeComment(topRow(range), startCol(range))),
    };
  }

  if (enabled(grid, 'columnSorting') || enabled(grid, 'multiColumnSorting')) {
    // `multiColumnSorting` is a subclass of `columnSorting`, so either answers
    // the same call; which one is running decides whether a second sort adds to
    // the first or replaces it.
    const sorting = (enabled(grid, 'multiColumnSorting')
      ? grid.getPlugin<ColumnSorting>('multiColumnSorting')
      : grid.getPlugin<ColumnSorting>('columnSorting'))!;
    for (const [key, name, order] of [
      [ITEM.sortAscending, 'Sort ascending', 'asc'],
      [ITEM.sortDescending, 'Sort descending', 'desc'],
    ] as const) {
      items[key] = {
        key,
        name,
        disabled: nothingSelected,
        callback: onRange((range) => sorting.sort({ column: startCol(range), sortOrder: order })),
      };
    }
  }

  if (enabled(grid, 'exportFile')) {
    const exporter = grid.getPlugin<ExportFile>('exportFile')!;
    items[ITEM.exportFile] = {
      key: ITEM.exportFile,
      name: () => grid.getTranslatedPhrase(PHRASE.exportFile),
      submenu: {
        items: [
          {
            key: 'export_file:csv',
            name: () => grid.getTranslatedPhrase(PHRASE.exportCsv),
            callback: () => exporter.downloadFile('csv', { colHeaders: true }),
          },
          {
            key: 'export_file:xlsx',
            name: () => grid.getTranslatedPhrase(PHRASE.exportXlsx),
            callback: () => exporter.downloadFile('xlsx'),
          },
        ],
      },
    };
  }

  if (enabled(grid, 'provenance')) {
    const provenance = grid.getPlugin<Provenance>('provenance')!;
    items[ITEM.provenance] = {
      key: ITEM.provenance,
      name: 'Where did this come from?',
      disabled: nothingSelected,
      callback: onRange((range) => provenance.show(topRow(range), startCol(range))),
    };
  }

  // Not a Handsontable item. It is here because the journal records who made
  // each change, and taking back an agent's work without touching your own is
  // the whole reason for recording it.
  items[ITEM.undoAgent] = {
    key: ITEM.undoAgent,
    name: 'Undo agent changes',
    hidden: () => !grid.canUndoBy('agent'),
    callback: () => grid.undoLastAgentChange(),
  };

  return items;
}

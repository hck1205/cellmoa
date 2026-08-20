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

/** Whether a plugin is present and switched on. */
function enabled(grid: Grid, name: string): boolean {
  return grid.getPlugin(name)?.isPluginEnabled() === true;
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
      name: () => grid.getTranslatedPhrase(PHRASE.rowAbove),
      disabled: nothingSelected,
      callback: (_key, ranges) => {
        const range = first(ranges);
        if (range) {
          grid.alter('insert_row', topRow(range), rowsIn(range));
        }
      },
    },
    [ITEM.rowBelow]: {
      key: ITEM.rowBelow,
      name: () => grid.getTranslatedPhrase(PHRASE.rowBelow),
      disabled: nothingSelected,
      callback: (_key, ranges) => {
        const range = first(ranges);
        if (range) {
          grid.alter('insert_row', topRow(range) + rowsIn(range), rowsIn(range));
        }
      },
    },
    [ITEM.columnLeft]: {
      key: ITEM.columnLeft,
      name: () => grid.getTranslatedPhrase(PHRASE.columnLeft),
      disabled: nothingSelected,
      callback: (_key, ranges) => {
        const range = first(ranges);
        if (range) {
          grid.alter('insert_col', startCol(range), colsIn(range));
        }
      },
    },
    [ITEM.columnRight]: {
      key: ITEM.columnRight,
      name: () => grid.getTranslatedPhrase(PHRASE.columnRight),
      disabled: nothingSelected,
      callback: (_key, ranges) => {
        const range = first(ranges);
        if (range) {
          grid.alter('insert_col', startCol(range) + colsIn(range), colsIn(range));
        }
      },
    },
    [ITEM.removeRow]: {
      key: ITEM.removeRow,
      name: () => grid.getTranslatedPhrase(PHRASE.removeRow, rowsIn(first(selection()) ?? EMPTY)),
      disabled: nothingSelected,
      callback: (_key, ranges) => {
        const range = first(ranges);
        if (range) {
          grid.alter('remove_row', topRow(range), rowsIn(range));
        }
      },
    },
    [ITEM.removeColumn]: {
      key: ITEM.removeColumn,
      name: () => grid.getTranslatedPhrase(PHRASE.removeColumn, colsIn(first(selection()) ?? EMPTY)),
      disabled: nothingSelected,
      callback: (_key, ranges) => {
        const range = first(ranges);
        if (range) {
          grid.alter('remove_col', startCol(range), colsIn(range));
        }
      },
    },
    [ITEM.clearColumn]: {
      key: ITEM.clearColumn,
      name: () => grid.getTranslatedPhrase(PHRASE.clearColumn),
      disabled: nothingSelected,
      callback: (_key, ranges) => {
        const range = first(ranges);
        if (!range) {
          return;
        }
        const changes: Array<[number, number, string]> = [];
        for (let col = startCol(range); col < startCol(range) + colsIn(range); col += 1) {
          for (let row = 0; row < grid.countRows(); row += 1) {
            changes.push([row, col, '']);
          }
        }
        grid.setDataAtCells(changes, 'contextMenu');
      },
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
        return range !== null && grid.getCellMeta(topRow(range), startCol(range))['readOnly'] === true;
      },
      callback: (_key, ranges) => {
        const range = first(ranges);
        if (!range) {
          return;
        }
        const already = grid.getCellMeta(topRow(range), startCol(range))['readOnly'] === true;
        for (let row = topRow(range); row < topRow(range) + rowsIn(range); row += 1) {
          for (let col = startCol(range); col < startCol(range) + colsIn(range); col += 1) {
            grid.setCellMeta(row, col, 'readOnly', !already);
          }
        }
        grid.render();
      },
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
                callback: (_k: string, ranges: MenuSelection[]) => {
                  const range = first(ranges);
                  if (range) {
                    grid.setAlignment(range, className);
                  }
                },
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
    const clipboard = grid.getPlugin('copyPaste') as unknown as { getCopyableText(): string };
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
  }

  if (enabled(grid, 'mergeCells')) {
    const merge = grid.getPlugin('mergeCells') as unknown as {
      toggleMerge(): void;
      getCoveringArea(row: number, col: number): unknown;
    };
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
    const freeze = grid.getPlugin('manualColumnFreeze') as unknown as {
      freezeColumn(col: number): void;
      unfreezeColumn(col: number): void;
    };
    items[ITEM.freezeColumn] = {
      key: ITEM.freezeColumn,
      name: () => grid.getTranslatedPhrase(PHRASE.freezeColumn),
      disabled: nothingSelected,
      callback: (_key, ranges) => {
        const range = first(ranges);
        if (range) {
          freeze.freezeColumn(startCol(range));
        }
      },
    };
    items[ITEM.unfreezeColumn] = {
      key: ITEM.unfreezeColumn,
      name: () => grid.getTranslatedPhrase(PHRASE.unfreezeColumn),
      disabled: nothingSelected,
      callback: (_key, ranges) => {
        const range = first(ranges);
        if (range) {
          freeze.unfreezeColumn(startCol(range));
        }
      },
    };
  }

  if (enabled(grid, 'hiddenRows')) {
    const hidden = grid.getPlugin('hiddenRows') as unknown as {
      hide(indexes: number[]): void;
      show(indexes?: number[]): void;
    };
    items[ITEM.hiddenRowsHide] = {
      key: ITEM.hiddenRowsHide,
      name: () => grid.getTranslatedPhrase(PHRASE.hideRow),
      disabled: nothingSelected,
      callback: (_key, ranges) => {
        const range = first(ranges);
        if (range) {
          const rows = Array.from({ length: rowsIn(range) }, (_, i) => topRow(range) + i);
          hidden.hide(rows);
        }
      },
    };
    items[ITEM.hiddenRowsShow] = {
      key: ITEM.hiddenRowsShow,
      name: () => grid.getTranslatedPhrase(PHRASE.showRow),
      callback: () => hidden.show(),
    };
  }

  if (enabled(grid, 'hiddenColumns')) {
    const hidden = grid.getPlugin('hiddenColumns') as unknown as {
      hide(indexes: number[]): void;
      show(indexes?: number[]): void;
    };
    items[ITEM.hiddenColumnsHide] = {
      key: ITEM.hiddenColumnsHide,
      name: () => grid.getTranslatedPhrase(PHRASE.hideColumn),
      disabled: nothingSelected,
      callback: (_key, ranges) => {
        const range = first(ranges);
        if (range) {
          const cols = Array.from({ length: colsIn(range) }, (_, i) => startCol(range) + i);
          hidden.hide(cols);
        }
      },
    };
    items[ITEM.hiddenColumnsShow] = {
      key: ITEM.hiddenColumnsShow,
      name: () => grid.getTranslatedPhrase(PHRASE.showColumn),
      callback: () => hidden.show(),
    };
  }

  if (enabled(grid, 'comments')) {
    const comments = grid.getPlugin('comments') as unknown as {
      show(row: number, col: number): void;
      removeComment(row: number, col: number): void;
      getComment(row: number, col: number): unknown;
    };
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
      callback: (_key, ranges) => {
        const range = first(ranges);
        if (range) {
          comments.show(topRow(range), startCol(range));
        }
      },
    };
    items[ITEM.removeComment] = {
      key: ITEM.removeComment,
      name: () => grid.getTranslatedPhrase(PHRASE.removeComment),
      disabled: () => {
        const range = first(selection());
        return range === null || !comments.getComment(topRow(range), startCol(range));
      },
      callback: (_key, ranges) => {
        const range = first(ranges);
        if (range) {
          comments.removeComment(topRow(range), startCol(range));
        }
      },
    };
  }

  if (enabled(grid, 'columnSorting') || enabled(grid, 'multiColumnSorting')) {
    const sorting = (grid.getPlugin('multiColumnSorting')?.isPluginEnabled() === true
      ? grid.getPlugin('multiColumnSorting')
      : grid.getPlugin('columnSorting')) as unknown as {
      sort(config: { column: number; sortOrder: 'asc' | 'desc' }): void;
    };
    for (const [key, name, order] of [
      [ITEM.sortAscending, 'Sort ascending', 'asc'],
      [ITEM.sortDescending, 'Sort descending', 'desc'],
    ] as const) {
      items[key] = {
        key,
        name,
        disabled: nothingSelected,
        callback: (_k, ranges) => {
          const range = first(ranges);
          if (range) {
            sorting.sort({ column: startCol(range), sortOrder: order });
          }
        },
      };
    }
  }

  if (enabled(grid, 'exportFile')) {
    const exporter = grid.getPlugin('exportFile') as unknown as {
      downloadFile(format: 'csv' | 'xlsx', options?: Record<string, unknown>): void;
    };
    items[ITEM.exportFile] = {
      key: ITEM.exportFile,
      name: () => grid.getTranslatedPhrase(PHRASE.exportFile),
      submenu: {
        items: [
          {
            key: 'export_file:csv',
            name: () => grid.getTranslatedPhrase(PHRASE.exportCsv),
            callback: () => exporter.downloadFile('csv', { columnHeaders: true }),
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
    const provenance = grid.getPlugin('provenance') as unknown as {
      show(row: number, col: number): void;
    };
    items[ITEM.provenance] = {
      key: ITEM.provenance,
      name: 'Where did this come from?',
      disabled: nothingSelected,
      callback: (_key, ranges) => {
        const range = first(ranges);
        if (range) {
          provenance.show(topRow(range), startCol(range));
        }
      },
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

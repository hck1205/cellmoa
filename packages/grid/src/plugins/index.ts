/**
 * The plugins.
 *
 * Importing this module registers every one of them, so a grid built after it
 * has them all available whether or not its settings switch them on.
 */

export { ColumnSorting, MultiColumnSorting, compareValues } from './columnSorting.js';
export type { SortConfig, SortOrder, SortSettings } from './columnSorting.js';

export { Filters, testCondition } from './filters.js';
export type { ColumnFilter, Condition, ConditionName, FilterValue } from './filters.js';

export { HiddenColumns, HiddenRows, TrimRows } from './hiding.js';
export type { HidingSettings } from './hiding.js';

export { ManualColumnFreeze, ManualColumnMove, ManualRowMove } from './manualMove.js';

export {
  AutoColumnSize,
  AutoRowSize,
  ManualColumnResize,
  ManualRowResize,
  StretchColumns,
} from './manualResize.js';

export { Autofill, extendSeries } from './autofill.js';
export type { AutofillSettings } from './autofill.js';

export { Comments } from './comments.js';
export type { Comment, CommentSettings } from './comments.js';

export {
  CopyPaste,
  escapeClipboardValue,
  parseClipboardText,
  parsePastedValue,
  pasteExtent,
  toClipboardHtml,
  toClipboardText,
} from './copyPaste.js';
export type { CopyPasteSettings } from './copyPaste.js';

export { MergeCells } from './mergeCells.js';
export type { MergeCellsSettings, MergedArea } from './mergeCells.js';
export * from './undoRedo.js';
export * from './search.js';
export * from './columnSummary.js';
export * from './exportFile.js';
export * from './nestedHeaders.js';
export * from './collapsibleColumns.js';
export * from './menuItems.js';
export * from './menuPlugin.js';
export * from './buildMenu.js';
export * from './contextMenu.js';
export * from './dropdownMenu.js';
export * from './dialog.js';
export * from './notification.js';
export * from './loading.js';
export * from './emptyDataState.js';
export * from './pagination.js';
export * from './customBorders.js';
export * from './moveCells.js';
export * from './scrolling.js';
export * from './selectionHandles.js';
export * from './bindRowsWithHeaders.js';
export * from './nestedRows.js';
export * from './dataProvider.js';

// The features with no Handsontable counterpart, listed apart.
export * from './cellmoa/index.js';
export * from './ownedIndexes.js';

/**
 * The phrase keys, spelled as Handsontable spells them.
 *
 * Naming them here rather than writing the strings at each use means a
 * dictionary and the code that reads it cannot drift apart without the compiler
 * noticing — and it keeps the keys identical to Handsontable's, so a dictionary
 * written for one library works in the other.
 */

export const PHRASE = {
  ok: 'Common:ok',
  cancel: 'Common:cancel',

  noItems: 'ContextMenu:items.noItems',
  rowAbove: 'ContextMenu:items.insertRowAbove',
  rowBelow: 'ContextMenu:items.insertRowBelow',
  columnLeft: 'ContextMenu:items.insertColumnOnTheLeft',
  columnRight: 'ContextMenu:items.insertColumnOnTheRight',
  removeRow: 'ContextMenu:items.removeRow',
  removeColumn: 'ContextMenu:items.removeColumn',
  undo: 'ContextMenu:items.undo',
  redo: 'ContextMenu:items.redo',
  readOnly: 'ContextMenu:items.readOnly',
  clearColumn: 'ContextMenu:items.clearColumn',

  alignment: 'ContextMenu:items.align',
  alignLeft: 'ContextMenu:items.align.left',
  alignCenter: 'ContextMenu:items.align.center',
  alignRight: 'ContextMenu:items.align.right',
  alignJustify: 'ContextMenu:items.align.justify',
  alignTop: 'ContextMenu:items.align.top',
  alignMiddle: 'ContextMenu:items.align.middle',
  alignBottom: 'ContextMenu:items.align.bottom',

  freezeColumn: 'ContextMenu:items.freezeColumn',
  unfreezeColumn: 'ContextMenu:items.unfreezeColumn',

  borders: 'ContextMenu:items.borders',
  borderTop: 'ContextMenu:items.borders.top',
  borderRight: 'ContextMenu:items.borders.right',
  borderBottom: 'ContextMenu:items.borders.bottom',
  borderLeft: 'ContextMenu:items.borders.left',
  removeBorders: 'ContextMenu:items.borders.remove',

  addComment: 'ContextMenu:items.addComment',
  editComment: 'ContextMenu:items.editComment',
  removeComment: 'ContextMenu:items.removeComment',
  readOnlyComment: 'ContextMenu:items.readOnlyComment',

  mergeCells: 'ContextMenu:items.mergeCells',
  unmergeCells: 'ContextMenu:items.unmergeCells',

  copy: 'ContextMenu:items.copy',
  copyWithHeaders: 'ContextMenu:items.copyWithHeaders',
  copyHeadersOnly: 'ContextMenu:items.copyHeadersOnly',
  cut: 'ContextMenu:items.cut',

  exportFile: 'ContextMenu:items.export',
  exportCsv: 'ContextMenu:items.exportFileCsv',
  exportXlsx: 'ContextMenu:items.exportFileXlsx',

  hideRow: 'ContextMenu:items.hideRow',
  showRow: 'ContextMenu:items.showRow',
  hideColumn: 'ContextMenu:items.hideColumn',
  showColumn: 'ContextMenu:items.showColumn',
} as const;

export type PhraseKey = (typeof PHRASE)[keyof typeof PHRASE];

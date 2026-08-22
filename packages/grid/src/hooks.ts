/**
 * The hook registry.
 *
 * Handsontable's extensibility rests on hooks: a plugin adds behaviour by
 * listening rather than by patching. The names below are the same 253 that
 * Handsontable defines, so a plugin or an integration written against it knows
 * where to attach.
 *
 * Two properties are worth stating because plugins rely on them. Handlers run
 * in the order they were added, and a `before*` hook can stop the action by
 * returning `false` — that is how a validator refuses an edit or a plugin
 * vetoes a paste.
 */

/** Every hook this grid fires. */
export const HOOK_NAMES = [
  'afterAddChild', 'afterAutofill', 'afterBeginEditing', 'afterCellMetaReset',
  'afterChange', 'afterColumnCollapse', 'afterColumnExpand', 'afterColumnFreeze',
  'afterColumnMove', 'afterColumnResize', 'afterColumnSequenceCacheUpdate', 'afterColumnSequenceChange',
  'afterColumnSort', 'afterColumnUnfreeze', 'afterContextMenuDefaultOptions', 'afterContextMenuHide',
  'afterContextMenuShow', 'afterCopy', 'afterCopyLimit', 'afterCreateCol',
  'afterCreateRow', 'afterCustomBordersUpdate', 'afterCut', 'afterDataProviderFetch',
  'afterDataProviderFetchAbort', 'afterDataProviderFetchError', 'afterDeselect', 'afterDestroy',
  'afterDetachChild', 'afterDialogFocus', 'afterDialogHide', 'afterDialogShow',
  'afterDocumentKeyDown', 'afterDrawSelection', 'afterDropdownMenuDefaultOptions', 'afterDropdownMenuHide',
  'afterDropdownMenuShow', 'afterEmptyDataStateHide', 'afterEmptyDataStateShow', 'afterFilter',
  'afterFormulasValuesUpdate', 'afterGetCellMeta', 'afterGetColHeader', 'afterGetColumnHeaderRenderers',
  'afterGetRowHeader', 'afterGetRowHeaderRenderers', 'afterHideColumns', 'afterHideRows',
  'afterInit', 'afterLanguageChange', 'afterListen', 'afterLoadData',
  'afterLoadingHide', 'afterLoadingShow', 'afterMergeCells', 'afterModifyTransformEnd',
  'afterModifyTransformFocus', 'afterModifyTransformStart', 'afterMomentumScroll', 'afterMoveCells',
  'afterNamedExpressionAdded', 'afterNamedExpressionRemoved', 'afterNotificationHide', 'afterNotificationShow',
  'afterOnCellContextMenu', 'afterOnCellCornerDblClick', 'afterOnCellCornerMouseDown', 'afterOnCellMouseDown',
  'afterOnCellMouseOut', 'afterOnCellMouseOver', 'afterOnCellMouseOverOutside', 'afterOnCellMouseUp',
  'afterOnSelectionEdgeMouseDown', 'afterOnSelectionHandleMouseDown', 'afterPageChange', 'afterPageCounterVisibilityChange',
  'afterPageNavigationVisibilityChange', 'afterPageSizeChange', 'afterPageSizeVisibilityChange', 'afterPaste',
  'afterPluginsInitialized', 'afterRedo', 'afterRedoStackChange', 'afterRefreshDimensions',
  'afterRemoveCellMeta', 'afterRemoveCol', 'afterRemoveRow', 'afterRender',
  'afterRenderer', 'afterRowMove', 'afterRowResize', 'afterRowSequenceCacheUpdate',
  'afterRowSequenceChange', 'afterRowsMutation', 'afterRowsMutationError', 'afterScroll',
  'afterScrollHorizontally', 'afterScrollVertically', 'afterSelectAll', 'afterSelectColumns',
  'afterSelectRows', 'afterSelection', 'afterSelectionByProp', 'afterSelectionEnd',
  'afterSelectionEndByProp', 'afterSelectionFocusSet', 'afterSetCellMeta', 'afterSetDataAtCell',
  'afterSetDataAtRowProp', 'afterSetSourceDataAtCell', 'afterSetTheme', 'afterSheetAdded',
  'afterSheetRemoved', 'afterSheetRenamed', 'afterTrimRow', 'afterUndo',
  'afterUndoStackChange', 'afterUnhideColumns', 'afterUnhideRows', 'afterUnlisten',
  'afterUnmergeCells', 'afterUntrimRow', 'afterUpdateData', 'afterUpdateSettings',
  'afterValidate', 'afterViewRender', 'afterViewportColumnCalculatorOverride', 'afterViewportRowCalculatorOverride',
  'beforeAddChild', 'beforeAlter', 'beforeAutofill', 'beforeBeginEditing',
  'beforeCellAlignment', 'beforeChange', 'beforeChangeRender', 'beforeColumnCollapse',
  'beforeColumnExpand', 'beforeColumnFreeze', 'beforeColumnMove', 'beforeColumnResize',
  'beforeColumnSort', 'beforeColumnUnfreeze', 'beforeColumnWrap', 'beforeCompositionStart',
  'beforeContextMenuSetItems', 'beforeContextMenuShow', 'beforeCopy', 'beforeCreateCol',
  'beforeCreateRow', 'beforeCut', 'beforeDataProviderFetch', 'beforeDetachChild',
  'beforeDialogHide', 'beforeDialogShow', 'beforeDrawBorders', 'beforeDropdownMenuSetItems',
  'beforeDropdownMenuShow', 'beforeEmptyDataStateHide', 'beforeEmptyDataStateShow', 'beforeFilter',
  'beforeGetCellMeta', 'beforeHeightChange', 'beforeHideColumns', 'beforeHideRows',
  'beforeHighlightingColumnHeader', 'beforeHighlightingRowHeader', 'beforeInit', 'beforeInitWalkontable',
  'beforeKeyDown', 'beforeLanguageChange', 'beforeLoadData', 'beforeLoadingHide',
  'beforeLoadingShow', 'beforeMergeCells', 'beforeMoveCells', 'beforeNotificationHide',
  'beforeNotificationShow', 'beforeOnCellContextMenu', 'beforeOnCellMouseDown', 'beforeOnCellMouseOut',
  'beforeOnCellMouseOver', 'beforeOnCellMouseOverOutside', 'beforeOnCellMouseUp', 'beforePageChange',
  'beforePageSizeChange', 'beforePaste', 'beforeRedo', 'beforeRedoStackChange',
  'beforeRefreshDimensions', 'beforeRemoveCellClassNames', 'beforeRemoveCellMeta', 'beforeRemoveCol',
  'beforeRemoveRow', 'beforeRender', 'beforeRenderer', 'beforeRowMove',
  'beforeRowResize', 'beforeRowWrap', 'beforeRowsMutation', 'beforeSelectAll',
  'beforeSelectColumns', 'beforeSelectRows', 'beforeSelectionFocusSet', 'beforeSelectionHighlightSet',
  'beforeSetCellMeta', 'beforeSetRangeEnd', 'beforeSetRangeStart', 'beforeSetRangeStartOnly',
  'beforeStretchingColumnWidth', 'beforeTouchScroll', 'beforeTrimRow', 'beforeUndo',
  'beforeUndoStackChange', 'beforeUnhideColumns', 'beforeUnhideRows', 'beforeUnmergeCells',
  'beforeUntrimRow', 'beforeUpdateData', 'beforeValidate', 'beforeValueRender',
  'beforeViewRender', 'beforeViewportScroll', 'beforeViewportScrollHorizontally', 'beforeViewportScrollVertically',
  'beforeWidthChange', 'construct', 'dialogFocusNextElement', 'dialogFocusPreviousElement',
  'hasExternalDataSource', 'init', 'modifyAutoColumnSizeSeed', 'modifyAutofillRange',
  'modifyColHeader', 'modifyColWidth', 'modifyColumnHeaderHeight', 'modifyColumnHeaderValue',
  'modifyCopyableRange', 'modifyData', 'modifyFiltersMultiSelectValue', 'modifyFocusOnTabNavigation',
  'modifyFocusedElement', 'modifyGetCellCoords', 'modifyGetCoordsElement', 'modifyRowData',
  'modifyRowHeader', 'modifyRowHeaderWidth', 'modifyRowHeight', 'modifyRowHeightByOverlayName',
  'modifySinglePassLayout', 'modifySourceData', 'modifyTransformEnd', 'modifyTransformFocus',
  'modifyTransformStart',
] as const;

/**
 * Hooks this grid fires that Handsontable does not have.
 *
 * They are listed apart from the ported ones so the parity count stays honest:
 * 253 is the number of Handsontable hooks, and quietly padding it with our own
 * would make the figure mean nothing.
 */
export const EXTRA_HOOK_NAMES = [
  /** The window of cells about to be drawn, before any of them is. */
  'beforeViewportRender',
  /** Asks how many rows deep the column header is. */
  'modifyColHeaderLevels',
  /** Replaces the column header's structure, for a nested header. */
  'modifyColHeaderRows',
  /** A value arriving from a loader failed `sourceDataValidator`. */
  'afterSourceDataValidate',
  /** A verification finished. */
  'afterVerify',
  /** A comparison against a snapshot finished. */
  'afterDiff',
] as const;

export type HookName = (typeof HOOK_NAMES)[number] | (typeof EXTRA_HOOK_NAMES)[number];

/** A hook handler. The return value only matters for `before*` hooks. */
export type HookHandler = (...args: any[]) => unknown;

interface Registration {
  handler: HookHandler;
  once: boolean;
  /** Set when the handler is removed while the hook is running. */
  removed?: boolean;
}

const KNOWN = new Set<string>([...HOOK_NAMES, ...EXTRA_HOOK_NAMES]);

/** Whether a name is one of the hooks this grid fires. */
export function isHookName(name: string): name is HookName {
  return KNOWN.has(name);
}

/**
 * The hooks registered on one grid.
 */
export class Hooks {
  #buckets = new Map<string, Registration[]>();

  /** Registers a handler. */
  add(name: string, handler: HookHandler): this {
    this.#bucket(name).push({ handler, once: false });
    return this;
  }

  /** Registers a handler that runs at most once. */
  addOnce(name: string, handler: HookHandler): this {
    this.#bucket(name).push({ handler, once: true });
    return this;
  }

  /**
   * Removes a handler, or every handler for a hook when none is given.
   *
   * A handler removed while its own hook is running is marked rather than
   * spliced out, so that a plugin tearing itself down inside a hook does not
   * make the loop skip the handler after it.
   */
  remove(name: string, handler?: HookHandler): this {
    const bucket = this.#buckets.get(name);
    if (!bucket) {
      return this;
    }
    for (const registration of bucket) {
      if (handler === undefined || registration.handler === handler) {
        registration.removed = true;
      }
    }
    return this;
  }

  /** Whether anything is listening to a hook. */
  has(name: string): boolean {
    return (this.#buckets.get(name) ?? []).some((r) => !r.removed);
  }

  /** How many handlers are listening, for tests and diagnostics. */
  count(name: string): number {
    return (this.#buckets.get(name) ?? []).filter((r) => !r.removed).length;
  }

  /**
   * Runs a hook, threading the first argument through the handlers.
   *
   * A handler that returns `undefined` leaves the value alone; anything else
   * replaces it. That is what lets `modifyColWidth` and its kind adjust a value
   * without every handler having to know what the one before it decided.
   */
  run<T>(name: string, value: T, ...rest: unknown[]): T {
    const bucket = this.#buckets.get(name);
    if (!bucket) {
      return value;
    }
    let current = value;
    // A copy, so a handler that adds or removes handlers does not disturb the
    // run in progress.
    for (const registration of [...bucket]) {
      if (registration.removed) {
        continue;
      }
      const result = registration.handler(current, ...rest);
      if (result !== undefined) {
        current = result as T;
      }
      if (registration.once) {
        registration.removed = true;
      }
    }
    this.#compact(name);
    return current;
  }

  /**
   * Runs a `before*` hook and reports whether the action may go ahead.
   *
   * Any handler returning `false` vetoes it, and the rest still run: a plugin
   * that needs to know an action was attempted should hear about it even when
   * another plugin has already refused.
   */
  allows(name: string, ...args: unknown[]): boolean {
    const bucket = this.#buckets.get(name);
    if (!bucket) {
      return true;
    }
    let allowed = true;
    for (const registration of [...bucket]) {
      if (registration.removed) {
        continue;
      }
      if (registration.handler(...args) === false) {
        allowed = false;
      }
      if (registration.once) {
        registration.removed = true;
      }
    }
    this.#compact(name);
    return allowed;
  }

  /** Removes every handler. */
  clear(): void {
    this.#buckets.clear();
  }

  #bucket(name: string): Registration[] {
    let bucket = this.#buckets.get(name);
    if (!bucket) {
      bucket = [];
      this.#buckets.set(name, bucket);
    }
    return bucket;
  }

  #compact(name: string): void {
    const bucket = this.#buckets.get(name);
    if (!bucket) {
      return;
    }
    const kept = bucket.filter((r) => !r.removed);
    if (kept.length === 0) {
      this.#buckets.delete(name);
    } else if (kept.length !== bucket.length) {
      this.#buckets.set(name, kept);
    }
  }
}

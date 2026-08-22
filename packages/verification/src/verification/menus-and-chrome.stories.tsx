/**
 * Menus, dialogs, toasts, and the empty state.
 *
 * Everything here is floating UI: it needs a stylesheet, a stacking context and
 * a place to go. A dialog with no backdrop and four toast stacks all landing in
 * the same corner both passed the test suite, because neither is a fact a test
 * without CSS can reach.
 */

import { useEffect } from 'react';
import { Compare, block } from '../Compare.js';

export default { title: 'Verification/Menus and chrome' };

export const ContextMenu = () => (
  <Compare
    note="Right-click a cell. The menu is built from whichever plugins are running, so the two lists differ where the features do. Try Shift+F10 as well: cellmoa has no keyboard path into either menu."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      contextMenu: true,
      comments: true,
      mergeCells: true,
      copyPaste: true,
    }}
    data={block(6, 5)}
    height={320}
  />
);

export const ColumnMenu = () => (
  <Compare
    note="Click the ▾ on a column header. The reference puts the filter panel here — condition, value list, OK and Cancel. cellmoa has no filter UI at all: the plugin is API-only."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      dropdownMenu: true,
      filters: true,
      columnSorting: true,
    }}
    data={block(6, 4)}
    height={320}
  />
);

export const ContextMenuWithChosenItems = () => (
  <Compare
    note="Only the items named, in the order named, with a separator between the groups."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      contextMenu: ['row_above', 'row_below', '---------', 'remove_row', 'make_read_only'],
    }}
    data={block(5, 3)}
    height={300}
  />
);

export const Dialog = () => (
  <Compare
    note="Both open on mount. Look at the backdrop and the accessible name: cellmoa's `background` values were `dark`/`light`/`none` where the documented ones are `solid`/`semi-transparent`, so the documented value matched no CSS and left the backdrop undimmed."
    settings={{ colHeaders: true, rowHeaders: true, dialog: true }}
    data={block(4, 4)}
    height={300}
    afterMount={{
      cellmoa: (grid) => {
        const dialog = grid.getPlugin('dialog') as unknown as {
          show(options: Record<string, unknown>): void;
        } | undefined;
        dialog?.show({
          content: 'A dialog, over a dimmed grid.',
          background: 'semi-transparent',
          a11y: { ariaLabel: 'Example dialog' },
        });
      },
    }}
  />
);

export const Notification = () => (
  <Compare
    note="An error toast that was asked to stay. cellmoa read `type` and `timeout` while the documented names are `variant` and `duration`, so a doc-written error appeared as a low-severity toast and vanished after four seconds."
    settings={{ colHeaders: true, rowHeaders: true, notification: true }}
    data={block(4, 4)}
    height={300}
    afterMount={{
      cellmoa: (grid) => {
        const toast = grid.getPlugin('notification') as unknown as {
          showMessage(options: Record<string, unknown>): string;
        } | undefined;
        toast?.showMessage({
          variant: 'error',
          duration: 0,
          title: 'Could not save',
          message: 'The server refused the change.',
        });
      },
    }}
  />
);

export const EmptyState = () => (
  <Compare
    note="No rows at all. The reference shows a title and a description from its dictionary; cellmoa hardcoded English until the seven `EmptyDataState:*` phrases — present in all 21 locales and read by nothing — were wired up."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      emptyDataState: true,
      minRows: 0,
      startRows: 0,
      startCols: 4,
    }}
    height={260}
  />
);

export const Loading = () => (
  <Compare
    note="The overlay that covers the grid while something is in flight. It counts its callers, so an unbalanced show leaves the grid covered forever — which is a bug that only looks like anything on screen."
    settings={{ colHeaders: true, rowHeaders: true, loading: true }}
    data={block(5, 4)}
    height={260}
    afterMount={{
      cellmoa: (grid) => {
        const loading = grid.getPlugin('loading') as unknown as {
          show(options?: Record<string, unknown>): void;
        } | undefined;
        loading?.show({ message: 'Loading…' });
      },
    }}
  />
);

export const Pagination = () => (
  <Compare
    note="Five rows a page. Look for the page-size selector, which cellmoa declared as `showPageSize` and drew nowhere."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      pagination: { pageSize: 5, showPageSize: true, pageSizeList: [5, 10, 20] },
    }}
    data={block(23, 4)}
    height={320}
  />
);

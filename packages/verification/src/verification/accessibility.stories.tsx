/**
 * What assistive technology is told.
 *
 * Roles and states are DOM facts, so a test can read them — but whether they
 * hang together is a question about the tree, and Ladle's a11y addon asks it
 * properly. cellmoa puts `role="grid"` on a wrapper with six `<table>` elements
 * beneath it, and an implicit `role="table"` severs the grid-to-row
 * relationship. That is the VPAT's own "Mixed table/ARIA semantics" finding,
 * reproduced.
 */

import { Compare, block } from '../Compare.js';

export default { title: 'Verification/Accessibility' };

export const Roles = () => (
  <Compare
    note="Open Ladle's a11y panel. Both should expose grid, row, columnheader, rowheader and gridcell, with `aria-rowindex` counted over the whole table rather than the drawn window."
    settings={{ colHeaders: true, rowHeaders: true, ariaTags: true }}
    data={block(6, 4)}
  />
);

export const SelectionAnnounced = () => (
  <Compare
    note="Select a range, then inspect a cell. The reference marks selected cells with `aria-selected` and the grid with `aria-multiselectable`; cellmoa emits neither, so a screen-reader user cannot tell what is selected."
    settings={{ colHeaders: true, rowHeaders: true, ariaTags: true, selectionMode: 'multiple' }}
    data={block(6, 4)}
  />
);

export const KeyboardOnly = () => (
  <Compare
    note="Tab into each grid and use only the keyboard: arrows, Ctrl+arrows, Home/End, Shift to extend, F2 to edit, Shift+F10 for the menu. cellmoa binds 35 of the 60 documented shortcuts and has no keyboard path into any menu."
    settings={{ colHeaders: true, rowHeaders: true, contextMenu: true, tabNavigation: true }}
    data={block(8, 5)}
    height={300}
  />
);

export const AriaTagsOff = () => (
  <Compare
    note="`ariaTags: false` removes the lot, for a caller wrapping the grid in their own semantics. Nothing ARIA should remain."
    settings={{ colHeaders: true, rowHeaders: true, ariaTags: false }}
    data={block(4, 4)}
  />
);

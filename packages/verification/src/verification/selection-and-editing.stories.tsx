/**
 * Selecting, editing, filling, and moving.
 *
 * These are pointer and keyboard behaviours. A test can call the method; only a
 * browser can tell you the handle was under the pointer, the border was drawn,
 * or the editor opened where the cell is.
 */

import { Compare, block } from '../Compare.js';

export default { title: 'Verification/Selection and editing' };

export const SelectionAndFillHandle = () => (
  <Compare
    note="Drag across cells, then drag the small square at the bottom-right of the selection. The reference draws pill handles on each edge for `selectionHandles`; cellmoa draws one corner square that performs an autofill, which is a different feature under the same name."
    settings={{ colHeaders: true, rowHeaders: true, fillHandle: true }}
    data={block(6, 5)}
  />
);

export const MultipleSelection = () => (
  <Compare
    note="Ctrl-click (or Cmd-click) several ranges. The reference gives each layer a cumulative class so the overlap darkens; cellmoa draws one flat selected state."
    settings={{ colHeaders: true, rowHeaders: true, selectionMode: 'multiple' }}
    data={block(6, 5)}
  />
);

export const Autofill = () => (
  <Compare
    note="Select the first two cells of a column and drag the fill handle down. A series should continue rather than repeat. `1, 2` continues; `Mon, Tue` continues if the list is known."
    settings={{ colHeaders: true, rowHeaders: true, fillHandle: true }}
    data={[
      ['1', 'Mon', 'x'],
      ['2', 'Tue', 'x'],
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ]}
  />
);

export const MergedCells = () => (
  <Compare
    note="Two merges declared in the settings. The reference clears the cells a merge covers; a merge configured as an object (`{ virtualized, cells }`) left cellmoa's plugin switched off entirely until recently."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      mergeCells: [
        { row: 1, col: 1, rowspan: 2, colspan: 2 },
        { row: 0, col: 3, rowspan: 1, colspan: 2 },
      ],
    }}
    data={block(5, 5)}
  />
);

export const CustomBorders = () => (
  <Compare
    note="Borders drawn per cell edge. These are pure paint — nothing about them is visible to a test that cannot read a stylesheet."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      customBorders: [
        {
          range: { from: { row: 1, col: 1 }, to: { row: 2, col: 2 } },
          top: { width: 2, color: '#dc2626' },
          bottom: { width: 2, color: '#dc2626' },
          left: { width: 2, color: '#dc2626' },
          right: { width: 2, color: '#dc2626' },
        },
      ],
    }}
    data={block(4, 4)}
  />
);

export const Comments = () => (
  <Compare
    note="A commented cell is marked in the corner, and hovering shows the note. Both the marker and the box are styling."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      comments: true,
      cell: [{ row: 1, col: 1, comment: { value: 'checked against the invoice' } }],
    }}
    data={block(4, 4)}
  />
);

export const ReadOnlyPaste = () => (
  <Compare
    note="Copy a block and paste it over the locked column. A read-only cell refuses quietly and the rest of the paste still lands — the failure mode to look for is the whole paste being dropped."
    settings={{
      colHeaders: ['free', 'locked', 'free'],
      rowHeaders: true,
      columns: [{}, { readOnly: true }, {}],
    }}
    data={block(5, 3)}
  />
);

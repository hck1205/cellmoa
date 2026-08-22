/**
 * Two people editing the same sheet.
 */

import { Compare, block } from '../Compare.js';

export default { title: 'Verification/Data management' };

export const Collaboration = () => (
  <Compare
    note="The page is about applying a remote change without clobbering a local one. cellmoa's engine goes further than the guide asks: every commit carries an actor and a revision, and a write against a stale revision is refused rather than merged — which is what `afterRevisionConflict` reports. What it does not have is the grid-side guard the page's own example uses, `getActiveEditor().isOpened()`, so a remote change can land on a cell somebody is editing. Type into a cell in each and watch what a programmatic write does to it."
    settings={{ colHeaders: true, rowHeaders: true }}
    data={block(5, 4)}
    afterMount={{
      cellmoa: (grid) => {
        // A change arriving from somewhere else, a moment later.
        setTimeout(() => grid.setDataAtCell(0, 0, 'from elsewhere', 'api'), 2500);
      },
      handsontable: (hot) => {
        setTimeout(() => hot.setDataAtCell(0, 0, 'from elsewhere'), 2500);
      },
    }}
  />
);

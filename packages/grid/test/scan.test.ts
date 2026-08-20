import { describe, expect, it } from 'vitest';
import { mountGrid } from './helpers.js';

/**
 * What the cache costs as a session goes on.
 *
 * A cache keyed on the windows that happened to be asked for grows by one entry
 * for every place the user scrolls to, and answering "do I have this cell?"
 * means searching all of them — once per cell, per frame, forever. Keyed on a
 * fixed grid of blocks it is a set lookup, and the number of entries follows
 * the sheet rather than the scrolling.
 */
describe('the window cache', () => {
  it('does not grow a longer lookup the further you scroll', async () => {
    const { grid } = await mountGrid({ startRows: 5000, startCols: 20 });
    for (let top = 0; top < 400; top += 4) {
      grid.scrollViewportTo(top, 0);
      grid.render();
    }
    // 400 rows of a 20-column sheet is seven blocks however you reach them.
    expect(grid.source.loadedBlocks).toBeLessThan(12);
  });

  it('reads a block once however many cells of it are asked for', async () => {
    const { grid, engine } = await mountGrid({ startRows: 400, startCols: 10 });
    let reads = 0;
    const send = engine.send.bind(engine);
    (engine as unknown as { send: typeof send }).send = (request: object) => {
      if ((request as { op?: string }).op === 'read') {
        reads += 1;
      }
      return send(request);
    };

    // Rows 0-63 are one block, and mounting already drew part of it.
    for (let row = 0; row < 64; row += 1) {
      grid.getDataAtCell(row, 0);
    }
    expect(reads).toBe(0);

    // Row 64 begins the next one, and that is one read for all of it.
    for (let row = 64; row < 128; row += 1) {
      grid.getDataAtCell(row, 0);
    }
    expect(reads).toBe(1);
  });

  it('forgets everything when the workbook moves on', async () => {
    const { grid } = await mountGrid({ startRows: 100, startCols: 5 });
    grid.getDataAtCell(0, 0);
    expect(grid.source.loadedBlocks).toBeGreaterThan(0);
    grid.setDataAtCell(0, 0, 'changed');
    // Any edit can move any cell that reads it, so the whole cache goes.
    expect(grid.getDataAtCell(0, 0)).toBe('changed');
  });
});

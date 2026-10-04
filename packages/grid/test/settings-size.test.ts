import { describe, expect, it } from 'vitest';
import { mountGrid } from './helpers.js';

describe('grid size', () => {
  it('leaves the size to the container by default', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3 });
    expect(grid.view?.wrapper.style.width).toBe('');
    expect(grid.view?.wrapper.style.height).toBe('');
  });

  it('reads a number as pixels and a string as CSS', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3, width: 500, height: 300 });
    expect(grid.view?.wrapper.style.width).toBe('500px');
    expect(grid.view?.wrapper.style.height).toBe('300px');

    const relative = await mountGrid({ startRows: 3, startCols: 3, width: '75%', height: '50vh' });
    expect(relative.grid.view?.wrapper.style.width).toBe('75%');
    expect(relative.grid.view?.wrapper.style.height).toBe('50vh');
  });

  it('caps itself at the parent when told not to overflow', async () => {
    const { grid, container } = await mountGrid({
      startRows: 3,
      startCols: 3,
      width: 5000,
      preventOverflow: 'horizontal',
    });
    Object.defineProperty(container, 'clientWidth', { value: 600, configurable: true });
    grid.render();
    expect(grid.view?.wrapper.style.maxWidth).toBe('600px');
    expect(grid.view?.wrapper.style.maxHeight).toBe('');
  });
});

describe('header size', () => {
  it('takes the header sizes from the settings', async () => {
    const { grid } = await mountGrid({
      startRows: 3,
      startCols: 3,
      rowHeaderWidth: 80,
      columnHeaderHeight: 40,
    });
    expect(grid.getRowHeaderWidth()).toBe(80);
    expect(grid.getColHeaderHeight()).toBe(40);
    expect((grid.view?.root.querySelector('th.cm-row-header') as HTMLElement).style.width).toBe(
      '80px',
    );
  });

  it('gives each level of a nested header its own height', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      nestedHeaders: [[{ label: 'group', colspan: 2 }], ['a', 'b']],
      columnHeaderHeight: [50, 25],
    });
    expect(grid.getColHeaderHeight(0)).toBe(50);
    expect(grid.getColHeaderHeight(1)).toBe(25);
    const rows = grid.view?.root.querySelectorAll('tr.cm-header');
    expect((rows?.[0] as HTMLElement).style.height).toBe('50px');
    expect((rows?.[1] as HTMLElement).style.height).toBe('25px');
  });

  it('reads `minRowHeights` as the alias it is', async () => {
    // Handsontable's own docs call it an alias for `rowHeights`, not a floor.
    const { grid } = await mountGrid({ startRows: 3, startCols: 2, minRowHeights: 44 });
    expect(grid.getRowHeight(0)).toBe(44);
  });
});

describe('class names', () => {
  it('puts the caller’s classes on the grid', async () => {
    const { grid } = await mountGrid({ startRows: 2, startCols: 2, tableClassName: 'mine yours' });
    expect(grid.view?.root.classList.contains('mine')).toBe(true);
    expect(grid.view?.root.classList.contains('yours')).toBe(true);

    grid.updateSettings({ tableClassName: 'theirs' });
    // The old ones go, without disturbing the grid's own classes.
    expect(grid.view?.root.classList.contains('mine')).toBe(false);
    expect(grid.view?.root.classList.contains('theirs')).toBe(true);
    expect(grid.view?.root.classList.contains('cm-grid')).toBe(true);
  });

  it('marks the row and column the selection is on, when asked', async () => {
    const { grid } = await mountGrid({
      startRows: 3,
      startCols: 3,
      currentRowClassName: 'row-here',
      currentColClassName: 'col-here',
    });
    grid.selectCell(1, 1);
    expect(grid.view?.elementAt(1, 0)?.classList.contains('row-here')).toBe(true);
    expect(grid.view?.elementAt(0, 1)?.classList.contains('col-here')).toBe(true);
    expect(grid.view?.elementAt(0, 0)?.classList.contains('row-here')).toBe(false);
  });

  it('tells a header the selection passes through from one that is selected', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3 });
    grid.selectCell(1, 1);
    const header = (col: number) =>
      grid.view?.root.querySelector(`th.cm-col-header[data-col="${col}"]`);
    // The selection is in column 1, but the column is not selected.
    expect(header(1)?.classList.contains('ht__highlight')).toBe(true);
    expect(header(1)?.classList.contains('ht__active_highlight')).toBe(false);

    grid.selectColumns(1);
    expect(header(1)?.classList.contains('ht__active_highlight')).toBe(true);
  });

  it('adds `headerClassName` to every column header', async () => {
    const { grid } = await mountGrid({ startRows: 2, startCols: 2, headerClassName: 'htRight' });
    grid.selectCell(0, 0);
    expect(
      grid.view?.root.querySelector('th.cm-col-header')?.classList.contains('htRight'),
    ).toBe(true);
  });

  it('truncates with an ellipsis when asked', async () => {
    const { grid } = await mountGrid({ startRows: 2, startCols: 2, textEllipsis: true });
    expect(grid.view?.elementAt(0, 0)?.classList.contains('cm-ellipsis')).toBe(true);
  });
});

describe('virtualization', () => {
  it('draws a window, not the whole sheet', async () => {
    const { grid } = await mountGrid({ startRows: 500, startCols: 40 });
    const drawn = grid.view!.root.querySelectorAll('td').length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(500 * 40);
  });

  it('draws every row when virtualization is switched off', async () => {
    const { grid } = await mountGrid({ startRows: 60, startCols: 3, renderAllRows: true });
    const rows = new Set(
      [...grid.view!.root.querySelectorAll('td')].map((td) => td.dataset['row']),
    );
    expect(rows.size).toBe(60);
  });

  it('draws every column likewise', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 40, renderAllColumns: true });
    const cols = new Set(
      [...grid.view!.root.querySelectorAll('td')].map((td) => td.dataset['col']),
    );
    expect(cols.size).toBe(40);
  });

  it('takes a wider margin when asked for one', async () => {
    const near = await mountGrid({ startRows: 200, startCols: 3 });
    const far = await mountGrid({ startRows: 200, startCols: 3, viewportRowRenderingOffset: 40 });
    const count = (m: Awaited<ReturnType<typeof mountGrid>>) =>
      new Set([...m.grid.view!.root.querySelectorAll('td')].map((td) => td.dataset['row'])).size;
    expect(count(far)).toBeGreaterThan(count(near));
  });
});

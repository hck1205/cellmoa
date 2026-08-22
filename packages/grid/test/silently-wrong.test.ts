/**
 * The defects that looked like features.
 *
 * Each of these had the right name and the wrong behaviour, which is the kind
 * a user cannot report because there is nothing to see. They came out of a
 * walk through the reference documentation, and every one is pinned here
 * against the page that specifies it.
 */

import { describe, expect, it, vi } from 'vitest';
import { makeGrid, mountGrid } from './helpers.js';

describe('a validator given as a pattern', () => {
  it('is actually run', async () => {
    // It used to fall through to the *type's* validator, so a text column with
    // a pattern ran `textValidator` and accepted everything.
    const grid = await makeGrid({ startRows: 2, startCols: 1 });
    grid.setCellMeta(0, 0, 'validator', /^\d+$/);

    expect((await grid.validateCell(0, 0, '123')).valid).toBe(true);
    expect((await grid.validateCell(0, 0, 'abc')).valid).toBe(false);
  });

  it('says what the value failed to match', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 1 });
    grid.setCellMeta(0, 0, 'validator', /^[a-z]+$/);
    const verdict = await grid.validateCell(0, 0, 'Nope1');
    expect(verdict.reason).toContain('/^[a-z]+$/');
  });

  it('does not carry `lastIndex` from one cell to the next', async () => {
    // A `g` pattern is stateful. Reusing it across cells would pass, fail,
    // pass, fail down the column for no reason a reader could see.
    const grid = await makeGrid({ startRows: 3, startCols: 1 });
    grid.setCellMeta(0, 0, 'validator', /\d+/g);
    for (const value of ['1', '22', '333']) {
      expect((await grid.validateCell(0, 0, value)).valid).toBe(true);
    }
  });

  it('marks the cell invalid through the ordinary write path', async () => {
    const grid = await makeGrid({ startRows: 2, startCols: 1, allowInvalid: true });
    grid.setCellMeta(0, 0, 'validator', /^\d+$/);
    grid.beginEditing(0, 0, 'letters');
    grid.closeEditor(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(grid.isCellInvalid(0, 0)).toBe(true);
  });
});

describe('clicking a checkbox', () => {
  it('toggles it', async () => {
    // The one gesture the type exists for. The input was drawn with
    // `tabIndex = -1` and nothing listened for a click anywhere.
    const { grid } = await mountGrid({ startRows: 2, startCols: 1 });
    grid.setCellMeta(0, 0, 'type', 'checkbox');
    grid.render();

    const box = grid.getCellElement(0, 0)?.querySelector('.cm-checkbox') as HTMLElement;
    expect(box, 'the checkbox is drawn').toBeTruthy();
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    // The engine stores the boolean and shows it as `TRUE`, which is what the
    // toggle compares against — the cell's value, not its text.
    expect(grid.getCell(0, 0)?.value).toBe(true);

    grid.render();
    const again = grid.getCellElement(0, 0)?.querySelector('.cm-checkbox') as HTMLElement;
    again.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(grid.getCell(0, 0)?.value).toBe(false);
  });

  it('uses the templates the column configured', async () => {
    const { grid } = await mountGrid({ startRows: 1, startCols: 1 });
    grid.setCellMetaObject(0, 0, {
      type: 'checkbox',
      checkedTemplate: 'yes',
      uncheckedTemplate: 'no',
    });
    grid.render();
    const box = grid.getCellElement(0, 0)?.querySelector('.cm-checkbox') as HTMLElement;
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(grid.getDataAtCell(0, 0)).toBe('yes');
  });

  it('selects the cell it was clicked in', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 1 });
    grid.setCellMeta(1, 0, 'type', 'checkbox');
    grid.render();
    const box = grid.getCellElement(1, 0)?.querySelector('.cm-checkbox') as HTMLElement;
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(grid.getSelectedLast()?.[0]).toBe(1);
  });

  it('refuses a read-only cell', async () => {
    const { grid } = await mountGrid({ startRows: 1, startCols: 1 });
    grid.setCellMetaObject(0, 0, { type: 'checkbox', readOnly: true });
    grid.render();
    const box = grid.getCellElement(0, 0)?.querySelector('.cm-checkbox') as HTMLElement;
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(grid.getDataAtCell(0, 0)).toBe('');
  });
});

describe('the default layout direction', () => {
  it('inherits `dir` from the page, which is what `inherit` means', async () => {
    // The default is `inherit`, and it resolved to left-to-right whatever the
    // page said. An Arabic page that configured nothing — exactly what the
    // guide tells it to do — got a silently mis-laid-out grid.
    document.documentElement.setAttribute('dir', 'rtl');
    try {
      const grid = await makeGrid({ startRows: 1, startCols: 1 });
      expect(grid.isRtl()).toBe(true);
      expect(grid.getDirectionFactor()).toBe(-1);
    } finally {
      document.documentElement.removeAttribute('dir');
    }
  });

  it('inherits from an ancestor, not only from the document', async () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('dir', 'rtl');
    document.body.appendChild(wrapper);
    try {
      const { grid, container } = await mountGrid({ startRows: 1, startCols: 1 });
      wrapper.appendChild(container);
      expect(grid.isRtl()).toBe(true);
    } finally {
      wrapper.remove();
    }
  });

  it('lets an explicit setting win over the page', async () => {
    document.documentElement.setAttribute('dir', 'rtl');
    try {
      const grid = await makeGrid({ startRows: 1, startCols: 1, layoutDirection: 'ltr' });
      expect(grid.isRtl()).toBe(false);
    } finally {
      document.documentElement.removeAttribute('dir');
    }
  });

  it('is left to right when the page says nothing', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 1 });
    expect(grid.isRtl()).toBe(false);
  });
});

describe('the action names `alter` accepts', () => {
  it('takes the spellings every sample written since v13 uses', async () => {
    // `insert_row`/`insert_col` were replaced in v13. The new names fell
    // through every branch and did nothing at all — not an error, nothing.
    const grid = await makeGrid({ startRows: 3, startCols: 3 });
    grid.alter('insert_row_above', 1);
    expect(grid.countRows()).toBe(4);
    grid.alter('insert_col_start', 1);
    expect(grid.countCols()).toBe(4);
  });

  it('still takes the old spellings a v12 configuration carries', async () => {
    const grid = await makeGrid({ startRows: 3, startCols: 3 });
    grid.alter('insert_row', 1);
    grid.alter('insert_col', 1);
    expect(grid.countRows()).toBe(4);
    expect(grid.countCols()).toBe(4);
  });

  it('puts a row below where "below" says, and above where "above" says', async () => {
    const grid = await makeGrid({ startRows: 3, startCols: 1 });
    grid.setDataAtCells([
      [0, 0, 'a'],
      [1, 0, 'b'],
      [2, 0, 'c'],
    ]);

    grid.alter('insert_row_above', 1);
    expect(grid.getDataAtCell(1, 0)).toBe('');
    expect(grid.getDataAtCell(2, 0)).toBe('b');

    const below = await makeGrid({ startRows: 3, startCols: 1 });
    below.setDataAtCells([
      [0, 0, 'a'],
      [1, 0, 'b'],
      [2, 0, 'c'],
    ]);
    below.alter('insert_row_below', 1);
    expect(below.getDataAtCell(1, 0)).toBe('b');
    expect(below.getDataAtCell(2, 0)).toBe('');
  });

  it('says so when the name is not an action, rather than doing nothing', async () => {
    const warnings: unknown[] = [];
    const grid = await makeGrid({ startRows: 2, startCols: 2 });
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      warnings.push(args[0]);
    });
    grid.alter('insert_rows' as never, 0);
    spy.mockRestore();

    expect(grid.countRows()).toBe(2);
    expect(String(warnings[0])).toContain('is not an action');
  });
});

describe('what the `cells` function can override', () => {
  it('wins over `setCellMeta`, as the guide says three times it does', async () => {
    // It ran before the per-cell layer, so conditional formatting worked until
    // a cell also had explicit meta — and then stopped for that cell alone.
    const grid = await makeGrid({
      startRows: 2,
      startCols: 2,
      cells: () => ({ className: 'from-cells' }),
    });
    grid.setCellMeta(0, 0, 'className', 'from-setCellMeta');
    expect(grid.getCellMeta(0, 0).className).toBe('from-cells');
  });

  it('wins over the `cell` array too', async () => {
    const grid = await makeGrid({
      startRows: 2,
      startCols: 2,
      cell: [{ row: 0, col: 0, readOnly: true }],
      cells: () => ({ readOnly: false }),
    });
    expect(grid.getCellMeta(0, 0).readOnly).toBe(false);
  });

  it('still wins over a column, which it always did', async () => {
    const grid = await makeGrid({
      startRows: 2,
      startCols: 2,
      columns: [{ readOnly: true }, {}],
      cells: (row: number) => (row === 1 ? { readOnly: false } : {}),
    });
    expect(grid.getCellMeta(0, 0).readOnly).toBe(true);
    expect(grid.getCellMeta(1, 0).readOnly).toBe(false);
  });

  it('receives the column’s name, which it never used to', async () => {
    // The signature said `(row, col, prop?)` and the third argument was always
    // `undefined`, so a `cells` written against the documented shape could not
    // tell one column from another by name.
    const seen: Array<string | number | undefined> = [];
    const grid = await makeGrid({
      startRows: 1,
      startCols: 2,
      colHeaders: ['id', 'name'],
      cells: (_row: number, _col: number, prop?: string | number) => {
        seen.push(prop);
        return {};
      },
    });
    grid.getCellMeta(0, 0);
    grid.getCellMeta(0, 1);
    expect(seen).toContain('id');
    expect(seen).toContain('name');
  });
});

describe('the checkbox toggle and the renderer', () => {
  it('agree about what counts as checked', async () => {
    // Two copies of the same comparison: the renderer compared exactly and the
    // toggle compared case-blind, so `'YES'` against `checkedTemplate: 'yes'`
    // drew unchecked and then unchecked itself when pressed.
    const { grid } = await mountGrid({ startRows: 1, startCols: 1 });
    grid.setCellMetaObject(0, 0, {
      type: 'checkbox',
      checkedTemplate: 'yes',
      uncheckedTemplate: 'no',
    });
    grid.setDataAtCell(0, 0, 'YES');
    grid.render();

    const box = grid.getCellElement(0, 0)?.querySelector('.cm-checkbox') as HTMLInputElement;
    expect(box.checked, 'the renderer reads it as checked').toBe(true);

    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(grid.getDataAtCell(0, 0), 'so pressing it unchecks').toBe('no');
  });

  it('type-checks the spellings the guide uses', async () => {
    // `intl-date` resolved at run time but was a compile error, so a
    // configuration copied from the guide did not build.
    const grid = await makeGrid({ startRows: 1, startCols: 1, columns: [{ type: 'intl-date' }] });
    expect(grid.getCellMeta(0, 0).type).toBe('intl-date');
  });
});

describe('clicking a column header', () => {
  it('sorts, which it could not do through a real DOM before', async () => {
    // `cellAt` needs both `data-row` and `data-col`; a header carries one, so
    // the mousedown handler returned before firing anything. Click-to-sort
    // listens for `afterOnCellMouseDown` and was therefore unreachable — the
    // plugin's own tests drove the hook directly and could not see this.
    const { grid } = await mountGrid({ startRows: 3, startCols: 1, columnSorting: true });
    grid.setDataAtCells([
      [0, 0, 'c'],
      [1, 0, 'a'],
      [2, 0, 'b'],
    ]);
    grid.render();

    const header = grid.view!.root.querySelector('th.cm-col-header') as HTMLElement;
    expect(header, 'the header is drawn').toBeTruthy();
    header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(grid.getDataAtCell(0, 0)).toBe('a');
  });

  it('selects the column', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3 });
    grid.render();
    const headers = grid.view!.root.querySelectorAll('th.cm-col-header');
    (headers[1] as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(grid.getSelectedLast()).toEqual([0, 1, 2, 1]);
  });

  it('reports the header as row -1, the way the reference numbers one', async () => {
    const seen: Array<{ row: number; col: number }> = [];
    const { grid } = await mountGrid({ startRows: 2, startCols: 2 });
    grid.addHook('afterOnCellMouseDown', (_v: unknown, _e: unknown, coords: never) => {
      seen.push(coords);
    });
    grid.render();
    const header = grid.view!.root.querySelector('th.cm-col-header') as HTMLElement;
    header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(seen).toEqual([{ row: -1, col: 0 }]);
  });

  it('lets a hook refuse the click', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 2 });
    grid.addHook('beforeOnCellMouseDown', () => false);
    grid.render();
    const header = grid.view!.root.querySelector('th.cm-col-header') as HTMLElement;
    header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(grid.getSelectedLast()).toBeUndefined();
  });
});

describe('a plugin that does its work once, and data given in the settings', () => {
  it('pages the data it was given, not the empty sheet it was built on', async () => {
    // `#createPlugins()` ran before `#loadInitialData()`, so every plugin whose
    // whole job happens in `onEnable` — the first page, a summary, an initial
    // sort — read a grid with no rows in it. The documented declarative
    // configuration came up wrong and corrected itself on the first click.
    const grid = await makeGrid({
      colHeaders: true,
      pagination: { pageSize: 3 },
      data: [['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7'], ['8']],
    });
    expect(grid.countRows()).toBe(3);
  });

  it('totals the data it was given', async () => {
    const grid = await makeGrid({
      colHeaders: true,
      data: [['1'], ['2'], ['3']],
      columnSummary: [
        { sourceColumn: 0, type: 'sum', destinationRow: 3, destinationColumn: 0 },
      ],
    });
    expect(grid.getDataAtCell(3, 0)).toBe('6');
  });

  it('applies an initial sort to the data it was given', async () => {
    const grid = await makeGrid({
      colHeaders: true,
      data: [['pear'], ['apple'], ['fig']],
      columnSorting: { initialConfig: { column: 0, sortOrder: 'asc' } },
    });
    expect(grid.getDataAtCell(0, 0)).toBe('apple');
  });
});

describe('the settings a cell type brings with it', () => {
  it('does not let a masked value be copied', async () => {
    // The reference's password type carries `copyable: false`; ours carried
    // nothing, because a type could hold only a renderer, an editor and a
    // validator. A mask that copies in the clear is not a mask.
    const grid = await makeGrid({ startRows: 1, startCols: 1, columns: [{ type: 'password' }] });
    grid.setDataAtCell(0, 0, 'secret');
    expect(grid.getCellMeta(0, 0).copyable).toBe(false);
    expect(grid.getCopyableData(0, 0)).toBe('');
  });

  it('makes a dropdown strict and unfiltered without being told', async () => {
    const grid = await makeGrid({
      startRows: 1,
      startCols: 1,
      columns: [{ type: 'dropdown', source: ['red', 'green'] }],
    });
    expect(grid.getCellMeta(0, 0).strict).toBe(true);
    expect(grid.getCellMeta(0, 0).filter).toBe(false);
  });

  it('is a default, so a caller who says otherwise wins', async () => {
    const grid = await makeGrid({
      startRows: 1,
      startCols: 1,
      columns: [{ type: 'password', copyable: true }],
    });
    expect(grid.getCellMeta(0, 0).copyable).toBe(true);
  });

  it('leaves a type with nothing to carry exactly as it was', async () => {
    const grid = await makeGrid({ startRows: 1, startCols: 1, columns: [{ type: 'text' }] });
    expect(grid.getCellMeta(0, 0).copyable).not.toBe(false);
  });
});

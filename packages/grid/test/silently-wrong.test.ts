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

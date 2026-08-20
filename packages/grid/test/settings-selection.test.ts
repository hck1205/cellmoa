import { describe, expect, it } from 'vitest';
import { mountGrid } from './helpers.js';

describe('how much of the selection is shown', () => {
  it('shows the focused cell, the range and the headers by default', async () => {
    const { grid } = await mountGrid({ startRows: 4, startCols: 4 });
    grid.selectCell(0, 0, 1, 1);
    expect(grid.view?.elementAt(0, 0)?.classList.contains('cm-current')).toBe(true);
    expect(grid.view?.elementAt(1, 1)?.classList.contains('cm-selected')).toBe(true);
    expect(
      grid.view?.root.querySelector('th.cm-col-header[data-col="0"]')?.classList.contains('ht__highlight'),
    ).toBe(true);
  });

  it('switches off exactly the layer it is told to', async () => {
    const area = await mountGrid({ startRows: 4, startCols: 4, disableVisualSelection: 'area' });
    area.grid.selectCell(0, 0, 1, 1);
    // The focused cell is still marked; the range around it is not.
    expect(area.grid.view?.elementAt(0, 0)?.classList.contains('cm-current')).toBe(true);
    expect(area.grid.view?.elementAt(1, 1)?.classList.contains('cm-selected')).toBe(false);

    const header = await mountGrid({ startRows: 4, startCols: 4, disableVisualSelection: 'header' });
    header.grid.selectCell(0, 0);
    expect(header.grid.view?.elementAt(0, 0)?.classList.contains('cm-current')).toBe(true);
    expect(
      header.grid.view?.root
        .querySelector('th.cm-col-header[data-col="0"]')
        ?.classList.contains('ht__highlight'),
    ).toBe(false);
  });

  it('takes a list of layers', async () => {
    const { grid } = await mountGrid({
      startRows: 4,
      startCols: 4,
      disableVisualSelection: ['current', 'area'],
    });
    grid.selectCell(0, 0, 1, 1);
    expect(grid.view?.elementAt(0, 0)?.classList.contains('cm-current')).toBe(false);
    expect(grid.view?.elementAt(1, 1)?.classList.contains('cm-selected')).toBe(false);
    // Headers were not in the list, so they still show.
    expect(
      grid.view?.root.querySelector('th.cm-col-header[data-col="0"]')?.classList.contains('ht__highlight'),
    ).toBe(true);
  });

  it('shows nothing at all for `true`', async () => {
    const { grid } = await mountGrid({ startRows: 4, startCols: 4, disableVisualSelection: true });
    grid.selectCell(0, 0, 1, 1);
    expect(grid.view?.elementAt(0, 0)?.classList.contains('cm-current')).toBe(false);
    expect(grid.view?.elementAt(1, 1)?.classList.contains('cm-selected')).toBe(false);
  });
});

describe('clicking away', () => {
  it('drops the selection by default', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3 });
    grid.selectCell(1, 1);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(grid.selection.highlight).toBeNull();
  });

  it('keeps it when told to', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3, outsideClickDeselects: false });
    grid.selectCell(1, 1);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(grid.selection.highlight).toEqual({ row: 1, col: 1 });
  });

  it('asks a function which clicks count', async () => {
    const { grid } = await mountGrid({
      startRows: 3,
      startCols: 3,
      outsideClickDeselects: (target: HTMLElement) => target.tagName !== 'BUTTON',
    });
    grid.selectCell(1, 1);
    const button = document.createElement('button');
    const div = document.createElement('div');
    document.body.append(button, div);

    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(grid.selection.highlight).toEqual({ row: 1, col: 1 });
    div.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(grid.selection.highlight).toBeNull();
  });

  it('keeps the selection when the click was inside the grid', async () => {
    // The click redraws the table, so the cell that was clicked is gone by the
    // time the event reaches the document. Reading the dispatch path rather
    // than the live tree is what keeps this from being an outside click.
    const { grid } = await mountGrid({ startRows: 3, startCols: 3 });
    grid.view!.elementAt(1, 1)!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(grid.selection.highlight).toEqual({ row: 1, col: 1 });
  });

  it('stops listening once destroyed', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3 });
    grid.selectCell(1, 1);
    grid.destroy();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    // No throw: a destroyed grid must not still be answering the page.
    expect(() => outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))).not.toThrow();
  });
});

describe('where Enter goes', () => {
  it('moves down by default', async () => {
    const { grid } = await mountGrid({ startRows: 4, startCols: 4, enterBeginsEditing: false });
    grid.selectCell(0, 0);
    grid.view?.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(grid.selection.highlight).toEqual({ row: 1, col: 0 });
  });

  it('moves where `enterMoves` says, and back with shift', async () => {
    const { grid } = await mountGrid({
      startRows: 4,
      startCols: 4,
      enterBeginsEditing: false,
      enterMoves: { row: 0, col: 1 },
    });
    grid.selectCell(0, 0);
    const press = (shift = false) =>
      grid.view?.root.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: shift, bubbles: true }),
      );
    press();
    expect(grid.selection.highlight).toEqual({ row: 0, col: 1 });
    press(true);
    expect(grid.selection.highlight).toEqual({ row: 0, col: 0 });
  });

  it('follows `enterMoves` after committing an edit too', async () => {
    const { grid } = await mountGrid({
      startRows: 4,
      startCols: 4,
      enterMoves: { row: 0, col: 1 },
    });
    grid.selectCell(0, 0);
    grid.beginEditing(0, 0, 'typed');
    grid.closeEditor(true, { row: 0, col: 1 });
    expect(grid.getDataAtCell(0, 0)).toBe('typed');
    expect(grid.selection.highlight).toEqual({ row: 0, col: 1 });
  });
});

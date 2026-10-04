import { describe, expect, it, vi } from 'vitest';
import type { ContextMenu } from '../src/plugins/index.js';
import { ITEM } from '../src/plugins/index.js';
import { mountGrid } from './helpers.js';

describe('what the grid may be told to do', () => {
  it('hides the insert and remove commands the settings forbid', async () => {
    const { grid } = await mountGrid({
      startRows: 3,
      startCols: 3,
      contextMenu: true,
      allowInsertRow: false,
      allowRemoveColumn: false,
    });
    grid.selectCell(0, 0);
    const keys = (grid.getPlugin('contextMenu') as unknown as ContextMenu)
      .getItems()
      .map((item) => item.key);
    expect(keys).not.toContain(ITEM.rowAbove);
    expect(keys).not.toContain(ITEM.removeColumn);
    expect(keys).toContain(ITEM.columnLeft);
    expect(keys).toContain(ITEM.removeRow);
  });

  it('refuses the same change through the API, not only through the menu', async () => {
    // A command hidden from the menu that an API call could still perform
    // would make the setting a suggestion.
    const { grid } = await mountGrid({ startRows: 3, startCols: 3, allowRemoveRow: false });
    grid.setDataAtCell(0, 0, 'stays');
    grid.alter('remove_row', 0);
    expect(grid.getDataAtCell(0, 0)).toBe('stays');
    expect(grid.countRows()).toBe(3);
  });
});

describe('column headers', () => {
  it('lets one column name itself without rewriting the whole list', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 3,
      colHeaders: ['A', 'B', 'C'],
      columns: [{}, { title: 'Renamed' }, {}],
    });
    expect(grid.getColHeader(0)).toBe('A');
    expect(grid.getColHeader(1)).toBe('Renamed');
  });
});

describe('frozen rows at the bottom', () => {
  it('draws them from the end of the sheet', async () => {
    const { grid } = await mountGrid({ startRows: 20, startCols: 3, fixedRowsBottom: 2 });
    const bottom = grid.view?.root.querySelector('.cm-pane--bottom');
    expect(bottom).not.toBeNull();
    const rows = [...(bottom?.querySelectorAll('td') ?? [])].map((td) => td.dataset['row']);
    // The last two rows, wherever the sheet currently ends.
    expect(new Set(rows)).toEqual(new Set(['18', '19']));
  });

  it('follows the data when the sheet grows', async () => {
    const { grid } = await mountGrid({ startRows: 5, startCols: 3, fixedRowsBottom: 1 });
    grid.setDataAtCell(9, 0, 'new last row');
    const rows = [
      ...(grid.view?.root.querySelectorAll('.cm-pane--bottom td') ?? []),
    ].map((td) => (td as HTMLElement).dataset['row']);
    expect(new Set(rows)).toEqual(new Set([String(grid.countRows() - 1)]));
  });

  it('draws nothing when none are frozen', async () => {
    const { grid } = await mountGrid({ startRows: 5, startCols: 3 });
    expect(grid.view?.root.querySelectorAll('.cm-pane--bottom td')).toHaveLength(0);
  });
});

describe('mapping values in and out', () => {
  it('shows what `valueGetter` and `valueFormatter` produce', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [
        {
          valueGetter: (value: string) => Number(value) * 2,
          valueFormatter: (value: unknown) => `${value} units`,
        },
      ],
    });
    grid.setDataAtCell(0, 0, '5');
    expect(grid.getDataAtCell(0, 0)).toBe('10 units');
    // The workbook still holds what was written.
    expect(grid.getSourceDataAtCell(0, 0)).toBe('5');
  });

  it('stores what `valueParser` and `valueSetter` produce', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      columns: [
        {
          valueParser: (value: string) => value.replace(/ units$/, ''),
          valueSetter: (value: string) => value.toUpperCase(),
        },
      ],
    });
    grid.beginEditing(0, 0, 'abc units');
    grid.closeEditor(true);
    expect(grid.getSourceDataAtCell(0, 0)).toBe('ABC');
  });
});

describe('settings that report rather than act', () => {
  it('says a licence key is not needed rather than ignoring it', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await mountGrid({ startRows: 2, startCols: 2, licenseKey: 'non-commercial-and-evaluation' });
      expect(info.mock.calls.flat().join(' ')).toContain('needs no licence key');
    } finally {
      info.mockRestore();
    }
  });

  it('says `formulas: false` does not switch the engine off', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const { grid } = await mountGrid({ startRows: 2, startCols: 2, formulas: false });
      expect(info.mock.calls.flat().join(' ')).toContain('calculates formulas natively');
      // And it does not, in fact, switch off.
      grid.setDataAtCell(0, 0, '=1+1');
      expect(grid.getDataAtCell(0, 0)).toBe('2');
    } finally {
      info.mockRestore();
    }
  });

  it('says the array-binding settings do not apply', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await mountGrid({ startRows: 2, startCols: 2, dataSchema: { name: null } });
      expect(info.mock.calls.flat().join(' ')).toContain('addressed rather than keyed');
    } finally {
      info.mockRestore();
    }
  });

  it('warns about source data a validator rejects, without dropping it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { grid } = await mountGrid({
        startRows: 2,
        startCols: 2,
        sourceDataValidator: (value: unknown) => String(value).length < 5,
        sourceDataWarningMessage: 'too long',
      });
      grid.setDataAtCell(0, 0, 'far too long');
      // Reported, not refused: a wrong write from code is not made right by
      // vanishing.
      expect(grid.getDataAtCell(0, 0)).toBe('far too long');
      expect(warn.mock.calls.flat().join(' ')).toContain('too long');
      expect(warn.mock.calls.flat().join(' ')).toContain('A1');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('initial state', () => {
  it('is a base the settings are laid over', async () => {
    const { grid } = await mountGrid({
      startRows: 2,
      startCols: 2,
      initialState: { fixedRowsTop: 2, colHeaders: false },
      colHeaders: true,
    });
    // The explicit setting wins over the initial state; what it does not
    // mention comes from the state.
    expect(grid.hasColHeaders()).toBe(true);
    expect(grid.getSettings().fixedRowsTop).toBe(2);
  });

  it('is ignored by updateSettings', async () => {
    const { grid } = await mountGrid({ startRows: 2, startCols: 2, rowHeaders: true });
    grid.updateSettings({ initialState: { rowHeaders: false } });
    expect(grid.hasRowHeaders()).toBe(true);
  });
});

describe('the core stylesheet', () => {
  it('puts the rules the layout needs into the page', async () => {
    document.getElementById('cm-core-css')?.remove();
    await mountGrid({ startRows: 2, startCols: 2 });
    expect(document.getElementById('cm-core-css')).not.toBeNull();
  });

  it('stays out when told to', async () => {
    document.getElementById('cm-core-css')?.remove();
    await mountGrid({ startRows: 2, startCols: 2, injectCoreCss: false });
    expect(document.getElementById('cm-core-css')).toBeNull();
  });
});

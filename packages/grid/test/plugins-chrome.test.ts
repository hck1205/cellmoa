import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/engine.js';
import { Grid } from '../src/grid.js';
import type {
  AutoRowSize,
  Dialog,
  EmptyDataState,
  Loading,
  Notification,
  StretchColumns,
} from '../src/plugins/index.js';
import { DEFAULT_EMPTY_MESSAGE, DEFAULT_FILTERED_MESSAGE } from '../src/plugins/index.js';
import { mountGrid } from './helpers.js';
import type { MountOptions } from './helpers.js';

/** This suite's table, whose size several of its assertions count on. */
const makeGrid = (settings: MountOptions = {}) =>
  mountGrid({ startRows: 4, startCols: 3, ...settings }).then((m) => m.grid);

describe('the dialog plugin', () => {
  it('opens over the grid and takes the keyboard', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('dialog') as unknown as Dialog;
    plugin.show({ content: 'Are you sure?' });

    const box = grid.view?.root.querySelector('.cm-dialog');
    expect(box?.textContent).toBe('Are you sure?');
    expect(plugin.isVisible()).toBe(true);
    expect(grid.view?.root.querySelector('[aria-modal="true"]')).not.toBeNull();
    expect(box?.ownerDocument.activeElement).toBe(box);
  });

  it('closes on Escape and on a click outside the box', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('dialog') as unknown as Dialog;

    plugin.show({ content: 'x' });
    plugin.element?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(plugin.isVisible()).toBe(false);

    plugin.show({ content: 'x' });
    plugin.element?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(plugin.isVisible()).toBe(false);
  });

  it('stays put when it was asked not to be closable', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('dialog') as unknown as Dialog;
    plugin.show({ content: 'x', closable: false });
    plugin.element?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(plugin.isVisible()).toBe(true);
  });

  it('changes what an open dialog says', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('dialog') as unknown as Dialog;
    plugin.show({ content: 'before' });
    plugin.update({ content: 'after' });
    expect(grid.view?.root.querySelector('.cm-dialog')?.textContent).toBe('after');
  });

  it('reads a dismissed confirmation as "no"', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('dialog') as unknown as Dialog;
    const answers: boolean[] = [];

    plugin.showConfirm('Delete?', (yes) => answers.push(yes));
    plugin.hide();
    expect(answers).toEqual([false]);

    plugin.showConfirm('Delete?', (yes) => answers.push(yes));
    const buttons = [...(plugin.element?.querySelectorAll('button') ?? [])];
    (buttons.find((b) => b.textContent === 'OK') as HTMLButtonElement).click();
    expect(answers).toEqual([false, true]);
  });

  it('takes HTML only when asked for it', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('dialog') as unknown as Dialog;
    plugin.show({ content: '<b>bold</b>' });
    expect(grid.view?.root.querySelector('.cm-dialog b')).toBeNull();
    plugin.show({ content: '<b>bold</b>', contentType: 'html' });
    expect(grid.view?.root.querySelector('.cm-dialog b')?.textContent).toBe('bold');
  });
});

describe('the notification plugin', () => {
  it('shows messages side by side rather than replacing them', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('notification') as unknown as Notification;
    plugin.showMessage({ message: 'first', timeout: 0 });
    plugin.showMessage({ message: 'second', timeout: 0, type: 'error' });

    expect(plugin.getQueueSize()).toBe(2);
    expect(grid.view?.root.querySelectorAll('.cm-notification')).toHaveLength(2);
    expect(grid.view?.root.querySelector('.cm-notification--error')).not.toBeNull();
  });

  it('replaces a message shown again under the same id', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('notification') as unknown as Notification;
    plugin.showMessage({ id: 'save', message: 'saving', timeout: 0 });
    plugin.showMessage({ id: 'save', message: 'saved', timeout: 0 });
    expect(plugin.getQueueSize()).toBe(1);
    expect(grid.view?.root.querySelector('.cm-notification-text')?.textContent).toBe('saved');
  });

  it('takes a message down by id, and all of them at once', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('notification') as unknown as Notification;
    const first = plugin.showMessage({ message: 'a', timeout: 0 });
    plugin.showMessage({ message: 'b', timeout: 0 });
    plugin.hide(first);
    expect(plugin.isVisible(first)).toBe(false);
    expect(plugin.isVisible()).toBe(true);
    plugin.hideAll();
    expect(plugin.isVisible()).toBe(false);
  });

  it('goes by itself after its timeout', async () => {
    vi.useFakeTimers();
    try {
      const grid = await makeGrid();
      const plugin = grid.getPlugin('notification') as unknown as Notification;
      plugin.showMessage({ message: 'brief', timeout: 1000 });
      expect(plugin.isVisible()).toBe(true);
      vi.advanceTimersByTime(1001);
      expect(plugin.isVisible()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes when its button is pressed', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('notification') as unknown as Notification;
    plugin.showMessage({ message: 'x', timeout: 0 });
    (grid.view?.root.querySelector('.cm-notification-close') as HTMLButtonElement).click();
    expect(plugin.isVisible()).toBe(false);
  });
});

describe('the loading plugin', () => {
  it('counts its callers so the first to finish does not uncover the second', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('loading') as unknown as Loading;
    plugin.show({ message: 'opening' });
    plugin.show({ message: 'recalculating' });
    expect(plugin.depth).toBe(2);

    plugin.hide();
    expect(plugin.isVisible()).toBe(true);
    plugin.hide();
    expect(plugin.isVisible()).toBe(false);
  });

  it('does not go below zero when hidden more often than shown', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('loading') as unknown as Loading;
    plugin.hide();
    plugin.hide();
    plugin.show();
    expect(plugin.isVisible()).toBe(true);
    plugin.hide();
    expect(plugin.isVisible()).toBe(false);
  });

  it('uncovers the grid even when the work throws', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('loading') as unknown as Loading;
    await expect(
      plugin.during(async () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    expect(plugin.isVisible()).toBe(false);
  });

  it('shows the message it was given', async () => {
    const grid = await makeGrid();
    const plugin = grid.getPlugin('loading') as unknown as Loading;
    plugin.show({ message: 'Opening workbook…' });
    expect(grid.view?.root.querySelector('.cm-loading-message')?.textContent).toBe(
      'Opening workbook…',
    );
  });
});

describe('the emptyDataState plugin', () => {
  it('says nothing while there are rows', async () => {
    const grid = await makeGrid({ emptyDataState: true });
    expect((grid.getPlugin('emptyDataState') as unknown as EmptyDataState).getReason()).toBeNull();
    expect(grid.view?.root.querySelector('.cm-empty-state')).toBeNull();
  });

  it('tells an empty table from one a filter emptied', async () => {
    const grid = await makeGrid({ emptyDataState: true, startRows: 0, minRows: 0 });
    const plugin = grid.getPlugin('emptyDataState') as unknown as EmptyDataState;
    expect(plugin.getReason()).toBe('empty');
    expect(plugin.getMessage('empty')).toBe(DEFAULT_EMPTY_MESSAGE);

    const filtered = await makeGrid({ emptyDataState: true, minRows: 0, startRows: 3 });
    filtered.setDataAtCell(0, 0, 'x');
    filtered.rowIndex.trim([0, 1, 2]);
    const filteredPlugin = filtered.getPlugin('emptyDataState') as unknown as EmptyDataState;
    expect(filteredPlugin.getReason()).toBe('filtered');
    expect(filteredPlugin.getMessage('filtered')).toBe(DEFAULT_FILTERED_MESSAGE);
  });

  it('shows the message it was configured with', async () => {
    const grid = await makeGrid({
      emptyDataState: { emptyMessage: 'Nothing here yet' },
      startRows: 0,
      minRows: 0,
    });
    (grid.getPlugin('emptyDataState') as unknown as EmptyDataState).refresh();
    expect(grid.view?.root.querySelector('.cm-empty-state')?.textContent).toBe('Nothing here yet');
  });

  it('hands the element to a renderer of your own', async () => {
    const grid = await makeGrid({
      emptyDataState: {
        contentRenderer: (element: HTMLElement, reason: string) => {
          const button = element.ownerDocument.createElement('button');
          button.textContent = `add data (${reason})`;
          element.appendChild(button);
        },
      },
      startRows: 0,
      minRows: 0,
    });
    (grid.getPlugin('emptyDataState') as unknown as EmptyDataState).refresh();
    expect(grid.view?.root.querySelector('.cm-empty-state button')?.textContent).toBe(
      'add data (empty)',
    );
  });
});

describe('sizing plugins', () => {
  it('makes a row as tall as its tallest cell needs', async () => {
    const grid = await makeGrid({ autoRowSize: true });
    grid.setDataAtCell(0, 0, 'one line');
    grid.setDataAtCell(1, 0, 'line one\nline two\nline three');
    const plugin = grid.getPlugin('autoRowSize') as unknown as AutoRowSize;
    plugin.recalculate();

    expect(plugin.countLines(1)).toBe(3);
    expect(grid.getRowHeight(1)).toBe(grid.getRowHeight(0) * 3);
  });

  it('leaves a row someone dragged alone', async () => {
    const grid = await makeGrid({ autoRowSize: true, manualRowResize: true });
    grid.setRowHeight(0, 90);
    (grid.getPlugin('autoRowSize') as unknown as AutoRowSize).recalculate();
    expect(grid.getRowHeight(0)).toBe(90);
  });

  it('gives the spare width to the last column', async () => {
    const grid = await makeGrid({ stretchH: 'last', autoColumnSize: false }, 600);
    const plugin = grid.getPlugin('stretchColumns') as unknown as StretchColumns;
    const before = grid.getColWidth(2);
    plugin.recalculate();
    expect(grid.getColWidth(2)).toBeGreaterThan(before);
    expect(grid.getColWidth(0)).toBe(before);
    // The stretch is computed from the unstretched widths, so running it again
    // gives the same answer rather than compounding.
    const stretched = grid.getColWidth(2);
    plugin.recalculate();
    expect(grid.getColWidth(2)).toBe(stretched);
  });

  it('shares the spare width out in proportion', async () => {
    const grid = await makeGrid({ stretchH: 'all', autoColumnSize: false }, 600);
    const plugin = grid.getPlugin('stretchColumns') as unknown as StretchColumns;
    plugin.recalculate();
    // Every column grew, and they all started the same width so they stay equal.
    expect(grid.getColWidth(0)).toBe(grid.getColWidth(1));
    expect(grid.getColWidth(0)).toBeGreaterThan(50);
  });

  it('gives the widths back when it is switched off', async () => {
    const grid = await makeGrid({ stretchH: 'last', autoColumnSize: false }, 600);
    const before = grid.getColWidth(2);
    const plugin = grid.getPlugin('stretchColumns') as unknown as StretchColumns;
    plugin.recalculate();
    grid.updateSettings({ stretchH: 'none' });
    expect(grid.getColWidth(2)).toBe(before);
  });

  it('turns both axes on when `manualResize` is asked for', async () => {
    const grid = await makeGrid({ manualResize: true });
    expect(grid.isPluginEnabled('manualRowResize')).toBe(true);
    expect(grid.isPluginEnabled('manualColumnResize')).toBe(true);
  });
});

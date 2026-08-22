/**
 * The dialog family, against the API its documentation describes.
 *
 * These four plugins are the ones a caller reaches for when something has gone
 * wrong, so an option that is read under a different name than it is written is
 * worse here than anywhere else: the toast that was asked to stay and shout
 * comes out quiet and brief, and nobody finds out until the error is missed.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Dialog, EmptyDataState, Loading, Notification } from '../src/plugins/index.js';
import { makeGrid } from './helpers.js';
import type { MountOptions } from './helpers.js';

const mount = (settings: MountOptions = {}) =>
  makeGrid({ startRows: 4, startCols: 3, ...settings });

const notificationOf = (grid: Awaited<ReturnType<typeof mount>>) =>
  grid.getPlugin('notification') as unknown as Notification;
const dialogOf = (grid: Awaited<ReturnType<typeof mount>>) =>
  grid.getPlugin('dialog') as unknown as Dialog;
const emptyOf = (grid: Awaited<ReturnType<typeof mount>>) =>
  grid.getPlugin('emptyDataState') as unknown as EmptyDataState;

describe('what a notification option means', () => {
  it('reads the documented spelling of the severity and the timing', async () => {
    vi.useFakeTimers();
    try {
      const grid = await mount();
      const plugin = notificationOf(grid);
      plugin.showMessage({ message: 'could not save', variant: 'error', duration: 0 });

      const toast = grid.view?.overlay.querySelector('.cm-notification');
      expect(toast?.classList.contains('cm-notification--error')).toBe(true);
      expect(toast?.getAttribute('role')).toBe('alert');
      expect(toast?.getAttribute('aria-live')).toBe('assertive');

      // `duration: 0` asked it to stay, and staying is the whole reason to say so.
      vi.advanceTimersByTime(60_000);
      expect(plugin.isVisible()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still reads the older spelling, so callers written against it keep working', async () => {
    vi.useFakeTimers();
    try {
      const grid = await mount();
      const plugin = notificationOf(grid);
      const calls: string[] = [];
      plugin.showMessage({
        message: 'could not load',
        type: 'error',
        timeout: 0,
        actions: [{ label: 'Refetch', onClick: () => calls.push('refetch') }],
      });

      expect(grid.view?.overlay.querySelector('.cm-notification--error')).not.toBeNull();
      vi.advanceTimersByTime(60_000);
      expect(plugin.isVisible()).toBe(true);

      (grid.view?.overlay.querySelector('.cm-notification-action') as HTMLButtonElement).click();
      expect(calls).toEqual(['refetch']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a title above the message and calls an action back', async () => {
    const grid = await mount();
    const plugin = notificationOf(grid);
    const calls: string[] = [];
    plugin.showMessage({
      title: 'Sync failed',
      message: 'The service is unavailable.',
      variant: 'error',
      duration: 0,
      actions: [{ label: 'Retry', type: 'primary', callback: () => calls.push('retry') }],
    });

    expect(grid.view?.overlay.querySelector('.cm-notification-title')?.textContent).toBe(
      'Sync failed',
    );
    expect(grid.view?.overlay.querySelector('.cm-notification-text')?.textContent).toBe(
      'The service is unavailable.',
    );
    (grid.view?.overlay.querySelector('.cm-notification-action') as HTMLButtonElement).click();
    expect(calls).toEqual(['retry']);
  });

  it('names the close button in the grid’s language', async () => {
    const grid = await mount({ language: 'de-DE' });
    notificationOf(grid).showMessage({ message: 'x', duration: 0 });
    expect(
      grid.view?.overlay.querySelector('.cm-notification-close')?.getAttribute('aria-label'),
    ).toBe('Schließen');
  });
});

describe('where a notification goes', () => {
  it('keeps a stack per corner', async () => {
    const grid = await mount();
    const plugin = notificationOf(grid);
    plugin.showMessage({ message: 'a', position: 'top-start', duration: 0 });
    plugin.showMessage({ message: 'b', position: 'top-start', duration: 0 });
    plugin.showMessage({ message: 'c', position: 'bottom-end', duration: 0 });

    const stacks = grid.view?.overlay.querySelectorAll('.cm-notifications');
    expect(stacks).toHaveLength(2);
    const topStart = grid.view?.overlay.querySelector(
      '.cm-notifications[data-position="top-start"]',
    );
    expect(topStart?.querySelectorAll('.cm-notification')).toHaveLength(2);
  });

  it('puts a toast that named no corner in the bottom end one', async () => {
    const grid = await mount();
    notificationOf(grid).showMessage({ message: 'a', duration: 0 });
    expect(
      grid.view?.overlay.querySelector('.cm-notifications')?.getAttribute('data-position'),
    ).toBe('bottom-end');
  });

  it('queues past the stack limit and mounts the queued one when room appears', async () => {
    const grid = await mount({ notification: { stackLimit: 2 } });
    const plugin = notificationOf(grid);
    const first = plugin.showMessage({ message: 'a', duration: 0 });
    plugin.showMessage({ message: 'b', duration: 0 });
    const third = plugin.showMessage({ message: 'c', duration: 0 });

    expect(grid.view?.overlay.querySelectorAll('.cm-notification')).toHaveLength(2);
    expect(plugin.getQueueSize()).toBe(1);
    expect(plugin.isVisible(third)).toBe(false);

    plugin.hide(first);
    expect(plugin.getQueueSize()).toBe(0);
    expect(plugin.isVisible(third)).toBe(true);
    expect(grid.view?.overlay.querySelectorAll('.cm-notification')).toHaveLength(2);
  });

  it('empties the queue as well as the screen when told to hide everything', async () => {
    const grid = await mount({ notification: { stackLimit: 1 } });
    const plugin = notificationOf(grid);
    plugin.showMessage({ message: 'a', duration: 0 });
    plugin.showMessage({ message: 'b', duration: 0 });
    expect(plugin.getQueueSize()).toBe(1);

    plugin.hideAll();
    expect(plugin.getQueueSize()).toBe(0);
    expect(plugin.isVisible()).toBe(false);
  });
});

describe('refusing a notification', () => {
  it('cancels the whole call when beforeNotificationShow says no', async () => {
    const grid = await mount({ notification: { stackLimit: 1 } });
    const plugin = notificationOf(grid);
    grid.hooks.add('beforeNotificationShow', () => false);

    expect(plugin.showMessage({ message: 'a', duration: 0 })).toBe('');
    expect(plugin.isVisible()).toBe(false);
    expect(plugin.getQueueSize()).toBe(0);
  });

  it('keeps the toast up, and stops its clock, when beforeNotificationHide says no', async () => {
    vi.useFakeTimers();
    try {
      const grid = await mount();
      const plugin = notificationOf(grid);
      const id = plugin.showMessage({ message: 'a', duration: 1000 });
      grid.hooks.add('beforeNotificationHide', () => false);

      plugin.hide(id);
      expect(plugin.isVisible(id)).toBe(true);

      // The veto has to stop the timer too, or the toast it saved goes anyway.
      vi.advanceTimersByTime(5000);
      expect(plugin.isVisible(id)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('what a dialog option means', () => {
  it('takes the documented background variants, and defaults to solid', async () => {
    const grid = await mount();
    const plugin = dialogOf(grid);
    plugin.show({ content: 'x' });
    expect(plugin.element?.getAttribute('data-background')).toBe('solid');

    plugin.show({ content: 'x', background: 'semi-transparent' });
    expect(plugin.element?.getAttribute('data-background')).toBe('semi-transparent');
  });

  it('puts the animation and content-background flags where CSS can see them', async () => {
    const grid = await mount();
    const plugin = dialogOf(grid);
    plugin.show({ content: 'x', animation: false, contentBackground: false });
    expect(plugin.element?.getAttribute('data-animation')).toBe('off');
    const box = plugin.element?.querySelector('.cm-dialog');
    expect(box?.getAttribute('data-content-background')).toBe('false');
  });

  it('renders a template with its title, description and buttons', async () => {
    const grid = await mount();
    const plugin = dialogOf(grid);
    const calls: string[] = [];
    plugin.show({
      template: {
        type: 'confirm',
        title: 'Increase the price by:',
        description: 'Pick an amount.',
        buttons: [
          { text: '$100', type: 'secondary', callback: () => calls.push('100') },
          { text: '$200', type: 'secondary', callback: () => calls.push('200') },
        ],
      },
    });

    expect(plugin.element?.querySelector('.cm-dialog-title')?.textContent).toBe(
      'Increase the price by:',
    );
    expect(plugin.element?.querySelector('.cm-dialog-description')?.textContent).toBe(
      'Pick an amount.',
    );
    const buttons = [...(plugin.element?.querySelectorAll('.cm-dialog-buttons button') ?? [])];
    expect(buttons.map((b) => b.textContent)).toEqual(['$100', '$200']);
    (buttons[1] as HTMLButtonElement).click();
    expect(calls).toEqual(['200']);
  });
});

describe('the dialog’s accessible name', () => {
  it('has one even when nothing was configured', async () => {
    const grid = await mount();
    dialogOf(grid).show({ content: 'x' });
    const overlay = grid.view?.overlay.querySelector('.cm-dialog-overlay');
    expect(overlay?.getAttribute('role')).toBe('dialog');
    expect(overlay?.getAttribute('aria-label')).toBe('Dialog');
  });

  it('takes the role and the references it was given', async () => {
    const grid = await mount();
    dialogOf(grid).show({
      content: '<h2 id="t">Title</h2><p id="d">Description</p>',
      contentType: 'html',
      a11y: {
        role: 'alertdialog',
        ariaLabel: 'ignored',
        ariaLabelledby: 't',
        ariaDescribedby: 'd',
      },
    });
    const overlay = grid.view?.overlay.querySelector('.cm-dialog-overlay');
    expect(overlay?.getAttribute('role')).toBe('alertdialog');
    expect(overlay?.getAttribute('aria-labelledby')).toBe('t');
    expect(overlay?.getAttribute('aria-describedby')).toBe('d');
    // A label and a reference to one cannot both win; the reference does.
    expect(overlay?.getAttribute('aria-label')).toBeNull();
  });
});

describe('the dialog’s ready-made shapes', () => {
  it('takes an alert as a title and a description, and calls back on OK', async () => {
    const grid = await mount();
    const plugin = dialogOf(grid);
    const calls: string[] = [];
    plugin.showAlert({ title: 'Alert', description: 'Something happened.' }, () =>
      calls.push('ok'),
    );

    expect(plugin.element?.querySelector('.cm-dialog-title')?.textContent).toBe('Alert');
    expect(plugin.element?.querySelector('.cm-dialog-description')?.textContent).toBe(
      'Something happened.',
    );
    const buttons = [...(plugin.element?.querySelectorAll('button') ?? [])];
    (buttons.find((b) => b.textContent === 'OK') as HTMLButtonElement).click();
    expect(calls).toEqual(['ok']);
    expect(plugin.isVisible()).toBe(false);
  });

  it('takes a confirmation as a message and two callbacks', async () => {
    const grid = await mount();
    const plugin = dialogOf(grid);
    const calls: string[] = [];

    plugin.showConfirm(
      'Undo the last action?',
      () => calls.push('yes'),
      () => calls.push('no'),
    );
    const yes = [...(plugin.element?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === 'OK',
    );
    (yes as HTMLButtonElement).click();
    expect(calls).toEqual(['yes']);

    plugin.showConfirm(
      'Undo the last action?',
      () => calls.push('yes'),
      () => calls.push('no'),
    );
    plugin.hide();
    expect(calls).toEqual(['yes', 'no']);
  });
});

describe('the loading overlay in another language', () => {
  it('takes its title from the dictionary rather than from the source', async () => {
    const grid = await mount({ language: 'de-DE' });
    (grid.getPlugin('loading') as unknown as Loading).show();
    expect(grid.view?.overlay.querySelector('.cm-loading-message')?.textContent).toBe('Lädt...');
  });
});

describe('what an empty grid says', () => {
  it('says it in a title and a description, both translated', async () => {
    const grid = await mount({
      emptyDataState: true,
      language: 'de-DE',
      startRows: 0,
      minRows: 0,
    });
    emptyOf(grid).refresh();
    const state = grid.view?.root.querySelector('.cm-empty-state');
    expect(state?.querySelector('.cm-empty-state-title')?.textContent).toBe(
      'Keine Daten verfügbar',
    );
    expect(state?.querySelector('.cm-empty-state-description')?.textContent).toBe(
      'Es gibt noch nichts anzuzeigen.',
    );
  });

  it('says something else when a filter is what emptied it', async () => {
    const grid = await mount({ emptyDataState: true, filters: true, minRows: 0, startRows: 3 });
    grid.setDataAtCell(0, 0, 'a');
    grid.setDataAtCell(1, 0, 'b');
    grid.setDataAtCell(2, 0, 'c');
    const filters = grid.getPlugin('filters') as unknown as {
      addCondition: (column: number, name: string, args?: unknown[]) => void;
      filter: () => void;
      isFiltered: () => boolean;
    };
    filters.addCondition(0, 'eq', ['nothing matches this']);
    filters.filter();

    const plugin = emptyOf(grid);
    expect(plugin.getReason()).toBe('filtered');
    const state = grid.view?.root.querySelector('.cm-empty-state');
    expect(state?.querySelector('.cm-empty-state-title')?.textContent).toBe('No results found');
    expect(state?.querySelector('.cm-empty-state-description')?.textContent).toBe(
      'It looks like your current filters are hiding all results.',
    );

    const reset = state?.querySelector('.cm-empty-state-buttons button') as HTMLButtonElement;
    expect(reset.textContent).toBe('Reset filters');
    reset.click();
    expect(filters.isFiltered()).toBe(false);
    expect(grid.countRows()).toBe(3);
  });

  it('offers no reset button when there is no filters plugin to reset', async () => {
    const grid = await mount({ emptyDataState: true, minRows: 0, startRows: 3 });
    grid.rowIndex.trim([0, 1, 2]);
    emptyOf(grid).refresh();
    expect(emptyOf(grid).getReason()).toBe('filtered');
    expect(grid.view?.root.querySelector('.cm-empty-state-buttons')).toBeNull();
  });

  it('says it is loading while the overlay is up', async () => {
    const grid = await mount({
      emptyDataState: true,
      loading: true,
      startRows: 0,
      minRows: 0,
    });
    (grid.getPlugin('loading') as unknown as Loading).show();
    emptyOf(grid).refresh();
    expect(emptyOf(grid).getReason()).toBe('loading');
    expect(grid.view?.root.querySelector('.cm-empty-state-title')?.textContent).toBe(
      'Loading data',
    );
  });

  it('takes the message it was configured with, as a value or as a function', async () => {
    const calls: string[] = [];
    const grid = await mount({
      emptyDataState: {
        message: {
          title: 'No data available',
          description: 'Please add some data to get started.',
          buttons: [
            { text: 'Add Sample Data', type: 'primary', callback: () => calls.push('add') },
          ],
        },
      },
      startRows: 0,
      minRows: 0,
    });
    emptyOf(grid).refresh();
    expect(grid.view?.root.querySelector('.cm-empty-state-title')?.textContent).toBe(
      'No data available',
    );
    (grid.view?.root.querySelector('.cm-empty-state-buttons button') as HTMLButtonElement).click();
    expect(calls).toEqual(['add']);

    const byReason = await mount({
      emptyDataState: {
        message: (source: string) => ({ title: `nothing (${source})` }),
      },
      startRows: 0,
      minRows: 0,
    });
    emptyOf(byReason).refresh();
    expect(byReason.view?.root.querySelector('.cm-empty-state-title')?.textContent).toBe(
      'nothing (empty)',
    );
  });
});

describe('the empty state’s hooks', () => {
  it('reports itself going up and coming down', async () => {
    const seen: string[] = [];
    // Rows to begin with, so the overlay goes up while the test is watching
    // rather than during the plugin's own start-up.
    const grid = await mount({ emptyDataState: true, startRows: 2, minRows: 0 });
    grid.hooks.add('afterEmptyDataStateShow', (_value: unknown, reason: unknown) => {
      seen.push(`show:${String(reason)}`);
    });
    grid.hooks.add('afterEmptyDataStateHide', () => {
      seen.push('hide');
    });

    grid.alter('remove_row', 0, 2);
    emptyOf(grid).refresh();
    expect(seen).toEqual(['show:empty']);

    grid.alter('insert_row_above', 0, 1);
    emptyOf(grid).refresh();
    expect(seen).toEqual(['show:empty', 'hide']);
  });

  it('does not go up when beforeEmptyDataStateShow says no', async () => {
    const grid = await mount({ emptyDataState: true, startRows: 2, minRows: 0 });
    grid.hooks.add('beforeEmptyDataStateShow', () => false);
    grid.alter('remove_row', 0, 2);
    emptyOf(grid).refresh();
    expect(grid.view?.root.querySelector('.cm-empty-state')).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ShortcutContext, ShortcutManager, combinationOf, normalizeCombination } from '../src/shortcuts.js';

function press(key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, ...modifiers, cancelable: true });
}

describe('combination handling', () => {
  it('normalises order, case and spacing', () => {
    expect(normalizeCombination('Ctrl+Shift+A', false)).toBe('control+shift+a');
    expect(normalizeCombination('shift + control + a', false)).toBe('control+shift+a');
    expect(normalizeCombination('A', false)).toBe('a');
  });

  it('maps `mod` to the platform modifier', () => {
    expect(normalizeCombination('mod+a', false)).toBe('control+a');
    expect(normalizeCombination('mod+a', true)).toBe('meta+a');
  });

  it('reads a combination off an event', () => {
    expect(combinationOf(press('a'))).toBe('a');
    expect(combinationOf(press('A', { ctrlKey: true, shiftKey: true }))).toBe('control+shift+a');
    expect(combinationOf(press('ArrowDown'))).toBe('arrowdown');
  });
});

describe('a shortcut context', () => {
  it('runs what matches and prevents the default', () => {
    const context = new ShortcutContext('grid', false);
    const callback = vi.fn();
    context.addShortcut({ keys: [['ctrl', 'a']], callback });

    const event = press('a', { ctrlKey: true });
    expect(context.handle(event)).toBe(true);
    expect(callback).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves an unbound key alone', () => {
    const context = new ShortcutContext('grid', false);
    const event = press('q');
    expect(context.handle(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('honours a guard', () => {
    const context = new ShortcutContext('grid', false);
    const callback = vi.fn();
    context.addShortcut({ keys: [['enter']], callback, runOnlyIf: () => false });
    expect(context.handle(press('Enter'))).toBe(false);
    expect(callback).not.toHaveBeenCalled();
  });

  it('lets a callback decline the keystroke', () => {
    const context = new ShortcutContext('grid', false);
    context.addShortcut({ keys: [['tab']], callback: () => false });
    const event = press('Tab');
    expect(context.handle(event)).toBe(false);
    // Declined, so the browser still gets it.
    expect(event.defaultPrevented).toBe(false);
  });

  it('can leave the default in place while still handling the key', () => {
    const context = new ShortcutContext('grid', false);
    context.addShortcut({ keys: [['a']], callback: () => undefined, preventDefault: false });
    const event = press('a');
    expect(context.handle(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('binds several combinations to one action', () => {
    const context = new ShortcutContext('grid', false);
    const callback = vi.fn();
    context.addShortcut({ keys: [['delete'], ['backspace']], callback });
    context.handle(press('Delete'));
    context.handle(press('Backspace'));
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('removes everything a group registered', () => {
    const context = new ShortcutContext('grid', false);
    const callback = vi.fn();
    context.addShortcuts([{ keys: [['a']], callback }, { keys: [['b']], callback }], {
      group: 'plugin',
    });
    expect(context.hasShortcut(['a'])).toBe(true);
    context.removeShortcutsByGroup('plugin');
    expect(context.hasShortcut(['a'])).toBe(false);
    expect(context.hasShortcut(['b'])).toBe(false);
  });

  it('stops after the first handler unless told otherwise', () => {
    const context = new ShortcutContext('grid', false);
    const first = vi.fn();
    const second = vi.fn();
    context.addShortcut({ keys: [['a']], callback: first });
    context.addShortcut({ keys: [['a']], callback: second });
    context.handle(press('a'));
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it('runs every handler when propagation is allowed', () => {
    const context = new ShortcutContext('grid', false);
    const first = vi.fn();
    const second = vi.fn();
    context.addShortcut({ keys: [['a']], callback: first, stopPropagation: false });
    context.addShortcut({ keys: [['a']], callback: second });
    context.handle(press('a'));
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });
});

describe('the shortcut manager', () => {
  it('only consults the active context', () => {
    const manager = new ShortcutManager(false);
    const inGrid = vi.fn();
    const inEditor = vi.fn();
    manager.getContext('grid')!.addShortcut({ keys: [['enter']], callback: inGrid });
    manager.getContext('editor')!.addShortcut({ keys: [['enter']], callback: inEditor });

    manager.handle(press('Enter'));
    expect(inGrid).toHaveBeenCalledOnce();
    expect(inEditor).not.toHaveBeenCalled();

    manager.setActiveContextName('editor');
    manager.handle(press('Enter'));
    expect(inEditor).toHaveBeenCalledOnce();
    expect(inGrid).toHaveBeenCalledOnce();
  });

  it('refuses to activate a context that does not exist', () => {
    const manager = new ShortcutManager(false);
    expect(() => manager.setActiveContextName('nowhere')).toThrowError(/no shortcut context/);
  });

  it('takes new contexts from plugins', () => {
    const manager = new ShortcutManager(false);
    const callback = vi.fn();
    manager.addContext('menu').addShortcut({ keys: [['escape']], callback });
    manager.setActiveContextName('menu');
    manager.handle(press('Escape'));
    expect(callback).toHaveBeenCalledOnce();
  });
});

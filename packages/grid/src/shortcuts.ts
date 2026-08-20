/**
 * Keyboard shortcuts.
 *
 * Shortcuts live in named contexts — `grid` while navigating, `editor` while
 * typing into a cell — and only the active context is consulted. Without that
 * separation every binding would need to ask whether an editor happens to be
 * open, and one that forgot would eat a keystroke the editor needed.
 *
 * A shortcut may be registered under a group so that a plugin can remove
 * everything it added, and may carry a guard so that it applies only when the
 * grid is in the right state.
 */

/** A key combination, written the way Handsontable writes it: `ctrl+shift+a`. */
export type KeyCombination = string;

/** What runs when a shortcut fires. Returning `false` lets the event through. */
export type ShortcutCallback = (event: KeyboardEvent) => unknown;

export interface ShortcutOptions {
  /** The combinations that trigger it. */
  keys: KeyCombination[][];
  callback: ShortcutCallback;
  /** Lets a plugin remove everything it added in one call. */
  group?: string;
  /** Consulted before the callback; `false` means the shortcut does not apply. */
  runOnlyIf?: (event: KeyboardEvent) => boolean;
  /** Whether to call `preventDefault` when the shortcut fires. Defaults to true. */
  preventDefault?: boolean;
  /** Whether to stop other shortcuts for the same keys. Defaults to true. */
  stopPropagation?: boolean;
}

interface Registered extends ShortcutOptions {
  group: string;
  preventDefault: boolean;
  stopPropagation: boolean;
}

/** Modifier keys, in the order a normalised combination lists them. */
const MODIFIERS = ['control', 'meta', 'alt', 'shift'] as const;

/**
 * Normalises a combination so that `Ctrl+Shift+A`, `shift+control+a` and
 * `ctrl + shift + A` are all the same key.
 *
 * `mod` stands for the platform's primary modifier: Command on a Mac and
 * Control everywhere else. Writing bindings with it is what keeps one table of
 * shortcuts correct on both.
 */
export function normalizeCombination(combination: string, isMac = detectMac()): string {
  const parts = combination
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  // The space bar cannot be written literally in a `+`-separated combination,
  // so it is named.

  const modifiers = new Set<string>();
  let key = '';
  for (const part of parts) {
    switch (part) {
      case 'mod':
        modifiers.add(isMac ? 'meta' : 'control');
        break;
      case 'ctrl':
      case 'control':
        modifiers.add('control');
        break;
      case 'cmd':
      case 'command':
      case 'meta':
        modifiers.add('meta');
        break;
      case 'alt':
      case 'option':
        modifiers.add('alt');
        break;
      case 'shift':
        modifiers.add('shift');
        break;
      case 'space':
      case 'spacebar':
        key = 'space';
        break;
      default:
        key = part;
    }
  }
  const ordered = MODIFIERS.filter((modifier) => modifiers.has(modifier));
  return [...ordered, key].filter(Boolean).join('+');
}

/** The combination a keyboard event represents. */
export function combinationOf(event: KeyboardEvent): string {
  const modifiers: string[] = [];
  if (event.ctrlKey) {
    modifiers.push('control');
  }
  if (event.metaKey) {
    modifiers.push('meta');
  }
  if (event.altKey) {
    modifiers.push('alt');
  }
  if (event.shiftKey) {
    modifiers.push('shift');
  }
  // `key` rather than `code`, so a shortcut follows the user's layout. The
  // space bar is named rather than written literally, because a combination is
  // split on `+` and a bare space would vanish.
  const key = event.key === ' ' ? 'space' : event.key.toLowerCase();
  return [...modifiers, key].join('+');
}

function detectMac(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const platform = navigator.platform ?? '';
  return /mac|iphone|ipad/i.test(platform) || /mac/i.test(navigator.userAgent ?? '');
}

/** One context's shortcuts. */
export class ShortcutContext {
  readonly name: string;
  #byCombination = new Map<string, Registered[]>();
  #isMac: boolean;

  constructor(name: string, isMac = detectMac()) {
    this.name = name;
    this.#isMac = isMac;
  }

  /** Registers a shortcut. */
  addShortcut(options: ShortcutOptions): void {
    const registered: Registered = {
      group: 'default',
      preventDefault: true,
      stopPropagation: true,
      ...options,
    };
    for (const combination of options.keys) {
      const key = normalizeCombination(combination.join('+'), this.#isMac);
      const bucket = this.#byCombination.get(key) ?? [];
      bucket.push(registered);
      this.#byCombination.set(key, bucket);
    }
  }

  /** Registers several shortcuts sharing a group. */
  addShortcuts(shortcuts: ShortcutOptions[], shared: Partial<ShortcutOptions> = {}): void {
    for (const shortcut of shortcuts) {
      this.addShortcut({ ...shared, ...shortcut });
    }
  }

  /** Removes every shortcut registered under a group. */
  removeShortcutsByGroup(group: string): void {
    for (const [combination, bucket] of this.#byCombination) {
      const kept = bucket.filter((shortcut) => shortcut.group !== group);
      if (kept.length === 0) {
        this.#byCombination.delete(combination);
      } else {
        this.#byCombination.set(combination, kept);
      }
    }
  }

  /** Removes every shortcut for one combination. */
  removeShortcutsByKeys(keys: KeyCombination[]): void {
    this.#byCombination.delete(normalizeCombination(keys.join('+'), this.#isMac));
  }

  /** Whether anything is bound to a combination. */
  hasShortcut(keys: KeyCombination[]): boolean {
    return this.#byCombination.has(normalizeCombination(keys.join('+'), this.#isMac));
  }

  /**
   * Runs whatever matches an event.
   *
   * Returns whether anything handled it, so the caller can decide about
   * `preventDefault` for keys nothing was bound to.
   */
  handle(event: KeyboardEvent): boolean {
    const bucket = this.#byCombination.get(combinationOf(event));
    if (!bucket) {
      return false;
    }
    let handled = false;
    for (const shortcut of bucket) {
      if (shortcut.runOnlyIf && !shortcut.runOnlyIf(event)) {
        continue;
      }
      const result = shortcut.callback(event);
      // Returning false explicitly declines the keystroke, leaving it for the
      // browser — that is how an editor lets a real Tab through.
      if (result === false) {
        continue;
      }
      handled = true;
      if (shortcut.preventDefault) {
        event.preventDefault();
      }
      if (shortcut.stopPropagation) {
        break;
      }
    }
    return handled;
  }
}

/**
 * The contexts of one grid, and which is active.
 */
export class ShortcutManager {
  #contexts = new Map<string, ShortcutContext>();
  #active = 'grid';
  #isMac: boolean;

  constructor(isMac = detectMac()) {
    this.#isMac = isMac;
    this.addContext('grid');
    this.addContext('editor');
  }

  addContext(name: string): ShortcutContext {
    const context = new ShortcutContext(name, this.#isMac);
    this.#contexts.set(name, context);
    return context;
  }

  getContext(name: string): ShortcutContext | undefined {
    return this.#contexts.get(name);
  }

  /** Which context keystrokes go to. */
  getActiveContextName(): string {
    return this.#active;
  }

  setActiveContextName(name: string): void {
    if (!this.#contexts.has(name)) {
      throw new Error(`there is no shortcut context called ${JSON.stringify(name)}`);
    }
    this.#active = name;
  }

  /** Offers an event to the active context. */
  handle(event: KeyboardEvent): boolean {
    return this.#contexts.get(this.#active)?.handle(event) ?? false;
  }
}

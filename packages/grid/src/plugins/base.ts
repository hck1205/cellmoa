/**
 * The plugin framework.
 *
 * A plugin is a class that attaches to a grid and adds behaviour through
 * hooks. It is created for every grid whether or not it is switched on, and
 * `isEnabled` decides whether it actually runs — which is what lets
 * `updateSettings` turn a feature on later without the grid having to know how
 * to build it.
 *
 * The lifecycle is Handsontable's, so a plugin written against it ports
 * directly: `isEnabled` → `enablePlugin` → (`updatePlugin`)* → `disablePlugin`
 * → `destroy`.
 */

import type { Grid } from '../grid.js';
import type { HookHandler } from '../hooks.js';

/** What every plugin implements. */
export abstract class BasePlugin {
  /** The name the plugin is looked up by. */
  static readonly pluginName: string = 'base';

  protected readonly grid: Grid;
  #enabled = false;
  /** Hooks added while enabled, so they can all be taken off again. */
  #added: Array<[string, HookHandler]> = [];
  /** Listeners added while enabled, likewise. */
  #listeners: Array<() => void> = [];

  constructor(grid: Grid) {
    this.grid = grid;
  }

  /** The name this instance was registered under. */
  get pluginName(): string {
    return (this.constructor as typeof BasePlugin).pluginName;
  }

  /** Whether the settings ask for this plugin. */
  abstract isEnabled(): boolean;

  /** Sets the plugin up. Called only when `isEnabled` is true. */
  protected abstract onEnable(): void;

  /** Takes it down again. The base class removes hooks and listeners. */
  protected onDisable(): void {
    // Most plugins need nothing beyond what the base class undoes.
  }

  /** Whether the plugin is currently running. */
  isPluginEnabled(): boolean {
    return this.#enabled;
  }

  /** Switches the plugin on if the settings ask for it. */
  enablePlugin(): void {
    if (this.#enabled || !this.isEnabled()) {
      return;
    }
    this.#enabled = true;
    this.onEnable();
  }

  /** Switches it off, undoing everything it registered. */
  disablePlugin(): void {
    if (!this.#enabled) {
      return;
    }
    this.onDisable();
    for (const [name, handler] of this.#added) {
      this.grid.hooks.remove(name, handler);
    }
    this.#added = [];
    for (const remove of this.#listeners) {
      remove();
    }
    this.#listeners = [];
    this.#enabled = false;
  }

  /**
   * Re-reads the settings.
   *
   * The default is to take the plugin down and put it back up, which is always
   * correct; a plugin with expensive state overrides it.
   */
  updatePlugin(): void {
    const wanted = this.isEnabled();
    if (this.#enabled && !wanted) {
      this.disablePlugin();
      return;
    }
    if (!this.#enabled && wanted) {
      this.enablePlugin();
      return;
    }
    if (this.#enabled) {
      this.disablePlugin();
      this.enablePlugin();
    }
  }

  destroy(): void {
    this.disablePlugin();
  }

  /** Registers a hook that is removed when the plugin is disabled. */
  protected addHook(name: string, handler: HookHandler): void {
    this.grid.hooks.add(name, handler);
    this.#added.push([name, handler]);
  }

  /** Registers a DOM listener that is removed when the plugin is disabled. */
  protected listen<K extends keyof HTMLElementEventMap>(
    target: EventTarget,
    type: K | string,
    handler: (event: never) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler as EventListener, options);
    this.#listeners.push(() => target.removeEventListener(type, handler as EventListener, options));
  }

  /** The plugin's own settings, whatever shape they were given in. */
  protected settings<T = unknown>(): T | undefined {
    return this.grid.getSettings()[this.pluginName] as T | undefined;
  }

  /**
   * Whether the plugin's setting switches it on.
   *
   * Handsontable's settings take three shapes for one feature: `true` to switch
   * it on with its defaults, an object to switch it on and configure it, and
   * anything else (`false`, absent) to leave it off. Most plugins want exactly
   * that test, and writing it out is how one of them ends up treating `null`
   * as configuration.
   */
  protected switchedOn(): boolean {
    const settings = this.settings();
    return settings === true || (typeof settings === 'object' && settings !== null);
  }

  /**
   * The plugin's settings as an object, empty when they were not given as one.
   *
   * `true` carries no configuration, so it reads as "no options" — which lets a
   * caller ask for a field without first asking what shape the setting took.
   */
  protected options<T extends object>(): Partial<T> {
    const settings = this.settings();
    return typeof settings === 'object' && settings !== null ? (settings as Partial<T>) : {};
  }
}

/** How a plugin is constructed. */
export type PluginConstructor = (new (grid: Grid) => BasePlugin) & { pluginName: string };

const registry = new Map<string, PluginConstructor>();

/** Registers a plugin so every grid gets one. */
export function registerPlugin(constructor: PluginConstructor): void {
  registry.set(constructor.pluginName, constructor);
}

/** Every registered plugin, in the order they were registered. */
export function registeredPlugins(): PluginConstructor[] {
  return [...registry.values()];
}

/** The names of every registered plugin. */
export function pluginNames(): string[] {
  return [...registry.keys()].sort();
}

/** Looks a plugin up by name. */
export function getPluginConstructor(name: string): PluginConstructor | undefined {
  return registry.get(name);
}

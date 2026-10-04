/**
 * Turning the menu settings into a list of items.
 *
 * Kept apart from either menu plugin because both use it and neither owns it —
 * it used to live in `contextMenu.ts`, which made the dropdown menu import from
 * the context menu for no reason other than where the function happened to sit.
 */

import { SEPARATOR } from '../menu.js';
import type { MenuItem } from '../menu.js';

/**
 * Turns whatever the settings said into a list of items.
 *
 * A key that names nothing is dropped rather than shown as a dead entry: which
 * commands exist depends on which plugins are on, and a menu listing `copy`
 * when the clipboard plugin is off would be a lie.
 */
export function buildMenu(
  settings: unknown,
  available: Record<string, MenuItem>,
  defaults: string[],
): MenuItem[] {
  const resolveKeys = (keys: string[]): MenuItem[] =>
    keys
      .map((key) => (key === SEPARATOR ? { key: SEPARATOR } : available[key]))
      .filter((item): item is MenuItem => item !== undefined);

  if (settings === true || settings === undefined) {
    return resolveKeys(defaults);
  }
  if (Array.isArray(settings)) {
    return resolveKeys(settings as string[]);
  }
  if (typeof settings === 'object' && settings !== null) {
    const items = (settings as { items?: unknown }).items;
    if (Array.isArray(items)) {
      return resolveKeys(items as string[]);
    }
    if (items && typeof items === 'object') {
      // An object keeps its own order, and an entry may either name a built-in
      // command or define a new one outright.
      return Object.entries(items as Record<string, Partial<MenuItem>>).map(([key, overrides]) => ({
        ...(available[key] ?? { key }),
        ...overrides,
        key,
      }));
    }
    return resolveKeys(defaults);
  }
  return [];
}

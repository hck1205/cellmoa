/**
 * Phrases, in whichever language the grid was asked for.
 *
 * Two settings, and they do different jobs. `language` picks the dictionary —
 * what the menu says. `locale` picks the formatting rules — how a number or a
 * date is written. They usually agree and are allowed not to: someone reading
 * an English interface may still want German number formatting.
 */

import { DICTIONARIES, LANGUAGES } from './dictionaries.js';
import type { Dictionary, Phrase } from './dictionaries.js';

export * from './dictionaries.js';

/** The language used when none was asked for, or the one asked for is unknown. */
export const DEFAULT_LANGUAGE = 'en-US';

const registry = new Map<string, Dictionary>(Object.entries(DICTIONARIES));

/**
 * Adds or replaces a dictionary.
 *
 * A partial dictionary is filled in from `en-US` rather than left with holes:
 * a menu item with no label is worse than one in the wrong language.
 */
export function registerLanguage(code: string, dictionary: Dictionary): void {
  registry.set(code, { ...DICTIONARIES[DEFAULT_LANGUAGE], ...dictionary });
}

/** Whether there is a dictionary for a language. */
export function hasLanguage(code: string): boolean {
  return registry.has(code);
}

/** Every language there is a dictionary for. */
export function languages(): string[] {
  return [...registry.keys()];
}

/**
 * Looks a phrase up.
 *
 * `count` chooses between the singular and the plural of a two-part phrase;
 * anything other than exactly one is plural, which is the rule English uses and
 * the one Handsontable's dictionaries are written for.
 */
export function phrase(language: string, key: string, count?: number): string {
  const dictionary = registry.get(language) ?? registry.get(DEFAULT_LANGUAGE);
  const found: Phrase | undefined =
    dictionary?.[key] ?? registry.get(DEFAULT_LANGUAGE)?.[key];
  if (found === undefined) {
    // The key itself, so a missing phrase is visible rather than blank.
    return key;
  }
  if (typeof found === 'string') {
    return found;
  }
  return count === 1 ? found[0] : found[1];
}

/** The dictionary for a language, or the default one. */
export function dictionary(language: string): Dictionary {
  return registry.get(language) ?? registry.get(DEFAULT_LANGUAGE) ?? {};
}

/** The keys Handsontable's own dictionaries define, for a completeness check. */
export function phraseKeys(): string[] {
  return Object.keys(DICTIONARIES[DEFAULT_LANGUAGE] ?? {});
}

export { LANGUAGES };

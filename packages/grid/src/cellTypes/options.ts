/**
 * Where a list cell's allowed values come from.
 *
 * The editor offers a list and the validator checks against one, and it has to
 * be the same list. It was not: the editors read `source` and `selectOptions`
 * while the validators read only `source`, so a column configured the second
 * way got an editor that offered the right values and a validator that had
 * nothing to compare against and therefore accepted anything — which looks
 * like validation without being it.
 */

import type { GridSettings } from '../settings.js';

/**
 * The values a list cell allows, in the order they were given.
 *
 * A `source` given as a function is not resolved here: it answers
 * asynchronously, and both callers need an answer now — the editor asks it
 * itself, and the validator treats an unknowable list as nothing to check.
 */
export function optionsOf(meta: GridSettings): string[] {
  const source = meta.source;
  if (Array.isArray(source)) {
    return source.map(String);
  }
  const selectOptions = meta.selectOptions;
  if (Array.isArray(selectOptions)) {
    return selectOptions.map(String);
  }
  if (selectOptions && typeof selectOptions === 'object') {
    return Object.values(selectOptions as Record<string, unknown>).map(String);
  }
  return [];
}

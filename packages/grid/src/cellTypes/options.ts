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

/**
 * Which list types close their list when the column has not said.
 *
 * Handsontable defines `dropdown` as `autocomplete` with `strict: true`
 * already applied, and leaves `autocomplete` itself flexible — a list that
 * suggests rather than constrains is the whole point of that type. A `select`
 * is a native `<select>`, whose editor cannot produce a value that is off the
 * list, so its validator has no reason to accept one either.
 */
const STRICT_BY_DEFAULT: Record<string, boolean> = {
  autocomplete: false,
  dropdown: true,
  select: true,
};

/**
 * Whether a list cell refuses a value that is not on its list.
 *
 * The editor and the validator have to give the same answer to this, and they
 * did not. The editor forced `strict` on for every dropdown, so a
 * `{type: 'dropdown', strict: false}` column had an editor that would not
 * commit what its own validator was happy to accept; the validator checked the
 * list whenever there was one, so a plain `{type: 'autocomplete', source: […]}`
 * column marked every typed value invalid although its editor had offered to
 * commit it. Both ask here now, so there is one answer rather than two.
 */
export function isStrictList(meta: GridSettings, type: string): boolean {
  return typeof meta.strict === 'boolean' ? meta.strict : STRICT_BY_DEFAULT[type] === true;
}

/**
 * The options a list editor shows for what has been typed so far.
 *
 * Pulled out of the editor because it is the part with rules — whether the
 * match is case-sensitive, whether the list narrows at all, how the remaining
 * options are ordered — and none of those rules need a DOM to be true. Inside
 * the editor they could only be checked by building an element and reading its
 * children back, which is why `sortByRelevance` and `filteringCaseSensitive`
 * had no test of their own.
 */
export function matchOptions(all: string[], query: string, meta: GridSettings): string[] {
  const caseSensitive = meta.filteringCaseSensitive === true;
  const fold = (text: string): string => (caseSensitive ? text : text.toLowerCase());

  // `filter: false` is a list that always shows everything; typing then only
  // chooses what gets committed.
  const narrowed =
    meta.filter !== false && query !== ''
      ? all.filter((option) => fold(option).includes(fold(query)))
      : all;

  if (meta.sortByRelevance === false || query === '') {
    // The order the `source` gave, which is what a caller who ordered it
    // deliberately is asking for.
    return narrowed;
  }
  const needle = fold(query);
  // A stable partition rather than a sort: options that start with what was
  // typed come first, and everything keeps its original order within its half.
  const starts = narrowed.filter((option) => fold(option).startsWith(needle));
  const rest = narrowed.filter((option) => !fold(option).startsWith(needle));
  return [...starts, ...rest];
}

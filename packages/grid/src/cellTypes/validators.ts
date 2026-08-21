/**
 * The validators.
 *
 * A validator answers one question: may this value be written? It runs before
 * the edit reaches the engine, so a rejected value never becomes part of the
 * workbook's history — which matters, because an audit trail full of typos
 * someone immediately corrected is an audit trail nobody reads.
 */

import type { GridSettings } from '../settings.js';
import { optionsOf } from './options.js';
import type { CellValidator } from './types.js';
import { VALID, invalid } from './types.js';

/** Whether a value counts as empty, and whether that is allowed. */
function emptyCheck(value: string, meta: GridSettings): ReturnType<CellValidator> | null {
  if (value !== '') {
    return null;
  }
  return meta.allowEmpty === false ? invalid('this cell cannot be left empty') : VALID;
}

/** Accepts anything. The default for a text cell. */
export const textValidator: CellValidator = (value, meta) => emptyCheck(value, meta) ?? VALID;

/**
 * Accepts numbers, and a formula.
 *
 * A formula is let through unchecked: what it evaluates to is the engine's
 * business, and refusing `=SUM(A1:A9)` in a numeric column because it is not
 * itself a number would make the column useless.
 */
export const numericValidator: CellValidator = (value, meta) => {
  const empty = emptyCheck(value, meta);
  if (empty) {
    return empty;
  }
  if (value.startsWith('=')) {
    return VALID;
  }
  // Thousands separators and a trailing percent are how people type numbers.
  const cleaned = value.replace(/[\s,]/g, '').replace(/%$/, '');
  if (cleaned === '' || Number.isNaN(Number(cleaned))) {
    return invalid(`${JSON.stringify(value)} is not a number`);
  }
  return VALID;
};

/** Accepts a value that is on the list. */
export function listValidator(source?: unknown): CellValidator {
  return (value, meta) => {
    const empty = emptyCheck(value, meta);
    if (empty) {
      return empty;
    }
    if (value.startsWith('=')) {
      return VALID;
    }
    const allowed = Array.isArray(source) ? source.map(String) : optionsOf(meta);
    if (allowed.length === 0) {
      // Nothing to check against is not a failure; a source given as a
      // function is resolved by the editor, not here.
      return VALID;
    }
    if (meta.strict === false) {
      return VALID;
    }
    return allowed.includes(value)
      ? VALID
      : invalid(`${JSON.stringify(value)} is not one of the allowed values`);
  };
}

export const autocompleteValidator: CellValidator = listValidator();
export const dropdownValidator: CellValidator = listValidator();
export const selectValidator: CellValidator = listValidator();

/** Accepts several values from the list, comma-separated. */
export const multiSelectValidator: CellValidator = (value, meta) => {
  const empty = emptyCheck(value, meta);
  if (empty) {
    return empty;
  }
  const options = optionsOf(meta);
  if (options.length === 0) {
    return VALID;
  }
  const allowed = new Set(options);
  const chosen = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const unknown = chosen.find((part) => !allowed.has(part));
  return unknown === undefined
    ? VALID
    : invalid(`${JSON.stringify(unknown)} is not one of the allowed values`);
};

/**
 * Accepts a date the engine can read.
 *
 * The check is deliberately loose: the engine parses several forms, and a
 * validator stricter than the parser would refuse values that would have
 * worked.
 */
export const dateValidator: CellValidator = (value, meta) => {
  const empty = emptyCheck(value, meta);
  if (empty) {
    return empty;
  }
  if (value.startsWith('=')) {
    return VALID;
  }
  // A serial number is a date too.
  if (!Number.isNaN(Number(value))) {
    return VALID;
  }
  const parts = value.split(/[-/.]/).map((part) => part.trim());
  if (parts.length === 3 && parts.every((part) => /^\d{1,4}$/.test(part))) {
    return VALID;
  }
  return invalid(`${JSON.stringify(value)} is not a date`);
};

/** Accepts `h:mm`, `h:mm:ss`, and the same with an am/pm suffix. */
export const timeValidator: CellValidator = (value, meta) => {
  const empty = emptyCheck(value, meta);
  if (empty) {
    return empty;
  }
  if (value.startsWith('=') || !Number.isNaN(Number(value))) {
    return VALID;
  }
  return /^\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?$/i.test(value.trim())
    ? VALID
    : invalid(`${JSON.stringify(value)} is not a time`);
};

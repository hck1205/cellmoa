/**
 * What a cell type is made of.
 *
 * Handsontable splits a cell's behaviour into three pieces, and keeping them
 * separate is what lets a numeric column be edited as text, rendered
 * right-aligned, and validated as a number without any one of those knowing
 * about the others.
 */

import type { CellData, GridSettings } from '../settings.js';

/** What a renderer is given. */
export interface RenderContext {
  row: number;
  col: number;
  /** The element to fill in; it is reused between renders. */
  td: HTMLTableCellElement;
  /** The cell's contents, or `null` when it holds nothing. */
  cell: CellData | null;
  /** The settings in force for this cell. */
  meta: GridSettings;
}

/** Draws a cell. */
export type CellRenderer = (context: RenderContext) => void;

/** What an editor is given when it opens. */
export interface EditorContext {
  row: number;
  col: number;
  /** Where to put the editor, in the grid's own coordinates. */
  rect: { left: number; top: number; width: number; height: number };
  /** What the cell holds now: the formula if there is one, else the text. */
  value: string;
  meta: GridSettings;
  /** Where to attach the editor's element. */
  parent: HTMLElement;
  /** Called with the new value when the user commits. */
  commit: (value: string, moveBy?: { row: number; col: number }) => void;
  /** Called when the user gives up. */
  cancel: () => void;
}

/** An open editor. */
export interface EditorInstance {
  /** The element holding focus, so the grid can tell whether it still has it. */
  element: HTMLElement;
  /** The value as it stands, for a caller that wants it without committing. */
  getValue(): string;
  /** Puts the caret where the user expects it. */
  focus(): void;
  /** Takes the editor down. */
  close(): void;
  /** Offers a key to the editor before the grid sees it. */
  handleKey?(event: KeyboardEvent): boolean;
}

/** Opens an editor over a cell. */
export type CellEditor = (context: EditorContext) => EditorInstance;

/** The outcome of validating a value. */
export interface ValidationResult {
  valid: boolean;
  /** Why it failed, for a tooltip or a message. */
  reason?: string;
}

/** Checks a value before it is written. */
export type CellValidator = (
  value: string,
  meta: GridSettings,
) => ValidationResult | Promise<ValidationResult>;

/** A cell type: a renderer, an editor and a validator under one name. */
export interface CellTypeDefinition {
  renderer: CellRenderer;
  editor: CellEditor | null;
  validator: CellValidator | null;
  /**
   * Settings the type brings with it.
   *
   * A `password` column is not copyable and a `dropdown` is strict, and in both
   * cases that is a property of the *type* rather than something every caller
   * should have to remember. They are defaults: any layer that says otherwise
   * wins, so `{ type: 'password', copyable: true }` is still copyable.
   *
   * Without this the editor had to patch `strict` into the settings as it went
   * past, which is how the editor and the validator came to disagree about what
   * strict meant.
   */
  meta?: GridSettings;
}

/** Shorthand for a value that passed. */
export const VALID: ValidationResult = { valid: true };

/**
 * Reads whatever a validator returned as a verdict.
 *
 * The registered validators answer with a `ValidationResult`, and a validator
 * somebody wrote themselves usually answers with a boolean — that is the shape
 * Handsontable's own `callback(true)` teaches. Both have to mean the same
 * thing, and they have to mean it at every entry point: a validator that
 * rejects a value when a cell is edited but accepts it when `validateCells`
 * runs is worse than one that never worked.
 */
export function asVerdict(result: unknown): ValidationResult {
  if (typeof result === 'object' && result !== null && 'valid' in result) {
    const verdict = result as ValidationResult;
    return { valid: Boolean(verdict.valid), ...(verdict.reason ? { reason: verdict.reason } : {}) };
  }
  // `undefined` is a validator that returned nothing, which is not a refusal.
  return { valid: result !== false };
}

/** Shorthand for a value that did not. */
export function invalid(reason: string): ValidationResult {
  return { valid: false, reason };
}

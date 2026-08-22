/**
 * The cell type registry.
 *
 * A type is a name under which a renderer, an editor and a validator are
 * registered together. Looking them up by name rather than passing them around
 * is what lets a column say `type: 'numeric'` and get all three.
 */

import * as editors from './editors.js';
import * as renderers from './renderers.js';
import * as validators from './validators.js';
import type { CellEditor, CellRenderer, CellTypeDefinition, CellValidator } from './types.js';

export * from './types.js';
export { editors, renderers, validators };
export { checkboxState, checkboxTemplates } from './renderers.js';
export { isStrictList, matchOptions, optionsOf } from './options.js';

const cellTypes = new Map<string, CellTypeDefinition>();
const rendererRegistry = new Map<string, CellRenderer>();
const editorRegistry = new Map<string, CellEditor>();
const validatorRegistry = new Map<string, CellValidator>();

/** Registers a renderer under a name. */
export function registerRenderer(name: string, renderer: CellRenderer): void {
  rendererRegistry.set(name, renderer);
}

export function registerEditor(name: string, editor: CellEditor): void {
  editorRegistry.set(name, editor);
}

export function registerValidator(name: string, validator: CellValidator): void {
  validatorRegistry.set(name, validator);
}

/** Registers a cell type, and its three pieces under the same name. */
export function registerCellType(name: string, definition: CellTypeDefinition): void {
  cellTypes.set(name, definition);
  rendererRegistry.set(name, definition.renderer);
  if (definition.editor) {
    editorRegistry.set(name, definition.editor);
  }
  if (definition.validator) {
    validatorRegistry.set(name, definition.validator);
  }
}

/**
 * Registers a cell type under every name it answers to.
 *
 * A type that the documentation calls `intl-date` and the registry calls
 * `intlDate` is not the same type as far as a configuration is concerned: the
 * lookup misses, the column falls back to the text renderer, and the grid
 * shows something plausible that is not what was asked for. So the documented
 * spellings are registered too, against the same definition, and
 * `getCellType` returns the same object whichever name it was asked by.
 */
function registerCellTypeAs(names: string[], definition: CellTypeDefinition): void {
  for (const name of names) {
    registerCellType(name, definition);
  }
}

export function getCellType(name: string): CellTypeDefinition | undefined {
  return cellTypes.get(name);
}

export function getRenderer(name: string): CellRenderer | undefined {
  return rendererRegistry.get(name);
}

export function getEditor(name: string): CellEditor | undefined {
  return editorRegistry.get(name);
}

export function getValidator(name: string): CellValidator | undefined {
  return validatorRegistry.get(name);
}

/** Every registered cell type, for tests and for a type picker. */
export function cellTypeNames(): string[] {
  return [...cellTypes.keys()].sort();
}

// The types Handsontable ships, registered under the same names so that a
// configuration written for it selects the same behaviour here.
registerCellType('text', {
  renderer: renderers.textRenderer,
  editor: editors.textEditor,
  validator: validators.textValidator,
});
registerCellType('numeric', {
  renderer: renderers.numericRenderer,
  editor: editors.numericEditor,
  validator: validators.numericValidator,
});
registerCellType('checkbox', {
  renderer: renderers.checkboxRenderer,
  // A checkbox is toggled rather than typed into, so it has no editor; the
  // grid turns Space and Enter into a write.
  editor: null,
  validator: null,
});
registerCellType('date', {
  renderer: renderers.dateRenderer,
  editor: editors.dateEditor,
  validator: validators.dateValidator,
});
registerCellType('time', {
  renderer: renderers.timeRenderer,
  editor: editors.timeEditor,
  validator: validators.timeValidator,
});
registerCellType('dropdown', {
  renderer: renderers.dropdownRenderer,
  editor: editors.dropdownEditor,
  validator: validators.dropdownValidator,
});
registerCellType('autocomplete', {
  renderer: renderers.autocompleteRenderer,
  editor: editors.autocompleteEditor,
  validator: validators.autocompleteValidator,
});
registerCellType('select', {
  renderer: renderers.selectRenderer,
  editor: editors.selectEditor,
  validator: validators.selectValidator,
});
// `multiselect` is the reference's own spelling and `multiSelect` the one it
// shipped with first; both are registered there, so both are registered here.
registerCellTypeAs(['multiselect', 'multiSelect'], {
  renderer: renderers.multiSelectRenderer,
  editor: editors.multiSelectEditor,
  validator: validators.multiSelectValidator,
});
registerCellType('password', {
  renderer: renderers.passwordRenderer,
  editor: editors.passwordEditor,
  validator: validators.textValidator,
});
registerCellType('handsontable', {
  // A grid inside a cell: the value is text, and the editor is a list.
  renderer: renderers.autocompleteRenderer,
  editor: editors.autocompleteEditor,
  validator: validators.autocompleteValidator,
});
registerCellTypeAs(['intl-date', 'intlDate'], {
  renderer: renderers.dateRenderer,
  editor: editors.dateEditor,
  validator: validators.dateValidator,
});
registerCellTypeAs(['intl-time', 'intlTime'], {
  renderer: renderers.timeRenderer,
  editor: editors.timeEditor,
  validator: validators.timeValidator,
});

// Renderers that are not cell types of their own.
registerRenderer('html', renderers.htmlRenderer);
registerEditor('textarea', editors.textareaEditor);

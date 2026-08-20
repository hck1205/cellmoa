/**
 * The editors.
 *
 * An editor is a small element placed over the cell. It owns the keystrokes
 * while it is open — the grid switches its shortcut context — and hands back a
 * string when the user commits, because the engine parses input the same way
 * whether it came from a keyboard or a file.
 */

import type { CellEditor, EditorContext, EditorInstance } from './types.js';

/** Places an element over the cell being edited. */
function position(element: HTMLElement, context: EditorContext): void {
  const { rect } = context;
  element.style.position = 'absolute';
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

/** Which way a key says to move after committing. */
function moveFor(event: KeyboardEvent): { row: number; col: number } | undefined {
  if (event.key === 'Enter') {
    return { row: event.shiftKey ? -1 : 1, col: 0 };
  }
  if (event.key === 'Tab') {
    return { row: 0, col: event.shiftKey ? -1 : 1 };
  }
  return undefined;
}

/**
 * The default editor: a single-line text input.
 *
 * A formula is edited as its source rather than its result, which is why the
 * grid hands the editor `=A1*2` and not `20`.
 */
export const textEditor: CellEditor = (context) => {
  const document = context.parent.ownerDocument;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cm-editor';
  input.value = context.value;
  position(input, context);
  context.parent.appendChild(input);

  let closed = false;
  const close = (): void => {
    if (!closed) {
      closed = true;
      input.remove();
    }
  };

  const instance: EditorInstance = {
    element: input,
    getValue: () => input.value,
    focus: () => {
      input.focus();
      // The caret goes to the end, so typing continues the value rather than
      // replacing it — F2 on a filled cell should not lose what is there.
      input.setSelectionRange(input.value.length, input.value.length);
    },
    close,
    handleKey(event) {
      if (event.key === 'Escape') {
        context.cancel();
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        // Alt+Enter is a line break in a spreadsheet, not a commit.
        if (event.key === 'Enter' && event.altKey) {
          return false;
        }
        context.commit(input.value, moveFor(event));
        return true;
      }
      // Everything else belongs to the input: arrows move the caret, not the
      // selection.
      return false;
    },
  };
  return instance;
};

/** A password editor: the same, with the characters masked. */
export const passwordEditor: CellEditor = (context) => {
  const instance = textEditor(context);
  (instance.element as HTMLInputElement).type = 'password';
  return instance;
};

/** A multi-line editor, for cells that hold a paragraph. */
export const textareaEditor: CellEditor = (context) => {
  const document = context.parent.ownerDocument;
  const area = document.createElement('textarea');
  area.className = 'cm-editor cm-editor--multiline';
  area.value = context.value;
  position(area, context);
  context.parent.appendChild(area);

  return {
    element: area,
    getValue: () => area.value,
    focus: () => {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    },
    close: () => area.remove(),
    handleKey(event) {
      if (event.key === 'Escape') {
        context.cancel();
        return true;
      }
      // In a multi-line editor plain Enter inserts a line; only a modified one
      // commits.
      if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        context.commit(area.value, moveFor(event));
        return true;
      }
      if (event.key === 'Tab') {
        context.commit(area.value, moveFor(event));
        return true;
      }
      return false;
    },
  };
};

/** The values a list editor offers. */
function optionsOf(context: EditorContext): string[] {
  const source = context.meta.source;
  if (Array.isArray(source)) {
    return source.map(String);
  }
  const selectOptions = context.meta.selectOptions;
  if (Array.isArray(selectOptions)) {
    return selectOptions.map(String);
  }
  if (selectOptions && typeof selectOptions === 'object') {
    return Object.values(selectOptions as Record<string, unknown>).map(String);
  }
  return [];
}

/** A native `<select>`, for a short fixed list. */
export const selectEditor: CellEditor = (context) => {
  const document = context.parent.ownerDocument;
  const select = document.createElement('select');
  select.className = 'cm-editor cm-editor--select';
  for (const option of optionsOf(context)) {
    const element = document.createElement('option');
    element.value = option;
    element.textContent = option;
    select.appendChild(element);
  }
  select.value = context.value;
  position(select, context);
  context.parent.appendChild(select);

  return {
    element: select,
    getValue: () => select.value,
    focus: () => select.focus(),
    close: () => select.remove(),
    handleKey(event) {
      if (event.key === 'Escape') {
        context.cancel();
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        context.commit(select.value, moveFor(event));
        return true;
      }
      // Arrows move through the options rather than through the grid.
      return false;
    },
  };
};

/**
 * A text input with a list beneath it.
 *
 * `strict` decides whether a value outside the list is refused; `filter`
 * decides whether typing narrows the list. Both are Handsontable's options and
 * both matter: a strict, unfiltered dropdown and a loose, filtered autocomplete
 * are different controls that happen to share an implementation.
 */
export const autocompleteEditor: CellEditor = (context) => {
  const document = context.parent.ownerDocument;
  const wrapper = document.createElement('div');
  wrapper.className = 'cm-editor cm-editor--autocomplete';
  position(wrapper, context);
  wrapper.style.height = 'auto';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cm-editor-input';
  input.value = context.value;
  input.style.width = '100%';
  wrapper.appendChild(input);

  const list = document.createElement('ul');
  list.className = 'cm-editor-list';
  wrapper.appendChild(list);
  context.parent.appendChild(wrapper);

  const all = optionsOf(context);
  const shouldFilter = context.meta.filter !== false;
  const caseSensitive = context.meta.filteringCaseSensitive === true;
  let highlighted = -1;
  let visible: string[] = [];

  const draw = (): void => {
    const query = input.value;
    visible = shouldFilter && query !== ''
      ? all.filter((option) =>
          caseSensitive
            ? option.includes(query)
            : option.toLowerCase().includes(query.toLowerCase()),
        )
      : all;
    list.replaceChildren();
    visible.forEach((option, index) => {
      const item = document.createElement('li');
      item.textContent = option;
      item.className = index === highlighted ? 'cm-editor-item is-highlighted' : 'cm-editor-item';
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        context.commit(option);
      });
      list.appendChild(item);
    });
  };
  input.addEventListener('input', () => {
    highlighted = -1;
    draw();
  });
  draw();

  const chosen = (): string =>
    highlighted >= 0 && visible[highlighted] !== undefined ? visible[highlighted]! : input.value;

  return {
    element: input,
    getValue: chosen,
    focus: () => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    },
    close: () => wrapper.remove(),
    handleKey(event) {
      if (event.key === 'Escape') {
        context.cancel();
        return true;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        highlighted = Math.min(Math.max(highlighted + step, -1), visible.length - 1);
        draw();
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const value = chosen();
        // In strict mode a value that is not on the list is refused rather
        // than written.
        if (context.meta.strict === true && !all.includes(value)) {
          return true;
        }
        context.commit(value, moveFor(event));
        return true;
      }
      return false;
    },
  };
};

/** A dropdown is an autocomplete that insists on its list. */
export const dropdownEditor: CellEditor = (context) =>
  autocompleteEditor({ ...context, meta: { ...context.meta, strict: true } });

/** Several values at once, held as a comma-separated string. */
export const multiSelectEditor: CellEditor = (context) => {
  const document = context.parent.ownerDocument;
  const wrapper = document.createElement('div');
  wrapper.className = 'cm-editor cm-editor--multi-select';
  position(wrapper, context);
  wrapper.style.height = 'auto';

  const chosen = new Set(
    context.value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  );
  const boxes: HTMLInputElement[] = [];
  for (const option of optionsOf(context)) {
    const label = document.createElement('label');
    label.className = 'cm-editor-option';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = option;
    box.checked = chosen.has(option);
    boxes.push(box);
    label.append(box, document.createTextNode(option));
    wrapper.appendChild(label);
  }
  context.parent.appendChild(wrapper);

  const value = (): string =>
    boxes
      .filter((box) => box.checked)
      .map((box) => box.value)
      .join(', ');

  return {
    element: wrapper,
    getValue: value,
    focus: () => boxes[0]?.focus(),
    close: () => wrapper.remove(),
    handleKey(event) {
      if (event.key === 'Escape') {
        context.cancel();
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        context.commit(value(), moveFor(event));
        return true;
      }
      return false;
    },
  };
};

/** A native date input. */
export const dateEditor: CellEditor = (context) => {
  const instance = textEditor(context);
  const input = instance.element as HTMLInputElement;
  input.classList.add('cm-editor--date');
  return instance;
};

export const timeEditor: CellEditor = dateEditor;

/** A numeric editor: text, but the field is marked so a phone shows digits. */
export const numericEditor: CellEditor = (context) => {
  const instance = textEditor(context);
  (instance.element as HTMLInputElement).inputMode = 'decimal';
  return instance;
};

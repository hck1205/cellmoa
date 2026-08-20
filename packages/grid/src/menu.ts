/**
 * The pop-up menu, shared by the context menu and the dropdown menu.
 *
 * A menu is a list of items, each of which knows its own label, whether it is
 * available, and what to do. Items come from the settings, from plugins that
 * contribute their own, or from a built-in table — and they all have the same
 * shape, so a plugin adding one does not have to know which menu it lands in.
 */

/** One entry. */
export interface MenuItem {
  /** How the item is referred to. `---------` is a separator. */
  key: string;
  /** The label, or a function returning it. */
  name?: string | (() => string);
  /** What happens when it is chosen. */
  callback?: (key: string, selection: MenuSelection[], event: Event) => void;
  /** Whether it is greyed out. */
  disabled?: boolean | (() => boolean);
  /** Whether it is left out altogether. */
  hidden?: boolean | (() => boolean);
  /** A nested menu. */
  submenu?: { items: MenuItem[] };
  /** Drawn with a tick when true. */
  checked?: boolean | (() => boolean);
}

/** The selection a menu command acts on. */
export interface MenuSelection {
  start: { row: number; col: number };
  end: { row: number; col: number };
}

/** The separator's key, spelled as Handsontable spells it. */
export const SEPARATOR = '---------';

/** Resolves a value that may have been given as a function. */
export function resolve<T>(value: T | (() => T) | undefined, fallback: T): T {
  if (value === undefined) {
    return fallback;
  }
  return typeof value === 'function' ? (value as () => T)() : value;
}

/** What a menu needs from whatever opened it. */
export interface MenuHost {
  document: Document;
  /** The selection the commands will act on. */
  selection(): MenuSelection[];
  /** Called after an item runs, so the opener can close and tidy up. */
  afterCommand?(key: string): void;
}

/**
 * A menu on screen.
 *
 * The element is built fresh each time it opens rather than kept and hidden.
 * An item's label and its availability are both allowed to be functions, so a
 * menu that was built once and reused would show whatever was true when it was
 * first opened — "Undo" greyed out on a table you have since edited.
 */
export class Menu {
  #host: MenuHost;
  #element: HTMLElement | null = null;
  #submenu: Menu | null = null;
  #onDocumentDown: ((event: Event) => void) | null = null;

  constructor(host: MenuHost) {
    this.#host = host;
  }

  /** Whether the menu is on screen. */
  get isOpen(): boolean {
    return this.#element !== null;
  }

  /** The menu's root element, or `null` when it is closed. */
  get element(): HTMLElement | null {
    return this.#element;
  }

  /** Opens the menu at a point, in page coordinates. */
  open(items: MenuItem[], x: number, y: number, parent?: HTMLElement): void {
    this.close();
    const visible = items.filter((item) => !resolve(item.hidden, false));
    if (visible.length === 0) {
      return;
    }
    const doc = this.#host.document;
    const element = doc.createElement('div');
    element.className = 'cm-menu';
    element.setAttribute('role', 'menu');
    element.style.position = 'absolute';
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;

    for (const item of visible) {
      element.appendChild(this.#build(item));
    }
    (parent ?? doc.body).appendChild(element);
    this.#element = element;

    // A click anywhere else closes the menu, which is what every menu does and
    // what people expect when they change their mind.
    this.#onDocumentDown = (event: Event) => {
      if (!element.contains(event.target as Node) && !this.#submenu?.element?.contains(event.target as Node)) {
        this.close();
      }
    };
    doc.addEventListener('mousedown', this.#onDocumentDown, true);
  }

  /** Takes the menu down. */
  close(): void {
    this.#submenu?.close();
    this.#submenu = null;
    if (this.#onDocumentDown) {
      this.#host.document.removeEventListener('mousedown', this.#onDocumentDown, true);
      this.#onDocumentDown = null;
    }
    this.#element?.remove();
    this.#element = null;
  }

  /** Runs an item's command, as choosing it would. */
  execute(item: MenuItem, event: Event): void {
    if (resolve(item.disabled, false) || item.key === SEPARATOR) {
      return;
    }
    if (item.submenu) {
      return;
    }
    item.callback?.(item.key, this.#host.selection(), event);
    this.close();
    this.#host.afterCommand?.(item.key);
  }

  #build(item: MenuItem): HTMLElement {
    const doc = this.#host.document;
    if (item.key === SEPARATOR) {
      const separator = doc.createElement('div');
      separator.className = 'cm-menu-separator';
      separator.setAttribute('role', 'separator');
      return separator;
    }
    const entry = doc.createElement('div');
    entry.className = 'cm-menu-item';
    entry.setAttribute('role', 'menuitem');
    entry.dataset.key = item.key;
    entry.textContent = resolve(item.name, item.key);

    if (resolve(item.disabled, false)) {
      entry.classList.add('cm-menu-item--disabled');
      entry.setAttribute('aria-disabled', 'true');
    }
    if (resolve(item.checked, false)) {
      entry.classList.add('cm-menu-item--checked');
      entry.setAttribute('aria-checked', 'true');
    }
    if (item.submenu) {
      entry.classList.add('cm-menu-item--submenu');
      entry.addEventListener('mouseenter', () => this.#openSubmenu(item, entry));
    }
    entry.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.execute(item, event);
    });
    return entry;
  }

  #openSubmenu(item: MenuItem, anchor: HTMLElement): void {
    if (!item.submenu || resolve(item.disabled, false)) {
      return;
    }
    this.#submenu?.close();
    this.#submenu = new Menu({
      document: this.#host.document,
      selection: () => this.#host.selection(),
      afterCommand: (key) => {
        this.close();
        this.#host.afterCommand?.(key);
      },
    });
    const box = anchor.getBoundingClientRect();
    this.#submenu.open(item.submenu.items, box.right, box.top);
  }
}

/**
 * Modal dialogs over the grid.
 *
 * The dialog covers the table and takes the keyboard, which is what makes it
 * modal rather than merely a box on top: while it is open, typing must not
 * reach the cell underneath. Escape closes it, because a modal you cannot
 * dismiss is a trap.
 */

import { PHRASE } from '../i18n/keys.js';
import { writeHtml } from '../sanitize.js';
import { BasePlugin, registerPlugin } from './base.js';

/**
 * How the backdrop is painted.
 *
 * `solid` and `semi-transparent` are the two the design system draws; `dark`,
 * `light` and `none` are the names this plugin shipped with and still answers
 * to, so a grid styled against them does not change appearance underneath its
 * author.
 */
export type DialogBackground = 'solid' | 'semi-transparent' | 'dark' | 'light' | 'none';

/** What assistive technology is told the dialog is. */
export interface DialogA11y {
  /** Defaults to `dialog`. */
  role?: string;
  /** The dialog's name, when nothing visible in it can serve as one. */
  ariaLabel?: string;
  /** The id of the element that names it, which wins over `ariaLabel`. */
  ariaLabelledby?: string;
  /** The id of the element that describes it. */
  ariaDescribedby?: string;
}

export interface DialogButton {
  text: string;
  type?: 'primary' | 'secondary';
  callback?: () => void;
}

/**
 * A ready-made dialog, instead of content of your own.
 *
 * The point is that an alert and a confirmation are the same two or three
 * pieces every time — a heading, a sentence, and the buttons that answer it —
 * and assembling them by hand is how two dialogs in one product end up looking
 * like they came from two products.
 */
export interface DialogTemplate {
  type?: 'alert' | 'confirm';
  title?: string;
  description?: string;
  buttons?: DialogButton[];
}

export interface DialogOptions {
  /** Plain text, or HTML when `contentType` says so. */
  content?: string;
  contentType?: 'text' | 'html';
  /** A ready-made shape, used instead of `content`. */
  template?: DialogTemplate;
  /** Whether Escape and a click on the background close it. */
  closable?: boolean;
  /** Extra classes on the dialog box. */
  contentClassName?: string;
  background?: DialogBackground;
  /** Whether the box itself is painted, or floats on the backdrop. */
  contentBackground?: boolean;
  animation?: boolean;
  a11y?: DialogA11y;
  /** Called after it closes. */
  onHide?: () => void;
}

/** What an alert says, when it is more than one line. */
export interface DialogAlert {
  title?: string;
  description?: string;
}

export class Dialog extends BasePlugin {
  static override readonly pluginName: string = 'dialog';

  #overlay: HTMLElement | null = null;
  #options: DialogOptions = {};

  override isEnabled(): boolean {
    return this.grid.getSettings().dialog !== false;
  }

  protected override onEnable(): void {
    // Built on demand: an invisible overlay in the DOM would still intercept
    // clicks in some layouts.
  }

  protected override onDisable(): void {
    this.hide();
  }

  /** Whether a dialog is on screen. */
  isVisible(): boolean {
    return this.#overlay !== null;
  }

  /** The dialog's element, or `null`. */
  get element(): HTMLElement | null {
    return this.#overlay;
  }

  /** Opens a dialog, replacing any that was already open. */
  show(options: DialogOptions = {}): void {
    const view = this.grid.view;
    if (!view) {
      return;
    }
    if (this.grid.hooks.allows('beforeDialogShow', options) === false) {
      return;
    }
    this.hide();
    this.#options = { closable: true, background: 'solid', ...options };

    const doc = view.root.ownerDocument;
    const overlay = doc.createElement('div');
    overlay.className = 'cm-dialog-overlay';
    overlay.dataset['background'] = this.#options.background ?? 'solid';
    // Reflected rather than acted on, so the stylesheet decides what fading in
    // means and a grid that has none is not left with a half-applied effect.
    overlay.dataset['animation'] = this.#options.animation === false ? 'off' : 'on';
    this.#describe(overlay, this.#options.a11y ?? {});

    const box = doc.createElement('div');
    box.className = ['cm-dialog', this.#options.contentClassName].filter(Boolean).join(' ');
    box.tabIndex = -1;
    box.dataset['contentBackground'] = String(this.#options.contentBackground !== false);
    this.#fill(box, this.#options);
    overlay.appendChild(box);

    if (this.#options.closable !== false) {
      overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) {
          this.hide();
        }
      });
      overlay.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          this.hide();
        }
      });
    }
    // Into the overlay layer, which spans the slots as well as the table: a
    // modal that leaves the pager clickable is not modal.
    view.overlay.appendChild(overlay);
    this.#overlay = overlay;
    this.focus();
    this.grid.hooks.notify('afterDialogShow', this.#options);
  }

  /** Changes what an open dialog says without closing it. */
  update(options: DialogOptions): void {
    this.#options = { ...this.#options, ...options };
    if (this.#overlay) {
      this.#overlay.dataset['background'] = this.#options.background ?? 'solid';
      this.#overlay.dataset['animation'] = this.#options.animation === false ? 'off' : 'on';
      this.#describe(this.#overlay, this.#options.a11y ?? {});
    }
    const box = this.#overlay?.querySelector('.cm-dialog');
    if (box instanceof HTMLElement) {
      box.dataset['contentBackground'] = String(this.#options.contentBackground !== false);
      this.#fill(box, this.#options);
    }
  }

  /** Closes it. */
  hide(): void {
    if (!this.#overlay) {
      return;
    }
    if (this.grid.hooks.allows('beforeDialogHide') === false) {
      return;
    }
    this.#overlay.remove();
    this.#overlay = null;
    this.#options.onHide?.();
    this.grid.hooks.notify('afterDialogHide');
  }

  /** Puts the keyboard in the dialog. */
  focus(): void {
    const box = this.#overlay?.querySelector('.cm-dialog');
    if (box instanceof HTMLElement) {
      box.focus();
    }
  }

  /**
   * A dialog with a message and one button.
   *
   * The callback is the reader's acknowledgement, so it runs whether they press
   * the button or dismiss the dialog — a caller waiting to carry on must not be
   * left waiting because the reader pressed Escape instead of OK.
   */
  showAlert(message: string | DialogAlert, callback?: () => void): void {
    const alert: DialogAlert = typeof message === 'string' ? { description: message } : message;
    let answered = false;
    this.show({
      template: {
        type: 'alert',
        ...alert,
        buttons: [
          {
            text: this.grid.getTranslatedPhrase(PHRASE.ok),
            type: 'primary',
            callback: () => {
              answered = true;
              this.hide();
              callback?.();
            },
          },
        ],
      },
      contentClassName: 'cm-dialog--alert',
      onHide: () => {
        if (!answered) {
          callback?.();
        }
      },
    });
  }

  /**
   * A dialog with two buttons, which reports which was chosen.
   *
   * Two shapes of answer, told apart by how many callbacks arrive. With one,
   * it is the older `(confirmed: boolean)` form and hears about both outcomes;
   * with two, they are the documented confirm and cancel handlers and each
   * hears only about its own.
   */
  showConfirm(
    message: string | DialogAlert,
    onConfirm?: (confirmed: boolean) => void,
    onCancel?: (confirmed: boolean) => void,
  ): void {
    const alert: DialogAlert = typeof message === 'string' ? { description: message } : message;
    const cancelled = onCancel ?? onConfirm;
    let answered = false;
    const answer = (confirmed: boolean): void => {
      answered = true;
      this.hide();
      (confirmed ? onConfirm : cancelled)?.(confirmed);
    };
    this.show({
      template: {
        type: 'confirm',
        ...alert,
        buttons: [
          {
            text: this.grid.getTranslatedPhrase(PHRASE.cancel),
            type: 'secondary',
            callback: () => answer(false),
          },
          {
            text: this.grid.getTranslatedPhrase(PHRASE.ok),
            type: 'primary',
            callback: () => answer(true),
          },
        ],
      },
      contentClassName: 'cm-dialog--confirm',
      // Dismissing a confirmation without answering is a "no", not a silence:
      // a caller waiting on the answer must always get one.
      onHide: () => {
        if (!answered) {
          cancelled?.(false);
        }
      },
    });
  }

  /** Names the dialog, so a screen reader announces more than "dialog". */
  #describe(overlay: HTMLElement, a11y: DialogA11y): void {
    overlay.setAttribute('role', a11y.role ?? 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    // A name and a reference to one cannot both be the name. The reference
    // wins, because it points at something the reader can also see.
    if (a11y.ariaLabelledby !== undefined) {
      overlay.setAttribute('aria-labelledby', a11y.ariaLabelledby);
      overlay.removeAttribute('aria-label');
    } else {
      overlay.setAttribute('aria-label', a11y.ariaLabel ?? 'Dialog');
      overlay.removeAttribute('aria-labelledby');
    }
    if (a11y.ariaDescribedby !== undefined) {
      overlay.setAttribute('aria-describedby', a11y.ariaDescribedby);
    } else {
      overlay.removeAttribute('aria-describedby');
    }
  }

  #fill(box: HTMLElement, options: DialogOptions): void {
    if (options.template) {
      this.#fillTemplate(box, options.template);
      return;
    }
    delete box.dataset['template'];
    const content = options.content ?? '';
    if (options.contentType === 'html') {
      // Through the same door the cell renderers use. This used to assign
      // `innerHTML` outright, so a grid that supplied a sanitizer for its cells
      // still had an unguarded way in.
      writeHtml(box, content, this.grid.getSettings().sanitizer, 'Dialog');
    } else {
      box.textContent = content;
    }
  }

  #fillTemplate(box: HTMLElement, template: DialogTemplate): void {
    const doc = box.ownerDocument;
    box.replaceChildren();
    if (template.type) {
      box.dataset['template'] = template.type;
    }
    if (template.title !== undefined) {
      const title = doc.createElement('h2');
      title.className = 'cm-dialog-title';
      title.textContent = template.title;
      box.appendChild(title);
    }
    if (template.description !== undefined) {
      const description = doc.createElement('p');
      description.className = 'cm-dialog-description';
      description.textContent = template.description;
      box.appendChild(description);
    }
    this.#addButtons(box, template.buttons ?? []);
  }

  #addButtons(box: HTMLElement, buttons: DialogButton[]): void {
    if (buttons.length === 0) {
      return;
    }
    const row = box.ownerDocument.createElement('div');
    row.className = 'cm-dialog-buttons';
    for (const { text, type, callback } of buttons) {
      const button = box.ownerDocument.createElement('button');
      button.type = 'button';
      if (type) {
        button.dataset['type'] = type;
      }
      button.textContent = text;
      if (callback) {
        button.addEventListener('click', callback);
      }
      row.appendChild(button);
    }
    box.appendChild(row);
  }
}

registerPlugin(Dialog);

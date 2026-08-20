/**
 * Modal dialogs over the grid.
 *
 * The dialog covers the table and takes the keyboard, which is what makes it
 * modal rather than merely a box on top: while it is open, typing must not
 * reach the cell underneath. Escape closes it, because a modal you cannot
 * dismiss is a trap.
 */

import { BasePlugin, registerPlugin } from './base.js';

export interface DialogOptions {
  /** Plain text, or HTML when `contentType` says so. */
  content?: string;
  contentType?: 'text' | 'html';
  /** Whether Escape and a click on the background close it. */
  closable?: boolean;
  /** Extra classes on the dialog box. */
  contentClassName?: string;
  background?: 'dark' | 'light' | 'none';
  animation?: boolean;
  /** Called after it closes. */
  onHide?: () => void;
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
    this.#options = { closable: true, background: 'dark', ...options };

    const doc = view.root.ownerDocument;
    const overlay = doc.createElement('div');
    overlay.className = 'cm-dialog-overlay';
    overlay.dataset['background'] = this.#options.background ?? 'dark';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const box = doc.createElement('div');
    box.className = ['cm-dialog', this.#options.contentClassName].filter(Boolean).join(' ');
    box.tabIndex = -1;
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
    view.root.appendChild(overlay);
    this.#overlay = overlay;
    this.focus();
    this.grid.hooks.run('afterDialogShow', undefined, this.#options);
  }

  /** Changes what an open dialog says without closing it. */
  update(options: DialogOptions): void {
    this.#options = { ...this.#options, ...options };
    const box = this.#overlay?.querySelector('.cm-dialog');
    if (box instanceof HTMLElement) {
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
    this.grid.hooks.run('afterDialogHide', undefined);
  }

  /** Puts the keyboard in the dialog. */
  focus(): void {
    const box = this.#overlay?.querySelector('.cm-dialog');
    if (box instanceof HTMLElement) {
      box.focus();
    }
  }

  /** A dialog with a message and one button. */
  showAlert(message: string, callback?: () => void): void {
    this.show({
      content: message,
      onHide: callback,
      contentClassName: 'cm-dialog--alert',
    });
    this.#addButtons([{ label: 'OK', action: () => this.hide() }]);
  }

  /** A dialog with two buttons, which reports which was chosen. */
  showConfirm(message: string, callback?: (confirmed: boolean) => void): void {
    let answered = false;
    this.show({
      content: message,
      contentClassName: 'cm-dialog--confirm',
      // Dismissing a confirmation without answering is a "no", not a silence:
      // a caller waiting on the answer must always get one.
      onHide: () => {
        if (!answered) {
          callback?.(false);
        }
      },
    });
    this.#addButtons([
      {
        label: 'Cancel',
        action: () => {
          answered = true;
          this.hide();
          callback?.(false);
        },
      },
      {
        label: 'OK',
        action: () => {
          answered = true;
          this.hide();
          callback?.(true);
        },
      },
    ]);
  }

  #fill(box: HTMLElement, options: DialogOptions): void {
    const content = options.content ?? '';
    if (options.contentType === 'html') {
      box.innerHTML = content;
    } else {
      box.textContent = content;
    }
  }

  #addButtons(buttons: Array<{ label: string; action: () => void }>): void {
    const box = this.#overlay?.querySelector('.cm-dialog');
    if (!(box instanceof HTMLElement)) {
      return;
    }
    const row = box.ownerDocument.createElement('div');
    row.className = 'cm-dialog-buttons';
    for (const { label, action } of buttons) {
      const button = box.ownerDocument.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', action);
      row.appendChild(button);
    }
    box.appendChild(row);
  }
}

registerPlugin(Dialog as never);

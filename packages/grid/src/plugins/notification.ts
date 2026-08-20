/**
 * Transient messages in a corner of the grid.
 *
 * Each message has an id so it can be taken down again by whoever raised it,
 * and messages queue rather than replacing each other — two things going wrong
 * at once should show two messages, not one.
 */

import { BasePlugin, registerPlugin } from './base.js';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface NotificationOptions {
  message: string;
  type?: NotificationType;
  /** How long before it goes by itself, in ms. `0` means it stays. */
  timeout?: number;
  /** An id of your own, so the same message does not stack up. */
  id?: string;
  closable?: boolean;
}

export class Notification extends BasePlugin {
  static override readonly pluginName: string = 'notification';

  #container: HTMLElement | null = null;
  #shown = new Map<string, { element: HTMLElement; timer: ReturnType<typeof setTimeout> | null }>();
  #counter = 0;

  override isEnabled(): boolean {
    return this.grid.getSettings().notification !== false;
  }

  protected override onEnable(): void {
    // The container appears with the first message.
  }

  protected override onDisable(): void {
    this.hideAll();
    this.#container?.remove();
    this.#container = null;
  }

  /** Shows a message and returns its id. */
  showMessage(options: NotificationOptions): string {
    const view = this.grid.view;
    if (!view) {
      return '';
    }
    const id = options.id ?? `notification-${(this.#counter += 1)}`;
    // Re-showing an id replaces the message rather than stacking a duplicate.
    this.hide(id);

    const doc = view.root.ownerDocument;
    const container = this.#ensureContainer(doc, view.root);
    const element = doc.createElement('div');
    element.className = `cm-notification cm-notification--${options.type ?? 'info'}`;
    element.dataset['id'] = id;
    element.setAttribute('role', options.type === 'error' ? 'alert' : 'status');

    const text = doc.createElement('span');
    text.className = 'cm-notification-text';
    text.textContent = options.message;
    element.appendChild(text);

    if (options.closable !== false) {
      const close = doc.createElement('button');
      close.type = 'button';
      close.className = 'cm-notification-close';
      close.textContent = '×';
      close.addEventListener('click', () => this.hide(id));
      element.appendChild(close);
    }
    container.appendChild(element);

    const timeout = options.timeout ?? 4000;
    const timer = timeout > 0 ? setTimeout(() => this.hide(id), timeout) : null;
    this.#shown.set(id, { element, timer });
    this.grid.hooks.run('afterNotificationShow', undefined, id, options);
    return id;
  }

  /** Takes one message down. */
  hide(id: string): void {
    const entry = this.#shown.get(id);
    if (!entry) {
      return;
    }
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
    }
    entry.element.remove();
    this.#shown.delete(id);
    this.grid.hooks.run('afterNotificationHide', undefined, id);
  }

  /** Takes them all down. */
  hideAll(): void {
    for (const id of [...this.#shown.keys()]) {
      this.hide(id);
    }
  }

  /** Whether one message, or any at all, is showing. */
  isVisible(id?: string): boolean {
    return id === undefined ? this.#shown.size > 0 : this.#shown.has(id);
  }

  /** How many are showing. */
  getQueueSize(): number {
    return this.#shown.size;
  }

  #ensureContainer(doc: Document, root: HTMLElement): HTMLElement {
    if (!this.#container) {
      this.#container = doc.createElement('div');
      this.#container.className = 'cm-notifications';
      root.appendChild(this.#container);
    }
    return this.#container;
  }
}

registerPlugin(Notification as never);

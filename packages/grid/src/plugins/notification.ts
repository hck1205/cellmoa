/**
 * Transient messages in a corner of the grid.
 *
 * Each message has an id so it can be taken down again by whoever raised it,
 * and messages queue rather than replacing each other — two things going wrong
 * at once should show two messages, not one.
 *
 * There is a stack per corner rather than one list, because a corner is a
 * position a caller chooses: a toast asked for the top start and shown at the
 * bottom end is in the wrong place, and covering the pager is exactly what a
 * caller avoids by asking for the other end.
 */

import { PHRASE } from '../i18n/keys.js';
import { BasePlugin, registerPlugin } from './base.js';

/** How loud the message is, and what colour it takes. */
export type NotificationVariant = 'info' | 'success' | 'warning' | 'error';

/**
 * The older spelling of {@link NotificationVariant}.
 *
 * @deprecated Use `NotificationVariant`.
 */
export type NotificationType = NotificationVariant;

/** Which corner of the grid the message stacks in. */
export type NotificationPosition = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';

/** The corner used when none was asked for. */
export const DEFAULT_NOTIFICATION_POSITION: NotificationPosition = 'bottom-end';

/** How long a message stays when it did not say, in ms. */
export const DEFAULT_NOTIFICATION_DURATION = 4000;

export interface NotificationAction {
  label: string;
  type?: 'primary' | 'secondary';
  callback?: () => void;
  /**
   * The older spelling of `callback`.
   *
   * @deprecated Use `callback`.
   */
  onClick?: () => void;
}

export interface NotificationOptions {
  message: string;
  /** A short heading above the message. */
  title?: string;
  variant?: NotificationVariant;
  /**
   * The older spelling of `variant`.
   *
   * @deprecated Use `variant`.
   */
  type?: NotificationVariant;
  /** How long before it goes by itself, in ms. `0` means it stays. */
  duration?: number;
  /**
   * The older spelling of `duration`.
   *
   * @deprecated Use `duration`.
   */
  timeout?: number;
  /** Which corner it stacks in. */
  position?: NotificationPosition;
  /** An id of your own, so the same message does not stack up. */
  id?: string;
  closable?: boolean;
  /**
   * Buttons on the message.
   *
   * A message that reports a failure the reader can do something about should
   * offer to do it — "could not load" with a **Refetch** button is a different
   * message from "could not load" alone. The message goes away when an action
   * is taken, because the action is the reader's answer to it.
   */
  actions?: NotificationAction[];
}

export interface NotificationSettings {
  /**
   * How many messages may be on screen at once.
   *
   * Past it they wait their turn instead of burying the grid; the one that has
   * been up longest going away is what makes room for the next.
   */
  stackLimit?: number;
}

/** A message that is on screen. */
interface Shown {
  element: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  position: NotificationPosition;
}

export class Notification extends BasePlugin {
  static override readonly pluginName: string = 'notification';

  #stacks = new Map<NotificationPosition, HTMLElement>();
  #shown = new Map<string, Shown>();
  #queue: Array<{ id: string; options: NotificationOptions }> = [];
  #counter = 0;

  override isEnabled(): boolean {
    return this.grid.getSettings().notification !== false;
  }

  protected override onEnable(): void {
    // The container appears with the first message.
  }

  protected override onDisable(): void {
    this.hideAll();
    for (const stack of this.#stacks.values()) {
      stack.remove();
    }
    this.#stacks.clear();
  }

  /**
   * Shows a message and returns its id.
   *
   * An empty id means the message was refused: `beforeNotificationShow` runs
   * once per call, whether the message goes up now or waits behind the stack
   * limit, so a caller that vetoes gets nothing shown and nothing queued.
   */
  showMessage(options: NotificationOptions): string {
    const view = this.grid.view;
    if (!view) {
      return '';
    }
    if (this.grid.hooks.allows('beforeNotificationShow', options) === false) {
      return '';
    }
    const id = options.id ?? `notification-${(this.#counter += 1)}`;
    // Re-showing an id replaces the message rather than stacking a duplicate.
    // It is not a hide, so it does not run the hide hooks: a caller vetoing
    // `beforeNotificationHide` is keeping a toast on screen, not refusing to
    // let its text be corrected.
    this.#remove(id);
    this.#queue = this.#queue.filter((waiting) => waiting.id !== id);

    const limit = this.options<NotificationSettings>().stackLimit;
    if (typeof limit === 'number' && limit > 0 && this.#shown.size >= limit) {
      this.#queue.push({ id, options });
      return id;
    }
    this.#mount(id, options);
    return id;
  }

  /** Takes one message down. */
  hide(id: string): void {
    const entry = this.#shown.get(id);
    if (!entry) {
      // A message still waiting its turn is dropped rather than left to appear
      // after the caller has already said it is no longer wanted.
      this.#queue = this.#queue.filter((waiting) => waiting.id !== id);
      return;
    }
    if (this.grid.hooks.allows('beforeNotificationHide', id) === false) {
      // The veto has to stop the clock as well. Otherwise the timeout that was
      // already running takes the message away a moment later, and the refusal
      // reads as having worked for exactly as long as nobody was looking.
      if (entry.timer !== null) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      return;
    }
    this.#remove(id);
    this.grid.hooks.notify('afterNotificationHide', id);
    this.#pump();
  }

  /** Takes them all down, and forgets the ones still waiting. */
  hideAll(): void {
    // The queue goes first, so the room each `hide` makes is not immediately
    // filled by a message the caller has just said it no longer wants.
    this.#queue = [];
    for (const id of [...this.#shown.keys()]) {
      this.hide(id);
    }
  }

  /** Whether one message, or any at all, is showing. */
  isVisible(id?: string): boolean {
    return id === undefined ? this.#shown.size > 0 : this.#shown.has(id);
  }

  /** How many messages are waiting behind the stack limit. */
  getQueueSize(): number {
    return this.#queue.length;
  }

  /** How many are on screen. */
  getVisibleCount(): number {
    return this.#shown.size;
  }

  /** Builds a message and puts it in its corner. */
  #mount(id: string, options: NotificationOptions): void {
    const view = this.grid.view;
    if (!view) {
      return;
    }
    const variant = options.variant ?? options.type ?? 'info';
    const position = options.position ?? DEFAULT_NOTIFICATION_POSITION;
    const doc = view.root.ownerDocument;
    const container = this.#ensureStack(doc, view.overlay, position);
    const element = doc.createElement('div');
    element.className = `cm-notification cm-notification--${variant}`;
    element.dataset['id'] = id;
    // An error interrupts; anything else waits its turn in the reader's
    // screen reader rather than cutting off what is being read.
    element.setAttribute('role', variant === 'error' ? 'alert' : 'status');
    element.setAttribute('aria-live', variant === 'error' ? 'assertive' : 'polite');

    if (options.title !== undefined) {
      const title = doc.createElement('div');
      title.className = 'cm-notification-title';
      title.textContent = options.title;
      element.appendChild(title);
    }

    const text = doc.createElement('span');
    text.className = 'cm-notification-text';
    text.textContent = options.message;
    element.appendChild(text);

    for (const action of options.actions ?? []) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'cm-notification-action';
      if (action.type) {
        button.dataset['type'] = action.type;
      }
      button.textContent = action.label;
      button.addEventListener('click', () => {
        this.hide(id);
        (action.callback ?? action.onClick)?.();
      });
      element.appendChild(button);
    }

    if (options.closable !== false) {
      const close = doc.createElement('button');
      close.type = 'button';
      close.className = 'cm-notification-close';
      close.textContent = '×';
      // The glyph is a multiplication sign, which reads as nothing useful, so
      // the button needs a name of its own.
      close.setAttribute('aria-label', this.grid.getTranslatedPhrase(PHRASE.NOTIFICATION_CLOSE));
      close.addEventListener('click', () => this.hide(id));
      element.appendChild(close);
    }
    container.appendChild(element);

    const duration = options.duration ?? options.timeout ?? DEFAULT_NOTIFICATION_DURATION;
    const timer = duration > 0 ? setTimeout(() => this.hide(id), duration) : null;
    this.#shown.set(id, { element, timer, position });
    this.grid.hooks.notify('afterNotificationShow', id, options);
  }

  /** Takes a message off the screen without saying anything about it. */
  #remove(id: string): void {
    const entry = this.#shown.get(id);
    if (!entry) {
      return;
    }
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
    }
    entry.element.remove();
    this.#shown.delete(id);
    const stack = this.#stacks.get(entry.position);
    if (stack && stack.childElementCount === 0) {
      // An empty stack is still a positioned box in the overlay, and an
      // invisible box in a corner is something for a click to land on.
      stack.remove();
      this.#stacks.delete(entry.position);
    }
  }

  /**
   * Lets the next waiting message up, if there is room.
   *
   * `beforeNotificationShow` already ran for it when it was queued and does not
   * run again, so a caller sees one hook per call rather than one per mount.
   */
  #pump(): void {
    const limit = this.options<NotificationSettings>().stackLimit;
    while (
      this.#queue.length > 0 &&
      (typeof limit !== 'number' || limit <= 0 || this.#shown.size < limit)
    ) {
      const next = this.#queue.shift();
      if (next) {
        this.#mount(next.id, next.options);
      }
    }
  }

  #ensureStack(
    doc: Document,
    overlay: HTMLElement,
    position: NotificationPosition,
  ): HTMLElement {
    let stack = this.#stacks.get(position);
    if (!stack) {
      stack = doc.createElement('div');
      stack.className = 'cm-notifications';
      stack.dataset['position'] = position;
      overlay.appendChild(stack);
      this.#stacks.set(position, stack);
    }
    return stack;
  }
}

registerPlugin(Notification);

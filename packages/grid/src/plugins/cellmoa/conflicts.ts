/**
 * Telling the user when their edit was refused.
 *
 * Every write carries the revision it was computed against, and the engine
 * refuses one made against a revision the workbook has moved past. That guard
 * is what stops an agent and a person overwriting each other — but a guard
 * whose refusals are silent is worse than no guard, because the user believes
 * they typed something they did not.
 *
 * Handsontable has no counterpart: it has no second writer to collide with.
 */

import { BasePlugin, registerPlugin } from '../base.js';

export interface ConflictsSettings {
  /** Show a message when a write is refused. Defaults to true. */
  notify?: boolean;
  /** What the message says. */
  message?: (revision: number) => string;
}

export class Conflicts extends BasePlugin {
  static override readonly pluginName: string = 'conflicts';

  #refusals: Array<{ revision: number; at: number }> = [];

  override isEnabled(): boolean {
    return this.grid.getSettings().conflicts !== false;
  }

  protected override onEnable(): void {
    this.addHook('afterRevisionConflict', (_value: unknown, revision: number) =>
      this.#onConflict(revision),
    );
  }

  protected override onDisable(): void {
    this.#refusals = [];
  }

  /** Every refused write this session, oldest first. */
  getRefusals(): Array<{ revision: number; at: number }> {
    return this.#refusals.map((refusal) => ({ ...refusal }));
  }

  /** Forgets them. */
  clear(): void {
    this.#refusals = [];
  }

  /** The message a refusal produces. */
  messageFor(revision: number): string {
    const message = this.options<ConflictsSettings>().message;
    if (message) {
      return message(revision);
    }
    return `Someone else changed this workbook (now at revision ${revision}). Your change was not applied.`;
  }

  #onConflict(revision: number): void {
    // `at` comes from the grid rather than the journal: this is a UI event, not
    // an edit, and nothing about it has to replay.
    this.#refusals.push({ revision, at: Date.now() });

    if (this.options<ConflictsSettings>().notify === false) {
      return;
    }
    const notifications = this.grid.getPlugin('notification') as unknown as {
      showMessage(options: { message: string; type: string; timeout: number }): string;
    } | null;
    notifications?.showMessage({
      message: this.messageFor(revision),
      type: 'warning',
      timeout: 0,
    });
  }
}

registerPlugin(Conflicts as never);

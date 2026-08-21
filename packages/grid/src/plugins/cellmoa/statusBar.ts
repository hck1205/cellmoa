/**
 * A bar along the bottom showing the workbook's fingerprint and revision.
 *
 * The fingerprint is what makes "this is the same workbook I checked" a
 * statement you can verify rather than assume. Showing it costs a line of
 * screen and turns the guarantee into something a person can act on: two
 * fingerprints that match mean the inputs and the values agree, and two that
 * differ say exactly which of the two changed.
 *
 * Handsontable has no counterpart.
 */

import { BasePlugin, registerPlugin } from '../base.js';

export interface StatusBarSettings {
  /** How much of the digest to show. A full SHA-256 is unreadable. */
  digestLength?: number;
  showRevision?: boolean;
  showFingerprint?: boolean;
  showSelection?: boolean;
}

/** The three digests the engine reports. */
export interface Fingerprint {
  workbook: string;
  inputs: string;
  values: string;
}

export class StatusBar extends BasePlugin {
  static override readonly pluginName: string = 'statusBar';

  #element: HTMLElement | null = null;

  override isEnabled(): boolean {
    return this.switchedOn();
  }

  protected override onEnable(): void {
    this.addHook('afterChange', () => this.refresh());
    this.addHook('afterUndo', () => this.refresh());
    this.addHook('afterRedo', () => this.refresh());
    this.addHook('afterSelection', () => this.refresh());
    this.refresh();
  }

  protected override onDisable(): void {
    this.grid.view?.layout.unregister('statusBar', 'bottom');
    this.#element = null;
  }

  /** The workbook's three digests. */
  getFingerprint(): Fingerprint {
    const response = this.grid.engine.call({ op: 'fingerprint' });
    const digests = (response['fingerprint'] ?? {}) as Partial<Fingerprint>;
    return {
      workbook: digests.workbook ?? '',
      inputs: digests.inputs ?? '',
      values: digests.values ?? '',
    };
  }

  /** The bar's element, or `null` when it is not up. */
  get element(): HTMLElement | null {
    return this.#element;
  }

  /** What the bar currently says, as plain text. */
  getText(): string {
    return this.#element?.textContent ?? '';
  }

  /** Rebuilds the bar. */
  refresh(): void {
    const view = this.grid.view;
    if (!view) {
      return;
    }
    const options = this.options<StatusBarSettings>();
    const doc = view.root.ownerDocument;
    if (!this.#element) {
      this.#element = doc.createElement('div');
      this.#element.className = 'cm-status-bar';
      this.#element.setAttribute('role', 'status');
      // Into the slot below the grid rather than on top of it: a status bar
      // that covered the last row would hide the thing it describes.
      view.layout.register('statusBar', this.#element, { side: 'bottom', weight: 200 });
    }
    this.#element.replaceChildren();

    if (options.showSelection !== false) {
      const range = this.grid.getSelectedRangeLast();
      this.#field(
        doc,
        'selection',
        range
          ? `${this.grid.getColHeader(range.startCol)}${range.topRow + 1}` +
              (range.cellCount > 1 ? ` (${range.cellCount} cells)` : '')
          : '—',
      );
    }
    if (options.showRevision !== false) {
      this.#field(doc, 'revision', `r${this.grid.revision}`);
    }
    if (options.showFingerprint !== false) {
      const length = options.digestLength ?? 12;
      const fingerprint = this.getFingerprint();
      const field = this.#field(doc, 'fingerprint', fingerprint.workbook.slice(0, length));
      // The full digests are on the element, so a copy is a copy of the real
      // thing rather than of the abbreviation on screen.
      field.title = `workbook ${fingerprint.workbook}\ninputs ${fingerprint.inputs}\nvalues ${fingerprint.values}`;
      field.dataset['workbook'] = fingerprint.workbook;
      field.dataset['inputs'] = fingerprint.inputs;
      field.dataset['values'] = fingerprint.values;
    }
  }

  #field(doc: Document, name: string, text: string): HTMLElement {
    const field = doc.createElement('span');
    field.className = `cm-status-field cm-status-field--${name}`;
    field.dataset['field'] = name;
    field.textContent = text;
    this.#element?.appendChild(field);
    return field;
  }
}

registerPlugin(StatusBar);

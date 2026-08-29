/**
 * The two halves of a dark theme have to agree.
 *
 * A theme that follows the system has to be written twice: once against
 * `[data-theme='dark']`, for a reader who chose dark, and once inside
 * `@media (prefers-color-scheme: dark)`, for a reader who chose nothing. CSS
 * has no way to share a value between a selector and a media query, so the
 * declarations are duplicated on purpose — three themes, five properties, two
 * places each.
 *
 * Duplicated on purpose is still duplicated. Nothing stops someone adjusting
 * one background colour and not the other, and the result is a grid that looks
 * right until the reader switches their system theme instead of the toggle.
 * That is not preventable in CSS, so it is checked here instead.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Vitest serves this module over a dev-server URL rather than from the file
// system, so `import.meta.url` is not a file: URL here and cannot be handed
// straight to `readFileSync`.
const here = dirname(fileURLToPath(new URL(import.meta.url, 'file:///')));
const css = readFileSync(join(here, '../src/themes/themes.css'), 'utf8');

/** Custom properties a block declares, in a form two blocks can be compared by. */
function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  return out;
}

/** Every `selector { ... }` in the stylesheet, media queries flattened away. */
function blocks(): Array<{ selector: string; body: string }> {
  const found: Array<{ selector: string; body: string }> = [];
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    found.push({ selector: selector.trim().split('\n').pop()?.trim() ?? '', body });
  }
  return found;
}

/** The themes that follow the system, found rather than listed. */
function autoThemes(): string[] {
  return [...new Set([...css.matchAll(/\.ht-theme-([\w-]+)-auto/g)].map((m) => m[1]))];
}

describe('the dark themes', () => {
  it('has at least one that follows the system', () => {
    expect(autoThemes().length).toBeGreaterThan(0);
  });

  for (const theme of autoThemes()) {
    it(`declares the same values in both halves of ${theme}`, () => {
      const all = blocks();
      const chosen = all.find((b) => b.selector.includes(`.ht-theme-${theme}-auto:where(`));
      const system = all.find((b) => b.selector.includes(`.ht-theme-${theme}-auto:not(`));

      expect(chosen, `no [data-theme] half for ${theme}`).toBeDefined();
      expect(system, `no prefers-color-scheme half for ${theme}`).toBeDefined();
      expect(declarations(system?.body ?? '')).toEqual(declarations(chosen?.body ?? ''));
    });
  }
});

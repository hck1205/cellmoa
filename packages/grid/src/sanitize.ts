/**
 * Writing HTML into the page, when there is any.
 *
 * This grid ships no sanitizer, as the reference stopped doing in v18: a
 * bundled one goes stale, and the caller is the only one who knows what their
 * content is allowed to contain. What this file guarantees is that every path
 * that writes HTML goes through the *same* door, so a caller who supplies a
 * `sanitizer` has actually covered all of them.
 *
 * That was the bug this exists to prevent. Cell renderers ran the sanitizer;
 * the dialog assigned `innerHTML` directly, consulting neither the sanitizer
 * nor `allowHtml`. A grid configured exactly as the security guide says still
 * had one unguarded way in.
 */

/** Where the content is going, so a sanitizer can be stricter about some of it. */
export type SanitizeSource = 'innerHTML' | 'CopyPaste.paste' | 'Dialog';

/** A caller's sanitizer: raw HTML in, safe HTML out. */
export type Sanitizer = (content: string, source: SanitizeSource) => string;

/**
 * Puts HTML into an element, through the sanitizer when there is one.
 *
 * With no sanitizer the content is written as it is — the reference's
 * documented default, and the reason the guide tells you to supply one. The
 * choice is the caller's, but it has to be a choice they made rather than a
 * path they never knew about.
 */
export function writeHtml(
  target: HTMLElement,
  content: string,
  sanitizer: unknown,
  source: SanitizeSource,
): void {
  target.innerHTML =
    typeof sanitizer === 'function' ? String((sanitizer as Sanitizer)(content, source)) : content;
}

/**
 * Rules the dictionaries have to keep, rather than strings anyone can read.
 *
 * A translation is checked by someone who speaks the language, and nobody here
 * does for twenty-one of them. What can be checked is the structure and the
 * few orthographic rules that are absolute — and those are exactly where a
 * copy-and-edit leaves something behind.
 *
 * The Swiss dictionary is the case that prompted this. It is German with three
 * strings deliberately respelled — `Grösser`, `Ausserhalb` — so whoever wrote
 * it knew that Swiss orthography has no `ß` at all. One string still said
 * `Schließen`. A rule catches that; a reading of ninety-six strings does not.
 */

import { describe, expect, it } from 'vitest';
import { DICTIONARIES, DEFAULT_LANGUAGE, phrase, registerLanguage } from '../src/i18n/index.js';
import { PHRASE } from '../src/i18n/keys.js';

const entries = Object.entries(DICTIONARIES);

/** Every string a dictionary holds, plural forms included. */
function texts(dictionary: Record<string, unknown>): string[] {
  return Object.values(dictionary).flatMap((value) =>
    typeof value === 'string' ? [value] : Array.isArray(value) ? value.map(String) : [],
  );
}

describe('the dictionaries', () => {
  it('has more than one language and a default among them', () => {
    expect(entries.length).toBeGreaterThan(1);
    expect(DICTIONARIES[DEFAULT_LANGUAGE]).toBeDefined();
  });

  it('defines every phrase the code asks for in the fallback language', () => {
    // A key the fallback is missing shows the caller the key itself, which is
    // the one failure mode `phrase()` cannot hide.
    const fallback = DICTIONARIES[DEFAULT_LANGUAGE] ?? {};
    const asked = Object.values(PHRASE);
    const missing = asked.filter((key) => fallback[key] === undefined);
    expect(missing).toEqual([]);
  });

  it('has no key that only a non-default language knows', () => {
    // A locale may leave a key out — `phrase()` falls back per key, so the
    // reader gets English for that one string. What it must not do is invent
    // one: a mistyped key here never matches a lookup, and nothing says so.
    const fallback = new Set(Object.keys(DICTIONARIES[DEFAULT_LANGUAGE] ?? {}));
    for (const [language, dictionary] of entries) {
      const orphans = Object.keys(dictionary).filter((key) => !fallback.has(key));
      expect(orphans, `${language} defines keys the fallback does not`).toEqual([]);
    }
  });

  it('spells Swiss German without the sharp s, which it does not have', () => {
    const swiss = DICTIONARIES['de-CH'];
    expect(swiss, 'de-CH should exist').toBeDefined();
    const offenders = texts(swiss ?? {}).filter((text) => text.includes('ß'));
    expect(offenders).toEqual([]);
  });

  it('leaves no phrase empty', () => {
    // An empty string is indistinguishable from a missing translation on
    // screen and does not fall back, because the key is present.
    for (const [language, dictionary] of entries) {
      const blank = Object.entries(dictionary)
        .filter(([, value]) => (typeof value === 'string' ? value.trim() === '' : false))
        .map(([key]) => key);
      expect(blank, `${language} has blank phrases`).toEqual([]);
    }
  });

  it('keeps every placeholder the fallback uses', () => {
    // `Seite [currentPage] von [totalPages]` only works if the placeholders
    // survive translation. One dropped in a translation shows a sentence with
    // a hole in it.
    const fallback = DICTIONARIES[DEFAULT_LANGUAGE] ?? {};
    const placeholders = (text: string) => (text.match(/\[[a-zA-Z]+\]/g) ?? []).sort();
    for (const [language, dictionary] of entries) {
      if (language === DEFAULT_LANGUAGE) continue;
      for (const [key, value] of Object.entries(dictionary)) {
        const source = fallback[key];
        if (typeof source !== 'string' || typeof value !== 'string') continue;
        expect(placeholders(value), `${language} ${key}`).toEqual(placeholders(source));
      }
    }
  });

  it('keeps a language\u2019s own words rather than the English it is filled in from', () => {
    // Every dictionary is built as `{ ...english, ...theirs }`, so the English
    // phrases fill any gap. That makes a completeness check meaningless — the
    // constructor guarantees it — and hides the failure that actually matters:
    // written the other way round, `{ ...theirs, ...english }`, every key is
    // still there and every one of the twenty translations is silently English.
    //
    // So the rule is not "no key is missing" but "the translation won". A
    // language is expected to differ from English on most of what it defines;
    // asking for a clear majority states that without naming any one string.
    const english = DICTIONARIES[DEFAULT_LANGUAGE] ?? {};
    for (const [language, dictionary] of entries) {
      if (language === DEFAULT_LANGUAGE) continue;
      const keys = Object.keys(english);
      const translated = keys.filter(
        (key) => JSON.stringify(dictionary[key]) !== JSON.stringify(english[key]),
      );
      expect(
        translated.length,
        `${language} matches English on ${keys.length - translated.length} of ${keys.length} phrases \u2014 is it being filled in over its own words?`,
      ).toBeGreaterThan(keys.length / 2);
    }
  });
});

describe('a phrase that a language does not have', () => {
  it('falls back to the default language rather than showing the key', () => {
    // A caller registering one phrase gets the other hundred and seven in
    // English rather than a grid full of raw keys, because `registerLanguage`
    // fills in from the default too. That is the normal shape of a caller's own
    // dictionary, and nothing else in the suite passes a partial one.
    registerLanguage('xx-XX', { 'Common:ok': 'Ja' });
    expect(phrase('xx-XX', 'Common:ok')).toBe('Ja');
    expect(phrase('xx-XX', PHRASE.contextMenuUndo)).toBe(
      phrase(DEFAULT_LANGUAGE, PHRASE.contextMenuUndo),
    );
  });

  it('shows the key when no language has it, rather than nothing at all', () => {
    expect(phrase(DEFAULT_LANGUAGE, 'Nobody:knows.this')).toBe('Nobody:knows.this');
  });

  it('falls back to the default language for a language nobody registered', () => {
    expect(phrase('zz-ZZ', PHRASE.contextMenuUndo)).toBe(
      phrase(DEFAULT_LANGUAGE, PHRASE.contextMenuUndo),
    );
  });
});

/**
 * What the reference documentation asks for, and what this grid answers.
 *
 * The parity table used to list the 162 setting names and say "162". Names are
 * cheap: a setting can be declared, typed, exported and still do nothing. This
 * reads the settings the code actually consults and reports the difference, so
 * the table cannot claim more than the code does.
 *
 *   node scripts/parity.mjs            # summary
 *   node scripts/parity.mjs --missing  # what is still unread
 *   node scripts/parity.mjs --json     # for a machine
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const GRID = new URL('../packages/grid/src/', import.meta.url).pathname;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (name.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

const files = walk(GRID);
const sources = new Map(files.map((path) => [relative(GRID, path), readFileSync(path, 'utf8')]));

/** The declared setting names, from the one list that defines them. */
function declaredSettings() {
  const settings = sources.get('settings.ts') ?? '';
  const block = /export const SETTING_NAMES[^=]*=\s*\[([\s\S]*?)\]/.exec(settings);
  return block ? [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
}

/**
 * Whether the code consults a setting, rather than merely naming it.
 *
 * Reading it out of the settings object or out of a cell's meta both count;
 * appearing in the declaration list or in a type does not. The distinction is
 * the whole point — an unread setting is a promise the grid does not keep.
 */
function pluginNames() {
  const names = new Set();
  for (const [path, text] of sources) {
    if (!path.startsWith('plugins/')) {
      continue;
    }
    for (const match of text.matchAll(/pluginName:\s*string\s*=\s*'([^']+)'/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

const plugins = pluginNames();

function isRead(name) {
  // A plugin reads its own setting by its name, through the base class. The
  // name never appears next to a dot, so pattern-matching alone would report
  // every plugin's setting as dead.
  if (plugins.has(name)) {
    return `plugins/${name}`;
  }
  const patterns = [
    new RegExp(`getSettings\\(\\)(?:\\s*\\.|\\?\\.)\\s*${name}\\b`),
    new RegExp(`getSettings\\(\\)\\[['"]${name}['"]\\]`),
    new RegExp(`\\bmeta(?:Data)?(?:\\s*\\.|\\?\\.)\\s*${name}\\b`),
    new RegExp(`\\bsettings(?:\\s*\\.|\\?\\.)\\s*${name}\\b`),
    new RegExp(`\\boptions(?:\\s*\\.|\\?\\.)\\s*${name}\\b`),
    new RegExp(`\\bcellProperties(?:\\s*\\.|\\?\\.)\\s*${name}\\b`),
    // Bracket access, which is how a plugin reads a setting it does not own.
    new RegExp(`\\[['"]${name}['"]\\]`),
    new RegExp(`['"]${name}['"]\\s*(?:\\]|,)?\\s*(?:in\\b|\\?\\?|===)`),
    new RegExp(`\\.${name}\\s*(?:\\?\\?|===|!==|>|<|\\|\\||&&|;)`),
    // Read off a resolved meta object, which is how a per-column setting is
    // consulted: `forColumn(col).title`.
    new RegExp(`for(?:Column|Cell)\\([^)]*\\)\\.${name}\\b`),
    // Destructured out of the settings object.
    new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*(?:this\\.)?(?:settings|options|getSettings\\(\\))`),
  ];
  for (const [path, text] of sources) {
    if (path === 'settings.ts') {
      continue;
    }
    if (patterns.some((pattern) => pattern.test(text))) {
      return path;
    }
  }
  // `settings.ts` may act on a setting itself (defaults are not action).
  const own = sources.get('settings.ts') ?? '';
  const acting = new RegExp(
    `\\bthis\\.#table\\.${name}\\b|\\bresolved\\.${name}\\b|\\bsettings\\.${name}\\b`,
  );
  return acting.test(own) ? 'settings.ts' : null;
}

const declared = declaredSettings();
const read = [];
const unread = [];
for (const name of declared) {
  const where = isRead(name);
  (where ? read : unread).push(name);
}

const report = {
  settings: { declared: declared.length, read: read.length, unread: unread.length, missing: unread },
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else if (process.argv.includes('--missing')) {
  for (const name of unread) {
    console.log(name);
  }
} else {
  const { declared: d, read: r } = report.settings;
  console.log(`settings  ${r}/${d} read  (${d - r} declared but never consulted)`);
}

process.exitCode = unread.length > 0 && process.argv.includes('--strict') ? 1 : 0;

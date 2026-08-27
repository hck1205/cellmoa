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
    // Destructured out of the settings object. Bounded to one line and to a
    // list of plain names: an unbounded `[^}]*` will happily swallow a whole
    // class body and report every field in it as a setting that is read.
    new RegExp(`\\{[\\w\\s,:]*\\b${name}\\b[\\w\\s,:]*\\}\\s*=\\s*(?:this\\.)?(?:settings|options|getSettings\\(\\))`),
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

/**
 * The core methods the reference exposes, and whether this grid has them.
 *
 * The list is kept here rather than derived from the reference's source,
 * because the source is not on hand at run time — but it is derived *from* it,
 * and a name in it that the grid does not answer to is a name the parity table
 * may not claim.
 */
const CORE_METHODS = readFileSync(
  new URL('./core-methods.txt', import.meta.url).pathname,
  'utf8',
)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

function hasMethod(name) {
  const pattern = new RegExp(`^\\s*(?:static |readonly |get |set |override |async )*${name}\\s*[(<:]`, 'm');
  for (const text of sources.values()) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Names this grid answers to with a different meaning.
 *
 * A name being present is not the same as it behaving as the reference does.
 * Counting one of these as parity would be the exact dishonesty this script
 * exists to prevent, so they are listed, printed, and explained.
 */
const DIVERGENT = {
  getCell:
    "returns the cell's value, not its `<td>` — the element is `getCellElement`",
};

const methodsPresent = CORE_METHODS.filter(hasMethod);
const methodsMissing = CORE_METHODS.filter((name) => !hasMethod(name));

/**
 * The hooks a handler can actually be called on.
 *
 * The table used to say "hooks 253 ✅ — every name registered", which was true
 * and useless: a hook whose name appears nowhere but the list cannot be fired,
 * so a caller who registers a handler on it gets silence. Registering the name
 * is the cheap half.
 *
 * A hook counts as reachable if its name appears anywhere in `src/` outside
 * `hooks.ts`, or if a template literal in a `hooks.run`/`hooks.allows` call
 * could produce it.
 *
 * That second half was missing, and the omission mattered. This used to
 * special-case one template shape — `after${hookPrefix}Show` — and report
 * everything else built from a template as dead. The hiding, move and resize
 * plugins all spell their hooks `` `afterHide${this.#suffix()}` ``, so eight
 * live hooks were counted dead, and the comment here claimed "a hook this
 * reports as dead really is dead", which was not true. A check that overstates
 * the problem is not the safe direction to be wrong in: it costs the reader's
 * trust in every other number on the table.
 */
function hookReachability() {
  const declaration = sources.get('hooks.ts') ?? '';
  const names = [...new Set([...declaration.matchAll(/'([a-zA-Z0-9]+)'/g)].map((m) => m[1]))].filter(
    (name) => /^(after|before|modify)[A-Z]/.test(name) || name === 'init',
  );

  const body = [...sources.entries()]
    .filter(([path]) => path !== 'hooks.ts')
    .map(([, text]) => text)
    .join('\n');

  // Hook names built from a template: `` `afterHide${this.#suffix()}` `` and
  // the like. The interpolations are unknowable statically, so each becomes
  // `\w*` and the literal parts have to match. That is generous — it counts a
  // hook a template *could* produce rather than one it demonstrably does — and
  // generous is the right direction here, because the cost of calling a live
  // hook dead is that nobody believes the table.
  const patterns = [];
  for (const [, literal] of body.matchAll(/hooks\.(?:run|notify|allows)\(\s*`([^`]+)`/g)) {
    const source = literal
      .split(/\$\{[^}]*\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\w*');
    patterns.push(new RegExp(`^${source}$`));
  }

  const dead = names.filter(
    (name) =>
      !patterns.some((pattern) => pattern.test(name)) && !new RegExp(`\\b${name}\\b`).test(body),
  );
  return { declared: names.length, reachable: names.length - dead.length, dead };
}

const hooks = hookReachability();

const report = {
  settings: { declared: declared.length, read: read.length, unread: unread.length, missing: unread },
  methods: {
    declared: CORE_METHODS.length,
    present: methodsPresent.length,
    missing: methodsMissing,
    divergent: DIVERGENT,
  },
  hooks: { declared: hooks.declared, reachable: hooks.reachable, dead: hooks.dead },
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else if (process.argv.includes('--missing')) {
  const what = process.argv.includes('--hooks')
    ? hooks.dead
    : process.argv.includes('--methods')
      ? methodsMissing
      : unread;
  for (const name of what) {
    console.log(name);
  }
} else {
  const { declared: d, read: r } = report.settings;
  const { declared: md, present: mp } = report.methods;
  console.log(`settings  ${r}/${d} read  (${d - r} declared but never consulted)`);
  console.log(`methods   ${mp}/${md} present  (${md - mp} named by the reference and missing)`);
  for (const [name, why] of Object.entries(DIVERGENT)) {
    console.log(`          ${name}: ${why}`);
  }
  const { declared: hd, reachable: hr } = report.hooks;
  console.log(`hooks     ${hr}/${hd} reachable  (${hd - hr} declared that nothing can fire)`);
}

const failing = unread.length + methodsMissing.length + hooks.dead.length;
process.exitCode = failing > 0 && process.argv.includes('--strict') ? 1 : 0;

#!/usr/bin/env node
/**
 * What Handsontable's own type declarations say it has, and what we have.
 *
 * Every earlier answer to "is this built" came from our side of the fence: a
 * story exists, a class exists, a page is listed. This asks the reference
 * instead. `handsontable@18` is installed for the verification stories, and it
 * ships `.d.ts` files — so the set of methods and settings it promises is a
 * fact on disk, not something to recall.
 *
 * A name present here is a name a caller can reach. It is not proof the
 * behaviour behind it is complete: `ManualColumnMove` exists, `moveIndexes`
 * works, and the drag gesture does not. This check finds what is missing
 * outright, which is the part that can be found mechanically.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const HOT = join(ROOT, 'packages/verification/node_modules/handsontable');
const GRID = join(ROOT, 'packages/grid/src');
if (!existsSync(HOT)) {
  console.log('handsontable is not installed; run npm install in packages/verification');
  process.exit(1);
}

/**
 * Members of one named interface in a `.d.ts`, minus the internals.
 *
 * The interface has to be named. Reading a whole file instead reported four
 * Core methods missing that Handsontable does not put on `Core` at all — they
 * belong to `GridHelperInstance` and `ViewportScrollerInstance`, declared in
 * the same file — which turned "no gap" into "four gaps". Members of inline
 * object types nested inside a member are excluded the same way, by taking
 * only the interface's own indentation.
 */
function declared(file, iface, kind) {
  const src = readFileSync(join(HOT, file), 'utf8');
  const open = src.indexOf(`export interface ${iface} {`);
  if (open < 0) throw new Error(`${file}: no interface ${iface} — handsontable's shape changed`);
  const body = src.slice(open, src.indexOf('\n}', open));
  const pattern = kind === 'method' ? /^ {4}(\w+)\s*[(<]/gm : /^ {4}(\w+)\??:/gm;
  return new Set([...body.matchAll(pattern)].map((m) => m[1]).filter((n) => !n.startsWith('_')));
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(full));
    else if (name.name.endsWith('.ts')) out.push(full);
  }
  return out;
}
const source = walk(GRID).map((f) => readFileSync(f, 'utf8'));
const grid = readFileSync(join(GRID, 'grid.ts'), 'utf8');
const settingsSrc = readFileSync(join(GRID, 'settings.ts'), 'utf8');

// Our Grid's own methods, and the settings the grid declares.
const ourMethods = new Set(
  [...grid.matchAll(/^\s{2,}(?:override\s+)?(?:async\s+)?([a-zA-Z]\w*)\s*[(<]/gm)].map((m) => m[1]),
);
// A setting is one the grid reads, which is `SETTING_NAMES` — not one the
// interface happens to name. Both interfaces end in `[key: string]`, the
// reference's included, so neither the type nor this check can lean on the
// declaration: reading only the interface reported eleven settings missing
// that the grid has read all along.
const named = (src, constant) =>
  new Set(
    [
      ...(new RegExp(`${constant}[^=]*=\\s*\\[([\\s\\S]*?)\\]`).exec(src)?.[1] ?? '').matchAll(
        /'([^']+)'/g,
      ),
    ].map((m) => m[1]),
  );
const ourSettings = new Set([
  ...settingsSrc.matchAll(/^ {2}([a-zA-Z]\w*)\??:/gm),
].map((m) => m[1]));
for (const name of named(settingsSrc, 'SETTING_NAMES')) ourSettings.add(name);

const report = [];
function compare(label, theirs, ours, note) {
  // A regex that matches nothing reports every name present, which is how this
  // script first said `0/0 present, 0 missing` and looked like good news. A
  // declaration file with no members in it is a parse failure, not an empty
  // reference.
  if (theirs.size < 20) {
    console.log(`${label}: read only ${theirs.size} names from handsontable — the parse is wrong, not the answer`);
    process.exit(1);
  }
  if (ours.size < 20) {
    console.log(`${label}: read only ${ours.size} names from our source — the parse is wrong`);
    process.exit(1);
  }
  const missing = [...theirs].filter((n) => !ours.has(n)).sort();
  report.push({ label, total: theirs.size, missing, note });
}

compare(
  'Core methods',
  declared('core/types.d.ts', 'HotInstance', 'method'),
  // A method may be reachable from the grid without being written on the class
  // — a plugin can add it. So anything the source defines anywhere counts.
  new Set([...ourMethods, ...source.flatMap((s) => [...s.matchAll(/^\s{2,}(\w+)\s*[(<]/gm)].map((m) => m[1]))]),
);
// Handsontable's `GridSettings` carries every hook as an optional callback, so
// comparing the two interfaces whole counts 280-odd hooks as missing settings.
// They are a different thing with a different home here, so they are counted
// against the hook registry instead — and separately, because "how many
// settings do we take" and "how many hooks can fire" are different questions
// with different answers.
const theirSettings = declared('core/settings.d.ts', 'GridSettings', 'field');
const isHook = (name) => /^(after|before|modify)[A-Z]/.test(name) || name === 'init';
const hooksSrc = readFileSync(join(GRID, 'hooks.ts'), 'utf8');
const ourHooks = named(hooksSrc, 'HOOK_NAMES');

compare(
  'Settings',
  new Set([...theirSettings].filter((n) => !isHook(n))),
  new Set([...ourSettings, ...ourHooks]),
);
compare('Hooks', new Set([...theirSettings].filter(isHook)), ourHooks);

let gaps = 0;
for (const { label, total, missing } of report) {
  gaps += missing.length;
  console.log(`\n${label}: ${total - missing.length}/${total} present`);
  for (const name of missing) console.log(`   missing  ${name}`);
}
console.log(`\n${gaps} names Handsontable declares and we do not`);

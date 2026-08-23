#!/usr/bin/env node
// Proves a Rust refactor moved code rather than changed it.
//
// Splitting a file is the kind of edit that looks obviously safe and is not:
// a brace counted wrong lands in the middle of a body, and the names still
// line up afterwards, so nothing complains. This compares the *text* of every
// function, before and after, and says which ones actually differ.
//
//   node scripts/moved-only-rs.mjs <git-ref> <old-path> <new-path...>
//
// Visibility is normalised away, since a function pulled into a child module
// has to be reachable from the parent, and that is not a change in behaviour.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [ref, oldPath, ...newPaths] = process.argv.slice(2);
if (!ref || !oldPath || newPaths.length === 0) {
  console.error('usage: moved-only-rs.mjs <git-ref> <old-path> <new-path...>');
  process.exit(2);
}

/** Every `fn` in the text, keyed by name, whitespace and visibility flattened. */
function bodies(text) {
  const found = new Map();
  const signature = /^(?:pub(?:\(super\))?(?:\(crate\))? )?fn ([a-z_0-9]+)(<[^>]*>)?\(/gm;
  for (const match of text.matchAll(signature)) {
    const start = match.index;
    let i = text.indexOf('{', start + match[0].length - 1);
    if (i < 0) continue;
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    const body = text
      .slice(start, j + 1)
      .replace(/^(?:pub(?:\(super\))?(?:\(crate\))? )?fn /, 'fn ')
      .replace(/\s+/g, ' ')
      .trim();
    found.set(match[1], body);
  }
  return found;
}

const before = bodies(execFileSync('git', ['show', `${ref}:${oldPath}`], { encoding: 'utf8' }));
const after = new Map();
for (const path of newPaths) {
  for (const [name, body] of bodies(readFileSync(path, 'utf8'))) after.set(name, body);
}

const removed = [...before.keys()].filter((n) => !after.has(n));
const added = [...after.keys()].filter((n) => !before.has(n));
const changed = [...before.keys()].filter((n) => after.has(n) && after.get(n) !== before.get(n));

console.log(`${before.size} functions before, ${after.size} after`);
for (const [label, names] of [['removed', removed], ['added', added], ['changed', changed]]) {
  console.log(`  ${label.padEnd(8)} ${names.length ? names.join(', ') : 'none'}`);
}

const clean = !removed.length && !added.length && !changed.length;
console.log(clean ? '\nmove only' : '\nnot a pure move — the names above differ in body text');
process.exit(clean ? 0 : 1);

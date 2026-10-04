/**
 * Which modules depend on each other in a circle.
 *
 * A type-only cycle is erased by TypeScript and costs nothing at run time, so
 * this is not about crashes. It is about direction: `settings.ts` importing a
 * plugin put the foundational types downstream of the code that reads them, and
 * ninety-nine cycles ran through that one edge. Nothing complained, because
 * nothing was counting.
 *
 *   node scripts/cycles.mjs           # runtime cycles only — these are bugs
 *   node scripts/cycles.mjs --all     # type-only cycles too — these are smells
 *   node scripts/cycles.mjs --strict  # exit non-zero if the budget is exceeded
 *
 * The budget is one: `grid.ts` and `plugins/base.ts` refer to each other by
 * their nature — a grid holds plugins and a plugin holds its grid — and the
 * plugin's half is a type import, so it disappears when compiled.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = 'packages/grid/src';
const BUDGET = 1;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (path.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

const files = walk(ROOT);
const includeTypes = process.argv.includes('--all');

/** Every module each file imports from, by path. */
const graph = new Map();
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const deps = new Set();
  for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)([\s\S]*?)from\s+'(\.[^']+)'/g)) {
    // `import type` is erased, so it cannot make a cycle at run time.
    if (/^\s*type\s/.test(match[1]) && !includeTypes) {
      continue;
    }
    const target = resolve(dirname(file), match[2].replace(/\.js$/, '.ts'));
    let rel = relative(process.cwd(), target);
    if (!files.includes(rel)) {
      rel = relative(process.cwd(), resolve(target.replace(/\.ts$/, ''), 'index.ts'));
    }
    if (files.includes(rel)) {
      deps.add(rel);
    }
  }
  graph.set(file, [...deps]);
}

/** Every distinct circle, found by walking each file's dependencies. */
const cycles = [];
const seen = new Set();
function visit(node, path) {
  const at = path.indexOf(node);
  if (at >= 0) {
    const cycle = path.slice(at).concat(node);
    // The same circle entered at a different point is the same circle.
    const key = [...new Set(cycle)].sort().join('|');
    if (!seen.has(key)) {
      seen.add(key);
      cycles.push(cycle);
    }
    return;
  }
  if (path.length > 10) {
    return;
  }
  for (const dep of graph.get(node) ?? []) {
    visit(dep, [...path, node]);
  }
}
for (const file of files) {
  visit(file, []);
}

const kind = includeTypes ? 'including type-only' : 'runtime only';
console.log(`cycles   ${cycles.length}  (${kind}, budget ${includeTypes ? BUDGET : 0})`);
for (const cycle of cycles) {
  console.log('  ' + cycle.map((path) => path.replace(`${ROOT}/`, '')).join(' → '));
}

const limit = includeTypes ? BUDGET : 0;
process.exitCode = cycles.length > limit && process.argv.includes('--strict') ? 1 : 0;

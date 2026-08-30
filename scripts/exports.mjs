#!/usr/bin/env node
/**
 * Every `export` claims someone can import it. This checks that the claim is
 * true: a name has to be reachable from a package entry point, or used by
 * another file inside the package. A name that is neither is not API — no
 * consumer can reach it — and not internal wiring either, since nothing calls
 * it. It is a leftover, and it misleads the next person into treating it as a
 * contract they have to keep.
 *
 * The entry points are the ones package.json actually publishes; deep imports
 * are not possible, so "exported from some file" means nothing on its own.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'packages', 'grid');
const SRC = join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const text = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

// The tests are consumers too. A name only they use is exported deliberately —
// to let a test reach an internal — and dropping its `export` breaks them at
// run time, where neither tsc (which does not compile test/) nor vitest (which
// strips types without checking them) would say a word. They never *declare*
// what src exports, so they are read for uses only.
const consumers = new Map(text);
for (const f of walk(join(ROOT, 'test'))) consumers.set(f, readFileSync(f, 'utf8'));

// What each file exports by name. Re-exports (`export { x } from`) count as
// carrying the name onward rather than declaring it.
const DECL = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
const declared = new Map();
for (const [file, src] of text) {
  const names = new Set();
  for (const m of src.matchAll(DECL)) names.add(m[1]);
  if (names.size) declared.set(file, names);
}

// Follow re-export chains from the entry points to find what a consumer can
// name. `export * from` carries everything the target declares or re-exports.
const entries = [join(SRC, 'index.ts'), join(SRC, 'themes', 'index.ts')];
const reachable = new Set();
const seen = new Set();
function resolveSpec(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec.replace(/\.js$/, ''));
  for (const cand of [`${base}.ts`, join(base, 'index.ts')]) if (text.has(cand)) return cand;
  return null;
}
function visit(file, wanted /* null = everything */) {
  const key = `${file}::${wanted ? [...wanted].sort().join(',') : '*'}`;
  if (seen.has(key)) return;
  seen.add(key);
  const src = text.get(file);
  if (!src) return;
  const mine = declared.get(file) ?? new Set();
  for (const name of mine) if (!wanted || wanted.has(name)) reachable.add(name);
  // `export { a, b } from './x.js'` and `export * from './x.js'`
  for (const m of src.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/gms)) {
    const target = resolveSpec(file, m[2]);
    if (!target) continue;
    const names = new Set(
      m[1]
        .split(',')
        .map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
        .filter(Boolean),
    );
    const pass = wanted ? new Set([...names].filter((n) => wanted.has(n))) : names;
    for (const n of pass) reachable.add(n);
    if (pass.size) visit(target, pass);
  }
  for (const m of src.matchAll(/^export\s+(?:type\s+)?\*\s+from\s+'([^']+)'/gm)) {
    const target = resolveSpec(file, m[1]);
    if (target) visit(target, wanted);
  }
  // A name re-exported from the entry may be declared in a file this one only
  // imports; follow those too when we are still looking for specific names.
  if (wanted) {
    for (const m of src.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/gms)) {
      const target = resolveSpec(file, m[2]);
      if (!target) continue;
      const names = new Set(
        m[1].split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()),
      );
      const pass = new Set([...names].filter((n) => wanted.has(n)));
      if (pass.size) visit(target, pass);
    }
  }
}
for (const e of entries) visit(e, null);

// The traversal understands three re-export forms. A file using a fourth would
// be walked straight past, and every name behind it reported as unreachable —
// which is how this script once accused 30 live types of being dead. So rather
// than guess, refuse: any `export ... from './x'` line none of the three
// patterns claimed is unknown syntax, and the script says so instead of
// returning a confident wrong answer.
const CLAIMED = [
  /^export\s+(?:type\s+)?\{[^}]*\}\s+from\s+'\.[^']*'/gms,
  /^export\s+(?:type\s+)?\*\s+from\s+'\.[^']*'/gm,
  /^export\s+(?:type\s+)?\*\s+as\s+\w+\s+from\s+'\.[^']*'/gm,
];
const unknown = [];
for (const [file, src] of text) {
  const claimed = new Set();
  for (const re of CLAIMED) for (const m of src.matchAll(re)) claimed.add(m[0].split('\n')[0].trim());
  for (const m of src.matchAll(/^export\b.*\bfrom\s+'\.[^']*'/gm)) {
    if (!claimed.has(m[0].trim())) unknown.push(`${file.slice(ROOT.length + 1)}  ${m[0].trim()}`);
  }
}
if (unknown.length) {
  console.log('exports  UNKNOWN re-export syntax — the reachability answer would be wrong:');
  for (const u of unknown) console.log(`  ${u}`);
  process.exit(1);
}

// A name used by any file other than the one declaring it is internal wiring.
const orphans = [];
for (const [file, names] of declared) {
  for (const name of names) {
    if (reachable.has(name)) continue;
    const used = [...consumers].some(
      ([other, src]) => other !== file && new RegExp(`\\b${name}\\b`).test(src),
    );
    if (!used) orphans.push(`${file.slice(ROOT.length + 1)}  ${name}`);
  }
}

const budget = 0;
console.log(`exports  ${orphans.length} unreachable and unused  (budget ${budget})`);
for (const o of orphans.sort()) console.log(`  ${o}`);
process.exit(orphans.length > budget ? 1 : 0);

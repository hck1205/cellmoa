/**
 * Proves that moving code around a class did not alter any of it.
 *
 *   cp packages/grid/src/grid.ts /tmp/before.ts
 *   # ...reorder...
 *   node scripts/moved-only.mjs /tmp/before.ts packages/grid/src/grid.ts
 *
 * A member-*name* check is not enough: a hand-rolled brace counter once
 * mangled this file's bodies while every name still matched, and the mistake
 * only surfaced when the compiler rejected the result. Names are cheap. This
 * compares the normalised source text of every member, so a body that changed
 * by one character is reported.
 *
 * The second argument is optional — with one file it just counts the members it
 * can see, which is a quick way to check the parser agrees with you.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// TypeScript is a dependency of the grid package, not of the repository root,
// so it is resolved from there rather than from next to this file.
const require = createRequire(new URL('../packages/grid/package.json', import.meta.url));
const ts = require('typescript');

/** The class to compare. Every file this is used on has exactly one that matters. */
const CLASS = process.env['MOVED_ONLY_CLASS'] ?? 'Grid';

function membersOf(path) {
  const text = readFileSync(path, 'utf8');
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true);
  const cls = file.statements.find((s) => ts.isClassDeclaration(s) && s.name?.text === CLASS);
  if (!cls) {
    console.error(`${path}: no class called ${CLASS} (set MOVED_ONLY_CLASS to change it)`);
    process.exit(2);
  }
  const out = new Map();
  for (const m of cls.members) {
    const n = m.name;
    if (!n) continue;
    const name = ts.isPrivateIdentifier(n) ? `#${n.text.replace(/^#/, '')}` : n.text;
    // The declaration only — leading comments move with it but are not the code.
    out.set(name, text.slice(m.getStart(file), m.end).replace(/\s+/g, ' ').trim());
  }
  return out;
}

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath) {
  console.error('usage: moved-only.mjs <before.ts> [after.ts]');
  process.exit(2);
}

// One file is the documented "just count what you can see" mode, which is how
// you check the parser agrees with you before trusting it to compare anything.
// It read argv[3] unconditionally and crashed, so the mode never worked.
if (!afterPath) {
  const members = membersOf(beforePath);
  console.log(`${members.size} members of ${CLASS} in ${beforePath}`);
  process.exit(0);
}

const before = membersOf(beforePath);
const after = membersOf(afterPath);
const problems = [];
for (const [name, code] of before) {
  if (!after.has(name)) problems.push(`lost: ${name}`);
  else if (after.get(name) !== code) problems.push(`changed: ${name}`);
}
for (const name of after.keys()) if (!before.has(name)) problems.push(`appeared: ${name}`);
console.log(problems.length ? problems.join('\n') : `IDENTICAL — ${before.size} members, text unchanged`);
process.exitCode = problems.length ? 1 : 0;

/**
 * Every documentation page, and whether a story exists for it.
 *
 * The tree is meant to mirror the guide's table of contents, which is a claim
 * that can be counted rather than asserted. A section with fewer exports than
 * pages is a page nobody wrote; more is a page written twice or one invented.
 *
 *   node coverage.mjs            # a summary, and a non-zero exit if short
 *   node coverage.mjs --missing  # the pages with no story
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = '/workspace/handsontable/handsontable/docs/content/guides';
// Resolved against this file, not the working directory: the script is run
// from the repository root as often as from here.
const STORIES = fileURLToPath(new URL('./src/verification', import.meta.url));

/** Every page in the guide, by section. */
function pages() {
  const found = new Map();
  const walk = (dir, section) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path, section ?? entry);
      } else if (entry.endsWith('.md')) {
        const head = readFileSync(path, 'utf8').slice(0, 4000);
        const title = /^title:\s*(.+)$/m.exec(head)?.[1].trim() ?? entry.replace(/\.md$/, '');
        found.set(`${section}/${entry}`, { section, title });
      }
    }
  };
  walk(DOCS, null);
  return [...found.values()];
}

/** Every story, by the section file it lives in. */
function stories() {
  const bySection = new Map();
  if (!existsSync(STORIES)) {
    return bySection;
  }
  for (const file of readdirSync(STORIES)) {
    if (!file.endsWith('.stories.tsx')) {
      continue;
    }
    const section = file.replace('.stories.tsx', '');
    const text = readFileSync(join(STORIES, file), 'utf8');
    // Both shapes the files use: a component, and a `const x = helper(...)`.
    const names = [...text.matchAll(/^export const (\w+)/gm)].map((m) => m[1]);
    bySection.set(section, names);
  }
  return bySection;
}

const all = pages();
const written = stories();
const sections = [...new Set(all.map((p) => p.section))].sort();

let short = 0;
console.log('section                        pages  stories');
for (const section of sections) {
  const want = all.filter((p) => p.section === section).length;
  const got = written.get(section)?.length ?? 0;
  const mark = got === want ? ' ' : got < want ? '<' : '>';
  if (got < want) {
    short += want - got;
  }
  console.log(`${mark} ${section.padEnd(28)} ${String(want).padStart(5)}  ${String(got).padStart(7)}`);
}
const want = all.length;
const got = [...written.values()].reduce((n, names) => n + names.length, 0);
console.log(`\n${got}/${want} pages have a story` + (short ? `  (${short} missing)` : ''));

if (process.argv.includes('--missing')) {
  for (const section of sections) {
    const pageCount = all.filter((p) => p.section === section).length;
    const storyCount = written.get(section)?.length ?? 0;
    if (storyCount < pageCount) {
      console.log(`\n${section}: ${pageCount - storyCount} short`);
      for (const page of all.filter((p) => p.section === section)) {
        console.log(`  ${page.title}`);
      }
    }
  }
}
process.exitCode = short > 0 ? 1 : 0;

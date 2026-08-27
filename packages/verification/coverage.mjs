#!/usr/bin/env node
/**
 * Every page in the guide's sidebar has a story, and every story is a page.
 *
 * The sidebar itself is committed as src/guide-toc.json — eighteen sections and
 * a hundred and five pages, taken from the markup rather than from a walk of
 * the site. That matters: the earlier list was derived by following links, and
 * it drifted. It ended up with a hundred and forty-nine entries, including
 * release notes and framework-wrapper pages the JavaScript guide does not
 * list, while missing a page the sidebar does. "149/149" was true about a list
 * nobody else had.
 *
 * So this checks both directions. A page with no story is a gap. A story with
 * no page is a story about something else, which belongs under "Beyond the
 * guide" rather than in the mirror.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const stories = join(here, "src/verification");
const toc = JSON.parse(readFileSync(join(here, "src/guide-toc.json"), "utf8"));

/** Story exports, per `Verification/...` title. */
const tree = new Map();
for (const file of readdirSync(stories).filter((name) =>
  name.endsWith(".stories.tsx"),
)) {
  const source = readFileSync(join(stories, file), "utf8");
  // Either quote style. This read `'` only, and prettier — which formats this
  // package — writes `"`, so the whole tree reported as missing the moment it
  // was formatted. A check that parses source with a regex should not have an
  // opinion about quotes.
  const title = /title:\s*['"]([^'"]+)['"]/.exec(source)?.[1];
  if (!title) continue;
  const names = [...source.matchAll(/^export (?:function|const) (\w+)/gm)].map(
    (m) => m[1],
  );
  tree.set(title, { file, names: new Set(names) });
}

/** How the sidebar's wording becomes an export name. */
const exportName = (title) => title.replace(/[^A-Za-z0-9]/g, "");
const titleCase = (title) =>
  exportName(
    title
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\B\w/g, (c) => c.toLowerCase()),
  );

let missing = 0;
let extra = 0;
const width = Math.max(...toc.map((s) => s.section.length));

for (const section of toc) {
  const entry = tree.get(`Verification/${section.section}`);
  const names = entry?.names ?? new Set();
  const wanted = section.pages.map((page) => titleCase(page.title));
  const absent = wanted.filter((name) => !names.has(name));
  const unexpected = [...names].filter((name) => !wanted.includes(name));
  missing += absent.length;
  extra += unexpected.length;

  const mark = absent.length || unexpected.length ? " <-" : "";
  console.log(
    `  ${section.section.padEnd(width)} ${String(names.size).padStart(3)}/${section.pages.length}${mark}`,
  );
  for (const name of absent) console.log(`      no story for ${name}`);
  for (const name of unexpected)
    console.log(`      ${name} is not a page in this section`);
}

const pages = toc.reduce((total, section) => total + section.pages.length, 0);
const beyond = tree.get("Beyond the guide")?.names.size ?? 0;
console.log(`\n${pages - missing}/${pages} pages in the guide have a story`);
console.log(
  `${beyond} stories about pages the sidebar does not list, kept under "Beyond the guide"`,
);

if (missing || extra) {
  console.log(`\n${missing} missing, ${extra} in the wrong section`);
  process.exit(1);
}

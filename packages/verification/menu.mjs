#!/usr/bin/env node
/**
 * The guide's sidebar, printed in full, with what each page has behind it.
 *
 * `coverage.mjs` answers "is anything missing" and prints only the gaps. This
 * prints every page, because the question it answers is different: not "are we
 * done" but "what is the list, and what is on each line of it".
 *
 * The count is verification stories, which is what can be counted. A story is
 * a live cellmoa grid beside a live Handsontable one, so a page with stories
 * has something running; it is not a claim that the feature is complete.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const toc = JSON.parse(readFileSync(join(here, "src/guide-toc.json"), "utf8"));
const stories = join(here, "src/verification");

const tree = new Map();
for (const file of readdirSync(stories).filter((n) => n.endsWith(".stories.tsx"))) {
  const source = readFileSync(join(stories, file), "utf8");
  const title = /title:\s*['"]([^'"]+)['"]/.exec(source)?.[1];
  if (!title) continue;
  tree.set(title, [...source.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]));
}

const exportName = (t) => t.replace(/[^A-Za-z0-9]/g, "");
const titleCase = (t) =>
  exportName(t.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w/g, (c) => c.toLowerCase()));

let n = 0;
let total = 0;
for (const section of toc) {
  const names = tree.get(`Verification/${section.section}`) ?? [];
  const wanted = section.pages.map((p) => titleCase(p.title));
  const owner = (name) =>
    wanted.filter((p) => name === p || name.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  const per = new Map(wanted.map((p) => [p, 0]));
  for (const name of names) {
    const page = owner(name);
    if (page) per.set(page, per.get(page) + 1);
  }
  console.log(`\n${section.section}  (${section.pages.length} pages)`);
  for (const page of section.pages) {
    const count = per.get(titleCase(page.title)) ?? 0;
    total += count;
    console.log(
      `  ${String(++n).padStart(3)}. ${page.title.padEnd(38)} ${count ? `${count} stor${count === 1 ? "y" : "ies"}` : "NONE"}`,
    );
  }
}
const beyond = tree.get("Beyond the guide")?.length ?? 0;
console.log(`\n${n} pages in 18 sections; ${total} verification stories + ${beyond} beyond the guide`);

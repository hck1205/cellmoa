/**
 * What both browser scripts need: a browser, a server, and a story to look at.
 *
 * `check.mjs` and `divergence.mjs` had their own copies of all of it — the same
 * launch, the same meta.json read, the same URL, the same loop. Two of those
 * copies had already drifted apart: one waited 900ms after a story loaded and
 * the other 700ms, for the same grids to finish the same work. A number that
 * exists twice and disagrees with itself is a flake waiting to be blamed on
 * something else.
 */

import { chromium } from "playwright";
import { existsSync, readFileSync, readdirSync } from "node:fs";

/** Where `ladle preview` serves the built site. */
export const PORT = 61004;

/**
 * How long to wait after the page settles.
 *
 * `networkidle` says the fetches are done, which is not the same as the grids
 * being drawn: the engine is WebAssembly and both libraries lay out on a frame
 * after that. Long enough for a slow story, short enough that 214 of them
 * finish in a couple of minutes.
 */
export const SETTLE_MS = 900;

/**
 * The browser to drive.
 *
 * Playwright is pinned to a build that does not match the one this environment
 * preinstalls, so the path is found rather than assumed — and the failure says
 * which paths were tried, because "browser not found" with no list is a bad
 * half-hour.
 */
function browserPath() {
  const root = "/opt/pw-browsers";
  const candidates = existsSync(root)
    ? readdirSync(root)
        .filter((name) => name.startsWith("chromium"))
        .map((name) => `${root}/${name}/chrome-linux/chrome`)
    : [];
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      `no chromium under ${root}; tried:\n  ${candidates.join("\n  ") || "(nothing)"}`,
    );
  }
  return found;
}

/** The stories to visit: the ones named on the command line, or all of them. */
export function storyIds(argv = process.argv.slice(2)) {
  if (argv.length > 0) {
    return argv;
  }
  const meta = JSON.parse(
    readFileSync(new URL("./build/meta.json", import.meta.url), "utf8"),
  );
  return Object.keys(meta.stories).sort();
}

/** Runs `work` against a page, and closes the browser however it ends. */
export async function withPage(work) {
  const browser = await chromium.launch({ executablePath: browserPath() });
  try {
    return await work(await browser.newPage());
  } finally {
    await browser.close();
  }
}

/** Opens one story and waits for it to have drawn. */
export async function visit(page, story) {
  await page.goto(`http://localhost:${PORT}/?story=${story}&mode=preview`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(SETTLE_MS);
}

/** The `<section>` panels a Compare story renders, as the tool wants to read them. */
export async function panels(page, read) {
  return page.evaluate(read);
}

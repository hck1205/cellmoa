/**
 * Every story, loaded in a real browser, checked for having drawn anything.
 *
 * This is not a comparison — a machine cannot tell you the two grids look the
 * same, and pretending otherwise would be worse than nothing. What it can tell
 * you is that neither panel threw, and that both put something on screen. A
 * story whose reference half fails to construct is a finding on its own: it is
 * how the `multiselect` spelling turned up.
 *
 *   npm run build && npm run check
 */

import { storyIds, visit, withPage } from "./harness.mjs";

const stories = storyIds();
const problems = [];

const failures = await withPage(async (page) => {
  let failures = 0;
  page.on("pageerror", (e) =>
    problems.push(`PAGEERROR ${e.message.slice(0, 120)}`),
  );
  page.on("console", (m) => {
    if (m.type() === "error")
      problems.push(`CONSOLE ${m.text().slice(0, 120)}`);
  });

  for (const story of stories) {
    problems.length = 0;
    await visit(page, story);
    // A story is fine when both panels drew something. Cells are the usual
    // sign, but an empty-state story legitimately has none — so the fallback is
    // that the panel rendered text and did not render an error.
    const counts = await page.evaluate(() => {
      const panels = [...document.querySelectorAll("section")];
      const read = (i) => {
        const panel = panels[i];
        if (!panel) return { cells: 0, text: 0, failed: true };
        return {
          cells: panel.querySelectorAll("td").length,
          text: (panel.textContent || "").trim().length,
          failed: panel.querySelector("pre") !== null,
        };
      };
      return {
        panels: panels.length,
        cellmoa: read(0),
        hot: read(1),
        // A page with nothing to compare renders prose under a heading and no
        // panels at all. The heading is the signal — counting characters made
        // a 39-character explanation fail a 40-character threshold, which is a
        // checker deciding correctness by an arbitrary number.
        explained: document.querySelector("h3") !== null,
      };
    });

    // Three shapes, three ways of being right. A `Compare` draws two panels; an
    // `OnlyReference` draws two but leaves ours deliberately empty; a
    // `NotAFeature` draws neither and says why. Judging them all by "did two
    // grids appear" is what made every honest not-a-feature story look broken.
    const drew = (p) => !p.failed && (p.cells > 0 || p.text > 24);
    const ok =
      counts.panels === 0
        ? counts.explained
        : drew(counts.cellmoa) && drew(counts.hot);
    if (!ok) {
      failures += 1;
    }
    console.log(
      `${ok ? "OK  " : "FAIL"} ${story.padEnd(56)} cellmoa=${counts.cellmoa.cells} hot=${counts.hot.cells}` +
        (counts.panels === 0 ? "  (nothing to compare)" : "") +
        (problems.length
          ? `\n       ${problems.slice(0, 2).join("\n       ")}`
          : ""),
    );
  }
  return failures;
});

process.exitCode = failures > 0 ? 1 : 0;
console.log(
  `\n${stories.length - failures}/${stories.length} stories drew both grids.`,
);

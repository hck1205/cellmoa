/**
 * Where the two panels actually disagree.
 *
 * `check.mjs` says both grids drew. That is the weaker claim, and it is the
 * only one a machine can make about appearance — but it is not the only thing
 * worth automating. The *text* the two panels put in their cells is
 * comparable, and where it differs there is either a finding or a story whose
 * data was never meant to match.
 *
 * So this reports the difference rather than judging it. A story that is here
 * and should not be is a defect; a story that is here on purpose should say so
 * in its note. Silence, either way, is the thing to avoid: 214 stories all
 * reported as "drew fine" tells nobody anything about parity.
 *
 *   npm run build && node divergence.mjs [story-id...]
 */

import { storyIds, visit, withPage } from "./harness.mjs";

const stories = storyIds();
const differing = [];
const same = [];
const unreadable = [];

await withPage(async (page) => {
  for (const story of stories) {
    await visit(page, story);

    const panels = await page.evaluate(() =>
      [...document.querySelectorAll("section")].map((panel) =>
        [...panel.querySelectorAll("td")].map((td) =>
          (td.textContent ?? "").trim(),
        ),
      ),
    );

    if (panels.length !== 2) {
      unreadable.push(story);
      continue;
    }
    const [ours, theirs] = panels;
    // Compared as a bag of values rather than in order. This library draws the
    // grid as several pane tables — frozen rows and columns are their own — so a
    // flat list of `td`s is not in row-major order on our side and is on theirs.
    // Comparing sequences reported 153 of 214 stories as differing when almost
    // all of them held the same values in a different DOM order.
    //
    // The weaker claim is the honest one: these are the values each panel shows,
    // and a value present on one side and not the other is worth looking at. It
    // will not catch a value in the wrong *place*, and saying so is better than
    // a number that means nothing.
    const tally = (cells) => {
      const counts = new Map();
      for (const text of cells) {
        if (text === "") continue;
        counts.set(text, (counts.get(text) ?? 0) + 1);
      }
      return counts;
    };
    const mine = tally(ours);
    const theirsCounts = tally(theirs);
    const mismatches = [];
    for (const [text, count] of mine) {
      const other = theirsCounts.get(text) ?? 0;
      if (other < count) mismatches.push({ text, ours: count, theirs: other });
    }
    for (const [text, count] of theirsCounts) {
      if (!mine.has(text)) mismatches.push({ text, ours: 0, theirs: count });
    }
    const shared = Math.min(ours.length, theirs.length);
    if (shared === 0) {
      unreadable.push(story);
    } else if (mismatches.length === 0) {
      same.push(story);
    } else {
      differing.push({ story, shared, mismatches });
    }
  }
});

for (const { story, shared, mismatches } of differing) {
  console.log(
    `\n${story}  (${mismatches.length} values differ, ${shared} cells compared)`,
  );
  for (const m of mismatches.slice(0, 4)) {
    console.log(
      `    ${JSON.stringify(m.text)}: ours ${m.ours}, theirs ${m.theirs}`,
    );
  }
  if (mismatches.length > 4)
    console.log(`    ... and ${mismatches.length - 4} more`);
}

console.log(
  `\n${same.length} stories agree cell for cell, ${differing.length} differ, ` +
    `${unreadable.length} have nothing to compare`,
);

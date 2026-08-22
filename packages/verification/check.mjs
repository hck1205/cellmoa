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

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const stories = process.argv.slice(2);
if (stories.length === 0) {
  const meta = JSON.parse(readFileSync(new URL('./build/meta.json', import.meta.url), 'utf8'));
  stories.push(...Object.keys(meta.stories).sort());
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const problems = [];
let failures = 0;
page.on('pageerror', (e) => problems.push(`PAGEERROR ${e.message.slice(0, 120)}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`CONSOLE ${m.text().slice(0, 120)}`); });

for (const story of stories) {
  problems.length = 0;
  await page.goto(`http://localhost:61002/?story=${story}&mode=preview`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  // A story is fine when both panels drew something. Cells are the usual
  // sign, but an empty-state story legitimately has none — so the fallback is
  // that the panel rendered text and did not render an error.
  const counts = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('section')];
    const read = (i) => {
      const panel = panels[i];
      if (!panel) return { cells: 0, text: 0, failed: true };
      return {
        cells: panel.querySelectorAll('td').length,
        text: (panel.textContent || '').trim().length,
        failed: panel.querySelector('pre') !== null,
      };
    };
    return { cellmoa: read(0), hot: read(1) };
  });
  const drew = (p) => !p.failed && (p.cells > 0 || p.text > 24);
  const ok = drew(counts.cellmoa) && drew(counts.hot);
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${story.padEnd(56)} cellmoa=${counts.cellmoa.cells} hot=${counts.hot.cells}` +
    (problems.length ? `\n       ${problems.slice(0, 2).join('\n       ')}` : ''));
}
await browser.close();
process.exitCode = failures > 0 ? 1 : 0;
console.log(`\n${stories.length - failures}/${stories.length} stories drew both grids.`);

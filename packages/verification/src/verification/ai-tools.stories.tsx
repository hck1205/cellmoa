/**
 * AI Tools — the 3 pages the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare, NotAFeature, block } from "../Compare.js";

export default { title: "Verification/AI Tools" };

export const SkillsForClaudeCode = () => (
  <NotAFeature
    page="Skills for Claude Code"
    path="skills-for-claude-code"
    why="A plugin the reference publishes for an editor. Not part of the library."
  />
);

export const AiThemeBuilder = () => (
  <Compare
    note={`The page is a generator on the reference's website: describe a look, get a block
      of custom properties. The generator cannot be compared, but its output can, because
      what it emits is a theme — and both grids here are given the same one, written by
      hand in the same shape it would produce. That is the honest test of whether a
      generated theme would carry over.

      It half does. The variables below are among the eleven cellmoa reads; the reference
      defines roughly 334, so a generated theme sets a great many that do nothing here —
      and does nothing visible about it, since an unknown custom property is not an error.
      Compare the two panels: the shared variables should agree, and everything the
      generator would have styled beyond them will only have moved on the right.`}
    settings={
      {
        colHeaders: true,
        rowHeaders: true,
        themeName: "ht-theme-main",
        style: {
          "--ht-background-color": "#0f172a",
          "--ht-foreground-color": "#e2e8f0",
          "--ht-accent-color": "#38bdf8",
          "--ht-border-color": "#334155",
        },
      } as never
    }
    data={block(5, 4)}
  />
);

export const AiDocsAssistant = () => (
  <NotAFeature
    page="AI Docs Assistant"
    path="ai-docs-assistant"
    why="A chat box on the reference's documentation site."
  />
);

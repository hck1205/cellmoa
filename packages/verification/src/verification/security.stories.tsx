/**
 * Security — the 1 page the guide's
 * sidebar lists under this heading, one story each, named as the sidebar
 * names them.
 *
 * src/guide-toc.json is that sidebar, and coverage.mjs checks this file
 * against it, so a page the reference adds shows up as a failure here rather
 * than as a gap nobody noticed.
 */

import { Compare } from "../Compare.js";

export default { title: "Verification/Security" };

const alert = {
  template: {
    type: "alert" as const,
    title: "Unsaved changes",
    description: "Three cells have been edited since the last save.",
    buttons: [
      { text: "Discard", type: "secondary" as const },
      { text: "Save", type: "primary" as const },
    ],
  },
  background: "semi-transparent" as const,
  contentBackground: true,
  closable: true,
  a11y: { role: "dialog", ariaLabel: "Unsaved changes" },
};

export const Security = () => (
  <Compare
    note="Since 18.0 neither library bundles a sanitizer: HTML passes through unchanged unless the caller supplies one. Both grids here get the same sanitizer, which strips `<script>`. The first cell should read `bold` in bold with nothing executed; the second is plain text and must stay escaped even though it looks like markup. cellmoa's dialog bypassed the sanitizer entirely until recently — every HTML path now goes through one door, which is the only way a caller who supplies one has actually covered them all."
    settings={{
      colHeaders: ["allowHtml", "plain"],
      rowHeaders: true,
      sanitizer: (html: string, source: string) =>
        `${html.replace(/<script[\s\S]*?<\/script>/g, "")}${source === "Dialog" ? "" : ""}`,
      columns: [{ allowHtml: true }, {}],
    }}
    data={[
      ["<b>bold</b><script>alert(1)</script>", "<b>not markup</b>"],
      ["<em>emphasis</em>", "<img src=x onerror=alert(1)>"],
    ]}
    height={200}
  />
);

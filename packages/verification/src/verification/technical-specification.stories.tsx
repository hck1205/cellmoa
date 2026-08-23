/**
 * Licences and the browsers that are supported.
 *
 * Four pages, none of them about behaviour. They are here so the tree matches
 * the table of contents.
 */

import { Compare, NotAFeature, block } from "../Compare.js";

export default { title: "Verification/Technical specification" };

export const SoftwareLicense = () => (
  <Compare
    note={`The reference is commercial with a free non-commercial key; cellmoa is MIT and
      needs none. What is worth checking rather than reading is that the difference does
      not break a configuration carried across: both grids below are handed the same
      licenseKey, and both should draw exactly as they would without it. cellmoa accepts
      the option and reports it once on the console rather than dropping it silently,
      because a setting that does nothing should say so.`}
    settings={{
      colHeaders: true,
      rowHeaders: true,
      licenseKey: "non-commercial-and-evaluation",
    }}
    data={block(4, 4)}
  />
);

export const DocumentationLicense = () => (
  <NotAFeature
    page="Documentation license"
    path="documentation-license"
    why="The licence on the guide itself."
  />
);

export const SupportedBrowsers = () => (
  <Compare
    note={`The page lists the two most recent versions of the evergreen browsers. A list is
      not something to draw twice — but the claim underneath it is testable, and this is
      the test: whichever browser you are reading this in, both grids either drew or did
      not. cellmoa carries one requirement the reference does not, which is WebAssembly
      for its engine. Every browser on that list has had it for years, so the practical
      support is the same; the failure mode is not. Without WebAssembly the reference
      still renders and cellmoa shows nothing at all, which is why this pair is worth
      having in front of a browser you are unsure about.`}
    settings={{ colHeaders: true, rowHeaders: true }}
    data={block(4, 4)}
  />
);

export const ThirdPartyLicenses = () => (
  <NotAFeature
    page="Third-party licenses"
    path="third-party-licenses"
    why="What the reference bundles. cellmoa bundles no third-party JavaScript at run time; its engine is its own Rust compiled to WebAssembly."
  />
);

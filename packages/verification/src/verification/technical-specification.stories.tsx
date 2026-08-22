/**
 * Licences and the browsers that are supported.
 *
 * Four pages, none of them about behaviour. They are here so the tree matches
 * the table of contents.
 */

import { NotAFeature } from '../Compare.js';

export default { title: 'Verification/Technical specification' };

export const SoftwareLicense = () => (
  <NotAFeature
    page="Software license"
    path="software-license"
    why="The reference is commercial with a free non-commercial key; cellmoa is MIT and needs no key. A `licenseKey` in a configuration is accepted and reported once rather than ignored, so a setting carried over does not look as though it is doing something."
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
  <NotAFeature
    page="Supported browsers"
    path="supported-browsers"
    why="The two most recent versions of the evergreen browsers. cellmoa needs WebAssembly for its engine, which every browser on that list has had for years — but it is a requirement the reference does not have, and it is worth stating."
  />
);

export const ThirdPartyLicenses = () => (
  <NotAFeature
    page="Third-party licenses"
    path="third-party-licenses"
    why="What the reference bundles. cellmoa bundles no third-party JavaScript at run time; its engine is its own Rust compiled to WebAssembly."
  />
);

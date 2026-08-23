/**
 * Building on the library rather than with it.
 *
 * Plugin authoring and the shipped types are checkable; the reference's own
 * repository build and CI are not, and pretending they were would pad the tree.
 */

import { Compare, NotAFeature, block } from "../Compare.js";

export default { title: "Verification/Tools and building" };

export const CustomBuilds = () => (
  <NotAFeature
    page="Custom builds"
    path="custom-builds"
    why="How to clone the reference's repository and build it yourself. About their build, not about a grid."
  />
);

export const CustomPlugins = () => (
  <Compare
    note="A plugin registered at run time and switched on by a setting. The lifecycle is the same in both — `isEnabled` → enable → update → disable — so a plugin ported across mostly works; the names differ (`pluginName` for `PLUGIN_KEY`, `settingKeys` for `SETTING_KEYS`, `this.grid` for `this.hot`), which the parity table records. Both grids below run with the plugin surface open: `getPlugin` should find every registered name."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      contextMenu: true,
      columnSorting: true,
      comments: true,
    }}
    data={block(5, 4)}
    height={280}
  />
);

export const Modules = () => (
  <NotAFeature
    page="Modules"
    path="modules"
    why="The largest page in the guide, and entirely about importing a subset: `handsontable/base`, `registerAllModules`, `registerCellType`, `registerPlugin`, per-module type files. cellmoa exposes four subpaths and no registration entry points, so none of it applies. The gap is real and recorded; there is simply nothing to render."
  />
);

export const Packages = () => (
  <NotAFeature
    page="Packages"
    path="packages"
    why="Which files the npm package ships and how the UMD build is laid out. About distribution, not behaviour."
  />
);

export const Testing = () => (
  <NotAFeature
    page="Testing"
    path="testing"
    why="How the reference runs its own test suite. cellmoa's suite is Vitest with jsdom, plus this package for what jsdom cannot see."
  />
);

export const TypeScriptTypes = () => (
  <Compare
    note="Both packages ship declarations. cellmoa exports all 36 types the page names, mostly as aliases over its own — `HotInstance` is `Grid`, `CellCoords` is `Coords`. Two mean something different and say so: `getCell` returns a value here rather than a `<td>`, and `Events` checks a hook's name but not its arguments. Nothing to see on screen; the grids below are only proof the typed configuration compiled."
    settings={{
      colHeaders: ["typed", "columns"],
      rowHeaders: true,
      columns: [{ type: "text" }, { type: "numeric" }],
    }}
    data={[
      ["a", "1"],
      ["b", "2"],
    ]}
    height={180}
  />
);

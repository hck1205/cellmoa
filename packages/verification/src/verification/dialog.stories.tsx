/**
 * The three pieces of floating UI that sit over the table: a modal dialog, the
 * "working…" overlay built on top of it, and the toasts that stack in a corner.
 *
 * This section is the strongest argument for the whole package. None of it can
 * be checked without a screen. A backdrop that does not paint, a dialog box
 * that lands behind the pager, a toast stack that grows downwards out of the
 * grid, a spinner that covers the headers but not the rows — every one of those
 * passes a jsdom assertion that the element exists, and every one is broken.
 * So read these three stories with the layout in mind, not just the text.
 *
 * The pages are in the order the guide's own sidebar lists them.
 */

import type {
  Dialog as CmDialog,
  Loading as CmLoading,
  Notification as CmNotification,
} from "@cellmoa/grid";
import { registerLanguageDictionary, jaJP } from "handsontable/i18n";

import { Compare, block } from "../Compare.js";

export default { title: "Verification/Dialog" };

registerLanguageDictionary(jaJP);

/**
 * One options object, handed to both `show()` calls unchanged.
 *
 * Written out here rather than inline because the point of the story is that
 * the two grids are asked for exactly the same dialog.
 */
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

export const Dialog = () => (
  <Compare
    note="The same options object opens a dialog over both grids a moment after mount. Four things to look at. The backdrop: `background: 'semi-transparent'` should let the table show through dimmed, where `'solid'` would hide it — a backdrop that does not paint at all is the defect this story exists to catch, and it was real here. The box: `template` should render the title, the description and two buttons with the primary one visibly primary, without the caller assembling any of it. The modality: click a cell underneath and type — nothing should reach the grid while the dialog is up, then press Escape and check the keyboard comes back. And the name: the `a11y` block should put a `dialog` role, `aria-modal` and an accessible name on the overlay, which Ladle's a11y addon will read out of either panel. One divergence to know about, since it is not visible here: Handsontable's `show()` with no arguments falls back to whatever the `dialog` option was configured with, and cellmoa's does not — it opens an empty box. Passing the options to `show()`, as both do here, works on either side."
    settings={{ colHeaders: true, rowHeaders: true, dialog: true }}
    data={block(6, 4)}
    height={280}
    afterMount={{
      cellmoa: (grid) => {
        setTimeout(() => grid.getPlugin<CmDialog>("dialog")?.show(alert), 700);
      },
      handsontable: (hot) => {
        setTimeout(() => hot.getPlugin("dialog").show(alert), 700);
      },
    }}
  />
);

export const Loading = () => (
  <Compare
    note="Both grids are put into a loading state a moment after mount and left there. The overlay should cover the whole grid root — headers, rows and the strip below the table — because a pager you can still click while the data is loading will ask for a page nobody is waiting for. Check the spinner actually animates rather than sitting still, and that the phrase is Japanese: the grid is set to `ja-JP`, and both libraries take the default from a dictionary key (`LOADING_TITLE` there, `Loading:title` here). English text means the plugin hard-coded it. Two differences are worth knowing. Handsontable's overlay takes an `icon`, a `title` and a `description`; cellmoa's takes one `message` and draws its own spinner, so a caller who wants three lines cannot have them. And cellmoa's is reference-counted rather than a flag — two things loading at once take it up twice, and the first to finish does not pull the overlay out from under the second, which is a difference in behaviour you can only see by starting a second load before the first ends."
    settings={{
      colHeaders: true,
      rowHeaders: true,
      dialog: true,
      loading: true,
      language: "ja-JP",
    }}
    data={block(6, 4)}
    height={260}
    afterMount={{
      cellmoa: (grid) => {
        setTimeout(() => grid.getPlugin<CmLoading>("loading")?.show(), 700);
      },
      handsontable: (hot) => {
        setTimeout(() => hot.getPlugin("loading").show(), 700);
      },
    }}
  />
);

export const Notification = () => (
  <Compare
    note="Two toasts open in each grid a moment after mount: an error with `duration: 0`, which must stay until it is dismissed, and an informational one at the other corner. Look at where they land — `top-end` and `bottom-start` are corners the caller chose, and a toast asked for one corner and drawn in another is covering something the caller moved it away from. Check they stack rather than replace one another, and that the persistent error does not quietly vanish after four seconds. cellmoa read `type` and `timeout` and ignored the documented `variant` and `duration`, which meant exactly that: a serious error, asked to stay, disappearing. It now reads `variant`/`duration`/`position`/`title` as documented and still answers to the two old names as aliases, so both spellings work. What cellmoa does not have is the keyboard route the page describes: F6 moves focus into Handsontable's notification region and Tab walks the controls across visible toasts, and there is no F6 binding anywhere in cellmoa's source, so its toast buttons are reachable by mouse only. The `aria-live` wiring is there on both — assertive for errors, polite otherwise — which the a11y addon can confirm."
    settings={{ colHeaders: true, rowHeaders: true, notification: true }}
    data={block(6, 4)}
    height={260}
    afterMount={{
      cellmoa: (grid) => {
        const toast = grid.getPlugin<CmNotification>("notification");
        setTimeout(() => {
          toast?.showMessage({
            title: "Could not save",
            message: "The server refused the write. Nothing was lost.",
            variant: "error",
            duration: 0,
            position: "top-end",
            // The callback is required by Handsontable's type; taking the
            // action is what dismisses the toast on both sides.
            actions: [
              { label: "Retry", type: "primary", callback: () => undefined },
            ],
          });
          toast?.showMessage({
            message: "Sorted by Region.",
            variant: "info",
            duration: 0,
            position: "bottom-start",
          });
        }, 700);
      },
      handsontable: (hot) => {
        const toast = hot.getPlugin("notification");
        setTimeout(() => {
          toast.showMessage({
            title: "Could not save",
            message: "The server refused the write. Nothing was lost.",
            variant: "error",
            duration: 0,
            position: "top-end",
            // The callback is required by Handsontable's type; taking the
            // action is what dismisses the toast on both sides.
            actions: [
              { label: "Retry", type: "primary", callback: () => undefined },
            ],
          });
          toast.showMessage({
            message: "Sorted by Region.",
            variant: "info",
            duration: 0,
            position: "bottom-start",
          });
        }, 700);
      },
    }}
  />
);

/**
 * The features that have no Handsontable counterpart.
 *
 * They are kept apart so the parity count stays honest: 42 is the number of
 * Handsontable plugins, and mixing our own into that list would make the figure
 * mean nothing. Everything here exists because the engine records who changed
 * what, and none of it is possible without that.
 */

export * from './provenance.js';
export * from './conflicts.js';
export * from './statusBar.js';
export * from './verifyOverlay.js';
export * from './diffView.js';

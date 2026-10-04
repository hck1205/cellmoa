/**
 * Building a grid to test against.
 *
 * jsdom reports zero for every measurement, so a container has to be told how
 * big it is or the renderer concludes nothing is visible and draws no cells.
 * That one detail is why every test needs a helper rather than a constructor
 * call, and why there should be one of it.
 */

import { Engine } from '../src/engine.js';
import { Grid } from '../src/grid.js';
import type { GridSettings } from '../src/settings.js';
import { readWasm } from './wasm.js';

const wasm = readWasm();

export interface MountOptions extends GridSettings {
  /** Share an engine between grids, to test two writers on one workbook. */
  engine?: Engine;
  /** How this grid's edits are recorded. */
  actor?: { kind: 'human' | 'agent' | 'script' | 'system'; id: string };
  /** The viewport the renderer is told it has. */
  viewport?: { width: number; height: number };
}

/** A grid, its engine and the element it was mounted into. */
export interface Mounted {
  grid: Grid;
  engine: Engine;
  container: HTMLElement;
}

/**
 * Mounts a grid into a fresh page.
 *
 * The body is emptied first: a test that leaves a menu or a dialog behind would
 * otherwise be found by the next test's query, and the failure would point at
 * the wrong test.
 */
export async function mountGrid(options: MountOptions = {}): Promise<Mounted> {
  document.body.replaceChildren();
  const { engine: given, viewport, ...settings } = options;
  const engine = given ?? (await Engine.load(wasm));

  const container = document.createElement('div');
  Object.defineProperty(container, 'clientHeight', {
    value: viewport?.height ?? 400,
    configurable: true,
  });
  Object.defineProperty(container, 'clientWidth', {
    value: viewport?.width ?? 600,
    configurable: true,
  });
  document.body.appendChild(container);

  // No default size. Each suite says how big its table is, because most of
  // them assert on the count and a default here would decide it for them.
  const grid = new Grid(container, { colHeaders: true, rowHeaders: true, ...settings, engine });
  // The view's own element needs a width too: `stretchColumns` measures it, and
  // in jsdom it does not inherit the container's.
  const root = grid.view?.root;
  if (root) {
    Object.defineProperty(root, 'clientWidth', {
      value: viewport?.width ?? 600,
      configurable: true,
    });
  }
  return { grid, engine, container };
}

/** The same, when only the grid is wanted. */
export async function makeGrid(options: MountOptions = {}): Promise<Grid> {
  return (await mountGrid(options)).grid;
}

/**
 * A clipboard event jsdom will let a plugin read from.
 *
 * jsdom builds no `clipboardData`, so every clipboard test has to supply one.
 * Three test files each had their own — two identical, and a third that took a
 * map of MIME types rather than a string. The general one subsumes the others,
 * so a string is taken as `text/plain` and anything richer is spelled out.
 */
export function clipboardEvent(
  type: string,
  content: string | Record<string, string> = {},
): ClipboardEvent {
  const flavours = typeof content === 'string' ? { 'text/plain': content } : content;
  const store = new Map(Object.entries(flavours).filter(([, value]) => value !== ''));
  const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (format: string) => store.get(format) ?? '',
      setData: (format: string, value: string) => store.set(format, value),
    },
    configurable: true,
  });
  return event;
}

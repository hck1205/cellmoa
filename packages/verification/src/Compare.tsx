/**
 * One feature, drawn twice.
 *
 * The point of every story here is the pair: the same settings handed to
 * cellmoa and to Handsontable, side by side in a real browser, so a claim of
 * parity can be looked at rather than read.
 *
 * jsdom cannot answer this. It measures every element as zero and applies no
 * stylesheet, so a whole class of defect passes a green suite and fails on
 * screen — a row that is hidden but still drawn, a dialog with no backdrop, a
 * header that never hears a click. Every one of those was real in this
 * codebase and was found by hand. This is where they would have shown.
 */

import { useEffect, useRef, useState } from 'react';
import { Engine, Grid } from '@cellmoa/grid';
import type { GridSettings } from '@cellmoa/grid';
import Handsontable from 'handsontable';
import '@cellmoa/grid/style.css';
import '@cellmoa/grid/themes.css';
import 'handsontable/styles/handsontable.css';
import 'handsontable/styles/ht-theme-main.css';

import wasmUrl from '@cellmoa/grid/wasm?url';

/** Compiled once and shared: building the module per story is slow enough to see. */
let engine: Promise<Engine> | null = null;
function loadEngine(): Promise<Engine> {
  engine ??= Engine.load(fetch(wasmUrl));
  return engine;
}

export interface CompareProps {
  /** Handed to both grids unchanged. Whatever either one ignores is the finding. */
  settings: GridSettings;
  /** Values typed into both. */
  data?: string[][];
  /** What to look at, and what would count as a difference. */
  note?: string;
  /** Run once after each is up, for a story that has to open or press something. */
  afterMount?: { cellmoa?: (grid: Grid) => void; handsontable?: (hot: Handsontable) => void };
  height?: number;
}

function Cellmoa({ settings, data, afterMount, height }: CompareProps) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let grid: Grid | null = null;
    let cancelled = false;
    void loadEngine()
      .then((loaded) => {
        if (cancelled || !host.current) {
          return;
        }
        grid = new Grid(host.current, { ...settings, engine: loaded });
        if (data) {
          grid.loadData(data);
        }
        afterMount?.cellmoa?.(grid);
      })
      .catch((cause: unknown) => setError(String(cause)));
    return () => {
      cancelled = true;
      grid?.destroy();
    };
  }, []);

  if (error) {
    return <pre style={{ color: 'crimson', margin: 8, whiteSpace: 'pre-wrap' }}>{error}</pre>;
  }
  return <div ref={host} style={{ height, width: '100%' }} />;
}

function Reference({ settings, data, afterMount, height }: CompareProps) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!host.current) {
      return;
    }
    let hot: Handsontable | null = null;
    try {
      hot = new Handsontable(host.current, {
        ...(settings as Handsontable.GridSettings),
        ...(data ? { data: data.map((row) => [...row]) } : {}),
        licenseKey: 'non-commercial-and-evaluation',
        themeName: 'ht-theme-main',
      });
      afterMount?.handsontable?.(hot);
    } catch (cause: unknown) {
      setError(String(cause));
    }
    return () => hot?.destroy();
  }, []);

  if (error) {
    return <pre style={{ color: 'crimson', margin: 8, whiteSpace: 'pre-wrap' }}>{error}</pre>;
  }
  return <div ref={host} style={{ height, width: '100%' }} />;
}

const panel: React.CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  border: '1px solid #d4d4d8',
  borderRadius: 6,
  overflow: 'hidden',
};

const label: React.CSSProperties = {
  padding: '6px 10px',
  font: '600 12px/1.4 ui-sans-serif, system-ui, sans-serif',
  background: '#fafafa',
  borderBottom: '1px solid #e4e4e7',
};

/** The two grids, and what to look for. */
export function Compare(props: CompareProps) {
  const height = props.height ?? 260;
  return (
    <div style={{ font: '13px/1.5 ui-sans-serif, system-ui, sans-serif' }}>
      {props.note ? (
        <p style={{ margin: '0 0 12px', maxWidth: '78ch', color: '#3f3f46' }}>{props.note}</p>
      ) : null}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <section style={panel}>
          <header style={label}>cellmoa</header>
          <Cellmoa {...props} height={height} />
        </section>
        <section style={panel}>
          <header style={{ ...label, background: '#f4f4f5' }}>Handsontable 18</header>
          <Reference {...props} height={height} />
        </section>
      </div>
    </div>
  );
}

/** A block of values, for a story that just needs something on screen. */
export function block(
  rows: number,
  cols: number,
  cell: (row: number, col: number) => string = (row, col) =>
    `${String.fromCharCode(65 + col)}${row + 1}`,
): string[][] {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => cell(row, col)),
  );
}

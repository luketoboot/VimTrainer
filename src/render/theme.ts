// Retro terminal aesthetic — phosphor palette + grid metrics.
// Every mode composes visuals from these primitives so the look stays cohesive.

export interface Theme {
  bg: string;
  fg: string; // default phosphor text
  dim: string; // dimmed text (inactive / background buffer)
  cursorBg: string; // block cursor fill
  cursorFg: string; // char under the cursor
  accent: string; // targets / highlights
  accentAlt: string; // secondary highlight
  danger: string; // hits / projectiles
  statusBg: string;
  statusFg: string;
  fontFamily: string;
}

export const GREEN_PHOSPHOR: Theme = {
  bg: "#05080a",
  fg: "#39ff87",
  dim: "#1f6f45",
  cursorBg: "#39ff87",
  cursorFg: "#05080a",
  accent: "#ffcf4d",
  accentAlt: "#4dd0ff",
  danger: "#ff4d5e",
  statusBg: "#0d1f16",
  statusFg: "#8affc0",
  fontFamily:
    '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
};

export const AMBER_PHOSPHOR: Theme = {
  ...GREEN_PHOSPHOR,
  fg: "#ffb54d",
  dim: "#7a4f12",
  cursorBg: "#ffb54d",
  accent: "#ffe08a",
  statusFg: "#ffd39a",
};

// Grid cell metrics in CSS pixels (scaled by devicePixelRatio at render time).
export interface GridMetrics {
  cellW: number;
  cellH: number;
  fontSize: number;
  padding: number;
}

export const DEFAULT_METRICS: GridMetrics = {
  cellW: 16,
  cellH: 28,
  fontSize: 22,
  padding: 24,
};

/** Metrics zoomed by the screen-size setting: the grid keeps the same number
 *  of cells, each cell just renders larger or smaller. */
export function scaledMetrics(scale: number): GridMetrics {
  return {
    cellW: Math.max(8, Math.round(DEFAULT_METRICS.cellW * scale)),
    cellH: Math.max(14, Math.round(DEFAULT_METRICS.cellH * scale)),
    fontSize: Math.max(10, Math.round(DEFAULT_METRICS.fontSize * scale)),
    padding: Math.max(8, Math.round(DEFAULT_METRICS.padding * scale)),
  };
}

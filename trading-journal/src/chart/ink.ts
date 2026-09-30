/**
 * Grey ramp shared by theme, levels, panes and markers (Plan 5.2). Kept in a module without any
 * `lightweight-charts` import so that marker/colour helpers can be bundled into the main chunk
 * while the chart library stays in its lazy chunk.
 */
export const ink = {
  bg: "#0a0a0a",
  grid: "#1c1c1c",
  ref: "#3a3a3a",
  tick: "#5f5f5f",
  mute: "#9b9b9b",
  fg: "#f2f2f2",
  separator: "#1f1f1f",
  labelBg: "#161616",
  signal: "#e5202e",
  /** journal semantics for trade overlays (declared exception, Plan 5.5) */
  win: "#3ddc84",
  loss: "#ff4d4f",
} as const;

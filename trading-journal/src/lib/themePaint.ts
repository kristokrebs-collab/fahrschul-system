/**
 * Theme-following paint for colours that live in JS (P13): a dark-palette hex → the same colour as a CSS value that
 * follows the light mode / accent (`var(--token, #hex)` – the fallback is the hex itself, so the dark look is
 * unchanged). Only for SVG presentation attributes (`stroke`, `fill`, `stopColor`) and inline styles – NEVER for canvas
 * (`fillStyle` cannot resolve `var()`; canvas charts follow the theme through `applyInk`). Unknown colours pass through.
 */
const PAINT: Readonly<Record<string, string>> = {
  "#f2f2f2": "var(--color-fg, #f2f2f2)",
  "#9b9b9b": "var(--color-mute, #9b9b9b)",
  "#5f5f5f": "var(--color-faint, #5f5f5f)",
  "#2c2c2c": "var(--color-line-2, #2c2c2c)",
  "#1f1f1f": "var(--color-line, #1f1f1f)",
  "#1c1c1c": "var(--color-chart-grid, #1c1c1c)",
  "#3a3a3a": "var(--color-chart-ref, #3a3a3a)",
  "#3ddc84": "var(--color-win, #3ddc84)",
  "#ff4d4f": "var(--color-loss, #ff4d4f)",
  "#ffb020": "var(--color-warn, #ffb020)",
  "#e5202e": "var(--color-signal, #e5202e)",
  "#65b488": "var(--color-win-soft, #65b488)",
  "#d27a7b": "var(--color-loss-soft, #d27a7b)",
};

export function themePaint(color: string): string {
  return PAINT[color.toLowerCase()] ?? color;
}

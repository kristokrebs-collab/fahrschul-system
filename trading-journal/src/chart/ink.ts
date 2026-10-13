/**
 * Grey ramp shared by theme, levels, panes and markers (Plan 5.2). Kept in a module without any
 * `lightweight-charts` import so that marker/colour helpers can be bundled into the main chunk
 * while the chart library stays in its lazy chunk.
 *
 * Runtime override (P02 theme hook, used by the light mode in P13): `applyInk(partial)` changes the live palette in place
 * (every reader that looks a colour up at draw time follows), `subscribeInk(cb)` tells the charts to re-apply their
 * options, `resetInk()` restores `INK_DEFAULTS`. The defaults below are unchanged.
 */
const INK_BASE = {
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
  /** `win` / `loss` at ~50 % saturation: provisional (forming-candle) signals, decision 9 */
  winSoft: "#65b488",
  lossSoft: "#d2797a",
  /** the veil ink (maximum-foreground ink, always used with an alpha via `withAlpha`): volume bars, bands, zone fill */
  veil: "#ffffff",
  /** text on a mid-grey / signal axis label (the fg ink on ink, the paper on paper) */
  onFill: "#f2f2f2",
} as const;

export type InkKey = keyof typeof INK_BASE;
export type Ink = { readonly [K in InkKey]: string };

/** The dark defaults (never mutated). */
export const INK_DEFAULTS: Ink = Object.freeze({ ...INK_BASE });

/** The live palette (read colours at use time to follow `applyInk`). */
export const ink: Ink = { ...INK_BASE };

const listeners = new Set<() => void>();
const isColor = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 64;

/** Overrides colours of the live palette at runtime (unknown keys and non-strings are ignored); notifies the charts. */
export function applyInk(partial: Partial<Record<InkKey, string>>): void {
  const target = ink as { -readonly [K in InkKey]: string };
  let changed = false;
  for (const k of Object.keys(partial) as InkKey[]) {
    const v = partial[k];
    if (!(k in INK_BASE) || !isColor(v) || target[k] === v) continue;
    target[k] = v;
    changed = true;
  }
  if (changed) for (const l of [...listeners]) l();
}

/** Back to the dark defaults. */
export function resetInk(): void {
  applyInk(INK_DEFAULTS);
}

/** Called after every effective `applyInk` (charts re-apply their colour options). */
export function subscribeInk(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/**
 * A palette colour with an alpha as a canvas colour: `withAlpha("#ffffff", 0.14)` → `rgba(255,255,255,0.14)` (the very
 * string the charts used before the palette went live, so the dark look is unchanged). Non-hex input passes through.
 */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const KEY_OF_DEFAULT = new Map<string, InkKey>();
for (const k of Object.keys(INK_BASE) as InkKey[]) if (!KEY_OF_DEFAULT.has(INK_BASE[k])) KEY_OF_DEFAULT.set(INK_BASE[k], k);

/**
 * A stored dark-palette colour (an annotation's `#f2f2f2`, a setup marker …) as the live palette's colour of the same
 * role: `inkOf("#f2f2f2")` is `ink.fg` (`#121212` in light mode). Colours that are no palette default pass through.
 */
export function inkOf(color: string): string {
  const k = KEY_OF_DEFAULT.get(color.trim().toLowerCase());
  return k ? ink[k] : color;
}

/**
 * The pictures of rich empty states. `draw` and `burst` run (`@/motion/rich/EmptyArt`, a lazy chunk); `dots` is the static dot-matrix ∅ of the
 * plain empty state (no running picture – it took the place of the orbit, Rücknahme R6). Only the cheap parts live here.
 */
export type EmptyArtKind = "draw" | "dots" | "burst";

/** Art box of an empty state (px) – the placeholder in `EmptyState` reserves exactly this while the chunk loads. */
export const EMPTY_ART_W = 64;
export const EMPTY_ART_H = 40;
/** Height the picture takes in the flow: the 7 × 7 dot glyph it replaces (7 × 3 + 6 × 2 px) – the picture overhangs by 3,5 px each side, so no reserved card height moves. */
export const EMPTY_ART_FLOW_H = 33;

/** Stable pick for a string (so one empty state always shows the same picture). */
export function pickArt(seed: string): EmptyArtKind {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return (["draw", "dots", "burst"] as const)[h % 3]!;
}

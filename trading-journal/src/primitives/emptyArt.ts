/** The running pictures of rich empty states (`@/motion/rich/EmptyArt`, a lazy chunk). Only the cheap parts live here. */
export type EmptyArtKind = "draw" | "orbit" | "burst";

/** Art box of an empty state (px) – the placeholder in `EmptyState` reserves exactly this while the chunk loads. */
export const EMPTY_ART_W = 64;
export const EMPTY_ART_H = 40;

/** Stable pick for a string (so one empty state always shows the same picture). */
export function pickArt(seed: string): EmptyArtKind {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return (["draw", "orbit", "burst"] as const)[h % 3]!;
}

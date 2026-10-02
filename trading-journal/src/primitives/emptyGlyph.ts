import type { Frame as DotFrame } from "@/motion/DotMatrix";

/** 7 × 7 dot-matrix "∅" (empty set): a dotted ring crossed by a diagonal – the Nothing-style glyph for "nothing yet". */
export const EMPTY_GLYPH: DotFrame = [
  [0, 0, 1, 1, 1, 0, 1],
  [0, 1, 0, 0, 0, 1, 0],
  [1, 0, 0, 0, 1, 0, 1],
  [1, 0, 0, 1, 0, 0, 1],
  [1, 0, 1, 0, 0, 0, 1],
  [0, 1, 0, 0, 0, 1, 0],
  [1, 0, 1, 1, 1, 0, 0],
];

/**
 * Pure: frames in which the lit dots of `glyph` "breathe in sequence" – a soft brightness wave travels diagonally
 * (top-left → bottom-right) across them, every lit dot stays between `floor` and 1, unlit dots stay 0.
 * `count` frames make one seamless loop.
 */
export function breathingFrames(glyph: DotFrame, count = 24, floor = 0.22, spread = 0.55): DotFrame[] {
  const frames: DotFrame[] = [];
  for (let k = 0; k < count; k++) {
    const phase = (k / count) * Math.PI * 2;
    frames.push(
      glyph.map((row, r) =>
        row.map((on, c) => {
          if (!on) return 0;
          const wave = (1 + Math.cos(phase - (r + c) * spread)) / 2;
          return floor + (1 - floor) * wave * wave;
        }),
      ),
    );
  }
  return frames;
}

/** The empty-state glyph animation (computed once). */
export const EMPTY_GLYPH_FRAMES: readonly DotFrame[] = breathingFrames(EMPTY_GLYPH);

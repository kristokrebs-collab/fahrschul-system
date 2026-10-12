import { motion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/** 8 × 8 Bayer matrix (0…63): the order in which the dither cells clear. */
export const BAYER8: readonly (readonly number[])[] = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

/** Stepped easing for the clip-path wipe (scan-line feel). */
export const steppedEase = (n: number) => (t: number) => Math.min(1, Math.ceil(t * n) / n);

const WIPE_STEPS = 12;
const CLIP_FROM = "inset(0% 0% 100% 0% round 12px)";
const CLIP_TO = "inset(0% 0% 0% 0% round 12px)";

export interface QrRevealProps {
  /** `data:image/svg+xml…` QR. */
  src: string;
  alt: string;
  className?: string;
}

/**
 * The 2FA QR code appears with a dither wipe (P09): the code is revealed top → bottom in 12 hard clip-path steps
 * (`tween.draw`, stepped easing) while an 8 × 8 ink grid over it dissolves in Bayer order (opacity only,
 * `tween.reveal` per cell, spread over the wipe). The grid unmounts afterwards; the image ends at `clip-path: none`.
 * White plate: the QR stays scannable in the dark theme. Reduced motion: shown at once.
 */
export function QrReveal({ src, alt, className }: QrRevealProps) {
  const reduced = useReducedFx();
  const [done, setDone] = useState(reduced);
  const span = tween.draw.duration;
  return (
    <div className={cn("relative mx-auto aspect-square w-[min(100%,13rem)] rounded-2xl bg-white p-3 shadow-[0_18px_50px_rgb(0_0_0/0.45)]", className)}>
      <motion.img
        src={src}
        alt={alt}
        width={176}
        height={176}
        className="block size-full select-none rounded-xl [image-rendering:pixelated]"
        draggable={false}
        initial={reduced ? false : { clipPath: CLIP_FROM }}
        animate={{ clipPath: CLIP_TO, transitionEnd: { clipPath: "none" } }}
        transition={{ duration: span, ease: steppedEase(WIPE_STEPS) }}
        onAnimationComplete={() => setDone(true)}
      />
      {!done && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-3 grid grid-cols-8 grid-rows-8 overflow-hidden rounded-xl">
          {BAYER8.flatMap((row, r) =>
            row.map((v, c) => (
              <motion.span
                key={`${r}-${c}`}
                className="bg-ink-900"
                initial={{ opacity: 1 }}
                animate={{ opacity: 0 }}
                transition={{ ...tween.reveal, delay: (v / 64) * span * 0.85 }}
              />
            )),
          )}
        </div>
      )}
    </div>
  );
}

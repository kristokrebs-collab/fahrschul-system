import { attachSpring, motion, useMotionValue, useTransform, type MotionValue, type SpringOptions } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { formatNumber, type FormatNumberOptions } from "@/motion/MotionNumber";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useValueFlash } from "@/motion/ValueFlash";

/** Pure: the label for `n` – `–` for non-finite input, otherwise `format(n)` or de-DE `formatNumber`. */
export function formatLive(n: number, format?: (n: number) => string, options: FormatNumberOptions = {}): string {
  if (!Number.isFinite(n)) return "–";
  return format ? format(n) : formatNumber(n, options);
}

/**
 * A MotionValue that follows `source` on a spring while `enabled` (attached imperatively, no React renders);
 * while disabled it is left untouched – render `source` itself then. Pass a stable `transition` (a token).
 */
export function useSmoothedValue(source: MotionValue<number>, transition: SpringOptions, enabled: boolean): MotionValue<number> {
  const out = useMotionValue(source.get());
  useLayoutEffect(() => {
    if (!enabled) return;
    out.jump(source.get());
    return attachSpring(out, source, transition);
  }, [out, source, transition, enabled]);
  return out;
}

type LiveTag = "span" | "p" | "div";

export interface LiveTextProps extends FormatNumberOptions {
  /** The live number (e.g. `priceMv`). */
  source: MotionValue<number>;
  /** Custom formatter (overrides decimals/prefix/suffix/signed). */
  format?: (n: number) => string;
  /** Glide between values: `true` → `spring.price`, or a spring token. Off under reduced motion. */
  smooth?: boolean | SpringOptions;
  /** Up/down tick flash behind the text (pre-rendered layers, opacity only). */
  flash?: boolean;
  /** Ignore moves smaller than this for the flash. */
  flashMinMove?: number;
  as?: LiveTag;
  className?: string;
  /** Static accessible label (throttle updates to ≤ 1 Hz if it carries the value). Never `aria-live`. */
  "aria-label"?: string;
}

/**
 * Live number as text with zero React renders: the formatted string is a `useTransform` MotionValue rendered as a
 * `motion.span` child, so every 120 Hz frame can show a new (optionally spring-smoothed) value while React stays idle.
 * `tabular-nums` keeps the width steady. Reduced motion: raw value, no glide; the flash becomes an underline.
 */
export function LiveText({ source, format, smooth = false, flash = false, flashMinMove, as = "span", className, decimals, prefix, suffix, signed, "aria-label": ariaLabel }: LiveTextProps) {
  const reduced = useReducedFx();
  const smoothing = smooth !== false && !reduced;
  const smoothed = useSmoothedValue(source, smooth === true || smooth === false ? spring.price : smooth, smoothing);
  const shown = smoothing ? smoothed : source;
  const text = useTransform(() => formatLive(shown.get(), format, { decimals, prefix, suffix, signed }));

  const upRef = useRef<HTMLSpanElement>(null);
  const downRef = useRef<HTMLSpanElement>(null);
  useValueFlash({ source }, upRef, downRef, { minMove: flashMinMove, enabled: flash });

  const Tag = motion[as] as typeof motion.span;
  if (!flash) {
    return (
      <Tag className={cn("tabular-nums", className)} aria-label={ariaLabel}>
        {text}
      </Tag>
    );
  }
  const layer = reduced ? "inset-x-0 -bottom-0.5 h-0.5 rounded-full" : "-inset-x-1 inset-y-0 rounded-md";
  return (
    <Tag className={cn("relative isolate inline-block tabular-nums", className)} aria-label={ariaLabel}>
      <span ref={upRef} aria-hidden="true" className={cn("pointer-events-none absolute -z-10 opacity-0", layer, reduced ? "bg-win" : "bg-win/15")} />
      <span ref={downRef} aria-hidden="true" className={cn("pointer-events-none absolute -z-10 opacity-0", layer, reduced ? "bg-loss" : "bg-loss/15")} />
      <motion.span>{text}</motion.span>
    </Tag>
  );
}

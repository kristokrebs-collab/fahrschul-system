import { animate, motion, useMotionValue, useMotionValueEvent, useTransform, type MotionValue, type Transition } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export type NumberTone = "win" | "loss" | "fg";

export interface FormatNumberOptions {
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Prepend `+` for positive values (minus is always U+2212). */
  signed?: boolean;
}

const formatters = new Map<number, Intl.NumberFormat>();
function nf(decimals: number): Intl.NumberFormat {
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(decimals, f);
  }
  return f;
}

/** de-DE, U+2212 minus, optional sign/prefix/suffix. `null` → `–`. */
export function formatNumber(value: number | null | undefined, { decimals = 0, prefix = "", suffix = "", signed = false }: FormatNumberOptions = {}): string {
  if (value == null || Number.isNaN(value)) return "–";
  const rounded = Number(value.toFixed(decimals));
  const sign = signed && rounded > 0 ? "+" : "";
  return prefix + sign + nf(decimals).format(rounded).replace("-", "−") + suffix;
}

export function toneOf(value: number | null | undefined): NumberTone {
  if (value == null || value === 0 || Number.isNaN(value)) return "fg";
  return value > 0 ? "win" : "loss";
}

export interface UseAnimatedNumberOptions {
  transition?: Transition;
  /** Set instantly instead of animating (e.g. while off-screen or for >4 Hz feeds). */
  instant?: boolean;
}

/**
 * Owns a MotionValue that follows `value` with `spring.number` (retargets with velocity, no React
 * re-render per frame). Reduced motion → `mv.set(value)`. Share the returned MotionValue between
 * a hero figure and its dialog so both show the same interpolated number.
 */
export function useAnimatedNumber(value: number, { transition = spring.number, instant = false }: UseAnimatedNumberOptions = {}): MotionValue<number> {
  const mv = useMotionValue(value);
  const reduced = useReducedFx();
  useEffect(() => {
    if (reduced || instant) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, transition);
    return () => controls.stop();
  }, [mv, value, reduced, instant, transition]);
  return mv;
}

export interface MotionNumberProps extends FormatNumberOptions {
  /** Target value. Ignored when `source` is given. */
  value?: number | null;
  /** Externally owned MotionValue (e.g. from `useAnimatedNumber`) – rendered, not animated here. */
  source?: MotionValue<number>;
  /** Custom formatter (overrides decimals/prefix/suffix/signed). */
  format?: (n: number) => string;
  /**
   * `auto`: three stacked spans (`text-win`/`text-loss`/`text-fg`) crossfaded on `tween.crossfade`
   * when the sign flips; only the current one is exposed to assistive tech. `none`: inherits colour.
   */
  tone?: "auto" | "none";
  /** Animate only while visible (`IntersectionObserver`); off-screen values are set instantly. */
  gate?: boolean;
  transition?: Transition;
  className?: string;
  /** Accessible label override; defaults to the formatted target value. */
  "aria-label"?: string;
}

const TONE_CLASS: Record<NumberTone, string> = { win: "text-win", loss: "text-loss", fg: "text-fg" };
const TONES: NumberTone[] = ["win", "loss", "fg"];

/**
 * Animated number (Bundle `Yw`, Plan 3.3 "Zahlen"): `useMotionValue` + `animate(mv, v, spring.number)`,
 * text via `useTransform` (rendered as a MotionValue child, no re-render), de-DE, U+2212, `tabular-nums`.
 */
export function MotionNumber({
  value,
  source,
  decimals = 0,
  prefix = "",
  suffix = "",
  signed = false,
  format,
  tone = "none",
  gate = false,
  transition = spring.number,
  className,
  "aria-label": ariaLabel,
}: MotionNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(!gate);
  const target = value ?? 0;
  const own = useAnimatedNumber(target, { transition, instant: !visible });
  const mv = source ?? own;

  useEffect(() => {
    if (!gate || typeof IntersectionObserver === "undefined") return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, [gate]);

  const fmt = useMemo(() => format ?? ((n: number) => formatNumber(n, { decimals, prefix, suffix, signed })), [format, decimals, prefix, suffix, signed]);
  const text = useTransform(() => (value === null && !source ? "–" : fmt(mv.get())));

  const [currentTone, setCurrentTone] = useState<NumberTone>(() => toneOf(mv.get()));
  useMotionValueEvent(mv, "change", (v) => {
    const t = toneOf(Number(v.toFixed(decimals)));
    setCurrentTone((prev) => (prev === t ? prev : t));
  });

  const label = ariaLabel ?? (value === null && !source ? "–" : fmt(source ? source.get() : target));

  if (tone === "none") {
    return (
      <motion.span ref={ref} className={cn("inline-block tabular-nums", className)} aria-label={label}>
        {text}
      </motion.span>
    );
  }

  return (
    <span ref={ref} className={cn("relative inline-grid tabular-nums", className)} aria-label={label}>
      {TONES.map((t) => (
        <motion.span
          key={t}
          aria-hidden={t !== currentTone}
          className={cn("col-start-1 row-start-1", TONE_CLASS[t])}
          initial={false}
          animate={{ opacity: t === currentTone ? 1 : 0 }}
          transition={tween.crossfade}
        >
          {text}
        </motion.span>
      ))}
    </span>
  );
}

import { animate, motion, useMotionValue, useTransform, type AnimationPlaybackControls, type MotionValue, type Transition } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { canObserveInView, observeInView } from "@/motion/inView";
import { cancelReplay, replay, type ReplayControls } from "@/motion/replay";
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

/** Retrigger guard for `flash` on continuously changing sources (a counting MotionValue keeps the tint lit). */
const FLASH_COOLDOWN_MS = 120;

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
  /** Animate only while visible (one shared `IntersectionObserver`); off-screen changes are set instantly. */
  gate?: boolean;
  /**
   * Value-change flash: an up-move tints the number `win`, a down-move `loss` (soft backdrop + tinted copy),
   * decaying on `tween.flash`. Compositor-only (opacity of pre-rendered layers); off under reduced motion.
   */
  flash?: boolean;
  /**
   * Count up from 0 (on `transition`) the first time the number scrolls into view; later changes roll from the
   * previous value. No effect with `source`, under reduced motion or without `IntersectionObserver`.
   */
  countOnReveal?: boolean;
  /**
   * Makes `countOnReveal` session-once: a number with a key that already counted up in this session (any mount, e.g.
   * on an earlier visit of the page) shows its value at once instead of counting from 0 again; changes still roll.
   */
  revealKey?: string;
  transition?: Transition;
  className?: string;
  /** Accessible label override; defaults to the formatted target value. */
  "aria-label"?: string;
}

const TONE_CLASS: Record<NumberTone, string> = { win: "text-win", loss: "text-loss", fg: "text-fg" };
const TONES: NumberTone[] = ["win", "loss", "fg"];

/** `revealKey`s that already counted up in this session (module scope: survives unmounts and page switches). */
const REVEALED = new Set<string>();

/**
 * The MotionValue a `MotionNumber` renders when it owns its value: springs to `target`, respects `gate`
 * (instant while off-screen) and `countOnReveal` (holds 0 until first in view). Visibility lives in refs fed by
 * the shared observer, so scrolling a 150-row table costs no React commits.
 */
function useOwnedNumber(
  ref: RefObject<HTMLElement | null>,
  target: number,
  { gate, countOnReveal, revealKey, transition, enabled }: { gate: boolean; countOnReveal: boolean; revealKey?: string; transition: Transition; enabled: boolean },
): MotionValue<number> {
  const reduced = useReducedFx();
  const [counts] = useState(() => countOnReveal && enabled && !reduced && canObserveInView() && !(revealKey !== undefined && REVEALED.has(revealKey)));
  const mv = useMotionValue(counts ? 0 : target);
  const visible = useRef(!gate);
  const revealed = useRef(!counts);
  const latest = useRef({ target, transition });
  const running = useRef<AnimationPlaybackControls | null>(null);

  useEffect(() => {
    latest.current = { target, transition };
  }, [target, transition]);

  useEffect(() => {
    if (!enabled || (!gate && !counts)) return;
    const el = ref.current;
    if (!el) return;
    return observeInView(el, (inView) => {
      visible.current = inView || !gate;
      if (!inView || revealed.current) return;
      revealed.current = true;
      if (revealKey !== undefined) REVEALED.add(revealKey);
      running.current?.stop();
      running.current = animate(mv, latest.current.target, latest.current.transition);
    });
  }, [ref, enabled, gate, counts, mv, revealKey]);

  useEffect(() => {
    if (!enabled || !revealed.current) return;
    running.current?.stop();
    running.current = null;
    if (reduced || !visible.current) {
      mv.jump(target);
      return;
    }
    running.current = animate(mv, target, transition);
  }, [enabled, target, transition, reduced, mv]);

  useEffect(() => () => running.current?.stop(), []);
  return mv;
}

const FLASH_FRAMES = { opacity: [1, 0] } as const;

/**
 * Up/down flash on two pre-rendered layers (refs returned for them). React `value` changes flash once per change;
 * a `source` flashes on its own change events (≥ `FLASH_COOLDOWN_MS` apart, or immediately when the direction flips).
 */
function useValueFlash(enabled: boolean, value: number, source: MotionValue<number> | undefined): { up: RefObject<HTMLSpanElement | null>; down: RefObject<HTMLSpanElement | null> } {
  const reduced = useReducedFx();
  const up = useRef<HTMLSpanElement>(null);
  const down = useRef<HTMLSpanElement>(null);
  const state = useRef({ value, at: 0, dir: 0, controls: null as ReplayControls | null });

  const fire = useCallback((dir: 1 | -1) => {
    const s = state.current;
    const on = dir > 0 ? up.current : down.current;
    const off = dir > 0 ? down.current : up.current;
    if (!on) return;
    s.controls?.stop();
    // the opposite tint is cut, not faded: a direction flip must read instantly; one native animation per layer,
    // restarted (`replay`) – nothing built per tick
    cancelReplay(off);
    s.controls = replay(on, FLASH_FRAMES, tween.flash);
    s.at = performance.now();
    s.dir = dir;
  }, []);

  useEffect(() => {
    const s = state.current;
    const prev = s.value;
    s.value = value;
    if (!enabled || reduced || source || prev === value) return;
    fire(value > prev ? 1 : -1);
  }, [enabled, reduced, source, value, fire]);

  useEffect(() => {
    if (!enabled || reduced || !source) return;
    const s = state.current;
    s.value = source.get();
    return source.on("change", (v) => {
      const prev = s.value;
      s.value = v;
      if (v === prev) return;
      const dir = v > prev ? 1 : -1;
      if (dir === s.dir && performance.now() - s.at < FLASH_COOLDOWN_MS) return;
      fire(dir);
    });
  }, [enabled, reduced, source, fire]);

  useEffect(() => {
    const s = state.current;
    return () => s.controls?.stop();
  }, []);
  return { up, down };
}

/**
 * Animated number (Bundle `Yw`, Plan 3.3 "Zahlen"): `useMotionValue` + `animate(mv, v, spring.number)`,
 * text via `useTransform` (rendered as a MotionValue child, no re-render), de-DE, U+2212, `tabular-nums`.
 * Optional `flash` (up/down tint on `tween.flash`) and `countOnReveal` (0 → value when first in view).
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
  flash = false,
  countOnReveal = false,
  revealKey,
  transition = spring.number,
  className,
  "aria-label": ariaLabel,
}: MotionNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const target = value ?? 0;
  const own = useOwnedNumber(ref, target, { gate, countOnReveal, revealKey, transition, enabled: !source });
  const mv = source ?? own;
  const { up: upRef, down: downRef } = useValueFlash(flash, target, source);

  const fmt = useMemo(() => format ?? ((n: number) => formatNumber(n, { decimals, prefix, suffix, signed })), [format, decimals, prefix, suffix, signed]);
  const text = useTransform(() => (value === null && !source ? "–" : fmt(mv.get())));

  const [currentTone, setCurrentTone] = useState<NumberTone>(() => toneOf(mv.get()));
  // the sign listener only exists for `tone="auto"`: a per-frame source (ring centre, bar counter) costs nothing otherwise
  useEffect(() => {
    if (tone === "none") return;
    return mv.on("change", (v) => {
      const t = toneOf(Number(v.toFixed(decimals)));
      setCurrentTone((prev) => (prev === t ? prev : t));
    });
  }, [mv, tone, decimals]);

  const label = ariaLabel ?? (value === null && !source ? "–" : fmt(source ? source.get() : target));

  const flashLayers = flash
    ? (["up", "down"] as const).map((d) => (
        <span
          key={d}
          ref={d === "up" ? upRef : downRef}
          aria-hidden="true"
          className={cn("pointer-events-none relative col-start-1 row-start-1 opacity-0", d === "up" ? "text-win" : "text-loss")}
        >
          <span className={cn("absolute -inset-x-1 inset-y-0 rounded-md", d === "up" ? "bg-win/15" : "bg-loss/15")} />
          <motion.span className="relative">{text}</motion.span>
        </span>
      ))
    : null;

  if (tone === "none" && !flash) {
    return (
      <motion.span ref={ref} className={cn("inline-block tabular-nums", className)} aria-label={label}>
        {text}
      </motion.span>
    );
  }

  // flash layers come last so their tinted copy (and the translucent wash) sit on top of the base text
  return (
    <span ref={ref} className={cn("relative inline-grid tabular-nums", className)} aria-label={label}>
      {tone === "none" ? (
        <motion.span className="relative col-start-1 row-start-1">{text}</motion.span>
      ) : (
        TONES.map((t) => (
          <motion.span
            key={t}
            aria-hidden={t !== currentTone}
            className={cn("relative col-start-1 row-start-1", TONE_CLASS[t])}
            initial={false}
            animate={{ opacity: t === currentTone ? 1 : 0 }}
            transition={tween.crossfade}
          >
            {text}
          </motion.span>
        ))
      )}
      {flashLayers}
    </span>
  );
}

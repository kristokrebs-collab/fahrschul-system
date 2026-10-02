import { animate, type AnimationPlaybackControls, type MotionValue } from "motion/react";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { fxTiming, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/** Ticks closer than this keep the current flash lit instead of restarting it (≈ 8 Hz; React-driven values). */
export const FLASH_COOLDOWN_MS = 120;
/**
 * Minimum gap between two flashes of a live market value (price odometer, header ticker, Bid/Ask, chart pulse tint):
 * on a realistic feed the wash otherwise stays lit and flips colour several times a second, so it signals nothing.
 */
export const FLASH_MIN_INTERVAL_MS = fxTiming.liveFlashGap * 1000;

/**
 * Pure: direction of a change from `prev` to `next` – `1` up, `-1` down, `0` when equal, not finite or the move is
 * smaller than `minMove`.
 */
export function flashDirection(prev: number, next: number, minMove = 0): -1 | 0 | 1 {
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return 0;
  const d = next - prev;
  if (d === 0 || Math.abs(d) < minMove) return 0;
  return d > 0 ? 1 : -1;
}

export interface ValueFlashOptions {
  /** Ignore moves smaller than this (e.g. half a tick). */
  minMove?: number;
  /**
   * Minimum gap between two flashes in ms (default `FLASH_COOLDOWN_MS`). A same-direction tick inside it keeps the
   * current flash; a direction flip inside it only cuts the current flash (never lights the opposite colour early).
   */
  cooldownMs?: number;
  /** Off switch (the hook is still called unconditionally). */
  enabled?: boolean;
}

/**
 * Flashes `up` on an up-move and `down` on a down-move: `opacity 1 → 0` on `tween.flash` (compositor-only, the
 * layers are pre-rendered). Feed either a React `value` or a `source` MotionValue (then every change event counts,
 * with no React render). Ticks after the `cooldownMs` gap retrigger from the peak; equal values and moves below
 * `minMove` do nothing. The hook itself does not check reduced motion – callers pick calmer layers (as `ValueFlash` does) or
 * pass `enabled: false`.
 */
export function useValueFlash(
  input: { value?: number | null; source?: MotionValue<number> },
  up: RefObject<HTMLElement | null>,
  down: RefObject<HTMLElement | null>,
  { minMove = 0, cooldownMs = FLASH_COOLDOWN_MS, enabled = true }: ValueFlashOptions = {},
): void {
  const { value, source } = input;
  const state = useRef({ value: value ?? NaN, at: -Infinity, dir: 0, controls: null as AnimationPlaybackControls | null });

  useEffect(() => {
    const s = state.current;
    const fire = (dir: -1 | 1) => {
      const now = performance.now();
      if (now - s.at < cooldownMs) {
        if (dir === s.dir) return;
        // a flip inside the gap: cut the stale colour, light nothing (the colour shown is never the wrong one)
        s.controls?.stop();
        s.controls = null;
        if (up.current) up.current.style.opacity = "0";
        if (down.current) down.current.style.opacity = "0";
        s.dir = 0;
        return;
      }
      const on = dir > 0 ? up.current : down.current;
      const off = dir > 0 ? down.current : up.current;
      if (!on) return;
      s.controls?.stop();
      if (off) off.style.opacity = "0";
      s.controls = animate(on, { opacity: [1, 0] }, tween.flash);
      s.at = now;
      s.dir = dir;
    };
    const step = (next: number) => {
      const dir = flashDirection(s.value, next, minMove);
      if (dir !== 0 || !Number.isFinite(s.value)) s.value = next;
      if (enabled && dir !== 0) fire(dir);
    };
    if (source) {
      s.value = source.get();
      return source.on("change", step);
    }
    if (value != null) step(value);
  }, [source, value, minMove, cooldownMs, enabled, up, down]);

  useEffect(() => () => state.current.controls?.stop(), []);
}

export interface ValueFlashProps extends ValueFlashOptions {
  /** React-driven value (one flash per change). */
  value?: number | null;
  /** MotionValue-driven value (flashes on change events, zero React renders). */
  source?: MotionValue<number>;
  children: ReactNode;
  className?: string;
}

/**
 * Tick flash behind a number (21st.dev "Value Flash"): a soft rounded `win/15` (up) or `loss/15` (down) backdrop that
 * decays over `tween.flash`. Reduced motion: no backdrop, a 2 px coloured underline that fades instead. The
 * layers are `aria-hidden` and `pointer-events-none`; the children render once, untouched.
 */
export function ValueFlash({ value, source, children, className, minMove, cooldownMs, enabled = true }: ValueFlashProps) {
  const reduced = useReducedFx();
  const upRef = useRef<HTMLSpanElement>(null);
  const downRef = useRef<HTMLSpanElement>(null);
  useValueFlash({ value, source }, upRef, downRef, { minMove, cooldownMs, enabled });
  const layer = reduced ? "inset-x-0 -bottom-0.5 h-0.5 rounded-full" : "-inset-x-1 inset-y-0 rounded-md";
  return (
    <span className={cn("relative inline-block isolate", className)}>
      <span ref={upRef} aria-hidden="true" className={cn("pointer-events-none absolute -z-10 opacity-0", layer, reduced ? "bg-win" : "bg-win/15")} />
      <span ref={downRef} aria-hidden="true" className={cn("pointer-events-none absolute -z-10 opacity-0", layer, reduced ? "bg-loss" : "bg-loss/15")} />
      {children}
    </span>
  );
}

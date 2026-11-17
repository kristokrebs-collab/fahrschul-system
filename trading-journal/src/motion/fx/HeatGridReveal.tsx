import { animate, type AnimationPlaybackControls } from "motion/react";
import { Children, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { FX_TONE, useFxPlay } from "@/motion/fx/shared";
import { isSafeFx } from "@/motion/safeFx";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * HeatGridReveal – the cells of a heatmap / correlation matrix / habit grid land as a radial cascade from ONE origin
 * cell (pass the best cell – "trade the best"): delay = Chebyshev ring distance · `stagger.heat`, capped at
 * `stagger.heatMax`, so even a 30 × 30 grid lands in < 0.8 s. Each cell pops from `{opacity 0, scale .55}` on
 * `spring.deal` (opacity `tween.heat`) and ends with no inline transform (`transform: none`); the origin cell gets one
 * signal ring.
 *
 * You render the cells (row-major children); the component lays them out with `cols` columns (CSS grid, `className`
 * for gap / sizing) and wraps each in a plain cell. The cascade is imperative (one Motion animation per cell, started
 * in a layout effect – no motion component per cell, no React render per frame, a replay does not re-mount your
 * cells). Plays on first view and on every new `play` key. Reduced motion: static grid. Helpers: `heatDelay`,
 * `heatColor`.
 */
export const HEAT_GRID = {
  fromScale: 0.55,
  /** the origin cell's ring: start / end scale */
  ring: [0.9, 2.2] as const,
} as const;

/** Row / column of a row-major index. */
function rc(index: number, cols: number): [number, number] {
  return [Math.floor(index / cols), index % cols];
}

/** Delay (s) of cell `index` for a cascade from `origin` (index or [row, col]). */
export function heatDelay(index: number, cols: number, origin: number | readonly [number, number] = 0, step: number = stagger.heat, cap: number = stagger.heatMax): number {
  const c = Math.max(1, Math.round(cols));
  const [r0, c0] = typeof origin === "number" ? rc(Math.max(0, origin), c) : origin;
  const [r, cc] = rc(index, c);
  const ring = Math.max(Math.abs(r - r0), Math.abs(cc - c0));
  return Math.min(cap, ring * step);
}

/**
 * Cell colour for a value `t` in −1..1 (diverging: loss red ← ink → win green) or 0..1 (sequential towards `tone`),
 * as a CSS `color-mix` string – no extra palette, only the fx tones.
 */
export function heatColor(t: number, mode: "diverging" | "win" | "loss" | "signal" | "fg" = "diverging"): string {
  const v = Number.isFinite(t) ? t : 0;
  if (mode === "diverging") {
    const a = Math.min(1, Math.abs(v));
    const tone = v >= 0 ? FX_TONE.win : FX_TONE.loss;
    return `color-mix(in srgb, ${tone} ${Math.round(8 + a * 62)}%, var(--color-ink-850))`;
  }
  const a = Math.min(1, Math.max(0, v));
  return `color-mix(in srgb, ${FX_TONE[mode]} ${Math.round(6 + a * 70)}%, var(--color-ink-850))`;
}

export interface HeatGridRevealProps {
  cols: number;
  /** Origin cell (row-major index or [row, col]); default 0. */
  origin?: number | readonly [number, number];
  /** Replay key (e.g. the period): every new value cascades again. */
  play?: number | boolean;
  /** Cascade on first view (default true). */
  playOnView?: boolean;
  children: ReactNode;
  className?: string;
  cellClassName?: string;
  /** Mark the origin with one signal ring (default true). */
  ring?: boolean;
  "aria-label"?: string;
  role?: string;
  /** Click on the grid itself (a gap or the halo around it); a click on a cell's own control never reaches it as `target === currentTarget`. */
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  /** Dense grid (`tests/e2e/hitbox.ts`): the grid is the touch target and snaps a tap within this many px to the nearest cell. */
  "data-hit-grid"?: number;
}

export function HeatGridReveal({ cols, origin = 0, play, playOnView = true, children, className, cellClassName, ring = true, "aria-label": ariaLabel, role, onClick, "data-hit-grid": hitGrid }: HeatGridRevealProps) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const [run, setRun] = useState(0);
  const [safe] = useState(isSafeFx);
  useFxPlay(ref, play, playOnView, !reduced, () => setRun((n) => n + 1));
  const cells = Children.toArray(children);
  const c = Math.max(1, Math.round(cols));
  const originIndex = typeof origin === "number" ? origin : origin[0] * c + origin[1];
  const originKey = typeof origin === "number" ? origin : `${origin[0]}:${origin[1]}`;
  const grid: CSSProperties = { gridTemplateColumns: `repeat(${c}, minmax(0, 1fr))` };
  // before the first cascade (waiting for the first view) the cells are hidden – never a flash of the final grid
  const hidden = !reduced && run === 0 && playOnView;

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || run === 0 || reduced) return;
    const controls: AnimationPlaybackControls[] = [];
    const els = Array.from(root.children) as HTMLElement[];
    els.forEach((el, i) => {
      const delay = heatDelay(i, c, origin);
      el.style.opacity = "0";
      el.style.transform = `scale(${HEAT_GRID.fromScale})`;
      const pop = animate(el, { transform: [`scale(${HEAT_GRID.fromScale})`, "scale(1)"] }, { ...spring.deal, delay });
      const fade = animate(el, { opacity: [0, 1] }, { ...tween.heat, delay });
      controls.push(pop, fade);
      // rest without an inline transform (`transform: none` – no containing block for fixed descendants)
      void Promise.all([pop.finished, fade.finished]).then(() => {
        el.style.transform = "";
        el.style.opacity = "";
      });
    });
    const r = ringRef.current;
    if (r) controls.push(animate(r, { opacity: [0.95, 0], transform: [`scale(${HEAT_GRID.ring[0]})`, `scale(${HEAT_GRID.ring[1]})`] }, { ...tween.ripple, delay: 0.05 }));
    return () => {
      for (const ctl of controls) ctl.stop();
      for (const el of els) {
        el.style.transform = "";
        el.style.opacity = "";
      }
    };
    // `origin` is captured through `originKey`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, reduced, c, originKey]);

  return (
    <div ref={ref} role={role} aria-label={ariaLabel} data-fx="heat-grid" data-run={run} data-hit-grid={hitGrid} onClick={onClick} className={cn("grid", className)} style={grid}>
      {cells.map((cell, i) => (
        <div key={i} className={cn("relative", cellClassName)} style={hidden ? { opacity: 0 } : undefined}>
          {cell}
          {ring && !reduced && i === originIndex && (
            <span
              ref={ringRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0"
              style={{ boxShadow: `0 0 0 1.5px ${FX_TONE.signal}${safe ? "" : `, 0 0 14px ${FX_TONE.signal}`}` }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

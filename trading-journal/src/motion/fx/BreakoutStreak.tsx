import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { liveHex, type FxTone } from "@/motion/fx/shared";
import { cubicBezier, seeded } from "@/motion/pulse/engine";
import { createTimeline, usePlayTrigger, type Timeline } from "@/motion/pulse/textKit";
import { ease, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * BreakoutStreak – a burst of chevron particles (`›`) shooting out in the breakout direction: at most 40 particles,
 * launched `stagger.streak` apart, each living ≈ `tween.streak`, drawn on ONE canvas that fills its `relative` parent.
 * Finite: after the last particle the canvas is cleared and the loop sleeps (also off-screen / in a hidden tab:
 * `createTimeline`). The canvas size is measured on resize only (≤ 2× DPR); per frame the pure `streakAt` positions
 * are drawn – no DOM reads, no React renders. aria-hidden; reduced motion: nothing is drawn.
 */
export type StreakDirection = "up" | "down" | "left" | "right";

export const BREAKOUT_STREAK = {
  maxParticles: 40,
  count: 24,
  /** chevron arm length in px (scaled per particle 0.7–1.3) */
  arm: 6,
  lineWidth: 2,
  /** travel as a share of the box extent along the direction (min … max) */
  travel: [0.45, 0.95] as const,
  /** lateral spread as a share of the box extent across the direction */
  spread: 0.7,
  maxDpr: 2,
} as const;

export interface StreakParticle {
  /** launch delay, s */
  delay: number;
  /** life, s */
  life: number;
  /** lateral offset −0.5 … 0.5 (share of the cross extent, scaled by `spread`) */
  lateral: number;
  /** travel 0..1 of the box extent */
  travel: number;
  /** arm length scale */
  scale: number;
  /** peak opacity */
  alpha: number;
}

/** Deterministic particle set of one burst (seeded – identical in tests and renders, never Math.random per frame). */
export function streakParticles(count: number, seed = 1): StreakParticle[] {
  const n = Math.max(0, Math.min(BREAKOUT_STREAK.maxParticles, Math.round(count)));
  const rand = seeded(seed);
  const [t0, t1] = BREAKOUT_STREAK.travel;
  return Array.from({ length: n }, (_, i) => ({
    delay: i * stagger.streak + rand() * stagger.streak,
    life: tween.streak.duration * (0.8 + rand() * 0.4),
    lateral: rand() - 0.5,
    travel: t0 + rand() * (t1 - t0),
    scale: 0.7 + rand() * 0.6,
    alpha: 0.55 + rand() * 0.45,
  }));
}

/** Total duration of a burst in seconds (last launch + its life). */
export function streakDuration(ps: readonly StreakParticle[]): number {
  return ps.reduce((m, p) => Math.max(m, p.delay + p.life), 0);
}

const easeTravel = cubicBezier(...ease.out);

/**
 * Position (box px) and opacity of particle `p` at `t` seconds after the burst start in a `w × h` box, or null when it
 * is not alive. Origin defaults to the box edge the burst leaves from (bottom centre for `up`, …).
 */
export function streakAt(p: StreakParticle, t: number, dir: StreakDirection, w: number, h: number, origin?: { x: number; y: number }, spread: number = BREAKOUT_STREAK.spread): { x: number; y: number; alpha: number } | null {
  const local = (t - p.delay) / p.life;
  if (local < 0 || local > 1) return null;
  const k = easeTravel(local);
  const vertical = dir === "up" || dir === "down";
  const along = vertical ? h : w;
  const across = vertical ? w : h;
  const sign = dir === "up" || dir === "left" ? -1 : 1;
  const ox = (origin?.x ?? (vertical ? 0.5 : dir === "right" ? 0 : 1)) * w;
  const oy = (origin?.y ?? (vertical ? (dir === "up" ? 1 : 0) : 0.5)) * h;
  const lat = p.lateral * spread * across;
  const d = sign * p.travel * along * k;
  // fade in over the first 12 %, out over the last 55 %
  const alpha = p.alpha * (local < 0.12 ? local / 0.12 : local > 0.45 ? Math.max(0, (1 - local) / 0.55) : 1);
  return vertical ? { x: ox + lat * (0.6 + 0.4 * k), y: oy + d, alpha } : { x: ox + d, y: oy + lat * (0.6 + 0.4 * k), alpha };
}

export interface BreakoutStreakProps {
  direction?: StreakDirection;
  tone?: Extract<FxTone, "win" | "loss" | "signal" | "fg">;
  /** Particles per burst (≤ 40, default 24). */
  count?: number;
  /** Replay key: every new number (or false → true) fires one burst. */
  play?: number | boolean;
  /** Fire once on mount (default true). */
  playOnMount?: boolean;
  /** Launch point as a share of the box (default: the edge opposite the direction, centred). */
  origin?: { x: number; y: number };
  /** Lateral spread share (default 0.7). */
  spread?: number;
  seed?: number;
  className?: string;
  onDone?: () => void;
}

const ANGLE: Record<StreakDirection, number> = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

export function BreakoutStreak({ direction = "up", tone = "win", count = BREAKOUT_STREAK.count, play, playOnMount = true, origin, spread = BREAKOUT_STREAK.spread, seed = 7, className, onDone }: BreakoutStreakProps) {
  const reduced = useReducedFx();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const tl = useRef<Timeline | null>(null);
  const burst = useRef(0);
  const cfg = useRef({ direction, tone, count, origin, spread, seed, onDone });
  useLayoutEffect(() => {
    cfg.current = { direction, tone, count, origin, spread, seed, onDone };
  });

  // measure once and on resize (never per frame)
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const measure = () => {
      const dpr = Math.min(BREAKOUT_STREAK.maxDpr, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      size.current = { w, h, dpr };
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    return () => ro.disconnect();
  }, [reduced]);

  useEffect(() => () => tl.current?.stop(), []);

  usePlayTrigger(play, playOnMount, () => {
    const c = canvasRef.current;
    const ctx = c?.getContext?.("2d") ?? null;
    if (reduced || !c || !ctx) {
      cfg.current.onDone?.();
      return;
    }
    tl.current?.stop();
    const { direction: dir, tone: tn, count: n, origin: o, spread: sp, seed: sd } = cfg.current;
    burst.current += 1;
    const ps = streakParticles(n, sd + burst.current);
    const total = streakDuration(ps);
    const color = liveHex(tn);
    const angle = ANGLE[dir];
    const timeline = createTimeline(c, (ms) => {
      const t = ms / 1000;
      const { w, h, dpr } = size.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (t >= total) {
        cfg.current.onDone?.();
        return false;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = BREAKOUT_STREAK.lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const p of ps) {
        const at = streakAt(p, t, dir, w, h, o, sp);
        if (!at) continue;
        const a = BREAKOUT_STREAK.arm * p.scale;
        ctx.save();
        ctx.translate(at.x, at.y);
        ctx.rotate(angle);
        // main chevron + a fainter trailing echo one arm behind
        for (const [dx, alpha] of [
          [0, at.alpha],
          [-a * 1.3, at.alpha * 0.35],
        ] as const) {
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.moveTo(dx - a * 0.7, -a);
          ctx.lineTo(dx + a * 0.3, 0);
          ctx.lineTo(dx - a * 0.7, a);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      return true;
    });
    tl.current = timeline;
    timeline.start();
  });

  if (reduced) return null;
  return <canvas ref={canvasRef} aria-hidden="true" data-fx="breakout-streak" data-direction={direction} className={cn("pointer-events-none absolute inset-0 size-full", className)} />;
}

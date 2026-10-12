import { isMotionValue, type MotionValue } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { FX_TONE, type FxTone } from "@/motion/fx/shared";
import { useFirstInView } from "@/motion/inView";
import { createFrameLoop } from "@/motion/pulse/engine";
import { springRests, stepSpring, type SpringState } from "@/motion/pulse/springStep";
import { watchActivity } from "@/motion/pulse/textKit";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * LiquidGauge – a tank (or round flask) that fills to `value` (0..1). The level glides on `spring.liquid` (a soft slosh
 * with one small overshoot) and a surface wave rises on every change and decays to flat in ≈ `tween.wave`; at rest
 * the loop sleeps and the surface is a straight line. Above `danger` (default 0.8) the liquid crossfades to the
 * signal red and a dashed red edge marks the limit – "fills towards the red edge".
 *
 * Compositor only: the liquid is a full-size layer moved by `translateY` (level); its wave crest is a pre-rendered
 * 2-period SVG strip moved by `translateX` (phase) and `scaleY` (amplitude), clipped by the tank's rounded
 * `overflow-hidden` box. Declared frame loop `liquid-gauge` (README): it runs only while the level / wave moves and
 * sleeps off-screen (jumps to rest there). `value` may be a MotionValue (no React render per change).
 * `role="meter"` with the target in `aria-valuenow`; reduced motion: the level jumps, no wave.
 */
export const LIQUID_GAUGE = {
  /** crest height in px at full amplitude */
  crest: 9,
  /** amplitude kick of a change: base + |Δ| · gain (clamped to 1) */
  kickBase: 0.35,
  kickGain: 3,
  /** surface wave travel in periods per second (at rest amplitude … full) */
  flow: [0.45, 1.6] as const,
  danger: 0.8,
} as const;

export interface LiquidGaugeProps {
  /** Fill level 0..1 (number or MotionValue). */
  value: number | MotionValue<number>;
  /** Level from which the liquid turns signal red (default 0.8, `null` = never). */
  danger?: number | null;
  /** Liquid tone below the danger level (default fg). */
  tone?: Extract<FxTone, "fg" | "win" | "warn" | "loss" | "mute">;
  shape?: "tank" | "round";
  /** Accessible name of the meter. */
  label: string;
  /** Optional `aria-valuetext` (e.g. "72 % vom Tageslimit"). */
  valueText?: string;
  className?: string;
  /** Overlay (centred above the liquid), e.g. a `MotionNumber`. */
  children?: ReactNode;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

/** The amplitude kick a level change gives the surface (pure). */
export function waveKick(current: number, delta: number): number {
  return Math.min(1, current + LIQUID_GAUGE.kickBase + Math.abs(delta) * LIQUID_GAUGE.kickGain);
}

/** Amplitude after `dt` s of decay (time constant = tween.wave / 4 → flat after ≈ tween.wave). */
export function waveDecay(amp: number, dt: number): number {
  return amp * Math.exp(-dt / (tween.wave.duration / 4));
}

export function LiquidGauge({ value, danger = LIQUID_GAUGE.danger, tone = "fg", shape = "tank", label, valueText, className, children }: LiquidGaugeProps) {
  const reduced = useReducedFx();
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const rootRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const hotRef = useRef<HTMLDivElement>(null);
  const crestRefs = useRef<(SVGSVGElement | null)[]>([]);
  const initial = clamp01(isMotionValue(value) ? (value as MotionValue<number>).get() : (value as number));
  // the liquid rises from empty the first time the tank is in view (reduced motion / no observer: full at once)
  const seen = useFirstInView(rootRef, !reduced);
  const [start] = useState(() => (reduced || seen ? initial : 0));
  const eng = useRef({ s: { x: start, v: 0 } as SpringState, target: start, amp: 0, phase: 0, hot: -1, active: true, reduced, danger });
  const loopRef = useRef<ReturnType<typeof createFrameLoop> | null>(null);

  const write = () => {
    const e = eng.current;
    const lvl = Math.max(-0.03, Math.min(1.03, e.s.x));
    const fill = fillRef.current;
    if (fill) fill.style.transform = `translate3d(0,${((1 - lvl) * 100).toFixed(3)}%,0)`;
    const amp = e.amp < 0.004 ? 0 : e.amp;
    const crest = `translate3d(${(-e.phase * 50).toFixed(3)}%,0,0) scaleY(${amp.toFixed(3)})`;
    for (const c of crestRefs.current) if (c) c.style.transform = crest;
    const hot = e.danger != null && lvl >= e.danger - 1e-6 ? 1 : 0;
    if (hot !== e.hot) {
      e.hot = hot;
      if (hotRef.current) hotRef.current.style.opacity = String(hot);
      rootRef.current?.toggleAttribute("data-danger", hot === 1);
    }
  };

  useLayoutEffect(() => {
    const e = eng.current;
    const loop = createFrameLoop((dt) => {
      if (!e.active) return false;
      stepSpring(e.s, e.target, spring.liquid, dt);
      e.amp = waveDecay(e.amp, dt);
      const [f0, f1] = LIQUID_GAUGE.flow;
      e.phase = (e.phase + dt * (f0 + (f1 - f0) * Math.min(1, e.amp))) % 1;
      const rest = springRests(e.s, e.target, 0.0008, 0.01) && e.amp < 0.004;
      if (rest) {
        e.s.x = e.target;
        e.s.v = 0;
        e.amp = 0;
      }
      write();
      if (rest) {
        const f = fillRef.current;
        if (f) f.style.willChange = "";
      }
      return !rest;
    });
    loopRef.current = loop;
    write();
    const root = rootRef.current;
    const unwatch = root
      ? watchActivity(root, (a) => {
          e.active = a;
          if (a) loop.wake();
          else {
            // off screen: land on the resting state at once (nothing animates unseen)
            loop.stop();
            e.s.x = e.target;
            e.s.v = 0;
            e.amp = 0;
            write();
          }
        })
      : () => {};
    return () => {
      unwatch();
      loop.stop();
    };
  }, []);

  const setTarget = (raw: number) => {
    const e = eng.current;
    const next = clamp01(raw);
    rootRef.current?.setAttribute("aria-valuenow", String(Math.round(next * 100)));
    if (next === e.target) return;
    const delta = next - e.s.x;
    e.target = next;
    if (e.reduced || !e.active) {
      e.s.x = next;
      e.s.v = 0;
      e.amp = 0;
      write();
      return;
    }
    e.amp = waveKick(e.amp, delta);
    const f = fillRef.current;
    if (f) f.style.willChange = "transform";
    loopRef.current?.wake();
  };

  useEffect(() => {
    const e = eng.current;
    e.reduced = reduced;
    e.danger = danger;
    e.hot = -1;
    if (reduced) {
      loopRef.current?.stop();
      e.s.x = e.target;
      e.amp = 0;
    }
    write();
  }, [reduced, danger]);

  useEffect(() => {
    if (!seen) return;
    if (isMotionValue(value)) {
      const mv = value as MotionValue<number>;
      setTarget(mv.get());
      return mv.on("change", setTarget);
    }
    setTarget(value as number);
    // setTarget only touches refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, seen]);

  const liquid = (color: string, key: number) => (
    <>
      <svg
        ref={(el) => {
          crestRefs.current[key] = el;
        }}
        aria-hidden="true"
        viewBox="0 0 200 10"
        preserveAspectRatio="none"
        className="absolute bottom-full left-0 block w-[200%] origin-bottom"
        style={{ height: LIQUID_GAUGE.crest, transform: "scaleY(0)" }}
      >
        <path d="M0 5 Q25 0 50 5 T100 5 T150 5 T200 5 V10 H0 Z" fill={`url(#${uid}-g${key})`} />
        <defs>
          <linearGradient id={`${uid}-g${key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.5" />
            <stop offset="1" stopColor={color} stopOpacity="0.32" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${color} 32%, transparent) 0%, color-mix(in srgb, ${color} 16%, transparent) 60%, color-mix(in srgb, ${color} 10%, transparent) 100%)` }}>
        <div className="absolute inset-x-0 top-0 h-px" style={{ background: `color-mix(in srgb, ${color} 75%, transparent)` }} />
      </div>
    </>
  );

  const nowPct = Math.round((seen ? initial : start) * 100);
  return (
    <div
      ref={rootRef}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={nowPct}
      aria-valuetext={valueText}
      data-fx="liquid-gauge"
      className={cn("relative isolate overflow-hidden border border-line-2 bg-ink-950", shape === "round" ? "aspect-square rounded-full" : "rounded-2xl", className)}
    >
      <div ref={fillRef} aria-hidden="true" className="absolute inset-0" style={{ transform: `translate3d(0,${((1 - start) * 100).toFixed(3)}%,0)` }}>
        <div className="absolute inset-0">{liquid(FX_TONE[tone], 0)}</div>
        <div ref={hotRef} className="absolute inset-0" style={{ opacity: 0, transition: `opacity ${tween.crossfade.duration}s ease-out` }}>
          {liquid(FX_TONE.signal, 1)}
        </div>
      </div>
      {danger != null && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t border-dashed border-signal/70" style={{ top: `${(1 - danger) * 100}%` }} />
      )}
      {children != null && <div className="relative z-[1] grid size-full place-items-center">{children}</div>}
    </div>
  );
}

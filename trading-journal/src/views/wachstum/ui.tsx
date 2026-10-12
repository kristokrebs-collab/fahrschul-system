/**
 * Building blocks of the Wachstum page (P08): the reveal cell, the section frame, the mood glyphs (abstract dot-matrix
 * patterns – no emojis) and the elastic slider of the check-in.
 */
import { animate, motion, useMotionValue, useSpring, useTransform, useVelocity } from "motion/react";
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { DotMatrix } from "@/motion/DotMatrix";
import { Reveal } from "@/motion/Reveal";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { SectionTitle } from "@/views/analyse/ui";

export { SEG_TOUCH } from "@/views/insights/ui";

/** Grid cell that reveals once (ends at `transform: none`) and lets its card fill the row height. */
export function Cell({ index, span, children, className }: { index: number; span: string; children: ReactNode; className?: string }) {
  return (
    <Reveal index={index} className={cn("flex min-w-0 flex-col [&>*]:flex-1", span, className)}>
      {children}
    </Reveal>
  );
}

export function Section({ id, title, sub, children }: { id: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="contents">
      <SectionTitle id={id} title={title} sub={sub} className="lg:col-span-12" />
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ mood glyphs */

const G = (rows: string[]): number[][] => rows.map((r) => [...r].map((c) => (c === "1" ? 1 : c === "o" ? 0.45 : 0)));

/** 7 × 7 mood glyphs, 1 (sehr schlecht) … 5 (sehr gut): falling chevrons, a sinking arc, a flat line, a rising arc, a burst. */
export const MOOD_GLYPHS: readonly number[][][] = [
  G(["1000001", "o1000o1", "0o101o0", "00o1o00", "1000001", "01000o0", "0010100"]),
  G(["0000000", "0000000", "0011100", "0o000o0", "1000001", "0000000", "0000000"]),
  G(["0000000", "0000000", "0000000", "1111111", "0000000", "0000000", "0000000"]),
  G(["0000000", "0000000", "1000001", "0o000o0", "0011100", "0000000", "0000000"]),
  G(["1001001", "0101010", "0011100", "1111111", "0011100", "0101010", "1001001"]),
];
const EMPTY_GLYPH = G(["0000000", "0000000", "0000000", "000o000", "0000000", "0000000", "0000000"]);

export const MOOD_TONE = ["loss", "warn", "mute", "fg", "win"] as const;

/** One mood as a dot-matrix glyph; a change cross-fades through the phosphor (same 7 × 7 grid). */
export function MoodGlyph({ mood, size = 5, className, label }: { mood: number | null; size?: number; className?: string; label?: string }) {
  const i = mood != null && mood >= 1 && mood <= 5 ? mood - 1 : -1;
  return <DotMatrix pattern={i >= 0 ? MOOD_GLYPHS[i] : EMPTY_GLYPH} rows={7} cols={7} size={size} gap={Math.max(1, Math.round(size / 2.5))} tone={i >= 0 ? MOOD_TONE[i] : "mute"} label={label} className={className} />;
}

/* ------------------------------------------------------------------ elastic slider */

/** Velocity → stretch (fraction of the track per second): a quick jump stretches the thumb ≈ 1.35×, at rest it is round. */
const STRETCH_MAX = 0.38;
const STRETCH_PER_UNIT = 0.09;
/** The pointer drags the thumb on a soft spring (elastic) before it snaps to the step on release. */
const DRAG_SPRING = { stiffness: 520, damping: 34, mass: 0.6 } as const;

export interface ElasticSliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  /** `null` = not set (a ghost thumb in the middle) */
  value: number | null;
  onChange: (v: number) => void;
  /** visible value text / `aria-valuetext` */
  format: (v: number) => string;
  tone?: "fg" | "win" | "loss" | "warn";
  /** labels under the ends of the track */
  ends?: [string, string];
  id?: string;
  "data-testid"?: string;
}

const FILL: Record<NonNullable<ElasticSliderProps["tone"]>, string> = { fg: "bg-fg", win: "bg-win", loss: "bg-loss", warn: "bg-warn" };

/**
 * Elastic slider (`role="slider"`): the thumb rides a spring that follows the pointer 1:1 target-wise and stretches with
 * its own velocity (transform only, like the elastic `Switch`), the fill is a `scaleX` of the same MotionValue; on release
 * it snaps to the step. One rect read per gesture, React state only when the STEP changes. Keyboard: arrows ± step,
 * Page ± 2 steps, Home / End. Reduced motion: no stretch, instant snap.
 */
export function ElasticSlider({ label, min, max, step, value, onChange, format, tone = "fg", ends, id, "data-testid": testId }: ElasticSliderProps) {
  const reduced = useReducedFx();
  const trackRef = useRef<HTMLDivElement>(null);
  const rect = useRef<{ left: number; width: number } | null>(null);
  const dragging = useRef(false);
  const frac = (v: number) => (max === min ? 0 : (Math.min(max, Math.max(min, v)) - min) / (max - min));
  const target = useMotionValue(value == null ? 0.5 : frac(value));
  const pos = useSpring(target, reduced ? { stiffness: 10_000, damping: 500 } : DRAG_SPRING);
  const velocity = useVelocity(pos);
  const stretch = useTransform(velocity, (v) => 1 + Math.min(STRETCH_MAX, Math.abs(v) * STRETCH_PER_UNIT));
  // the rail width is measured on resize only; the thumb's x is a pure function of (position, width)
  const railRef = useRef<HTMLDivElement>(null);
  const railW = useMotionValue(0);
  const x = useTransform(() => Math.min(1, Math.max(0, pos.get())) * railW.get());
  const fill = useTransform(pos, (p) => Math.min(1, Math.max(0, p)));
  const set = value != null;

  useLayoutEffect(() => {
    const el = railRef.current;
    if (!el) return;
    railW.set(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => railW.set(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [railW]);

  // an outside change (another device, a reset) glides there
  useEffect(() => {
    if (dragging.current) return;
    const f = value == null ? 0.5 : frac(value);
    if (reduced) {
      target.jump(f);
      pos.jump(f);
    } else target.set(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `frac` depends on min / max only
  }, [value, min, max, reduced, target, pos]);

  const snap = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
  const commit = (v: number) => {
    const s = Number(snap(v).toFixed(4));
    if (s !== value) onChange(s);
    return s;
  };
  const fromX = (clientX: number): number => {
    const r = rect.current;
    if (!r || r.width <= 0) return value ?? (min + max) / 2;
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    target.set(f);
    return min + f * (max - min);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    rect.current = { left: r.left, width: r.width };
    dragging.current = true;
    el.setPointerCapture?.(e.pointerId);
    commit(fromX(e.clientX));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    commit(fromX(e.clientX));
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const s = commit(fromX(e.clientX));
    // snap the thumb onto the step
    if (reduced) {
      target.jump(frac(s));
      pos.jump(frac(s));
    } else animate(target, frac(s), spring.press);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = value ?? snap((min + max) / 2);
    const next =
      e.key === "ArrowRight" || e.key === "ArrowUp" ? cur + step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? cur - step : e.key === "PageUp" ? cur + 2 * step : e.key === "PageDown" ? cur - 2 * step : e.key === "Home" ? min : e.key === "End" ? max : null;
    if (next == null) return;
    e.preventDefault();
    commit(next);
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span id={id ? `${id}-label` : undefined} className="text-[12.5px] font-medium text-fg">
          {label}
        </span>
        <span className={cn("num text-[12.5px]", set ? "text-fg" : "text-faint")}>{set ? format(value) : "–"}</span>
      </div>
      <div
        ref={trackRef}
        id={id}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value ?? undefined}
        aria-valuetext={set ? format(value) : "nicht gesetzt"}
        data-testid={testId}
        data-value={value ?? ""}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={onKey}
        className="group relative h-11 cursor-pointer touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-steel/60"
      >
        <div ref={railRef} className="absolute inset-x-2.5 top-1/2 h-[6px] -translate-y-1/2 overflow-hidden rounded-full bg-white/[0.07]">
          <motion.div aria-hidden="true" className={cn("absolute inset-0 origin-left rounded-full", FILL[tone], !set && "opacity-0")} style={{ scaleX: fill }} />
        </div>
        <motion.span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -ml-[11px] -mt-[11px] block size-[22px]" style={{ x }}>
          <motion.span
            className={cn("absolute inset-0 rounded-full shadow-[0_2px_8px_rgb(0_0_0/0.45)]", set ? "bg-white" : "border border-dashed border-white/35 bg-ink-800")}
            style={reduced ? undefined : { scaleX: stretch }}
          />
        </motion.span>
        {!set && <span className="pointer-events-none absolute inset-x-0 -bottom-1 text-center text-[10.5px] text-faint">Ziehen zum Setzen</span>}
      </div>
      {ends && (
        <div className="flex justify-between text-[10.5px] text-faint" aria-hidden="true">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  );
}

/** "+3", "−2" for deltas. */
export const signedInt = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");

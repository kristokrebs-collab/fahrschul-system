import { motion } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { createFrameLoop, smoothing } from "@/motion/pulse/engine";
import { useFirstInView } from "@/motion/inView";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `product-timeline` (measured) as a reusable milestone rail – goals, plan steps, a coach plan, the
 * fills of a position, onboarding progress:
 * - `vertical` (default) and `horizontal` (a snap-scrolling row): on first view the rail draws itself milestone by
 *   milestone (`tween.draw` split over the segments, capped at `stagger.max` steps), each dot pops (`spring.pop`) when
 *   the line reaches it, its copy rises out of a mask; the `active` milestone gets one signal ring that pings 3×
 *   (`tween.pingFew`) – finite. Done milestones are lit, later ones stay hollow and quiet.
 * - `pinned` (horizontal): the pack's scrollytelling – the section pins (sticky), the track slides 1:1 with the page
 *   scroll (smoothed `1 − e^(−12·dt)`), and every milestone grows its stem (`p^2.2`), pops its dot and reveals its
 *   copy as it travels from 74 % to 49 % of the viewport width. Geometry is measured on resize only; the scroll
 *   listener only stores `scrollY`; the loop sleeps when the track rests.
 * A11y: an ordered list with the real text; rails, stems and rings are aria-hidden; the active step is
 * `aria-current="step"`. Reduced motion: everything static (pinned falls back to the horizontal row).
 */
export const CONFIG = {
  /** px between milestones on the pinned track (pack 218) */
  step: 218,
  /** pinned: a milestone starts at 74 % of the viewport width and is fully revealed at 49 % */
  revealFrom: 0.74,
  revealTo: 0.49,
  stemPow: 2.2,
  copyStart: 0.5,
  /** 1/s smoothing of the scroll-driven track */
  smoothK: 12,
  /** pinned: stem length px */
  stem: 120,
} as const;

export type MilestoneTone = "fg" | "mute" | "win" | "loss" | "signal" | "warn";

export interface Milestone {
  id: string;
  title: string;
  /** small mono line above the title ("März 2026", "Schritt 2") */
  date?: string;
  text?: string;
  tone?: MilestoneTone;
}

export interface MilestoneRailProps {
  items: readonly Milestone[];
  orientation?: "vertical" | "horizontal";
  /** Horizontal only: pin the section and slide the track with the page scroll. */
  pinned?: boolean;
  /** Index of the current milestone (lit up to here); default: the last. `-1` = none reached. */
  active?: number;
  /** Accessible name of the list. */
  label: string;
  className?: string;
}

const DOT: Record<MilestoneTone, string> = { fg: "bg-fg", mute: "bg-mute", win: "bg-win", loss: "bg-loss", signal: "bg-signal", warn: "bg-warn" };

/** Seconds per rail segment of the first-view draw (the whole draw ≈ `tween.draw`, never slower than 0.12 s / step). */
export function segmentSeconds(count: number): number {
  const steps = Math.max(1, Math.min(stagger.max, count - 1));
  return Math.max(stagger.lead, tween.draw.duration / steps);
}

/** Pinned reveal progress of a milestone at screen x within a viewport of width `w` (0..1). */
export function pinnedReveal(x: number, w: number): number {
  const from = CONFIG.revealFrom * w;
  const to = CONFIG.revealTo * w;
  return Math.min(1, Math.max(0, (from - x) / Math.max(1, from - to)));
}

function state(i: number, active: number): "done" | "active" | "todo" {
  return i < active ? "done" : i === active ? "active" : "todo";
}

/* ------------------------------------------------------------------ vertical / horizontal */

function StaticRail({ items, orientation, active, label, className }: Required<Pick<MilestoneRailProps, "items" | "orientation" | "label">> & { active: number; className?: string }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLOListElement>(null);
  const seen = useFirstInView(ref, !reduced);
  const run = seen && !reduced;
  const seg = segmentSeconds(items.length);
  const at = (i: number) => Math.min(i, stagger.max) * seg;
  const vertical = orientation === "vertical";

  return (
    <ol
      ref={ref}
      aria-label={label}
      data-pulse="milestone-rail"
      data-orientation={orientation}
      className={cn(vertical ? "grid" : "flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain pb-2 [scrollbar-width:thin]", className)}
    >
      {items.map((m, i) => {
        const s = state(i, active);
        const tone = m.tone ?? (s === "active" ? "signal" : "fg");
        const last = i === items.length - 1;
        const lit = i < active;
        return (
          <li
            key={m.id}
            aria-current={s === "active" ? "step" : undefined}
            data-state={s}
            className={cn("relative", vertical ? "grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 pb-6 last:pb-0" : "grid w-[220px] shrink-0 snap-start content-start gap-2 pr-5 pt-1")}
          >
            {/* rail segment to the next milestone */}
            {!last && (
              <span aria-hidden="true" className={cn("absolute bg-line-2", vertical ? "top-[11px] bottom-0 left-[10px] w-px" : "top-[11px] left-[11px] right-0 h-px")}>
                {lit && (
                  <motion.span
                    className={cn("absolute inset-0 bg-fg/80", vertical ? "origin-top" : "origin-left")}
                    initial={reduced ? false : vertical ? { scaleY: 0 } : { scaleX: 0 }}
                    animate={run || reduced ? (vertical ? { scaleY: 1 } : { scaleX: 1 }) : undefined}
                    transition={{ duration: seg, ease: "linear", delay: at(i) }}
                  />
                )}
              </span>
            )}
            {/* dot */}
            <span aria-hidden="true" className="relative grid size-[22px] place-items-center">
              <motion.span
                className={cn("relative block size-[9px] rounded-full", s === "todo" ? "border border-line-2 bg-ink-900" : DOT[tone])}
                initial={reduced ? false : { scale: 0 }}
                animate={run || reduced ? { scale: 1 } : undefined}
                transition={{ ...spring.pop, delay: at(i) }}
              >
                {s === "active" && !reduced && run && <span className="fx-ping bg-signal" style={{ animationDelay: `${at(i)}s` }} />}
              </motion.span>
              {s === "active" && <span className="absolute inset-0 rounded-full border border-signal/40" />}
            </span>
            {/* copy rises out of a mask */}
            <span className={cn("block min-w-0 overflow-hidden", vertical ? "pt-[1px]" : "")}>
              <motion.span
                className="grid gap-0.5"
                initial={reduced ? false : { y: "105%", opacity: 0 }}
                animate={run || reduced ? { y: 0, opacity: 1, transitionEnd: { transform: "none" } } : undefined}
                transition={{ y: { ...tween.reveal, delay: at(i) + 0.04 }, opacity: { ...tween.fade, delay: at(i) + 0.04 } }}
              >
                {m.date && <span className="font-mono text-[10.5px] tracking-[0.12em] text-faint uppercase">{m.date}</span>}
                <span className={cn("text-[14px] font-medium leading-snug", s === "todo" ? "text-mute" : "text-fg")}>{m.title}</span>
                {m.text && <span className="text-[12.5px] leading-snug text-mute">{m.text}</span>}
              </motion.span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ pinned (scrollytelling) */

function PinnedRail({ items, active, label, className }: { items: readonly Milestone[]; active: number; label: string; className?: string }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLOListElement>(null);
  const axisRef = useRef<HTMLSpanElement>(null);
  const stemRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const copyRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const n = items.length;

  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const geo = { top: 0, travel: 0, vw: 1, start: 0 };
    const st = { x: 0, target: 0, written: [] as number[] };
    const measure = () => {
      geo.vw = window.innerWidth;
      geo.top = section.getBoundingClientRect().top + window.scrollY;
      geo.start = geo.vw * CONFIG.revealFrom + 40;
      // the last milestone ends at the reveal line
      geo.travel = Math.max(0, geo.start + (n - 1) * CONFIG.step - geo.vw * CONFIG.revealTo);
      section.style.height = `calc(100svh + ${Math.round(geo.travel)}px)`;
    };
    const targetOf = () => Math.min(geo.travel, Math.max(0, window.scrollY - geo.top));
    const write = () => {
      const track = trackRef.current;
      if (track) track.style.transform = `translate3d(${(-st.x).toFixed(2)}px,0,0)`;
      if (axisRef.current) axisRef.current.style.transform = `scaleX(${Math.min(1, (st.x + geo.vw * CONFIG.revealTo) / Math.max(1, geo.start + (n - 1) * CONFIG.step)).toFixed(4)})`;
      for (let i = 0; i < n; i++) {
        const sx = geo.start + i * CONFIG.step - st.x;
        const p = pinnedReveal(sx, geo.vw);
        const q = Math.round(p * 500);
        if (st.written[i] === q) continue;
        st.written[i] = q;
        const stem = stemRefs.current[i];
        if (stem) stem.style.transform = `scaleY(${Math.pow(p, CONFIG.stemPow).toFixed(4)})`;
        const dot = dotRefs.current[i];
        if (dot) dot.style.transform = `scale(${Math.min(1, Math.max(0, (p - 0.25) / 0.35)).toFixed(3)})`;
        const copy = copyRefs.current[i];
        if (copy) {
          const c = Math.min(1, Math.max(0, (p - CONFIG.copyStart) / (1 - CONFIG.copyStart)));
          const k = c * c * (3 - 2 * c);
          copy.style.transform = `translate3d(0,${((1 - k) * 105).toFixed(2)}%,0)`;
          copy.style.opacity = k.toFixed(3);
        }
      }
    };
    const loop = createFrameLoop((dt) => {
      st.x += (st.target - st.x) * smoothing(CONFIG.smoothK, dt);
      if (Math.abs(st.target - st.x) < 0.3) st.x = st.target;
      write();
      return st.x !== st.target;
    });
    const onScroll = () => {
      st.target = targetOf();
      loop.wake();
    };
    measure();
    st.target = targetOf();
    st.x = st.target;
    write();
    window.addEventListener("scroll", onScroll, { passive: true });
    const onResize = () => {
      measure();
      st.written = [];
      onScroll();
    };
    window.addEventListener("resize", onResize);
    return () => {
      loop.stop();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      section.style.height = "";
    };
  }, [n]);

  return (
    <div ref={sectionRef} data-pulse="milestone-rail" data-orientation="pinned" className={cn("relative", className)}>
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-line-2">
          <span ref={axisRef} className="absolute inset-0 origin-left bg-signal/80" style={{ transform: "scaleX(0)" }} />
        </div>
        <ol ref={trackRef} aria-label={label} className="absolute inset-0" style={{ willChange: "transform" }}>
          {items.map((m, i) => {
            const s = state(i, active);
            const up = i % 2 === 0;
            return (
              <li
                key={m.id}
                aria-current={s === "active" ? "step" : undefined}
                data-state={s}
                className="absolute top-1/2 w-[200px]"
                style={{ left: `calc(${CONFIG.revealFrom * 100}vw + 40px + ${i * CONFIG.step}px)` }}
              >
                <span
                  ref={(el) => {
                    stemRefs.current[i] = el;
                  }}
                  aria-hidden="true"
                  className={cn("absolute left-0 w-px bg-signal/60", up ? "bottom-0 origin-bottom" : "top-0 origin-top")}
                  style={{ height: CONFIG.stem, transform: "scaleY(0)" }}
                />
                <span
                  ref={(el) => {
                    dotRefs.current[i] = el;
                  }}
                  aria-hidden="true"
                  className={cn("absolute left-0 top-0 size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full", s === "todo" ? "border border-line-2 bg-ink-900" : DOT[m.tone ?? (s === "active" ? "signal" : "fg")])}
                  style={{ transform: "scale(0)" }}
                />
                <span className={cn("absolute left-3 block w-[190px] overflow-hidden", up ? "bottom-[40px]" : "top-[40px]")}>
                  <span
                    ref={(el) => {
                      copyRefs.current[i] = el;
                    }}
                    className="grid gap-1"
                    style={{ transform: "translate3d(0,105%,0)", opacity: 0 }}
                  >
                    {m.date && <span className="font-mono text-[10.5px] tracking-[0.12em] text-faint uppercase">{m.date}</span>}
                    <span className="text-[17px] font-medium leading-snug text-fg">{m.title}</span>
                    {m.text && <span className="text-[13px] leading-snug text-mute">{m.text}</span>}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

export function MilestoneRail({ items, orientation = "vertical", pinned = false, active, label, className }: MilestoneRailProps) {
  const reduced = useReducedFx();
  const current = active ?? items.length - 1;
  // the pinned track needs a layout; under reduced motion it is the plain horizontal row
  const usePinned = pinned && orientation === "horizontal" && !reduced && typeof window !== "undefined";
  if (usePinned) return <PinnedRail items={items} active={current} label={label} className={className} />;
  return <StaticRail items={items} orientation={orientation} active={current} label={label} className={className} />;
}

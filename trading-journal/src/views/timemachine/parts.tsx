/**
 * Small pieces of the Zeitmaschine card: the measured width of a chart, a value tile, the stacked bar of the three odds and a
 * quiet headline. Nothing here knows the domain beyond the numbers it is handed.
 */
import { motion } from "motion/react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useSeenOnce } from "@/primitives/revealValue";

/** Width of an element (ResizeObserver; `fallback` where nothing measures, e.g. jsdom). */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback = 560): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.round(el.clientWidth));
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w > 0 ? w : fallback;
}

/** Headline of a block inside the card: label + one calm line below. */
export function Block({ title, lead, children, testId, className }: { title: string; lead?: ReactNode; children: ReactNode; testId?: string; className?: string }) {
  return (
    <section className={cn("grid min-w-0 gap-2.5", className)} data-testid={testId} aria-label={title}>
      <div className="grid gap-0.5">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{title}</h3>
        {lead != null && <p className="text-[12px] leading-snug text-mute">{lead}</p>}
      </div>
      {children}
    </section>
  );
}

/** A labelled value (the label says what, the value is the number, `sub` the interval or sample). */
export function Tile({ label, value, sub, tone, className, testId }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; className?: string; testId?: string }) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5", className)} data-testid={testId}>
      <span className="min-h-[2.2em] text-[9.5px] font-semibold uppercase leading-tight tracking-[0.07em] text-faint sm:min-h-0 sm:text-[10px] sm:tracking-[0.1em]">{label}</span>
      <span className={cn("num whitespace-nowrap font-mono text-[18px] font-medium leading-tight", tone)}>{value}</span>
      {sub != null && <span className="num text-[11px] leading-snug text-mute">{sub}</span>}
    </div>
  );
}

/** Hatching and dots from gradients (the veil ink follows the theme): the second and third way, next to the fill, to tell the segments apart. */
export const HATCH: CSSProperties = { backgroundImage: "repeating-linear-gradient(135deg, rgb(var(--veil-rgb, 255 255 255) / 0.6) 0 1.5px, transparent 1.5px 5px)" };
export const DOTS: CSSProperties = { backgroundImage: "radial-gradient(circle, rgb(var(--veil-rgb, 255 255 255) / 0.55) 0.9px, transparent 1.2px)", backgroundSize: "5px 5px" };
const LOOK: Record<string, CSSProperties | undefined> = { solid: undefined, open: undefined, hatch: HATCH, dots: DOTS };

export interface Share {
  id: string;
  label: string;
  p: number;
  /** how the segment is drawn: solid, hatched or open – never colour alone */
  look: "solid" | "hatch" | "open" | "dots";
}

/**
 * The runs as one bar split into their outcomes, in the order target · stop · neither. Solid = target, hatched = stop,
 * dotted = neither (and open for a stop moved by break-even / trailing): every segment also carries its percentage as text
 * (the tiles above and the legend below), so the bar is a summary and never the only carrier.
 */
export function OddsBar({ shares, label }: { shares: readonly Share[]; label: string }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  const on = seen || reduced;
  return (
    <div className="grid gap-1.5">
      <div ref={ref} role="img" aria-label={`${label}: ${shares.map((s) => `${s.label} ${(s.p * 100).toFixed(1).replace(".", ",")} %`).join(", ")}`} className="flex h-3.5 w-full overflow-hidden rounded-full border border-line-2 bg-ink-950" data-testid="tm-oddsbar">
        {shares.map((s) => (
          <motion.span
            key={s.id}
            aria-hidden="true"
            data-look={s.look}
            data-share={s.id}
            className={cn("h-full origin-left", s.look === "solid" && "bg-fg/85", s.look === "open" && "bg-fg/10")}
            style={{ width: `${Math.max(s.p > 0 ? 0.6 : 0, s.p * 100)}%`, ...LOOK[s.look] }}
            initial={reduced ? false : { scaleX: 0, opacity: 0.4 }}
            animate={{ scaleX: on ? 1 : 0, opacity: on ? 1 : 0.4 }}
            transition={spring.enter}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-mute" aria-hidden="true">
        {shares.map((s) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <span className={cn("inline-block h-2.5 w-4 rounded-sm border border-line-2", s.look === "solid" && "bg-fg/85", s.look === "open" && "bg-fg/10")} style={LOOK[s.look]} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

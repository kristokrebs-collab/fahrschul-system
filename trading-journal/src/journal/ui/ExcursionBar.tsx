import { motion } from "motion/react";
import { captureRatio } from "@/domain/excursion";
import { fillPosition } from "@/domain/fills";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { MotionNumber } from "@/motion/MotionNumber";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export type ExcursionTrade = Pick<EnrichedTrade, "side" | "entry" | "exit" | "stop" | "r" | "mae" | "mfe" | "maeR" | "mfeR" | "result" | "status" | "fills">;

/**
 * The prices MAE / MFE are measured against: the Ø entry / Ø exit of the fills when the trade has them (that is what
 * `src/market/excursion.ts` measures from), else the trade's own entry / exit.
 */
export function excursionPrices(t: ExcursionTrade): { entry: number | null; exit: number | null } {
  const pos = t.fills?.length ? fillPosition(t) : null;
  const exit = t.result === "open" ? null : (pos?.exit ?? t.exit ?? null);
  return { entry: pos?.entry ?? t.entry ?? null, exit };
}

/** Values on one axis (R when the stop is known, else % of the entry). */
export function excursionAxis(t: ExcursionTrade): { unit: "R" | "%"; mae: number; mfe: number; exit: number | null; stop: number | null } | null {
  if (t.mae == null || t.mfe == null) return null;
  if (t.maeR != null && t.mfeR != null) return { unit: "R", mae: t.maeR, mfe: t.mfeR, exit: t.r ?? null, stop: 1 };
  const { entry, exit } = excursionPrices(t);
  if (!(entry != null && entry > 0)) return null;
  const pct = (v: number) => (v / entry) * 100;
  const moved = exit != null ? (t.side === "short" ? entry - exit : exit - entry) : null;
  return { unit: "%", mae: pct(t.mae), mfe: pct(t.mfe), exit: moved == null ? null : pct(moved), stop: null };
}

/**
 * Share of the best move the exit kept, capped at 100 % (whole bars can understate the MFE by a wick at the edges, so
 * a ratio above 1 is a measuring artefact, not a better-than-best exit); `null` without an MFE / exit.
 */
export function keptShare(t: ExcursionTrade): number | null {
  const { entry, exit } = excursionPrices(t);
  const cap = captureRatio(t.side, entry ?? 0, exit, t.mfe);
  return cap == null ? null : Math.min(1, cap);
}

/**
 * MAE / MFE of a trade on one axis around the entry: the adverse excursion grows to the left (red), the favourable to
 * the right (green), a white tick marks where the trade was closed, a dashed line the −1 R stop. Bars grow on
 * `spring.bar` (MAE first, MFE a beat later), the numbers count up. Below: how much of the best move the exit kept.
 */
export function ExcursionBar({ trade, className }: { trade: ExcursionTrade; className?: string }) {
  const reduced = useReducedFx();
  const ax = excursionAxis(trade);
  if (!ax) return null;
  const span = Math.max(ax.mae, ax.mfe, Math.abs(ax.exit ?? 0), ax.stop ?? 0, 0.0001) * 1.12;
  const half = (v: number) => Math.min(50, (v / span) * 50);
  const exitAt = ax.exit == null ? null : 50 + Math.max(-50, Math.min(50, (ax.exit / span) * 50));
  const cap = keptShare(trade);
  const grow = (i: number) => (reduced ? { duration: 0 } : { ...spring.bar, delay: i * stagger.lead });
  const suffix = ax.unit === "R" ? " R" : " %";
  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-baseline justify-between text-[11.5px]">
        <span className="text-loss">
          MAE <MotionNumber value={-ax.mae} decimals={2} suffix={suffix} countOnReveal revealKey="mae" />
        </span>
        <span className="text-win">
          MFE <MotionNumber value={ax.mfe} decimals={2} signed suffix={suffix} countOnReveal revealKey="mfe" />
        </span>
      </div>
      <div className="relative h-3" aria-hidden="true">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-2" />
        <motion.span className="absolute right-1/2 top-0 h-full rounded-l-full bg-loss/70" style={{ width: `${half(ax.mae)}%`, transformOrigin: "right center" }} initial={reduced ? false : { scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={grow(0)} />
        <motion.span className="absolute left-1/2 top-0 h-full rounded-r-full bg-win/70" style={{ width: `${half(ax.mfe)}%`, transformOrigin: "left center" }} initial={reduced ? false : { scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={grow(1)} />
        <span className="absolute left-1/2 top-[-3px] h-[18px] w-px bg-fg/60" />
        {ax.stop != null && <span className="absolute top-[-2px] h-4 border-l border-dashed border-mute/70" style={{ left: `${50 - half(ax.stop)}%` }} />}
        {exitAt != null && (
          <motion.span
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-850 bg-fg"
            style={{ left: `${exitAt}%` }}
            initial={reduced ? false : { scale: 0 }}
            whileInView={{ scale: 1 }}
            viewport={{ once: true }}
            transition={reduced ? { duration: 0 } : { ...spring.pop, delay: 2 * stagger.lead + tween.fade.duration }}
          />
        )}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-faint">
        <span>{ax.stop != null ? "−1 R Stop" : "gegen dich"}</span>
        <span>Einstieg</span>
        <span>für dich</span>
      </div>
      {cap != null && (
        <p className="text-[12px] text-mute">
          {cap >= 0 ? (
            <>
              Mitgenommen: <span className="font-mono text-fg">{Math.round(cap * 100)} %</span> der besten Bewegung.
            </>
          ) : (
            <>Trotz {ax.mfe.toFixed(2).replace(".", ",")}{suffix} im Plus im Minus geschlossen.</>
          )}
        </p>
      )}
    </div>
  );
}

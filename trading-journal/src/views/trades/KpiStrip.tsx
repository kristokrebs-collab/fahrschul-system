import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import type { Agg } from "@/domain/agg";
import { cn } from "@/lib/cn";
import { MotionNumber } from "@/motion/MotionNumber";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

export interface KpiStripProps {
  /** Aggregate of the filtered closed trades (`aggregate(filtered.filter(t => t.result !== "open"))`). */
  closed: Agg;
  /** Total number of filtered trades incl. open ones. */
  count: number;
  currency: string;
  className?: string;
}

const OPEN_FROM = { opacity: 0, scale: 0.8 };
const OPEN_SHOWN = { opacity: 1, scale: 1 };
const OPEN_EXIT = { opacity: 0, scale: 0.8, transition: tween.exit };
const OPEN_TRANSITION = { scale: spring.pop, opacity: tween.fade };

/**
 * Small totals of the filtered set (NEW, Plan 6.2 KPI strip): `Netto`, `Trades`, `Win-Rate`.
 * Tiles blur-fade in one after another when the strip first shows (`RevealGroup`), the figures count up from 0 on
 * that first reveal, then roll between filter results; Netto and Win-Rate flash green/red by the direction of the
 * change (`MotionNumber flash`). All MotionValue-driven – no React render per frame. Reduced motion: static tiles,
 * instant values, no flash.
 */
export function KpiStrip({ closed, count, currency, className }: KpiStripProps) {
  const reduced = useReducedFx();
  const open = count - closed.n;
  return (
    <RevealGroup className={cn("mb-4 grid grid-cols-3 gap-2", className)} aria-label="Kennzahlen der Auswahl" role="group">
      <Tile label="Netto">
        {closed.n ? <MotionNumber value={closed.net} decimals={2} signed tone="auto" flash countOnReveal revealKey="kpi-net" suffix={` ${currency}`} /> : <span className="text-faint">–</span>}
      </Tile>
      <Tile label="Trades">
        <MotionNumber value={closed.n} decimals={0} countOnReveal revealKey="kpi-n" />
        <AnimatePresence initial={false}>
          {open > 0 && (
            <motion.span
              key="open"
              className="ml-1 inline-block origin-left text-xs text-mute"
              initial={reduced ? false : OPEN_FROM}
              animate={OPEN_SHOWN}
              exit={reduced ? undefined : OPEN_EXIT}
              transition={OPEN_TRANSITION}
            >
              +{open} offen
            </motion.span>
          )}
        </AnimatePresence>
      </Tile>
      <Tile label="Win-Rate">
        {closed.winRate == null ? <span className="text-faint">–</span> : <MotionNumber value={closed.winRate * 100} decimals={0} suffix=" %" flash countOnReveal revealKey="kpi-wr" />}
      </Tile>
    </RevealGroup>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <RevealItem className="rounded-xl border border-line bg-ink-950/50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className="num mt-0.5 font-mono text-[14px] font-medium">{children}</div>
    </RevealItem>
  );
}

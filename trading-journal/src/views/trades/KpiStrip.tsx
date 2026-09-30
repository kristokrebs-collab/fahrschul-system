import type { ReactNode } from "react";
import type { Agg } from "@/domain/agg";
import { cn } from "@/lib/cn";
import { MotionNumber } from "@/motion/MotionNumber";

export interface KpiStripProps {
  /** Aggregate of the filtered closed trades (`aggregate(filtered.filter(t => t.result !== "open"))`). */
  closed: Agg;
  /** Total number of filtered trades incl. open ones. */
  count: number;
  currency: string;
  className?: string;
}

/**
 * Small totals of the filtered set (NEW, Plan 6.2 KPI strip): `Netto`, `Trades`, `Win-Rate`.
 * Tiles use the editor live-strip recipe; all values are `MotionNumber`s (no re-render per frame).
 */
export function KpiStrip({ closed, count, currency, className }: KpiStripProps) {
  const open = count - closed.n;
  return (
    <div className={cn("mb-4 grid grid-cols-3 gap-2", className)} aria-label="Kennzahlen der Auswahl" role="group">
      <Tile label="Netto">
        {closed.n ? <MotionNumber value={closed.net} decimals={2} signed tone="auto" suffix={` ${currency}`} /> : <span className="text-faint">–</span>}
      </Tile>
      <Tile label="Trades">
        <MotionNumber value={closed.n} decimals={0} />
        {open > 0 && <span className="ml-1 text-xs text-mute">+{open} offen</span>}
      </Tile>
      <Tile label="Win-Rate">
        {closed.winRate == null ? <span className="text-faint">–</span> : <MotionNumber value={closed.winRate * 100} decimals={0} suffix=" %" />}
      </Tile>
    </div>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-ink-950/50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className="num mt-0.5 font-mono text-[14px] font-medium">{children}</div>
    </div>
  );
}

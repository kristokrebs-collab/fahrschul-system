import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { EMPTY, explainR, rDistribution, TITLES } from "@/domain/insights";
import { cn } from "@/lib/cn";
import { pct0, r as fmtR } from "@/lib/format";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { EmptyState } from "@/primitives/EmptyState";
import { Collapse } from "@/primitives/Expander";
import { useSeenOnce } from "@/primitives/revealValue";
import { Bar } from "@/views/overview/Bar";
import { InsightCard, Stat, TradeList, softTone, useInsightsBase } from "./ui";

const HIST_H = 112;

/**
 * `R-Verteilung` (Tradezella risk report): histogram of realised R (columns grow on first view), planned vs realised
 * R, share ≥ 2R, losses beyond 1R (unfold the trades) and the winners' R efficiency.
 */
export function RDistributionCard() {
  const { view } = useInsightsBase();
  const d = useMemo(() => rDistribution(view.closed), [view.closed]);
  const reduced = useReducedFx();
  const root = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(root);
  const [showLosses, setShowLosses] = useState(false);
  const max = Math.max(1, ...d.bins.map((b) => b.n));
  const scale = Math.max(0.5, Math.abs(d.planned ?? 0), Math.abs(d.avgR ?? 0));

  return (
    <InsightCard title={TITLES.r} explain={() => explainR(d)} note={d.rN ? `${d.rN} Trades mit Stop` : undefined} data-testid="insights-r">
      {!d.rN ? (
        <EmptyState title={EMPTY.r.title} text={EMPTY.r.text} />
      ) : (
        <div ref={root} className="grid gap-4">
          <div className="grid gap-1.5">
            <div className="grid items-end gap-1" style={{ height: HIST_H, gridTemplateColumns: `repeat(${d.bins.length}, minmax(0, 1fr))` }}>
              {d.bins.map((b, i) => (
                <div key={b.key} className="relative flex h-full flex-col justify-end" role="img" aria-label={`${b.label} R: ${b.n} Trades`}>
                  <span className={cn("num mb-1 text-center font-mono text-[10px]", b.n ? "text-mute" : "text-faint/60")}>{b.n}</span>
                  <motion.span
                    aria-hidden="true"
                    className={cn("mx-[14%] block rounded-t-[3px]", i < 3 ? "bg-loss/70" : i === 3 ? "bg-fg/40" : "bg-win/70")}
                    style={{ height: `${Math.max((b.n / max) * 82, b.n ? 3 : 1)}%`, originY: 1 }}
                    initial={reduced ? false : { scaleY: 0 }}
                    animate={{ scaleY: seen || reduced ? 1 : 0 }}
                    transition={{ ...spring.enter, delay: reduced ? 0 : Math.min(i, stagger.max) * stagger.reveal }}
                  />
                </div>
              ))}
            </div>
            <div className="grid gap-1 border-t border-line-2 pt-1 text-center" style={{ gridTemplateColumns: `repeat(${d.bins.length}, minmax(0, 1fr))` }} aria-hidden="true">
              {d.bins.map((b) => (
                <span key={b.key} className="truncate text-[9.5px] text-faint">
                  {b.label}
                </span>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            {[
              { label: "Geplant", v: d.planned, sub: d.plannedN ? `${d.plannedN} Trades mit Ziel` : "kein Ziel eingetragen" },
              { label: "Realisiert", v: d.avgR, sub: `${d.rN} Trades` },
            ].map((row, i) => (
              <div key={row.label} className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 text-[12.5px]">
                <span className="text-mute">{row.label}</span>
                <Bar value={row.v == null ? 0 : Math.abs(row.v) / scale} index={i} fill={row.v != null && row.v < 0 ? "bg-loss/70" : i === 0 ? "bg-fg/60" : "bg-win/70"} />
                <span className={cn("num font-mono", i === 0 ? "text-fg" : softTone(row.v))}>{row.v == null ? "–" : fmtR(row.v)}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Anteil ≥ 2R" value={pct0(d.share2R)} sub={`${Math.round((d.share2R ?? 0) * d.rN)} von ${d.rN}`} />
            <Stat label="R-Effizienz" value={d.efficiency == null ? "–" : pct0(d.efficiency)} sub={d.efficiency == null ? "braucht Gewinner mit Ziel" : `${d.efficiencyN} Gewinner mit Ziel`} />
          </div>
          <div className="rounded-xl border border-line bg-ink-950/50">
            <button
              type="button"
              aria-expanded={showLosses}
              aria-controls="r-big-losses"
              disabled={!d.bigLosses.length}
              onClick={() => setShowLosses((o) => !o)}
              className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12.5px] disabled:cursor-default"
            >
              <span className="text-mute">Verluste größer als 1R</span>
              <span className={cn("num font-mono", d.bigLosses.length ? "text-loss" : "text-win")}>{d.bigLosses.length || "keine"}</span>
            </button>
            <Collapse open={showLosses} id="r-big-losses">
              <div className="px-1 pb-2">
                <TradeList trades={d.bigLosses} group="r-big" extra={(t) => fmtR(t.r)} />
              </div>
            </Collapse>
          </div>
        </div>
      )}
    </InsightCard>
  );
}

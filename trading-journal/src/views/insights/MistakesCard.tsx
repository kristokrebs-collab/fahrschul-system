import { useMemo, useState } from "react";
import { EMPTY, explainMistakes, mistakeReport, TITLES } from "@/domain/insights";
import { cn } from "@/lib/cn";
import { pct0, r as fmtR, signed } from "@/lib/format";
import { EmptyState } from "@/primitives/EmptyState";
import { Collapse } from "@/primitives/Expander";
import { Segmented } from "@/primitives/Segmented";
import { Bar } from "@/views/overview/Bar";
import { InsightCard, SEG_TOUCH, TradeList, softTone, useInsightsBase } from "./ui";

type Scope = "all" | "manual";
/** Rows shown before "Alle … zeigen". */
const VISIBLE = 6;
const SCOPES = [
  { v: "all" as const, label: "Alle" },
  { v: "manual" as const, label: "Markiert" },
];

/**
 * `Fehler-Kosten` (Tradezella tags report, measured against your own clean trades): banner with the biggest leak,
 * one row per mistake (n, automatic share, cost in money and R, share of trades, bar); a row unfolds the trades.
 * "Alle" adds the mistakes the journal recognises by itself, "Markiert" shows only your tags.
 */
export function MistakesCard() {
  const { view, settings, cur } = useInsightsBase();
  const [scope, setScope] = useState<Scope>("all");
  const rep = useMemo(() => mistakeReport(view.closed, settings.setups, scope === "all"), [view.closed, settings.setups, scope]);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? rep.rows : rep.rows.slice(0, VISIBLE);
  const max = Math.max(1, ...rep.rows.map((x) => Math.abs(x.excess)));

  return (
    <InsightCard
      title={TITLES.mistakes}
      explain={() => explainMistakes(rep, cur, scope === "all")}
      note={rep.total ? `${rep.tagged} von ${rep.total} Trades mit Fehler · ${rep.clean.n} sauber` : undefined}
      action={<Segmented<Scope> size="sm" aria-label="Welche Fehler" options={SCOPES} value={scope} onChange={setScope} className={SEG_TOUCH} />}
      data-testid="insights-mistakes"
    >
      {!rep.rows.length ? (
        <EmptyState title={view.closed.length ? EMPTY.mistakes.title : EMPTY.trades.title} text={view.closed.length ? EMPTY.mistakes.text : EMPTY.trades.text} />
      ) : (
        <div className="grid gap-3">
          {rep.leak && (
            <div className="rounded-xl border border-loss/30 bg-loss/[0.07] px-3.5 py-2.5 text-[12.5px] text-danger-text">
              Größtes Leck: <strong className="font-semibold">{rep.leak.tag}</strong> · {signed(rep.leak.excess, 0)} {cur} gegenüber sauberen Trades
            </div>
          )}
          <ul className="grid">
            {shown.map((x, i) => {
              const on = open === x.tag;
              return (
                <li key={x.tag} className={cn(i > 0 && "border-t border-line")}>
                  <button type="button" aria-expanded={on} aria-controls={`mistake-${i}`} onClick={() => setOpen(on ? null : x.tag)} className="grid min-h-11 w-full gap-1.5 rounded-lg px-1 py-2 text-left">
                    <span className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 text-[13px]">
                      <span className="min-w-0 truncate">
                        {x.tag} <span className="text-faint">· {x.n}×{x.auto ? ` (${x.auto} automatisch)` : ""}</span>
                      </span>
                      <span className={cn("num font-mono", softTone(x.excess))}>{signed(x.excess, 0)}</span>
                    </span>
                    <Bar value={Math.abs(x.excess) / max} index={i} className="h-1" fill={x.excess < 0 ? "bg-loss/70" : "bg-win/60"} />
                    <span className="num flex flex-wrap gap-x-3 text-[11px] text-faint">
                      <span>{pct0(x.share)} der Trades</span>
                      <span>Win-Rate {pct0(x.g.winRate)}</span>
                      {x.excessR != null && <span className={softTone(x.excessR)}>{fmtR(x.excessR)} gegenüber sauber</span>}
                    </span>
                  </button>
                  <Collapse open={on} id={`mistake-${i}`}>
                    <div className="pb-2">
                      <TradeList trades={x.trades} group={`mistake-${i}`} />
                    </div>
                  </Collapse>
                </li>
              );
            })}
          </ul>
          {rep.rows.length > VISIBLE && (
            <button type="button" aria-expanded={all} onClick={() => setAll((a) => !a)} className="touch-hit w-fit text-[12px] font-medium text-mute underline decoration-line-2 underline-offset-4 hover:text-fg">
              {all ? "Weniger zeigen" : `Alle ${rep.rows.length} Fehler zeigen`}
            </button>
          )}
        </div>
      )}
    </InsightCard>
  );
}

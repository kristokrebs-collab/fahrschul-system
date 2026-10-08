import { useMemo, useState } from "react";
import { MIN_TRADES_STABLE } from "@/domain/defaults";
import { EDGE_MIN_TRADES, EMPTY, explainFindings, FINDING_MIN_N, findings, TITLES } from "@/domain/insights";
import { cn } from "@/lib/cn";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { Badge } from "@/primitives/Badge";
import { EmptyState } from "@/primitives/EmptyState";
import { Collapse } from "@/primitives/Expander";
import { Bar } from "@/views/overview/Bar";
import { InsightCard, TradeList, useInsightsBase } from "./ui";

/**
 * What the Auswertung needs before its statistics carry weight – shown while there are trades but no clear pattern
 * yet (sparse journal: the empty card says how far it is instead of only "noch nichts").
 */
export const PROGRESS_STEPS = [
  { key: "findings", label: "Erste Erkenntnis", need: 2 * FINDING_MIN_N, sub: `${FINDING_MIN_N} Trades je Seite` },
  { key: "edge", label: "Edge-Score aussagekräftig", need: EDGE_MIN_TRADES, sub: "sechs Kennzahlen" },
  { key: "stable", label: "Backtest-Vergleich belastbar", need: MIN_TRADES_STABLE, sub: "Win-Rate und Erwartung" },
] as const;

function Progress({ have }: { have: number }) {
  return (
    <ul className="mt-3 grid w-full max-w-[21rem] gap-3 text-left" aria-label="Fortschritt der Auswertung">
      {PROGRESS_STEPS.map((s, i) => {
        const done = have >= s.need;
        return (
          <li key={s.key} className="grid gap-1.5">
            <span className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="min-w-0 text-fg">
                {s.label} <span className="text-faint">· {s.sub}</span>
              </span>
              <span className={cn("num shrink-0 font-mono text-[11.5px]", done ? "text-win" : "text-mute")}>{done ? "✓" : `${have} / ${s.need}`}</span>
            </span>
            <Bar value={Math.min(1, have / s.need)} index={i} className="h-1" fill={done ? "bg-win" : "bg-fg"} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * `Erkenntnisse` (rule-based Zella insights): the three findings with the largest money impact, each with the numbers
 * behind it and "klar" / "Tendenz"; a finding unfolds the trades it is about. Without a clear pattern yet the card shows
 * how many trades each part of the Auswertung still needs (`PROGRESS_STEPS`).
 */
export function FindingsCard() {
  const { view, cur } = useInsightsBase();
  const list = useMemo(() => findings(view.closed, { capital: view.start, currency: cur, limit: 3 }), [view.closed, view.start, cur]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <InsightCard title={TITLES.findings} explain={explainFindings} data-testid="insights-findings">
      {!list.length ? (
        view.closed.length ? (
          <EmptyState title={EMPTY.findings.title} text={EMPTY.findings.text} line={false} action={<Progress have={view.closed.length} />} />
        ) : (
          <EmptyState title={EMPTY.trades.title} text={EMPTY.trades.text} />
        )
      ) : (
        <RevealGroup as="ol" className="grid gap-2.5">
          {list.map((f, i) => {
            const on = open === f.key;
            return (
              <RevealItem as="li" key={f.key} className={cn("rounded-xl border bg-ink-950/50", f.tone === "loss" ? "border-loss/25" : "border-win/25")}>
                <button type="button" aria-expanded={on} aria-controls={`finding-${f.key}`} onClick={() => setOpen(on ? null : f.key)} className="grid w-full gap-1.5 px-3.5 py-3 text-left">
                  <span className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-start gap-2.5">
                      <span className="num mt-px font-mono text-[11px] text-faint">{i + 1}</span>
                      <span className={cn("text-[13.5px] font-semibold leading-snug", f.tone === "loss" ? "text-danger-text" : "text-win")}>{f.title}</span>
                    </span>
                    <Badge tone={f.confidence === "klar" ? (f.tone === "loss" ? "loss" : "win") : "mute"} className="shrink-0">
                      {f.confidence}
                    </Badge>
                  </span>
                  <span className="num pl-[22px] font-mono text-[11.5px] text-mute">{f.detail}</span>
                </button>
                <Collapse open={on} id={`finding-${f.key}`}>
                  <div className="px-1.5 pb-2">
                    <TradeList trades={f.trades} group={`finding-${f.key}`} max={6} />
                  </div>
                </Collapse>
              </RevealItem>
            );
          })}
        </RevealGroup>
      )}
    </InsightCard>
  );
}

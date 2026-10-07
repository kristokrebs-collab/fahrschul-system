import { useMemo, useState } from "react";
import { EMPTY, explainFindings, findings, TITLES } from "@/domain/insights";
import { cn } from "@/lib/cn";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { Badge } from "@/primitives/Badge";
import { EmptyState } from "@/primitives/EmptyState";
import { Collapse } from "@/primitives/Expander";
import { InsightCard, TradeList, useInsightsBase } from "./ui";

/**
 * `Erkenntnisse` (rule-based Zella insights): the three findings with the largest money impact, each with the numbers
 * behind it and "klar" / "Tendenz"; a finding unfolds the trades it is about.
 */
export function FindingsCard() {
  const { view, cur } = useInsightsBase();
  const list = useMemo(() => findings(view.closed, { capital: view.start, currency: cur, limit: 3 }), [view.closed, view.start, cur]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <InsightCard title={TITLES.findings} explain={explainFindings} data-testid="insights-findings">
      {!list.length ? (
        <EmptyState title={view.closed.length ? EMPTY.findings.title : EMPTY.trades.title} text={view.closed.length ? EMPTY.findings.text : EMPTY.trades.text} />
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

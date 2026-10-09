import { useMemo } from "react";
import { EMPTY, explainWinLoss, TITLES, winnersVsLosers } from "@/domain/insights";
import { cn } from "@/lib/cn";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { EmptyState } from "@/primitives/EmptyState";
import { InsightCard, useInsightsBase } from "./ui";

/**
 * `Gewinner vs. Verlierer` (Tradezella Win vs Loss): the same habits for winners and losers side by side; the three
 * rows with the largest difference carry the red signal dot and full-contrast text. Rows cascade in on first view.
 */
export function WinLossCard() {
  const { view, settings, cur } = useInsightsBase();
  const rep = useMemo(() => winnersVsLosers(view.closed, settings.setups, cur), [view.closed, settings.setups, cur]);
  const ok = rep.winners.n > 0 && rep.losers.n > 0;
  return (
    <InsightCard title={TITLES.winloss} explain={explainWinLoss} data-testid="insights-winloss">
      {!ok ? (
        <EmptyState title={EMPTY.winloss.title} text={EMPTY.winloss.text} />
      ) : (
        <div className="@container/wl grid">
          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-1 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em]" aria-hidden="true">
            <span className="text-faint" />
            <span className="text-right text-win">Gewinner</span>
            <span className="text-right text-loss">Verlierer</span>
          </div>
          <RevealGroup as="div" className="grid" role="table" aria-label="Gewinner und Verlierer im Vergleich">
            {rep.rows.map((r) => (
              <RevealItem key={r.key} as="div" role="row" className="grid min-h-9 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 border-t border-line px-1 py-1.5 text-[12.5px]">
                <span role="rowheader" className={cn("flex min-w-0 items-center gap-1.5", r.highlight ? "text-fg" : "text-mute")}>
                  {r.highlight && <span className="size-1.5 shrink-0 rounded-full bg-signal" aria-hidden="true" />}
                  <span className="truncate @max-[400px]/wl:hidden">{r.label}</span>
                  <span className="hidden truncate @max-[400px]/wl:inline">{r.short}</span>
                  {r.highlight && <span className="sr-only">(großer Unterschied)</span>}
                </span>
                <span role="cell" className={cn("num break-words text-right font-mono", r.highlight ? "text-fg" : "text-mute")}>
                  {r.win}
                </span>
                <span role="cell" className={cn("num break-words text-right font-mono", r.highlight ? "text-fg" : "text-mute")}>
                  {r.loss}
                </span>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      )}
    </InsightCard>
  );
}

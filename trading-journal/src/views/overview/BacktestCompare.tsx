import { motion } from "motion/react";
import { useState } from "react";
import { BACKTEST_CARD_TITLE, BACKTEST_COLUMNS, BACKTEST_SCOPE_ALL, BACKTEST_SCOPE_BT, BACKTEST_SETUP_DELETED, backtestCompare, explainBacktest, hasBacktestSetup, type BacktestScope } from "@/domain/backtest";
import { cn } from "@/lib/cn";
import { colorClass } from "@/lib/format";
import { HoverPill, useHoverGroup } from "@/motion/HoverPill";
import { MorphCard } from "@/motion/MorphCard";
import { Badge } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { useAccountView, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { ExplanationView } from "./explainer";

const SCOPES = [
  { v: "all", label: BACKTEST_SCOPE_ALL },
  { v: "bt", label: BACKTEST_SCOPE_BT },
] as const;

/**
 * `Backtest-Vergleich` (Bundle `bhe`, Plan 6.1): scope toggle (hidden when `s_bt` was deleted, decision 14),
 * headline banner, `Kennzahl | Du | Backtest | Δ` rows as MorphCards (`bt-{k}-{scope}`, hover pill `bt`),
 * footnote.
 */
export function BacktestCompare() {
  const settings = useJournal((s) => s.settings);
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const hasBt = hasBacktestSetup(settings);
  const [chosen, setScope] = useState<BacktestScope>("all");
  // without `s_bt` the comparison is always over all trades (decision 14)
  const scope: BacktestScope = hasBt ? chosen : "all";
  const cmp = backtestCompare(view.closed, settings.backtest, scope);
  const hover = useHoverGroup<string>();

  return (
    <Card title={BACKTEST_CARD_TITLE} action={hasBt ? <Segmented<BacktestScope> size="sm" aria-label="Vergleichsbasis" options={SCOPES} value={scope} onChange={setScope} /> : undefined}>
      <div className={cn("mb-4 flex items-center justify-between gap-3 rounded-xl border p-3.5", cmp.status === "over" ? "border-win/30 bg-win/[0.07]" : cmp.status === "under" ? "border-loss/30 bg-loss/[0.07]" : "border-line bg-white/[0.02]")}>
        <div>
          <div className={cn("text-[15px] font-semibold", cmp.status === "over" ? "text-win" : cmp.status === "under" ? "text-loss" : "text-fg")}>{cmp.headline}</div>
          <div className="mt-0.5 text-xs text-mute">{cmp.sub}</div>
        </div>
        {cmp.warnBadge && <Badge tone="warn">{cmp.warnBadge}</Badge>}
      </div>
      {!hasBt && <p className="mb-3 text-[11.5px] text-faint">{BACKTEST_SETUP_DELETED}</p>}
      <div className="grid">
        <div className="label grid grid-cols-[1fr_auto_auto_auto] gap-x-5 pb-2 !text-faint">
          <span>{BACKTEST_COLUMNS[0]}</span>
          <span className="text-right">{BACKTEST_COLUMNS[1]}</span>
          <span className="text-right">{BACKTEST_COLUMNS[2]}</span>
          <span className="w-16 text-right">{BACKTEST_COLUMNS[3]}</span>
        </div>
        {cmp.rows.map((r) => (
          <div key={r.key} className="relative border-t border-line py-1" {...hover.bind(r.key)}>
            <HoverPill show={hover.hovered === r.key} group="bt" className="inset-y-1" />
            <MorphCard
              id={`bt-${r.key}-${cmp.scope}`}
              title={`Backtest · ${r.l}`}
              body={() => <ExplanationView bare d={explainBacktest(r.key, cmp.stats, settings)} />}
              className="relative z-10 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-5 px-2 py-2 text-[13px]"
            >
              <span className="flex items-center gap-2 text-mute">
                <span className="font-mono text-[13px] leading-none text-faint transition-all duration-300 group-hover:rotate-90 group-hover:text-fg" aria-hidden="true">
                  +
                </span>
                {r.l}
              </span>
              <span className={cn("num text-right font-mono font-medium", r.you == null ? "text-faint" : r.kind === "pp" ? "text-fg" : colorClass(r.you))}>{r.youText}</span>
              <span className="num text-right font-mono text-mute">{r.refText}</span>
              <span className="w-16 text-right">
                {r.delta == null ? (
                  <span className="text-faint">–</span>
                ) : (
                  <motion.span layout="position" className="inline-block">
                    <Badge tone={r.tone === "mute" ? "mute" : r.tone} className="px-2">
                      {r.deltaText}
                    </Badge>
                  </motion.span>
                )}
              </span>
            </MorphCard>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-faint">{cmp.footer}</p>
    </Card>
  );
}

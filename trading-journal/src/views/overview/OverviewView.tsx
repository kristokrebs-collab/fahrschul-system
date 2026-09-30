import { useCloseMorphDialogOnUnmount } from "@/motion/MorphDialog";
import { BacktestCompare } from "./BacktestCompare";
import { ChartCard } from "./ChartCard";
import { ChecklistCard } from "./ChecklistCard";
import { EquityCard } from "./EquityCard";
import { Hero } from "./Hero";
import { MonthlyCard } from "./MonthlyCard";
import { PatternsCard } from "./PatternsCard";
import { ProjectionCard } from "./ProjectionCard";
import { RankingCard } from "./RankingCard";
import { RecentTrades } from "./RecentTrades";
import { TopTraderCard } from "./TopTraderCard";
import { WinRateCard } from "./WinRateCard";

/**
 * `Übersicht` (Bundle `z$`, Plan 6.1). Layout `grid gap-5 lg:grid-cols-12`:
 * 1 Hero (12) · 1b Chart (12) · 2 Backtest (5) | Win-Rate (3) | Hochrechnung (4) · 3 Kontostand (7) |
 * Top Trader (5) · 4 Entscheidungsgrundlagen (7) | Checkliste (5) · 5 P&L pro Monat (5) | Letzte Trades (7) ·
 * 6 Muster (12). Every card reads `uiStore.acc` through `useAccountView`.
 */
export function OverviewView({ className }: { className?: string }) {
  useCloseMorphDialogOnUnmount();
  return (
    <div className={["grid gap-5 lg:grid-cols-12", className].filter(Boolean).join(" ")}>
      <div className="lg:col-span-12">
        <Hero />
      </div>
      <div className="lg:col-span-12">
        <ChartCard />
      </div>
      <div className="lg:col-span-5">
        <BacktestCompare />
      </div>
      <div className="lg:col-span-3">
        <WinRateCard />
      </div>
      <div className="lg:col-span-4">
        <ProjectionCard />
      </div>
      <div className="lg:col-span-7">
        <EquityCard />
      </div>
      <div className="lg:col-span-5">
        <TopTraderCard />
      </div>
      <div className="lg:col-span-7">
        <RankingCard />
      </div>
      <div className="lg:col-span-5">
        <ChecklistCard />
      </div>
      <div className="lg:col-span-5">
        <MonthlyCard />
      </div>
      <div className="lg:col-span-7">
        <RecentTrades />
      </div>
      <div className="lg:col-span-12">
        <PatternsCard />
      </div>
    </div>
  );
}

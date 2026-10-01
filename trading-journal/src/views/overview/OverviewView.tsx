import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useCloseMorphDialogOnUnmount } from "@/motion/MorphDialog";
import { Reveal } from "@/motion/Reveal";
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
 * Below-the-fold cells skip rendering while far off-screen (`content-visibility: auto`, size remembered after the
 * first render). Paint containment clips at the cell box, so the cell gets 12 px of vertical room (padding offset by
 * an equal negative margin – layout is unchanged) for the card's hover lift; no horizontal room is needed and none
 * is taken (390 px viewport must not scroll sideways).
 */
const DEFER = "[content-visibility:auto] -my-3 py-3";

interface CellProps {
  /** Column within its row → reveal stagger (`stagger.reveal`). */
  col: number;
  span: string;
  /** Placeholder block size (px) while the cell has never been rendered; `undefined` → rendered eagerly. */
  defer?: number;
  children: ReactNode;
}

/**
 * One grid cell below the hero: blur-fades in the first time it is in view, staggered by its column. The reveal
 * ends at `transform: none` / `filter: none`, so a settled cell never becomes a containing block.
 */
function Cell({ col, span, defer, children }: CellProps) {
  return (
    <Reveal index={col} className={cn(span, defer != null && DEFER)} style={defer != null ? { containIntrinsicBlockSize: `auto ${defer}px` } : undefined}>
      {children}
    </Reveal>
  );
}

/**
 * `Übersicht` (Bundle `z$`, Plan 6.1). Layout `grid gap-5 lg:grid-cols-12`:
 * 1 Hero (12) · 1b Chart (12) · 2 Backtest (5) | Win-Rate (3) | Hochrechnung (4) · 3 Kontostand (7) |
 * Top Trader (5) · 4 Entscheidungsgrundlagen (7) | Checkliste (5) · 5 P&L pro Monat (5) | Letzte Trades (7) ·
 * 6 Muster (12). Every card reads `uiStore.acc` through `useAccountView`.
 * Hero and chart render as they are (the chart has its own entrance, and its body hosts a `position: fixed` marker
 * ghost and the canvas – no reveal transform/filter around it); every card below cascades in per row.
 */
export function OverviewView({ className }: { className?: string }) {
  useCloseMorphDialogOnUnmount();
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)}>
      <div className="lg:col-span-12">
        <Hero />
      </div>
      <div className="lg:col-span-12">
        <ChartCard />
      </div>
      <Cell col={0} span="lg:col-span-5">
        <BacktestCompare />
      </Cell>
      <Cell col={1} span="lg:col-span-3">
        <WinRateCard />
      </Cell>
      <Cell col={2} span="lg:col-span-4">
        <ProjectionCard />
      </Cell>
      <Cell col={0} span="lg:col-span-7" defer={380}>
        <EquityCard />
      </Cell>
      <Cell col={1} span="lg:col-span-5" defer={380}>
        <TopTraderCard />
      </Cell>
      <Cell col={0} span="lg:col-span-7" defer={360}>
        <RankingCard />
      </Cell>
      <Cell col={1} span="lg:col-span-5" defer={360}>
        <ChecklistCard />
      </Cell>
      <Cell col={0} span="lg:col-span-5" defer={480}>
        <MonthlyCard />
      </Cell>
      <Cell col={1} span="lg:col-span-7" defer={480}>
        <RecentTrades />
      </Cell>
      <Cell col={0} span="lg:col-span-12" defer={420}>
        <PatternsCard />
      </Cell>
    </div>
  );
}

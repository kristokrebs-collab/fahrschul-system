import { useEffect, useRef, type ReactNode } from "react";
import { IntroCell, useIntroRoot } from "@/intro/IntroCell";
import { useIntroFlown } from "@/intro/introStore";
import { cn } from "@/lib/cn";
import { useHoldProjectionOnHide } from "@/motion/activityProjection";
import { useCloseMorphDialogOnUnmount } from "@/motion/MorphDialog";
import { Reveal } from "@/motion/Reveal";
import { startIdlePrerender } from "@/primitives/idlePrerender";
import { InsightsSection } from "@/views/insights";
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
import { SignalCard } from "./SignalCard";
import { TopTraderCard } from "./TopTraderCard";
import { WinRateCard } from "./WinRateCard";

/**
 * Below-the-fold cells skip rendering while far off-screen (`content-visibility: auto`, size remembered after the
 * first render). Paint containment clips at the cell box, so the cell gets 12 px of vertical room (padding offset by
 * an equal negative margin – layout is unchanged) for the card's hover lift; no horizontal room is needed and none
 * is taken (390 px viewport must not scroll sideways).
 */
const DEFER = "[content-visibility:auto] -my-3 py-3";
/**
 * Every cell fills its grid row (design pass v3): the cards of one row end on one line instead of ragged bottoms with
 * black gaps between them. A deferred cell's padding (± 12 px, see `DEFER`) is added back, so its card is as tall as
 * the row too. Inside, charts and empty states take the free height (`fill`, `EmptyState` is `h-full`), lists stay
 * top-anchored.
 */
const FILL = "h-full";
const FILL_DEFER = "h-[calc(100%+1.5rem)]";

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
 * ends at `transform: none` / `filter: none`, so a settled cell never becomes a containing block. The grid item is
 * the intro cell (build beat); the reveal inside keeps the deferral classes. Deferred cells never fly (they are far
 * below the fold and paint-contained); a cell the intro carried into place skips its reveal (`settled`).
 */
function Cell({ col, span, defer, children }: CellProps) {
  return (
    <IntroCell className={span} fly={defer == null}>
      <CellReveal col={col} defer={defer}>
        {children}
      </CellReveal>
    </IntroCell>
  );
}

function CellReveal({ col, defer, children }: Omit<CellProps, "span">) {
  const flown = useIntroFlown();
  return (
    <Reveal
      index={col}
      settled={flown}
      className={cn(defer != null ? [DEFER, FILL_DEFER] : FILL)}
      style={defer != null ? { containIntrinsicBlockSize: `auto ${defer}px` } : undefined}
      data-defer={defer != null ? "" : undefined}
    >
      {children}
    </Reveal>
  );
}

/**
 * `Übersicht` (Bundle `z$`, Plan 6.1). Layout `grid gap-5 lg:grid-cols-12`:
 * 1 Hero (12) · 1a Einstiegs-Check (12, NEW: live multi-timeframe signal check) · 1b Chart (12) · 2 Backtest (5) |
 * Win-Rate (3) | Hochrechnung (4) · 3 Kontostand (7) | Top Trader (5) · 4 Entscheidungsgrundlagen (7) |
 * Checkliste (5) · 5 P&L pro Monat (5) | Letzte Trades (7) · 6 Muster (12) · 7 Auswertung (12, `InsightsSection`,
 * mounted bare: its cards bring their own reveal / deferral). Every card reads `uiStore.acc` through `useAccountView`.
 * Hero, Einstiegs-Check and chart render as they are (the chart has its own entrance, and its body hosts a
 * `position: fixed` marker ghost and the canvas – no reveal transform/filter around it; the check sits right under
 * the hero, where a reveal would leave its first ~130 px blank above the fold on landscape tablets, e.g. 1692×978,
 * until the first scroll); every card below cascades in per row.
 * Intro: every cell is an `IntroCell` – the on-screen ones start as a slanted deck and travel to their slots, and
 * their first-view effects start when they land (transforms end at `none`, so the chart's fixed ghost is unaffected
 * once settled); the grid itself is the element the portal zooms out of.
 */
export function OverviewView({ className }: { className?: string }) {
  useCloseMorphDialogOnUnmount();
  const root = useRef<HTMLDivElement>(null);
  useIntroRoot(root);
  // switching away hides this kept-alive page: no layoutId snapshot of its (display: none) motion nodes
  useHoldProjectionOnHide();
  // the deferred cells (here and in the Auswertung) render once in idle time, not inside the first scroll past them
  useEffect(() => (root.current ? startIdlePrerender(root.current) : undefined), []);
  return (
    <div ref={root} className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)}>
      <IntroCell className="lg:col-span-12">
        <Hero />
      </IntroCell>
      <IntroCell className="lg:col-span-12">
        <SignalCard />
      </IntroCell>
      <IntroCell className="lg:col-span-12">
        <ChartCard />
      </IntroCell>
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
      <IntroCell className="lg:col-span-12" fly={false}>
        <InsightsSection />
      </IntroCell>
    </div>
  );
}

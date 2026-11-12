/**
 * Standard widgets of the cockpit (P13): the existing cards of the Übersicht and the Auswertung, wrapped unchanged
 * (each reads its own stores – the account switch of the Übersicht applies), plus the widgets the feature packages
 * export (`ANALYSE_WIDGETS` P03, `RISIKO_WIDGETS` P05, `WACHSTUM_WIDGETS` P08). Registered once, on first import.
 */
import { BACKTEST_CARD_TITLE } from "@/domain/backtest";
import { CHECKLIST_CARD_TITLE } from "@/domain/checklist";
import { TITLES } from "@/domain/insights";
import { PATTERNS_TITLE } from "@/domain/patterns";
import { ANALYSE_WIDGETS } from "@/views/analyse/widgets";
import { CalendarCard } from "@/views/insights/CalendarCard";
import { DisciplineCard } from "@/views/insights/DisciplineCard";
import { DrawdownCard } from "@/views/insights/DrawdownCard";
import { EdgeScoreCard } from "@/views/insights/EdgeScoreCard";
import { FindingsCard } from "@/views/insights/FindingsCard";
import { MistakesCard } from "@/views/insights/MistakesCard";
import { RecapCard } from "@/views/insights/RecapCard";
import { TimeCard } from "@/views/insights/TimeCard";
import { BacktestCompare } from "@/views/overview/BacktestCompare";
import { ChecklistCard } from "@/views/overview/ChecklistCard";
import { EQUITY_TITLE, EquityCard } from "@/views/overview/EquityCard";
import { MONTHLY_TITLE, MonthlyCard } from "@/views/overview/MonthlyCard";
import { PatternsCard } from "@/views/overview/PatternsCard";
import { PROJECTION_TITLE, ProjectionCard } from "@/views/overview/ProjectionCard";
import { RANKING_TITLE, RankingCard } from "@/views/overview/RankingCard";
import { RECENT_TITLE, RecentTrades } from "@/views/overview/RecentTrades";
import { TOP_TRADER_TITLE, TopTraderCard } from "@/views/overview/TopTraderCard";
import { WinRateCard } from "@/views/overview/WinRateCard";
import { RISIKO_WIDGETS } from "@/views/risiko/widgets";
import { WACHSTUM_WIDGETS } from "@/views/wachstum/widgets";
import { registerWidget, registerWidgets, type CockpitWidget } from "./registry";

export const GROUPS = { overview: "Übersicht", insights: "Auswertung", analyse: "Analyse", risiko: "Risiko", wachstum: "Wachstum" } as const;

export const OVERVIEW_WIDGETS: readonly CockpitWidget[] = [
  { id: "ov-equity", title: EQUITY_TITLE, component: EquityCard, defaultSpan: 8, group: GROUPS.overview, description: "Kontoverlauf mit Replay" },
  { id: "ov-winrate", title: "Win-Rate", component: WinRateCard, defaultSpan: 4, group: GROUPS.overview, description: "Trefferquote gegen den Backtest" },
  { id: "ov-ranking", title: RANKING_TITLE, component: RankingCard, defaultSpan: 7, group: GROUPS.overview, description: "Welches Setup Geld bringt – die stärksten oben" },
  { id: "ov-recent", title: RECENT_TITLE, component: RecentTrades, defaultSpan: 7, group: GROUPS.overview, description: "Die letzten sechs Trades" },
  { id: "ov-projection", title: PROJECTION_TITLE, component: ProjectionCard, defaultSpan: 5, group: GROUPS.overview, description: "Linear und mit Zinseszins" },
  { id: "ov-monthly", title: MONTHLY_TITLE, component: MonthlyCard, defaultSpan: 5, group: GROUPS.overview, description: "Die letzten zwölf Monate" },
  { id: "ov-checklist", title: CHECKLIST_CARD_TITLE, component: ChecklistCard, defaultSpan: 5, group: GROUPS.overview, description: "Was eine volle Checkliste bringt" },
  { id: "ov-backtest", title: BACKTEST_CARD_TITLE, component: BacktestCompare, defaultSpan: 5, group: GROUPS.overview, description: "Live gegen Backtest" },
  { id: "ov-patterns", title: PATTERNS_TITLE, component: PatternsCard, defaultSpan: 12, group: GROUPS.overview, description: "Plan, Richtung, Überzeugung, Wochentag" },
  { id: "ov-toptrader", title: TOP_TRADER_TITLE, component: TopTraderCard, defaultSpan: 5, group: GROUPS.overview, description: "Live-Positionierung der Top Trader" },
];

export const INSIGHT_WIDGETS: readonly CockpitWidget[] = [
  { id: "in-recap", title: TITLES.recap, component: RecapCard, defaultSpan: 7, group: GROUPS.insights, description: "Woche und Monat in einem Satz" },
  { id: "in-findings", title: TITLES.findings, component: FindingsCard, defaultSpan: 5, group: GROUPS.insights, description: "Die drei klarsten Erkenntnisse" },
  { id: "in-calendar", title: TITLES.calendar, component: CalendarCard, defaultSpan: 7, group: GROUPS.insights, description: "Jeder Tag mit Ergebnis und Notiz" },
  { id: "in-edge", title: TITLES.edge, component: EdgeScoreCard, defaultSpan: 5, group: GROUPS.insights, description: "Dein Vorteil in einer Zahl" },
  { id: "in-discipline", title: TITLES.discipline, component: DisciplineCard, defaultSpan: 12, group: GROUPS.insights, description: "Regeln, Serie, Heatmap" },
  { id: "in-mistakes", title: TITLES.mistakes, component: MistakesCard, defaultSpan: 6, group: GROUPS.insights, description: "Was dich deine Fehler kosten" },
  { id: "in-time", title: TITLES.time, component: TimeCard, defaultSpan: 7, group: GROUPS.insights, description: "Wochentag und Session" },
  { id: "in-drawdown", title: TITLES.drawdown, component: DrawdownCard, defaultSpan: 7, group: GROUPS.insights, description: "Unterwasserkurve und Erholung" },
];

let registered = false;

/** Idempotent: registers every standard widget once. */
export function registerBuiltinWidgets(): void {
  if (registered) return;
  registered = true;
  for (const w of OVERVIEW_WIDGETS) registerWidget(w);
  for (const w of INSIGHT_WIDGETS) registerWidget(w);
  registerWidgets(ANALYSE_WIDGETS, GROUPS.analyse);
  registerWidgets(RISIKO_WIDGETS, GROUPS.risiko);
  registerWidgets(WACHSTUM_WIDGETS, GROUPS.wachstum);
}

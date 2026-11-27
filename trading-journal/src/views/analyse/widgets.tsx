/**
 * Cockpit widgets of the Analyse page (P03 → P13 `registerWidget({ id, title, component, defaultSpan })`): each widget
 * reads the account view of the Hero's switch itself, so it can be mounted anywhere without props. They wrap the
 * Analyse cards unchanged (no duplicated card logic). `defaultSpan` = columns of a 12-column grid.
 */
import type { ComponentType } from "react";
import { CARD_TITLES } from "@/domain/analytics";
import { BreakdownCard } from "./BreakdownCard";
import { HeatmapCard } from "./HeatmapCard";
import { useAnalyseBase, useRatios } from "./hooks";
import { KennzahlenHero } from "./KennzahlenHero";
import { MonteCarloCard } from "./MonteCarloCard";
import { RiskOfRuinCard } from "./RiskOfRuinCard";
import { RollingCard } from "./RollingCard";
import { StreaksCard } from "./StreaksCard";

export interface AnalyseWidget {
  id: string;
  title: string;
  component: ComponentType;
  defaultSpan: number;
}

export function KennzahlenWidget() {
  const { view, cur } = useAnalyseBase();
  const rep = useRatios(view);
  return <KennzahlenHero rep={rep} cur={cur} n={view.closed.length} />;
}
export function MonteCarloWidget() {
  const { view, cur } = useAnalyseBase();
  return <MonteCarloCard view={view} cur={cur} />;
}
export function RiskOfRuinWidget() {
  const { view, settings } = useAnalyseBase();
  const rep = useRatios(view);
  return <RiskOfRuinCard view={view} settings={settings} rep={rep} />;
}
export function BreakdownWidget() {
  const { view, settings, cur } = useAnalyseBase();
  return <BreakdownCard view={view} settings={settings} cur={cur} />;
}
export function HeatmapWidget() {
  const { view, cur } = useAnalyseBase();
  return <HeatmapCard view={view} cur={cur} />;
}
export function RollingWidget() {
  const { view, cur } = useAnalyseBase();
  return <RollingCard view={view} cur={cur} />;
}
export function StreaksWidget() {
  const { view } = useAnalyseBase();
  return <StreaksCard view={view} />;
}

export const ANALYSE_WIDGETS: readonly AnalyseWidget[] = [
  { id: "ana-kennzahlen", title: CARD_TITLES.hero, component: KennzahlenWidget, defaultSpan: 12 },
  { id: "ana-montecarlo", title: CARD_TITLES.monteCarlo, component: MonteCarloWidget, defaultSpan: 8 },
  { id: "ana-ruin", title: CARD_TITLES.ruin, component: RiskOfRuinWidget, defaultSpan: 4 },
  { id: "ana-breakdown", title: CARD_TITLES.breakdown, component: BreakdownWidget, defaultSpan: 7 },
  { id: "ana-heatmap", title: CARD_TITLES.heatmap, component: HeatmapWidget, defaultSpan: 5 },
  { id: "ana-rolling", title: CARD_TITLES.rolling, component: RollingWidget, defaultSpan: 7 },
  { id: "ana-streaks", title: CARD_TITLES.streaks, component: StreaksWidget, defaultSpan: 5 },
];

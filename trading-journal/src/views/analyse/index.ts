/** Analyse page (P03): pro statistics with honest uncertainty. See `README.md`. */
export { AnalyseView, ANALYSE_LEAD_FILL, PREVIEW_ITEMS } from "./AnalyseView";
export { KennzahlenHero, HERO_TILES } from "./KennzahlenHero";
export { MonteCarloCard, fanGeometry, FAN_PATHS, MC_MIN_TRADES, mcSampleOf } from "./MonteCarloCard";
export { RiskOfRuinCard, ROR_MIN_TRADES } from "./RiskOfRuinCard";
export { BreakdownCard, BREAKDOWN_ROWS } from "./BreakdownCard";
export { HeatmapCard } from "./HeatmapCard";
export { ExcursionCard } from "./ExcursionCard";
export { DistributionCard } from "./DistributionCard";
export { RollingCard } from "./RollingCard";
export { StreaksCard } from "./StreaksCard";
export { BenchmarkCard } from "./BenchmarkCard";
export { CompareCard } from "./CompareCard";
export { CustomStatCard, formatCustom } from "./CustomStatCard";
export { ANALYSE_WIDGETS, KennzahlenWidget, MonteCarloWidget, RiskOfRuinWidget, BreakdownWidget, HeatmapWidget, RollingWidget, StreaksWidget, type AnalyseWidget } from "./widgets";
export { useAnalyseUi, setAnalyseDim, analyseDimFromQuery, analyseQuery, DEFAULT_DIM, type AnalyseUi } from "./analyseStore";
export { useAnalyseBase, useRatios, useMonteCarlo, useRiskOfRuin, memoClosed } from "./hooks";

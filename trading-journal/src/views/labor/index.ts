/**
 * Labor page (P07) – barrel for the integrator (P14):
 * - `LaborView` → page `labor` (`React.lazy(() => import("@/views/labor").then((m) => ({ default: m.LaborView })))`);
 *   it renders its own `h1` and mounts the replay sheet of backtest trades.
 * - `useLabor`, `startLab`, `cancelLab` – the page's store (e.g. a CommandNav action "Backtest starten").
 */
export { LaborView, LABOR_LEAD_FILL } from "./LaborView";
export { useLabor, startLab, cancelLab, retryLab, planOf, pagesEstimate, sanitizeCfg, readDrafts, DEFAULT_LAB, PERIOD_DAYS, RUNS_MAX, DRAFTS_MAX, __resetLabor, type LabConfig, type LabStatus, type RunSummary, type CustomDraft, type DataSource } from "./laborStore";
export { useDiagnosis } from "./DiagnosisCard";
export { loadLabData, LAB_BUDGET, LAB_CACHE_PREFIX, HISTORY_SOURCES, HISTORY_TIMING, FALLBACK_CHAIN, forgetRoutes, failuresOf, LabLoadError, __setHistoryDeps, type HistoryDeps, type HistorySource, type HistorySourceInfo, type LoadStatus, type StageFailure, type LoadedData } from "./historySource";
export { labReplayModel, type LabReplayModel } from "./labReplay";
export { assumptionLines, principleLines } from "./SideCards";
export { LABOR } from "./strings";

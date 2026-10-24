/**
 * Background optimiser (Hintergrund-Optimierer) – the views. `EvolvePanel` is the reusable panel (props in `types.ts`); the Labor
 * hosts it through `EvolveSection` (its own lazy chunk). Import the panel with `lazy(() => import("@/views/evolve/EvolvePanel"))`.
 */
export type { CandleSet, CandleStatus, EvolveActionResult, EvolvePanelProps, StrategyEntry } from "./types";
export { EVOLVE, DISCLAIMER } from "./strings";

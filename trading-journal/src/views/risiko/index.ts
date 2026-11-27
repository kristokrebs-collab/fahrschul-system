/**
 * Risiko page (P05) – barrel for the integrator (P14):
 * - `RisikoView` → page `risiko` (`React.lazy(() => import("@/views/risiko").then((m) => ({ default: m.RisikoView })))`);
 * - `RiskGuardHost` → App.tsx leaf with `data-layer` (after SetupEditor, before Celebrate);
 * - `useRiskPreview(draft)` → TradeEditor (warnings before the save);
 * - `RISIKO_WIDGETS` → cockpit (P13).
 */
export { RisikoView, RISIKO_LEAD_FILL } from "./RisikoView";
export { RiskGuardHost, useRiskGuard, useRiskGuardStore, GUARD_KEY, guardToasts, newlyClosed, changedTrades, overrideActive, OVERRIDDEN_BY_HOLD, pruneMarks, MARKS_MAX, MARKS_TTL_MS, BULK_CHANGE, FRESH_SAVE_MS, freshSave } from "./guard";
export { useRiskPreview, useRiskBase, useLimitReport, useExposure, useLiveUpnl, useMinute } from "./hooks";
export { useRiskUi, parseInput, toInput } from "./riskStore";
export { RISIKO } from "./strings";
export { RISIKO_WIDGETS } from "./widgets";

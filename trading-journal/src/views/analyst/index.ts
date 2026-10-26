/**
 * Analyst panels (F68 / F69). Import them LAZILY – they pull in the analyst, DCF and thesis domains:
 *   const AnalystPanel = lazy(() => import("@/views/analyst/AnalystPanel"));
 *   const DcfPanel = lazy(() => import("@/views/analyst/DcfPanel"));
 *   const ThesisPanel = lazy(() => import("@/views/analyst/ThesisPanel"));
 * This index is for hosts that already load the chunk; the shell must not import it.
 */
export { AnalystPanel } from "./AnalystPanel";
export { DcfPanel } from "./DcfPanel";
export { THESIS_SECTIONS, ThesisPanel } from "./ThesisPanel";
export type { AnalystLoaded, AnalystPanelProps, DcfPanelProps, ThesisPanelProps } from "./types";
export { AN, DCF, TH } from "./strings";

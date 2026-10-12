/**
 * UI state of the Analyse page (P03): the breakdown dimension (router seam `#analyse?dim=<key>` – the integrator
 * calls `setAnalyseDim` / reads `analyseQuery`), the Monte-Carlo controls, the rolling window and the compare mode.
 * Per tab session only (in memory): nothing here is journal data.
 */
import { create } from "zustand";
import { isDimensionKey, type DimensionKey, type PeriodPreset } from "@/domain/analytics";

export type McHorizon = 50 | 100 | 250;
export type McMethod = "bootstrap" | "reshuffle";
export type CompareMode = "period" | "account" | "setup";

export interface AnalyseUi {
  dim: DimensionKey;
  mcHorizon: McHorizon;
  mcMethod: McMethod;
  /** fraction risked per trade in the risk-of-ruin card; `null` = the trader's own median */
  rorRisk: number | null;
  rorRuin: 0.3 | 0.5;
  rollingWindow: 10 | 20 | 50;
  compareMode: CompareMode;
  comparePeriod: PeriodPreset;
  compareSetups: [string | null, string | null];
  set(patch: Partial<Omit<AnalyseUi, "set">>): void;
}

export const DEFAULT_DIM: DimensionKey = "setup";

export const useAnalyseUi = create<AnalyseUi>((set) => ({
  dim: DEFAULT_DIM,
  mcHorizon: 100,
  mcMethod: "bootstrap",
  rorRisk: null,
  rorRuin: 0.5,
  rollingWindow: 20,
  compareMode: "period",
  comparePeriod: "month",
  compareSetups: [null, null],
  set: (patch) => set(patch),
}));

/** Router seam: `#analyse?dim=session` → the breakdown opens on that dimension (unknown keys are ignored). */
export function setAnalyseDim(dim: string | null | undefined): void {
  if (isDimensionKey(dim)) useAnalyseUi.setState({ dim });
}

/** The dimension of a query string (`dim=…`), `null` when missing / unknown. */
export function analyseDimFromQuery(q: string | URLSearchParams): DimensionKey | null {
  const p = typeof q === "string" ? new URLSearchParams(q.startsWith("?") ? q.slice(1) : q) : q;
  const d = p.get("dim");
  return isDimensionKey(d) ? d : null;
}

/** Query string of the current dimension (for `buildHash`): `""` for the default. */
export function analyseQuery(dim: DimensionKey = useAnalyseUi.getState().dim): string {
  return dim === DEFAULT_DIM ? "" : `dim=${dim}`;
}

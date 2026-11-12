/**
 * Session state of the Risiko page (P05, in memory per tab): the calculator's inputs (strings as typed – the card
 * parses them) and the risk-spread grouping. The liquidation card reads the calculator's planned position from here.
 */
import { create } from "zustand";
import type { AccountId, Side } from "@/domain/types";

export interface CalcInputs {
  account: AccountId | null;
  side: Side;
  pair: string;
  capital: string;
  riskPct: string;
  entry: string;
  stop: string;
  target: string;
  leverage: string;
}

export const EMPTY_CALC: CalcInputs = { account: null, side: "long", pair: "", capital: "", riskPct: "", entry: "", stop: "", target: "", leverage: "" };

interface RiskUi {
  calc: CalcInputs;
  /** bumped by every programmatic fill (chip, live price) – the result cascades again */
  fillSeq: number;
  spreadBy: "setup" | "asset";
  setCalc(patch: Partial<CalcInputs>, programmatic?: boolean): void;
  resetCalc(): void;
  setSpreadBy(by: "setup" | "asset"): void;
}

export const useRiskUi = create<RiskUi>()((set) => ({
  calc: EMPTY_CALC,
  fillSeq: 0,
  spreadBy: "setup",
  setCalc: (patch, programmatic = false) => set((s) => ({ calc: { ...s.calc, ...patch }, fillSeq: programmatic ? s.fillSeq + 1 : s.fillSeq })),
  resetCalc: () => set((s) => ({ calc: EMPTY_CALC, fillSeq: s.fillSeq + 1 })),
  setSpreadBy: (spreadBy) => set({ spreadBy }),
}));

/** German decimal input → number ("1,5" / "1.5" / "85 900" → 1.5 / 1.5 / 85900); NaN when empty or invalid. */
export function parseInput(s: string): number {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return NaN;
  // "85.900,5" (de thousands + decimal comma) → 85900.5; "1,5" → 1.5; "1.5" → 1.5
  const de = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t);
  const v = Number(de ? t.replace(/\./g, "").replace(",", ".") : t.replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
}

/** Number → input string with a decimal comma and sensible precision for prices. */
export function toInput(v: number | null | undefined, digits?: number): string {
  if (v == null || !Number.isFinite(v)) return "";
  const d = digits ?? (Math.abs(v) >= 1000 ? 1 : Math.abs(v) >= 10 ? 2 : Math.abs(v) >= 1 ? 4 : 6);
  return String(Number(v.toFixed(d))).replace(".", ",");
}

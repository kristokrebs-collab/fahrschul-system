/**
 * Bär / Basis / Bulle: each scenario's assumptions → the DCF value per share (a range, not a point). The company's starting
 * numbers are shared (`ThesisBase`), the scenario sets growth, the final margin, reinvestment and the two rates. A scenario with
 * a missing assumption does not compute: it says what is missing. No probabilities, no weighted "expected value" – the spread
 * between the scenarios is the information. Pure.
 */
import { buildAssumptions, impliedGrowth, rangeOf, runDcf, sensitivity, type DcfRange, type DcfResult, type ImpliedGrowth, type SimpleAssumptions } from "@/domain/dcf";
import type { Scenario, ScenarioKey, Thesis, ThesisBase } from "./types";
import { SCENARIO_KEYS } from "./types";

/** The DCF form values of a scenario (the base margin is the start of the margin path). */
export function simpleOf(base: ThesisBase, s: Scenario, years: number): SimpleAssumptions {
  return {
    years,
    baseRevenue: base.revenue,
    growthStart: s.growthStart,
    growthEnd: s.growthEnd,
    marginStart: base.ebitMargin,
    marginEnd: s.marginEnd,
    reinvestStart: s.reinvest,
    reinvestEnd: s.reinvest,
    taxRate: base.taxRate,
    wacc: s.wacc,
    terminalGrowth: s.terminalGrowth,
    netDebt: base.netDebt,
    shares: base.shares,
  };
}

export interface ScenarioValue {
  key: ScenarioKey;
  /** the inputs that are missing – no value then */
  missing: string[];
  result: DcfResult | null;
  /** the range over WACC ± 1 point and terminal growth ± 0,5 point */
  range: DcfRange | null;
  /** the base case's value per share (`null` when no value) */
  perShare: number | null;
}

export function computeScenario(t: Pick<Thesis, "base" | "scenarios" | "horizonYears">, key: ScenarioKey): ScenarioValue {
  const simple = simpleOf(t.base, t.scenarios[key], t.horizonYears);
  const built = buildAssumptions(simple);
  if (!built.assumptions) return { key, missing: built.missing, result: null, range: null, perShare: null };
  const result = runDcf(built.assumptions);
  const sens = sensitivity(built.assumptions);
  return { key, missing: [], result, range: sens ? rangeOf(sens) : null, perShare: result.status === "ok" && result.value ? result.value.perShare : null };
}

export const computeAll = (t: Pick<Thesis, "base" | "scenarios" | "horizonYears">): Record<ScenarioKey, ScenarioValue> => Object.fromEntries(SCENARIO_KEYS.map((k) => [k, computeScenario(t, k)])) as Record<ScenarioKey, ScenarioValue>;

/** Distance of a value to the typed price in percent of the price (`null` without a price WITH a source). */
export function versusPrice(perShare: number | null, price: Thesis["price"]): number | null {
  if (perShare == null || !price || !price.source.trim() || !(price.value > 0)) return null;
  return perShare / price.value - 1;
}

/** "Was müsste stimmen?": the constant yearly growth the BASIS scenario's other assumptions need to reach `target` per share. */
export function whatMustHold(t: Pick<Thesis, "base" | "scenarios" | "horizonYears">, key: ScenarioKey, target: number): ImpliedGrowth {
  return impliedGrowth(simpleOf(t.base, t.scenarios[key], t.horizonYears), target);
}

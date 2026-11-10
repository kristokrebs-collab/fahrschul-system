/**
 * The few numbers a person types (start and end value of growth, margin and reinvestment, plus the single rates) →
 * the year-by-year `DcfAssumptions`. The path between start and end is a straight line; the result table shows every year,
 * so nothing is hidden. A missing input is named, not replaced by a default.
 */
import { MAX_YEARS, MIN_YEARS, type DcfAssumptions } from "./dcf";

/** The inputs of the DCF form. `null` = not entered. Fractions (0.08 = 8 %). */
export interface SimpleAssumptions {
  years: number;
  baseRevenue: number | null;
  /** revenue growth in year 1 and in the last year */
  growthStart: number | null;
  growthEnd: number | null;
  /** EBIT margin in year 1 and in the last year */
  marginStart: number | null;
  marginEnd: number | null;
  /** share of NOPAT re-invested in year 1 and in the last year */
  reinvestStart: number | null;
  reinvestEnd: number | null;
  taxRate: number | null;
  wacc: number | null;
  terminalGrowth: number | null;
  netDebt: number | null;
  shares: number | null;
}

export const EMPTY_SIMPLE: SimpleAssumptions = Object.freeze({
  years: 5,
  baseRevenue: null,
  growthStart: null,
  growthEnd: null,
  marginStart: null,
  marginEnd: null,
  reinvestStart: null,
  reinvestEnd: null,
  taxRate: null,
  wacc: null,
  terminalGrowth: null,
  netDebt: null,
  shares: null,
}) as SimpleAssumptions;

/** `n` values on a straight line from `from` (year 1) to `to` (year n); one year → `[from]`. */
export function linearPath(from: number, to: number, n: number): number[] {
  if (n <= 1) return [from];
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

/** Labels of the inputs, in the order of the form (for "Es fehlt: …"). */
export const FIELD_LABELS: Readonly<Record<Exclude<keyof SimpleAssumptions, "years">, string>> = {
  baseRevenue: "Umsatz im Basisjahr",
  growthStart: "Wachstum Jahr 1",
  growthEnd: "Wachstum letztes Jahr",
  marginStart: "EBIT-Marge Jahr 1",
  marginEnd: "EBIT-Marge letztes Jahr",
  reinvestStart: "Reinvestition Jahr 1",
  reinvestEnd: "Reinvestition letztes Jahr",
  taxRate: "Steuersatz",
  wacc: "WACC",
  terminalGrowth: "Endwachstum",
  netDebt: "Nettoverschuldung",
  shares: "Aktienzahl",
};

export interface Built {
  assumptions: DcfAssumptions | null;
  /** names of the inputs that are not entered */
  missing: string[];
}

/** The inputs → `DcfAssumptions`, or the list of what is missing. */
export function buildAssumptions(s: SimpleAssumptions): Built {
  const missing = (Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]).filter((k) => s[k] == null || !Number.isFinite(s[k])).map((k) => FIELD_LABELS[k]);
  const years = Math.round(s.years);
  if (missing.length || !Number.isFinite(years) || years < MIN_YEARS || years > MAX_YEARS) {
    return { assumptions: null, missing: !Number.isFinite(years) || years < MIN_YEARS || years > MAX_YEARS ? [...missing, `Zeitraum (${MIN_YEARS} bis ${MAX_YEARS} Jahre)`] : missing };
  }
  return {
    missing,
    assumptions: {
      baseRevenue: s.baseRevenue!,
      growth: linearPath(s.growthStart!, s.growthEnd!, years),
      ebitMargin: linearPath(s.marginStart!, s.marginEnd!, years),
      taxRate: s.taxRate!,
      reinvestmentRate: linearPath(s.reinvestStart!, s.reinvestEnd!, years),
      wacc: s.wacc!,
      terminalGrowth: s.terminalGrowth!,
      netDebt: s.netDebt!,
      shares: s.shares!,
    },
  };
}

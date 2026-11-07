/**
 * Starting values for the DCF form taken from the SEC numbers of the earnings analyst – each with the sentence that says where
 * it comes from. They are FILED numbers (or plain arithmetic on filed numbers), never a forecast; the assumptions about the
 * future (growth, WACC, terminal growth) are NOT in here: the person sets them (`EXAMPLE_RATES` are the skill's example
 * values, offered on request and labelled as such).
 */
import { dateDe, money, shareCount } from "@/domain/analyst/fmt";
import type { AnalystResult } from "@/domain/analyst/types";
import type { SimpleAssumptions } from "./series";

export interface DcfSeed {
  currency: string;
  /** the filed starting values; `null` = not in the data */
  baseRevenue: number | null;
  ebitMargin: number | null;
  taxRate: number | null;
  reinvestmentRate: number | null;
  /** revenue growth of the newest quarter against the year before – shown as a hint next to the growth inputs, NOT used as an assumption */
  growthHint: number | null;
  netDebt: number | null;
  shares: number | null;
  /** where each value comes from (or why it is empty) */
  sources: Partial<Record<keyof Omit<DcfSeed, "currency" | "sources" | "stamp" | "asOf">, string>>;
  /** end of the newest quarter the values refer to */
  asOf: string | null;
  stamp: AnalystResult["stamp"];
}

/** The two rates the `/dcf` skill uses in its example – offered as a starting point, not derived from any data. */
export const EXAMPLE_RATES = { wacc: 0.09, terminalGrowth: 0.025 } as const;

export function seedFromAnalyst(r: AnalystResult): DcfSeed {
  const q = r.quarters[0] ?? null;
  const t = r.ttm;
  const cur = r.currency;
  const sources: DcfSeed["sources"] = {};
  const ttmText = t ? `Summe der letzten vier Quartale bis ${dateDe(t.end)}` : "";

  const baseRevenue = t?.revenue ?? null;
  sources.baseRevenue = baseRevenue != null ? `${ttmText} (SEC): ${money(baseRevenue, cur)}` : "keine Daten: vier zusammenhängende Quartale mit Umsatz fehlen";

  const ebitMargin = t?.operatingIncome != null && t.revenue != null && t.revenue > 0 ? t.operatingIncome / t.revenue : null;
  sources.ebitMargin = ebitMargin != null ? `operatives Ergebnis durch Umsatz, ${ttmText}` : "keine Daten: operatives Ergebnis der letzten vier Quartale fehlt";

  let taxRate: number | null = null;
  if (t?.incomeTax != null && t.pretaxIncome != null && t.pretaxIncome > 0) {
    const rate = t.incomeTax / t.pretaxIncome;
    if (rate >= 0 && rate < 0.5) taxRate = rate;
  }
  sources.taxRate = taxRate != null ? `Steuern durch Ergebnis vor Steuern, ${ttmText}` : "keine Daten (oder ein Steuersatz außerhalb von 0 – 50 %, der nicht übernommen wird)";

  let reinvestmentRate: number | null = null;
  if (t?.capex != null && t.depreciation != null && t.operatingIncome != null && t.operatingIncome > 0 && taxRate != null) {
    const nopat = t.operatingIncome * (1 - taxRate);
    const rate = (t.capex - t.depreciation) / nopat;
    if (Number.isFinite(rate) && rate > -1 && rate < 1.5) reinvestmentRate = rate;
  }
  sources.reinvestmentRate = reinvestmentRate != null ? `(Investitionen − Abschreibungen) durch NOPAT, ${ttmText}; Veränderung des Betriebskapitals ist NICHT enthalten` : "keine Daten (Investitionen, Abschreibungen, operatives Ergebnis oder Steuersatz fehlen)";

  const growthHint = q ? r.comparisons[0]?.yoy.revenue?.pct ?? null : null;
  sources.growthHint = growthHint != null ? `Umsatz des Quartals bis ${dateDe(q!.end)} gegen das Vorjahresquartal – ein Hinweis, keine Annahme` : "keine Daten";

  const netDebt = q?.netDebt ?? null;
  sources.netDebt = netDebt != null ? `Finanzschulden ${money(q!.debt!.value, cur)} − Kasse${q!.shortTermInvestments != null ? " − kurzfristige Wertpapiere" : ""}, Stand ${dateDe(q!.end)}${q!.debt!.complete ? "" : " (Untergrenze: kurzfristiger Schuldenteil nicht gemeldet)"}` : "keine Daten: Finanzschulden oder Kasse im neuesten Quartal nicht gemeldet";

  const shares = q?.sharesDiluted?.value ?? null;
  sources.shares = shares != null ? `verwässerte Aktien, Durchschnitt im Quartal bis ${dateDe(q!.end)}: ${shareCount(shares)}` : r.coverShares ? `keine Daten für den Quartalsdurchschnitt; Deckblatt meldet ${shareCount(r.coverShares.value)} (Stand ${dateDe(r.coverShares.asOf)}, ohne Verwässerung, bei mehreren Aktiengattungen evtl. unvollständig)` : "keine Daten";

  return { currency: cur, baseRevenue, ebitMargin, taxRate, reinvestmentRate, growthHint, netDebt, shares, sources, asOf: q?.end ?? null, stamp: r.stamp };
}

/** The form with the filed starting values filled in and everything about the future left empty. */
export function simpleFromSeed(seed: DcfSeed, years = 5): SimpleAssumptions {
  return {
    years,
    baseRevenue: seed.baseRevenue,
    growthStart: null,
    growthEnd: null,
    marginStart: seed.ebitMargin,
    marginEnd: seed.ebitMargin,
    reinvestStart: seed.reinvestmentRate,
    reinvestEnd: seed.reinvestmentRate,
    taxRate: seed.taxRate,
    wacc: null,
    terminalGrowth: null,
    netDebt: seed.netDebt,
    shares: seed.shares,
  };
}

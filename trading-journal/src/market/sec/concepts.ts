/**
 * The XBRL concepts the analyst reads, in the order they are tried (the first concept a company really uses wins; later ones
 * only fill periods the earlier ones do not cover). Pure and alias-free (the SEC functions keep exactly these concepts).
 *
 * A concept missing in a company's facts is simply "keine Daten" – there is no fallback to an estimate. Banks and insurers use
 * other revenue and cost concepts; for them gross profit stays empty, not zero.
 */
import type { ConceptKey } from "./wire";

/** `money` = a currency (USD preferred), `perShare` = currency per share, `shares` = a count of shares. */
export type ConceptKind = "money" | "perShare" | "shares";

const us = (name: string): ConceptKey => `us-gaap:${name}`;

/** Duration metrics (income statement, cash flow): the value belongs to a period. */
export const FLOW_METRICS = ["revenue", "costOfRevenue", "grossProfit", "operatingIncome", "pretaxIncome", "incomeTax", "netIncome", "epsDiluted", "sharesDiluted", "operatingCashFlow", "capex", "depreciation"] as const;
export type FlowMetric = (typeof FLOW_METRICS)[number];

/** Instant metrics (balance sheet): the value belongs to a day. */
export const POINT_METRICS = ["cash", "shortTermInvestments", "debtTotal", "debtNoncurrent", "debtCurrent", "debtCurrentAlt", "shortTermBorrowings", "commercialPaper", "sharesOutstanding"] as const;
export type PointMetric = (typeof POINT_METRICS)[number];

export type Metric = FlowMetric | PointMetric;

export const METRIC_KIND: Readonly<Record<Metric, ConceptKind>> = {
  revenue: "money",
  costOfRevenue: "money",
  grossProfit: "money",
  operatingIncome: "money",
  pretaxIncome: "money",
  incomeTax: "money",
  netIncome: "money",
  epsDiluted: "perShare",
  sharesDiluted: "shares",
  operatingCashFlow: "money",
  capex: "money",
  depreciation: "money",
  cash: "money",
  shortTermInvestments: "money",
  debtTotal: "money",
  debtNoncurrent: "money",
  debtCurrent: "money",
  debtCurrentAlt: "money",
  shortTermBorrowings: "money",
  commercialPaper: "money",
  sharesOutstanding: "shares",
};

export const METRIC_CONCEPTS: Readonly<Record<Metric, readonly ConceptKey[]>> = {
  revenue: [
    us("RevenueFromContractWithCustomerExcludingAssessedTax"),
    us("Revenues"),
    us("RevenuesNetOfInterestExpense"),
    us("RevenueFromContractWithCustomerIncludingAssessedTax"),
    us("SalesRevenueNet"),
    us("SalesRevenueGoodsNet"),
    us("SalesRevenueServicesNet"),
  ],
  costOfRevenue: [us("CostOfGoodsAndServicesSold"), us("CostOfRevenue"), us("CostOfGoodsSold")],
  grossProfit: [us("GrossProfit")],
  operatingIncome: [us("OperatingIncomeLoss")],
  pretaxIncome: [us("IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"), us("IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments")],
  incomeTax: [us("IncomeTaxExpenseBenefit")],
  netIncome: [us("NetIncomeLoss"), us("NetIncomeLossAvailableToCommonStockholdersBasic"), us("ProfitLoss")],
  epsDiluted: [us("EarningsPerShareDiluted"), us("EarningsPerShareBasicAndDiluted")],
  sharesDiluted: [us("WeightedAverageNumberOfDilutedSharesOutstanding"), us("WeightedAverageNumberOfShareOutstandingBasicAndDiluted")],
  operatingCashFlow: [us("NetCashProvidedByUsedInOperatingActivities"), us("NetCashProvidedByUsedInOperatingActivitiesContinuingOperations")],
  capex: [us("PaymentsToAcquirePropertyPlantAndEquipment"), us("PaymentsToAcquireProductiveAssets")],
  depreciation: [us("DepreciationDepletionAndAmortization"), us("DepreciationAndAmortization"), us("DepreciationAmortizationAndAccretionNet")],
  cash: [us("CashAndCashEquivalentsAtCarryingValue"), us("CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents")],
  shortTermInvestments: [us("MarketableSecuritiesCurrent"), us("AvailableForSaleSecuritiesDebtSecuritiesCurrent"), us("ShortTermInvestments")],
  debtTotal: [us("LongTermDebt")],
  debtNoncurrent: [us("LongTermDebtNoncurrent")],
  debtCurrent: [us("LongTermDebtCurrent")],
  debtCurrentAlt: [us("DebtCurrent")],
  shortTermBorrowings: [us("ShortTermBorrowings")],
  commercialPaper: [us("CommercialPaper")],
  sharesOutstanding: ["dei:EntityCommonStockSharesOutstanding", us("CommonStockSharesOutstanding")],
};

/** Every concept the server keeps (the union of the lists above) with its kind. */
export const KEPT_CONCEPTS: ReadonlyMap<ConceptKey, ConceptKind> = (() => {
  const m = new Map<ConceptKey, ConceptKind>();
  for (const metric of Object.keys(METRIC_CONCEPTS) as Metric[]) for (const c of METRIC_CONCEPTS[metric]) m.set(c, METRIC_KIND[metric]);
  return m;
})();

/** Forms whose facts count: the periodic reports (and amendments). 8-K / S-1 / 6-K facts are ignored. */
export const REPORT_FORMS: ReadonlySet<string> = new Set(["10-Q", "10-Q/A", "10-K", "10-K/A", "10-KT", "20-F", "20-F/A", "40-F", "40-F/A"]);

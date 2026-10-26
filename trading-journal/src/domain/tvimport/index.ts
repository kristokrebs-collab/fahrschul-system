/**
 * TradingView ways in (F14): the honest adapter status, the reader for the strategy-tester export "List of trades" (CSV) and
 * the comparison with a lab run. Pure TypeScript, no React, no I/O. See README.md.
 */
export { TV_ADAPTERS, STATUS_LABEL, adaptersOf, type AdapterStatus, type TvAdapter } from "./adapters";
export { detectDelimiter, mapColumns, parseNumber, parseTvTime, parseTvTrades, splitCsv, type TimeParse, type TvParseError, type TvParseOptions, type TvParseResult, type TvTrade } from "./parse";
export { INDICATORS, VERDICT_LABEL, cleanInputs, compareIndicator, defaultInputs, guessColumn, indicatorById, testBars, warmupOf, type CompareStats, type Deviation, type IndicatorCompare, type IndicatorDef, type IndicatorId, type IndicatorOutput, type IndicatorParam, type Inputs, type Validation, type Verdict } from "./indicators";
export { MIN_CHART_BARS, intervalLabel, parseTvChart, type ChartColumn, type ChartError, type ChartOptions, type ChartParse } from "./chart";
export { barMsOf, compareTrades, tvMovePct, type CompareOptions, type ComparePair, type CompareReason, type Comparison, type LabTrade } from "./compare";

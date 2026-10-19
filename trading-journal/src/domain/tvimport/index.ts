/**
 * TradingView ways in (F14): the honest adapter status, the reader for the strategy-tester export "List of trades" (CSV) and
 * the comparison with a lab run. Pure TypeScript, no React, no I/O. See README.md.
 */
export { TV_ADAPTERS, STATUS_LABEL, adaptersOf, type AdapterStatus, type TvAdapter } from "./adapters";
export { detectDelimiter, mapColumns, parseNumber, parseTvTime, parseTvTrades, splitCsv, type TimeParse, type TvParseError, type TvParseOptions, type TvParseResult, type TvTrade } from "./parse";
export { barMsOf, compareTrades, tvMovePct, type CompareOptions, type ComparePair, type CompareReason, type Comparison, type LabTrade } from "./compare";

/**
 * Branchen-Trend (Aktien › Branchen-Trend): the signal rule of Zarattini & Antonacci (2024) on the 48 Ken-French industries,
 * the Ampel, the paper protocol, the Pine export and the reader of a lab run's result file. Pure TypeScript, no React, no I/O.
 */
export * from "./config";
export { ema, rollExtreme, rollMeanChange, rollStd0 } from "./indicators";
export { runSignal, lastChangeIndex, weights, type SignalRun } from "./signal";
export { computeAmpel, industryReturns, datasetDays, AmpelAborted, MISSING, type AmpelEvent, type AmpelOptions, type AmpelResult, type AmpelRow, type AmpelState, type IndustryDataset } from "./ampel";
export {
  PROTOKOLL_HINWEIS,
  PROTOKOLL_MAX,
  PROTOKOLL_MODUS,
  entriesFromEvents,
  entriesOfStored,
  entryKey,
  entryOf,
  erfasstText,
  lineOf,
  mergeEntries,
  parseJsonl,
  toJsonl,
  type ProtokollEintrag,
} from "./protokoll";
export { buildPine, payloadTemplate, PAYLOAD_JSON_SCHEMA, PAYLOAD_SCHEMA_ID, type PineScript } from "./pine";
export { parseMegatest, verdictOf, MAX_RESULT_BYTES, type Kennzahlen, type MegatestResult, type MonteCarlo, type ParseOutcome, type ResultCheck, type ResultParams, type Segmente, type Verdict } from "./result";
export { histogram, rangeOf, shareBelowDiagonal, logTicks, easeOutQuart, nearestIndex } from "./chartMath";

/**
 * SEC EDGAR contract (F68 / F69): wire types, the reducer and helpers shared with the Netlify functions, and the stamped,
 * typed-error client. Import lazily from the analyst views – nothing here is part of the first load.
 */
export { addDays, calendarQuarter, daysBetween, isIsoDate, isoOfMs, msOfIso } from "./days";
export { KEPT_CONCEPTS, METRIC_CONCEPTS, REPORT_FORMS } from "./concepts";
export type { FlowMetric, Metric, PointMetric } from "./concepts";
export { archiveFolder, exhibitName, pickFilings } from "./filings";
export { clearSecCache, fetchSecFacts, fetchSecFilings, SecError, toSecError } from "./client";
export type { SecErrorKind, SecFetchOptions, SecStamped } from "./client";
export { reduceCompanyFacts } from "./reduce";
export { findTicker, normalizeCik, normalizeTicker } from "./tickers";
export { SEC_ERROR_CODES, SEC_SOURCE, SEC_SOURCE_LABEL } from "./wire";
export type { ConceptKey, FactRow, FactSeries, SecEarnings8k, SecErrorCode, SecFactsPayload, SecFiling, SecFilingsPayload } from "./wire";

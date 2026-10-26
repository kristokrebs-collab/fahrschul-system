/**
 * Historisches Datenarchiv (F26) – the pure part: series table, configuration, gaps, export. The store, the collector and
 * the view live in `@/market/archive` and `@/views/settings/ArchiveCard`. See README.md.
 */
export { ALL_SERIES, ARCHIVE_AUTO_SYMBOLS, ARCHIVE_MAX_SYMBOLS, BACKFILL_SERIES, BACKFILL_SERIES_IDS, FUNDING_STEP_MS, RAW_SERIES, SERIES, SERIES_IDS, STATE_SERIES, TICK_BYTES, TICK_CAP, isBackfillSeries, isSeriesId, seriesDef, type FieldDef, type SeriesDef } from "./series";
export {
  BACKFILL_DAY_CHOICES,
  BACKFILL_LOG_CAP,
  BACKFILL_LOG_VERSION,
  BACKFILL_MAX_SYMBOLS,
  BACKFILL_SERIES_NAME,
  BACKFILL_SERIES_ORDER,
  DEFAULT_BACKFILL_DAYS,
  EXCHANGE_HISTORY_MS,
  FIVE_MIN_MS,
  FUNDING_LIMIT,
  HISTORY_EDGE_MARGIN_MS,
  KLINE_STEPS_PER_REQUEST,
  RATIO_STEPS_PER_REQUEST,
  appendBackfillRun,
  backfillRange,
  cutWindows,
  fundingHistPoints,
  markHistPoints,
  oiHistPoints,
  parseBackfillLog,
  planBackfill,
  ratioHistPoints,
  seriesResult,
  windowsOf,
  type BackfillDays,
  type BackfillEnd,
  type BackfillPlan,
  type BackfillRun,
  type BackfillSeries,
  type FundingRow,
  type MarkKline,
  type OiRow,
  type RatioRow,
  type SeriesResult,
  type Window,
} from "./backfill";
export { ARCHIVE_CFG_VERSION, DEFAULT_ARCHIVE_CFG, EVERY_MIN_CHOICES, MAX_MB_CHOICES, effectiveSymbols, estimateBytes, observedSymbols, parseArchiveCfg, ringCap, sanitizeSymbols, withArchiveCfg } from "./config";
export { FAIL_LABEL, GAP_CAUSE_LABEL, GAP_FACTOR, explainGap, findGaps, gapMs, gapText, gapThreshold, ivAt } from "./gaps";
export { ARCHIVE_CSV_MIME, ARCHIVE_FORMAT, ARCHIVE_JSON_MIME, archiveFilename, archiveToJson, isoUtc, pointsToCsv, type JsonExportMeta, type JsonSeries } from "./export";
export type { ArchiveCfg, ArchivePoint, Cell, Gap, GapCause, SeriesId, SeriesInfo, SeriesKind, TickRecord } from "./types";

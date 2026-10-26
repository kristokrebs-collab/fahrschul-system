/**
 * Historisches Datenarchiv (F26) – the pure part: series table, configuration, gaps, export. The store, the collector and
 * the view live in `@/market/archive` and `@/views/settings/ArchiveCard`. See README.md.
 */
export { ARCHIVE_AUTO_SYMBOLS, ARCHIVE_MAX_SYMBOLS, RAW_SERIES, SERIES, SERIES_IDS, STATE_SERIES, TICK_BYTES, TICK_CAP, isSeriesId, seriesDef, type FieldDef, type SeriesDef } from "./series";
export { ARCHIVE_CFG_VERSION, DEFAULT_ARCHIVE_CFG, EVERY_MIN_CHOICES, MAX_MB_CHOICES, effectiveSymbols, estimateBytes, observedSymbols, parseArchiveCfg, ringCap, sanitizeSymbols, withArchiveCfg } from "./config";
export { FAIL_LABEL, GAP_CAUSE_LABEL, GAP_FACTOR, explainGap, findGaps, gapMs, gapText, gapThreshold, ivAt } from "./gaps";
export { ARCHIVE_CSV_MIME, ARCHIVE_FORMAT, ARCHIVE_JSON_MIME, archiveFilename, archiveToJson, isoUtc, pointsToCsv, type JsonExportMeta, type JsonSeries } from "./export";
export type { ArchiveCfg, ArchivePoint, Cell, Gap, GapCause, SeriesId, SeriesInfo, SeriesKind, TickRecord } from "./types";

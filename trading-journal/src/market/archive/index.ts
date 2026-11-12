/**
 * Historisches Datenarchiv (F26) – market side: the IndexedDB store, the collector, the clock and the switch / status.
 * The view imports from the modules it needs (the collector stays out of the shell). See `src/market/README.md`.
 */
export { ARCHIVE_DB_NAME, ArchiveQuotaError, ArchiveUnavailable, openArchiveDb, storageEstimate, type ArchiveDb } from "./db";
export { Collector, QUOTA_STOP_SHARE, RATE_BACKOFF_MS, REQUEST_GAP_MS, TRIM_EVERY_TICKS, defaultDeps, type CollectorDeps, type StateRead, type TickResult } from "./collector";
export { RESUME_DELAY_MS, START_DELAY_MS, startArchiveRunner, type RunnerDeps } from "./runner";
export { ARCHIVE_CFG_KEY, getArchiveCfg, getArchiveStatus, setArchiveCfg, useArchiveCfg, useArchiveOn, useArchiveStatus, type ArchiveStatus, type RunState } from "./store";
export { readLiveStates } from "./states";

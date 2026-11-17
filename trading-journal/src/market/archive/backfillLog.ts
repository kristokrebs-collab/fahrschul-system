/**
 * „Börsenhistorie nachladen“ – the log of the finished runs (`tj2-archive-backfill`, the last 10, this browser only – like the
 * archive itself it is no part of backup or cloud sync). Small and free of the run, so a card can say „nachgeladen am …“
 * without loading the code that fetches. Browser storage can be empty or blocked: the log then lives in memory for the session.
 */
import { BACKFILL_LOG_VERSION, appendBackfillRun, parseBackfillLog, type BackfillRun } from "@/domain/archive";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const BACKFILL_LOG_KEY = storageKey("archive-backfill");

let log: BackfillRun[] | null = null;

/** The runs of this browser, newest first. */
export function getBackfillLog(): readonly BackfillRun[] {
  if (!log) log = parseBackfillLog(readJson<unknown>(BACKFILL_LOG_KEY, null));
  return log;
}

export function rememberBackfillRun(run: BackfillRun): void {
  log = appendBackfillRun(getBackfillLog(), run);
  writeJson(BACKFILL_LOG_KEY, { v: BACKFILL_LOG_VERSION, runs: log });
}

export function clearBackfillLog(): void {
  log = [];
  writeJson(BACKFILL_LOG_KEY, { v: BACKFILL_LOG_VERSION, runs: [] });
}

/** The newest run that asked for `symbol` and stored something (not a run that was cut off before its first request). */
export function lastRunFor(symbol: string): BackfillRun | null {
  for (const r of getBackfillLog()) {
    const per = r.res[symbol];
    if (per && Object.values(per).some((v) => v === "ok" || v.startsWith("partial:"))) return r;
  }
  return null;
}

/** Tests: forget the in-memory copy. */
export function __resetBackfillLog(): void {
  log = null;
}

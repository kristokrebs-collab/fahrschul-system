/**
 * Report archive (P04): every COMPLETED period with at least one closed trade becomes a report automatically – no
 * button, no job: the archive is derived from the journal, so it is complete on every device and after an import.
 * "Bericht bereit" (`pendingReport`) = the newest completed period of the most important kind that the trader has not
 * opened yet (seen markers in `settings.coach.reports.seen`), at most `READY_DAYS` after the period ended. Pure.
 */
import type { EnrichedTrade, Settings } from "../types";
import { aggregate } from "../agg";
import { tradeTime } from "@/lib/dates";
import { coachPrefsOf } from "../coach/prefs";
import { periodOf, type ReportKind, type ReportPeriod } from "./periods";

export interface ArchiveEntry {
  period: ReportPeriod;
  n: number;
  net: number;
  winRate: number | null;
  seen: boolean;
}

/** A "Bericht bereit" only for periods that ended within this many days. */
export const READY_DAYS: Readonly<Record<ReportKind, number>> = { day: 0, week: 6, month: 10, quarter: 21, year: 31 };
/** Importance order of the ready wipe (a year beats a month beats a week; days never wipe). */
const READY_ORDER: readonly ReportKind[] = ["year", "quarter", "month", "week"];

/** Completed periods of `kind` with closed trades, newest first (≤ `limit`). */
export function reportArchive(list: readonly EnrichedTrade[], settings: object, kind: ReportKind, now: number, limit = 24): ArchiveEntry[] {
  const seen = new Set(coachPrefsOf(settings).seen);
  const by = new Map<string, { period: ReportPeriod; trades: EnrichedTrade[] }>();
  for (const t of list) {
    if (t.result === "open") continue;
    const p = periodOf(kind, tradeTime(t));
    if (p.to > now) continue;
    const e = by.get(p.key);
    if (e) e.trades.push(t);
    else by.set(p.key, { period: p, trades: [t] });
  }
  return [...by.values()]
    .sort((a, b) => b.period.from - a.period.from)
    .slice(0, limit)
    .map(({ period, trades }) => {
      const g = aggregate(trades);
      return { period, n: g.n, net: g.net, winRate: g.winRate, seen: seen.has(period.key) };
    });
}

/** The report the "Bericht bereit" wipe announces, or null. */
export function pendingReport(list: readonly EnrichedTrade[], settings: Settings, now: number): ArchiveEntry | null {
  for (const kind of READY_ORDER) {
    const newest = reportArchive(list, settings, kind, now, 1)[0];
    if (!newest || newest.seen) continue;
    const prevOfNow = periodOf(kind, now);
    // only the period that ended last (not an older one with trades) and only shortly after its end
    if (newest.period.to !== prevOfNow.from) continue;
    if (now - newest.period.to > READY_DAYS[kind] * 86_400_000) continue;
    return newest;
  }
  return null;
}

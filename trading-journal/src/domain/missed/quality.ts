/**
 * Daten- und Alarmqualität (F27): a check report over what the app can actually know about its own data and alerts – gaps in
 * the candle feed, the delay between a candle's close and the alert, periods the app was not running, duplicate and held-back
 * alerts. Pure, deterministic; the inputs are the stored traces (signal archive, Zustellprotokoll, presence trace) and the
 * result of an on-demand candle check.
 *
 * What it can and cannot say:
 * - **Alarme laufen nur bei offener App.** The share of time the app was open comes from the presence trace
 *   (`src/market/presence.ts`: a beat every 30 s while a tab runs the app). It exists only from the day it was first written;
 *   before that, and without any beat, the share is `unbekannt` – never guessed from the alerts, because no alert in a period
 *   also happens when nothing triggered.
 * - Delay = the alert's time minus the close of the candle the signal rests on. It is known only for signals that carried the
 *   close (entry check, Box alerts, key levels at the close); for the entry check it includes the 60 s hold that guards against
 *   repainting. A device clock that is off shows up here as a delay too.
 * - Gaps of the candle feed are gaps in what the exchange returned for the checked range (maintenance, listing, a market with
 *   no trades) or what could not be loaded – the report cannot tell which.
 * - The Zustellprotokoll keeps the newest 200 lines only; an older month is incomplete and says so.
 */
import { quantile } from "../analytics/stats";
import type { DeliveryRecord } from "../keylevels/delivery";
import { SOURCE_LABEL, type SignalEvent, type SignalSource } from "./archive";
import { presenceReport, type PresenceReport, type PresenceSeg } from "./presence";

export const QUALITY_WINDOW_DAYS = 30;
/** A delay above this is „spät“. */
export const SLOW_ALERT_MS = 5 * 60_000;
/** A delay above this is not a delay of the alert (a stale event), it is left out. */
const DELAY_MAX_MS = 24 * 3_600_000;
const DAY = 86_400_000;

/* ------------------------------------------------------------------ delay */

export interface DelayRow {
  source: SignalSource;
  label: string;
  /** alerts with a known candle close */
  n: number;
  median: number | null;
  p90: number | null;
  max: number | null;
  /** alerts later than `SLOW_ALERT_MS` */
  slow: number;
}

/** Delay between the candle close and the alert, per source. */
export function delayReport(events: readonly SignalEvent[], from: number): DelayRow[] {
  const bySource = new Map<SignalSource, number[]>();
  for (const e of events) {
    if (e.at < from || e.barClose == null) continue;
    const d = e.at - e.barClose;
    if (d < 0 || d > DELAY_MAX_MS) continue;
    const list = bySource.get(e.source);
    if (list) list.push(d);
    else bySource.set(e.source, [d]);
  }
  return (["entry", "box", "key"] as const)
    .filter((s) => bySource.has(s))
    .map((s) => {
      const ds = bySource.get(s)!;
      return { source: s, label: SOURCE_LABEL[s], n: ds.length, median: quantile(ds, 0.5), p90: ds.length >= 5 ? quantile(ds, 0.9) : null, max: Math.max(...ds), slow: ds.filter((d) => d > SLOW_ALERT_MS).length };
    });
}

/* ------------------------------------------------------------------ delivery log */

export interface DeliveryQuality {
  /** lines of the log inside the window */
  lines: number;
  sent: number;
  /** held back as a duplicate / outside the active hours („abgelehnte Zeiten“) / without a channel */
  duplicate: number;
  hours: number;
  channels: number;
  /** key-level messages sent more than once under the same key (beyond the first) */
  repeated: number;
  /** oldest line the log still holds (ms), `null` = empty */
  oldest: number | null;
  /** the window starts before the oldest line: the log is incomplete for it */
  truncated: boolean;
}

export function deliveryQuality(log: readonly DeliveryRecord[], from: number): DeliveryQuality {
  const inWin = log.filter((r) => r.at >= from);
  const oldest = log.length ? Math.min(...log.map((r) => r.at)) : null;
  const seen = new Map<string, number>();
  for (const r of inWin) if (r.source === "key" && r.outcome === "sent") seen.set(r.dedupeKey, (seen.get(r.dedupeKey) ?? 0) + 1);
  return {
    lines: inWin.length,
    sent: inWin.filter((r) => r.outcome === "sent").length,
    duplicate: inWin.filter((r) => r.outcome === "duplicate").length,
    hours: inWin.filter((r) => r.outcome === "hours").length,
    channels: inWin.filter((r) => r.outcome === "channels").length,
    repeated: [...seen.values()].reduce((s, n) => s + Math.max(0, n - 1), 0),
    oldest,
    // a full log (200 lines) that starts after the window start has dropped older lines
    truncated: oldest != null && log.length >= 200 && oldest > from,
  };
}

/* ------------------------------------------------------------------ candle gaps */

export interface BarGap {
  /** open time (ms) of the first missing candle and of the last one */
  from: number;
  to: number;
  missing: number;
}

export interface GapCheck {
  /** `SYMBOL` the candles belong to */
  symbol: string;
  intervalMs: number;
  /** range that was checked (ms) */
  from: number;
  to: number;
  /** candles that came back */
  bars: number;
  gaps: BarGap[];
  missing: number;
  /** why nothing could be checked (German), `null` = checked */
  error: string | null;
}

/** Missing candles between consecutive open times (`times` ascending). A step larger than the interval is a gap. */
export function findBarGaps(times: readonly number[], intervalMs: number): BarGap[] {
  const gaps: BarGap[] = [];
  for (let i = 1; i < times.length; i++) {
    const step = times[i]! - times[i - 1]!;
    if (step > intervalMs * 1.5) gaps.push({ from: times[i - 1]! + intervalMs, to: times[i]! - intervalMs, missing: Math.round(step / intervalMs) - 1 });
  }
  return gaps;
}

/* ------------------------------------------------------------------ the report */

export interface QualityInput {
  now: number;
  events: readonly SignalEvent[];
  log: readonly DeliveryRecord[];
  presence: readonly PresenceSeg[];
  /** results of the on-demand candle check (one per market), `null` = not run */
  gaps: readonly GapCheck[] | null;
  windowDays?: number;
}

export interface QualityReport {
  from: number;
  to: number;
  windowDays: number;
  presence: PresenceReport;
  delays: DelayRow[];
  delivery: DeliveryQuality;
  gaps: readonly GapCheck[] | null;
  /** signals the archive holds inside the window */
  signals: number;
}

export function qualityReport(input: QualityInput): QualityReport {
  const windowDays = input.windowDays ?? QUALITY_WINDOW_DAYS;
  const from = input.now - windowDays * DAY;
  return {
    from,
    to: input.now,
    windowDays,
    presence: presenceReport(input.presence, input.now, windowDays * DAY),
    delays: delayReport(input.events, from),
    delivery: deliveryQuality(input.log, from),
    gaps: input.gaps,
    signals: input.events.filter((e) => e.at >= from).length,
  };
}

/** „4 Min 12 s“, „2 Std 5 Min“, „3 T 4 Std“ – compact German duration. */
export function durationText(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "–";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 && m < 10 ? `${m} Min ${s % 60} s` : `${m} Min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} Std ${m % 60} Min` : `${h} Std`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} T ${h % 24} Std` : `${d} T`;
}

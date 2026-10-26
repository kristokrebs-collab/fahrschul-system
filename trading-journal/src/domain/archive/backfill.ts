/**
 * „Börsenhistorie nachladen“ (F26/F07) – the pure part: what is asked for, in which windows, what it costs, and how the
 * answers become archive points. No React, no I/O.
 *
 * The public history of Binance USDⓈ-M holds Open Interest and the long / short ratios for about 30 days only (5-minute
 * steps). The user can load it ONCE, explicitly, so the squeeze observation has a sample at once instead of after weeks of
 * running. What arrives is stored as its own series (`…Hist`, see `series.ts`), never merged into what the app collected,
 * never smoothed and never filled: a window Binance did not answer, a value that is not a finite number, a stretch
 * without a row – all of it stays a gap.
 *
 * Windows: the exchange documents `limit` ≤ 500 (ratios, open interest) / ≤ 1500 (klines) but not which rows a
 * `startTime` + `endTime` pair returns when more fit. Every window here holds at most `limit` grid steps, so the answer is
 * the same whichever way the exchange orders it.
 */
import { seriesDef } from "./series";
import type { ArchivePoint, SeriesId } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const FIVE_MIN_MS = 5 * MIN;

/** How far back the user can ask. */
export const BACKFILL_DAY_CHOICES = [7, 14, 30] as const;
export type BackfillDays = (typeof BACKFILL_DAY_CHOICES)[number];
export const DEFAULT_BACKFILL_DAYS: BackfillDays = 30;
/** What Binance keeps of the 5-minute open interest and ratios. */
export const EXCHANGE_HISTORY_MS = 30 * DAY;
/** The oldest request stays this far inside the exchange's window (clock skew, request time). */
export const HISTORY_EDGE_MARGIN_MS = 6 * HOUR;
/** Grid steps per request: below the documented `limit` (500 / 1500). */
export const RATIO_STEPS_PER_REQUEST = 480;
export const KLINE_STEPS_PER_REQUEST = 1440;
export const FUNDING_LIMIT = 1000;
/** Most symbols one load covers (the archive's own limit). */
export const BACKFILL_MAX_SYMBOLS = 8;
/** A rough time per request (pause + answer), for the „etwa …“ in the preview. */
export const SECONDS_PER_REQUEST = 0.6;

/** The six datasets, in the order they are loaded. */
export const BACKFILL_SERIES_ORDER = ["fundingHist", "markHist", "oiHist", "lsAccHist", "lsTopPosHist", "lsTopAccHist"] as const satisfies readonly SeriesId[];
export type BackfillSeries = (typeof BACKFILL_SERIES_ORDER)[number];

/** `[from, to]` the load asks for: whole 5-minute steps, never older than the exchange's window allows. */
export function backfillRange(days: number, now: number): { from: number; to: number } {
  const span = Math.min(Math.max(1, days) * DAY, EXCHANGE_HISTORY_MS - HISTORY_EDGE_MARGIN_MS);
  const to = Math.floor(now / FIVE_MIN_MS) * FIVE_MIN_MS;
  const from = Math.ceil((now - span) / FIVE_MIN_MS) * FIVE_MIN_MS;
  return { from, to };
}

export interface Window {
  /** inclusive, ms */
  from: number;
  to: number;
}

/** `[from, to]` cut into pieces of at most `steps` grid steps (`step` ms). The pieces do not overlap. */
export function cutWindows(from: number, to: number, step: number, steps: number): Window[] {
  const out: Window[] = [];
  if (!(to >= from) || step <= 0 || steps <= 0) return out;
  const len = step * steps;
  for (let s = from; s <= to; s += len) out.push({ from: s, to: Math.min(to, s + len - 1) });
  return out;
}

/** The windows of one dataset (funding is a single request). */
export function windowsOf(series: BackfillSeries, from: number, to: number): Window[] {
  if (series === "fundingHist") return to >= from ? [{ from, to }] : [];
  if (series === "markHist") return cutWindows(from, to, FIVE_MIN_MS, KLINE_STEPS_PER_REQUEST);
  return cutWindows(from, to, FIVE_MIN_MS, RATIO_STEPS_PER_REQUEST);
}

export interface BackfillPlan {
  symbols: string[];
  days: number;
  from: number;
  to: number;
  /** requests in all */
  requests: number;
  /** requests per symbol */
  perSymbol: number;
  /** points the exchange should deliver (an estimate: funding at 3 per day) */
  points: number;
  /** stored size, estimated from the series table like every size in the archive card */
  bytes: number;
  /** a rough duration in seconds */
  seconds: number;
}

/** What a load would ask for and cost – shown before the user starts it. */
export function planBackfill(symbols: readonly string[], days: number, now: number): BackfillPlan {
  const { from, to } = backfillRange(days, now);
  const list = [...new Set(symbols)].slice(0, BACKFILL_MAX_SYMBOLS);
  let perSymbol = 0;
  let points = 0;
  let bytes = 0;
  for (const s of BACKFILL_SERIES_ORDER) {
    perSymbol += windowsOf(s, from, to).length;
    const n = s === "fundingHist" ? Math.ceil(((to - from) / DAY) * 3) : Math.floor((to - from) / FIVE_MIN_MS) + 1;
    points += n;
    bytes += n * seriesDef(s).bytes;
  }
  const requests = perSymbol * list.length;
  return { symbols: list, days, from, to, requests, perSymbol, points: points * list.length, bytes: bytes * list.length, seconds: Math.ceil(requests * SECONDS_PER_REQUEST) };
}

/* ------------------------------------------------------------------------------------------------ answers → points */

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Latest wins for a time that appears twice; ascending; only times inside `[from, to + slack]`. */
function finish(points: ArchivePoint[], from: number, to: number, slack: number): ArchivePoint[] {
  const by = new Map<number, ArchivePoint>();
  for (const p of points) if (p.t >= from && p.t <= to + slack) by.set(p.t, p);
  return [...by.values()].sort((a, b) => a.t - b.t);
}

export interface OiRow {
  time: number;
  openInterest: number;
  openInterestValue: number;
}
export interface RatioRow {
  time: number;
  longPct: number;
  shortPct: number;
  ratio: number;
}
export interface FundingRow {
  time: number;
  fundingRate: number;
}
export interface MarkKline {
  /** open time, ms */
  time: number;
  close: number;
  /** `false` for the candle that is still forming */
  closed: boolean;
}

/** A value that is not a finite number is left out of the point – and a point without any value is not stored. */
const cell = (v: unknown): number | null => (fin(v) ? v : null);

export function oiHistPoints(symbol: string, rows: readonly OiRow[], w: Window): ArchivePoint[] {
  const out: ArchivePoint[] = [];
  for (const r of rows) {
    if (!fin(r.time) || !fin(r.openInterest) || r.openInterest < 0) continue;
    out.push({ series: "oiHist", symbol, t: r.time, d: { oi: r.openInterest, value: cell(r.openInterestValue) } });
  }
  return finish(out, w.from, w.to, MIN);
}

export function ratioHistPoints(series: "lsAccHist" | "lsTopPosHist" | "lsTopAccHist", symbol: string, rows: readonly RatioRow[], w: Window): ArchivePoint[] {
  const out: ArchivePoint[] = [];
  for (const r of rows) {
    if (!fin(r.time) || !fin(r.longPct) || !fin(r.shortPct) || r.longPct < 0 || r.longPct > 100) continue;
    out.push({ series, symbol, t: r.time, d: { long: r.longPct, short: r.shortPct, ratio: cell(r.ratio) } });
  }
  return finish(out, w.from, w.to, MIN);
}

export function fundingHistPoints(symbol: string, rows: readonly FundingRow[], w: Window): ArchivePoint[] {
  const out: ArchivePoint[] = [];
  for (const r of rows) if (fin(r.time) && fin(r.fundingRate)) out.push({ series: "fundingHist", symbol, t: r.time, d: { rate: r.fundingRate } });
  return finish(out, w.from, w.to, MIN);
}

/** The mark price at the END of each closed 5-minute candle (its close), stamped with the end of the candle. */
export function markHistPoints(symbol: string, rows: readonly MarkKline[], w: Window): ArchivePoint[] {
  const out: ArchivePoint[] = [];
  for (const r of rows) if (r.closed && fin(r.time) && fin(r.close) && r.close > 0) out.push({ series: "markHist", symbol, t: r.time + FIVE_MIN_MS, d: { mark: r.close } });
  return finish(out, w.from, w.to, FIVE_MIN_MS);
}

/* ------------------------------------------------------------------------------------------------ the run log */

export const BACKFILL_LOG_VERSION = 1;
export const BACKFILL_LOG_CAP = 10;

export type BackfillEnd = "done" | "cancelled" | "failed";
/** `ok` (all windows came) · `partial:<reason>` (some failed) · the reason (none came) · `skipped` (cancelled before). */
export type SeriesResult = string;

/** One load, as the card shows it afterwards („Zuletzt nachgeladen …“). Lives in this browser only. */
export interface BackfillRun {
  /** device time the load ended (ms) */
  t: number;
  end: BackfillEnd;
  days: number;
  from: number;
  to: number;
  route: "direct" | "proxy";
  symbols: string[];
  /** points written in all */
  points: number;
  /** per symbol, per dataset */
  res: Readonly<Record<string, Readonly<Record<string, SeriesResult>>>>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function runOf(v: unknown): BackfillRun | null {
  if (!isObj(v) || !fin(v.t) || !fin(v.days) || !fin(v.from) || !fin(v.to) || !fin(v.points)) return null;
  const end = v.end === "done" || v.end === "cancelled" || v.end === "failed" ? v.end : null;
  if (!end || !Array.isArray(v.symbols) || !isObj(v.res)) return null;
  const res: Record<string, Record<string, string>> = {};
  for (const [sym, per] of Object.entries(v.res)) {
    if (!isObj(per)) continue;
    res[sym] = Object.fromEntries(Object.entries(per).filter((e): e is [string, string] => typeof e[1] === "string"));
  }
  return { t: v.t, end, days: v.days, from: v.from, to: v.to, route: v.route === "proxy" ? "proxy" : "direct", symbols: v.symbols.filter((s): s is string => typeof s === "string"), points: v.points, res };
}

/** The stored log → runs, newest first. Anything unknown is left out. */
export function parseBackfillLog(raw: unknown): BackfillRun[] {
  if (!isObj(raw) || raw.v !== BACKFILL_LOG_VERSION || !Array.isArray(raw.runs)) return [];
  return raw.runs.map(runOf).filter((r): r is BackfillRun => r !== null).sort((a, b) => b.t - a.t).slice(0, BACKFILL_LOG_CAP);
}

export function appendBackfillRun(log: readonly BackfillRun[], run: BackfillRun): BackfillRun[] {
  return [run, ...log].sort((a, b) => b.t - a.t).slice(0, BACKFILL_LOG_CAP);
}

/** German names of the datasets, for the result list. */
export const BACKFILL_SERIES_NAME: Readonly<Record<BackfillSeries, string>> = {
  fundingHist: "Funding",
  markHist: "Markpreis",
  oiHist: "Open Interest",
  lsAccHist: "Long/Short alle Konten",
  lsTopPosHist: "Long/Short Top-Trader-Positionen",
  lsTopAccHist: "Long/Short Top-Trader-Konten",
};

/**
 * The result of one dataset: every window came → `ok`; some came → `partial:<reason>` (the first failure, or `skipped` when
 * windows were not asked after repeated failures); none came → the reason (or `skipped`).
 */
export function seriesResult(windows: number, fetched: number, failed: readonly string[]): SeriesResult {
  if (fetched >= windows && !failed.length) return "ok";
  if (fetched === 0) return failed[0] ?? "skipped";
  return `partial:${failed[0] ?? "skipped"}`;
}

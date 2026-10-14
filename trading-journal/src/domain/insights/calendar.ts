/**
 * "P&L-Kalender" (Tradezella calendar + daily journal): a Monday-first month grid of six weeks, a week column, the
 * month header and the day view. Every number goes through `aggregate()`, so a cell, its week, the month header and
 * the day view always add up (Tradezella's "why does my daily P&L not add up" cannot happen).
 * Day key = local date of `trade.date` (entry time; the journal stores no exit time).
 */
import type { EnrichedTrade } from "../types";
import { aggregate, type Agg } from "../agg";
import { localDateKey, tradeTime } from "@/lib/dates";
import { isFin } from "@/lib/format";
import { dayKeyOf, groupByDay } from "./shared";

export interface YearMonth {
  y: number;
  /** 0 = January */
  m: number;
}

export type CalendarUnit = "money" | "r" | "pct";

export interface DayCell {
  key: string;
  /** day of month 1…31 */
  day: number;
  /** false for the leading / trailing days of the neighbouring months (shown faint, never counted) */
  inMonth: boolean;
  /** closed trades of the day (empty for neighbour days) */
  trades: EnrichedTrade[];
  /** aggregate of `trades`, `null` without trades */
  g: Agg | null;
  /** Σ R of the day's trades with an R value (`null` when none has one) */
  rSum: number | null;
  /** 0…1 tint strength: |net| relative to the 90th percentile of the month's traded days */
  intensity: number;
  /** a day journal entry exists */
  hasNote: boolean;
  isToday: boolean;
  /** after today */
  future: boolean;
}

export interface WeekRow {
  cells: DayCell[];
  /** only the days inside the month (the week column adds up to the month header) */
  g: Agg;
  /** traded days inside the month */
  days: number;
  rSum: number | null;
}

export interface CalendarMonth extends YearMonth {
  /** always six weeks, so the grid never changes height between months */
  weeks: WeekRow[];
  g: Agg;
  tradingDays: number;
  winDays: number;
  lossDays: number;
  /** `winDays / tradingDays` (a day wins when its net P&L > 0), `null` without traded days */
  dayWinRate: number | null;
  best: DayCell | null;
  worst: DayCell | null;
  rSum: number | null;
  /** the scale of `intensity` */
  p90: number;
}

export const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
export const MONTHS_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"] as const;

export const ymKey = (ym: YearMonth): string => `${ym.y}-${String(ym.m + 1).padStart(2, "0")}`;
export const ymOf = (d: Date): YearMonth => ({ y: d.getFullYear(), m: d.getMonth() });
export const ymIndex = (ym: YearMonth): number => ym.y * 12 + ym.m;
export function addMonths(ym: YearMonth, k: number): YearMonth {
  const i = ymIndex(ym) + k;
  return { y: Math.floor(i / 12), m: ((i % 12) + 12) % 12 };
}
export const monthTitle = (ym: YearMonth): string => `${MONTHS_LONG[ym.m]} ${ym.y}`;

function sumR(list: readonly EnrichedTrade[]): number | null {
  let s = 0;
  let n = 0;
  for (const t of list)
    if (isFin(t.r)) {
      s += t.r;
      n++;
    }
  return n ? s : null;
}

/** 90th percentile of |net| over the traded days (index `floor(len · 0.9)`, clamped); 1 without traded days. */
export function p90(absNets: readonly number[]): number {
  if (!absNets.length) return 1;
  const a = [...absNets].sort((x, y) => x - y);
  const v = a[Math.min(a.length - 1, Math.floor(a.length * 0.9))] ?? 0;
  return v > 0 ? v : 1;
}

export interface CalendarOptions {
  /** day keys with a journal entry (`tj2-days`) */
  notes?: ReadonlySet<string> | Readonly<Record<string, unknown>>;
  today?: Date;
}

const hasKey = (notes: CalendarOptions["notes"], key: string): boolean =>
  !notes ? false : notes instanceof Set ? notes.has(key) : Object.prototype.hasOwnProperty.call(notes, key);

/** The month grid of `ym` from the closed trades of the current account view. */
export function calendarMonth(closed: readonly EnrichedTrade[], ym: YearMonth, opts: CalendarOptions = {}): CalendarMonth {
  const today = opts.today ?? new Date();
  const todayKey = localDateKey(today);
  const byDay = groupByDay(closed);
  const first = new Date(ym.y, ym.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(ym.y, ym.m, 1 - lead);

  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = localDateKey(d);
    const inMonth = d.getMonth() === ym.m && d.getFullYear() === ym.y;
    const trades = inMonth ? (byDay.get(key) ?? []) : [];
    cells.push({
      key,
      day: d.getDate(),
      inMonth,
      trades,
      g: trades.length ? aggregate(trades) : null,
      rSum: trades.length ? sumR(trades) : null,
      intensity: 0,
      hasNote: hasKey(opts.notes, key),
      isToday: key === todayKey,
      future: key > todayKey,
    });
  }

  const traded = cells.filter((c) => c.g);
  const scale = p90(traded.map((c) => Math.abs(c.g!.net)));
  for (const c of traded) c.intensity = Math.min(1, Math.abs(c.g!.net) / scale);

  const weeks: WeekRow[] = [];
  for (let w = 0; w < 6; w++) {
    const row = cells.slice(w * 7, w * 7 + 7);
    const ts = row.flatMap((c) => c.trades);
    weeks.push({ cells: row, g: aggregate(ts), days: row.filter((c) => c.g).length, rSum: sumR(ts) });
  }

  const all = traded.flatMap((c) => c.trades);
  const winDays = traded.filter((c) => c.g!.net > 0).length;
  const lossDays = traded.filter((c) => c.g!.net < 0).length;
  let best: DayCell | null = null;
  let worst: DayCell | null = null;
  for (const c of traded) {
    if (!best || c.g!.net > best.g!.net) best = c;
    if (!worst || c.g!.net < worst.g!.net) worst = c;
  }
  return {
    ...ym,
    weeks,
    g: aggregate(all),
    tradingDays: traded.length,
    winDays,
    lossDays,
    dayWinRate: traded.length ? winDays / traded.length : null,
    best: best && best.g!.net > 0 ? best : null,
    worst: worst && worst.g!.net < 0 ? worst : null,
    rSum: sumR(all),
    p90: scale,
  };
}

/**
 * Months the calendar can show: from the first closed trade's month (or the current month) to the later of the
 * current month and the last trade's month. Never empty future months.
 */
export function monthRange(closed: readonly EnrichedTrade[], today = new Date()): { min: YearMonth; max: YearMonth } {
  const now = ymOf(today);
  if (!closed.length) return { min: now, max: now };
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of closed) {
    const i = ymIndex(ymOf(tradeTime(t)));
    if (i < lo) lo = i;
    if (i > hi) hi = i;
  }
  const min = Math.min(lo, ymIndex(now));
  const max = Math.max(hi, ymIndex(now));
  return { min: addMonths({ y: 0, m: 0 }, min), max: addMonths({ y: 0, m: 0 }, max) };
}

/** Start month: the month of the newest closed trade, else the current month. */
export function initialMonth(closed: readonly EnrichedTrade[], today = new Date()): YearMonth {
  let last: Date | null = null;
  for (const t of closed) {
    const d = tradeTime(t);
    if (!last || +d > +last) last = d;
  }
  return ymOf(last ?? today);
}

/** Value of a cell / week / month in the chosen unit: money, Σ R, or % of the account capital. */
export function unitValue(g: Agg | null, rSum: number | null, unit: CalendarUnit, capital: number): number | null {
  if (!g || !g.n) return null;
  if (unit === "r") return rSum;
  if (unit === "pct") return capital > 0 ? g.net / capital : null;
  return g.net;
}

export interface DayView {
  key: string;
  date: Date;
  /** closed trades of the day in time order */
  trades: EnrichedTrade[];
  /** open trades entered that day (listed, not counted) */
  open: EnrichedTrade[];
  g: Agg;
  rSum: number | null;
  /** cumulative net P&L after each closed trade, starting at 0 */
  curve: number[];
}

/** The day view of `key` from all trades of the account view (closed + open). */
export function dayView(list: readonly EnrichedTrade[], key: string): DayView {
  const trades = list.filter((t) => t.result !== "open" && dayKeyOf(t) === key).sort((a, b) => +tradeTime(a) - +tradeTime(b));
  const open = list.filter((t) => t.result === "open" && dayKeyOf(t) === key).sort((a, b) => +tradeTime(a) - +tradeTime(b));
  const curve = [0];
  let acc = 0;
  for (const t of trades) {
    acc += t.pnl || 0;
    curve.push(acc);
  }
  const [y = "1970", m = "1", d = "1"] = key.split("-");
  return { key, date: new Date(+y, +m - 1, +d), trades, open, g: aggregate(trades), rSum: sumR(trades), curve };
}

/** Neighbouring traded days of `key` (for ‹ › in the day view), `null` at the ends. */
export function adjacentTradedDays(closed: readonly EnrichedTrade[], key: string): { prev: string | null; next: string | null } {
  const keys = [...new Set(closed.map(dayKeyOf))].sort();
  let prev: string | null = null;
  let next: string | null = null;
  for (const k of keys) {
    if (k < key) prev = k;
    else if (k > key) {
      next = k;
      break;
    }
  }
  return { prev, next };
}

/**
 * "Zeit & Session" (Tradezella Day & Time report, for 24/7 crypto): net P&L and win rate by weekday (local time),
 * by trading session in UTC (Asien 00–07, London 07–13, New York 13–21, Spät 21–24 on weekdays; Saturday and Sunday
 * UTC are their own "Wochenende" bucket) and by two-hour block of the local day.
 */
import type { EnrichedTrade } from "../types";
import { aggregate, type Agg } from "../agg";
import { tradeTime } from "@/lib/dates";

export type SessionKey = "asia" | "london" | "ny" | "late" | "weekend";

export const SESSIONS: readonly { key: SessionKey; label: string; short: string; range: string }[] = [
  { key: "asia", label: "Asien", short: "Asien", range: "00–07 UTC" },
  { key: "london", label: "London", short: "London", range: "07–13 UTC" },
  { key: "ny", label: "New York", short: "NY", range: "13–21 UTC" },
  { key: "late", label: "Spät", short: "Spät", range: "21–24 UTC" },
  { key: "weekend", label: "Wochenende", short: "WE", range: "Sa–So UTC" },
];

/** Session of an instant (UTC hours, UTC weekday). */
export function sessionOf(d: Date): SessionKey {
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return "weekend";
  const h = d.getUTCHours();
  if (h < 7) return "asia";
  if (h < 13) return "london";
  if (h < 21) return "ny";
  return "late";
}

export interface TimeBucket {
  key: string;
  label: string;
  /** label for narrow charts ("NY", "WE") */
  short: string;
  /** secondary label (session hours, …) */
  sub?: string;
  g: Agg;
  trades: EnrichedTrade[];
}

function buckets<K extends string>(closed: readonly EnrichedTrade[], defs: readonly { key: K; label: string; short?: string; sub?: string }[], keyOf: (t: EnrichedTrade) => K): TimeBucket[] {
  const by = new Map<K, EnrichedTrade[]>();
  for (const t of closed) {
    const k = keyOf(t);
    const arr = by.get(k);
    if (arr) arr.push(t);
    else by.set(k, [t]);
  }
  return defs.map((d) => {
    const trades = by.get(d.key) ?? [];
    return { key: d.key, label: d.label, short: d.short ?? d.label, sub: d.sub, g: aggregate(trades), trades };
  });
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

/** Monday … Sunday (local weekday of `trade.date`), always seven buckets. */
export function byWeekday(closed: readonly EnrichedTrade[]): TimeBucket[] {
  const defs = WEEKDAYS.map((label, i) => ({ key: String(i), label }));
  return buckets(closed, defs, (t) => String((tradeTime(t).getDay() + 6) % 7));
}

/** The five sessions, always in this order. */
export function bySession(closed: readonly EnrichedTrade[]): TimeBucket[] {
  return buckets(
    closed,
    SESSIONS.map((s) => ({ key: s.key, label: s.label, short: s.short, sub: s.range })),
    (t) => sessionOf(tradeTime(t)),
  );
}

/** Two-hour blocks of the local day ("00", "02", … "22"). */
export function byHour(closed: readonly EnrichedTrade[]): TimeBucket[] {
  const defs = Array.from({ length: 12 }, (_, i) => {
    const h = String(i * 2).padStart(2, "0");
    return { key: h, label: h, sub: `${h}–${String(i * 2 + 2).padStart(2, "0")} Uhr` };
  });
  return buckets(closed, defs, (t) => String(Math.floor(tradeTime(t).getHours() / 2) * 2).padStart(2, "0"));
}

/** Buckets need at least this many trades to be named best / worst. */
export const BUCKET_MIN_N = 3;

export interface BucketSummary {
  best: TimeBucket | null;
  worst: TimeBucket | null;
  busiest: TimeBucket | null;
  bestWin: TimeBucket | null;
}

export function bucketSummary(list: readonly TimeBucket[], minN = BUCKET_MIN_N): BucketSummary {
  const eligible = list.filter((b) => b.g.n >= minN);
  let best: TimeBucket | null = null;
  let worst: TimeBucket | null = null;
  let bestWin: TimeBucket | null = null;
  for (const b of eligible) {
    if (!best || b.g.net > best.g.net) best = b;
    if (!worst || b.g.net < worst.g.net) worst = b;
    if (!bestWin || (b.g.winRate ?? 0) > (bestWin.g.winRate ?? 0)) bestWin = b;
  }
  let busiest: TimeBucket | null = null;
  for (const b of list) if (b.g.n && (!busiest || b.g.n > busiest.g.n)) busiest = b;
  return {
    best: best && best.g.net > 0 ? best : null,
    worst: worst && worst.g.net < 0 && worst !== best ? worst : null,
    busiest,
    bestWin,
  };
}

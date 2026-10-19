/**
 * The two descriptions of „Passt zu dir?“ (F49): `strategyFacts` (what a finished Labor run demands) and `journalProfile`
 * (what the trader's closed trades show). Pure; the same input always gives the same numbers. Nothing here judges.
 *
 * Times: the run's trades are epoch ms (UTC); a journal trade is a local wall-clock string, read as the real instant
 * (`tradeTime`) and bucketed in UTC like the run – so weekday and session mean the same on both sides.
 */
import { streaks } from "../analytics/streaks";
import type { BehaviorEvent } from "../coach/events";
import { accountOf, byEntry, closeMs, entryMs, fin, median } from "../coach/shared";
import { holdMs } from "../excursion";
import { wilson } from "../insights/shared";
import { sessionOf, type SessionKey } from "../insights/time";
import type { EnrichedTrade, Settings, TradeResult } from "../types";
import type { JournalProfile, Share, StrategyFacts } from "./types";

const DAY = 86_400_000;
const SESSIONS: readonly SessionKey[] = ["asia", "london", "ny", "late", "weekend"];

export function shareOf(k: number, n: number): Share {
  const w = wilson(k, n);
  return { k, n, share: n > 0 ? k / n : 0, lo: w.lo, hi: w.hi };
}

/** Deepest drop of the cumulative sum of `rs` from a running peak (the start counts as a peak at 0); ≥ 0. */
export function drawdownDepth(rs: readonly number[]): number {
  let cum = 0;
  let peak = 0;
  let depth = 0;
  for (const r of rs) {
    cum += r;
    if (cum > peak) peak = cum;
    if (peak - cum > depth) depth = peak - cum;
  }
  return depth;
}

const resultOf = (pnl: number): TradeResult => (pnl > 0 ? "win" : pnl < 0 ? "loss" : "be");

interface Buckets {
  weekday: number[];
  session: Record<SessionKey, number>;
  weekdayCount: number[];
  sessionCount: Record<SessionKey, number>;
}

/** Shares and counts of the instants per UTC weekday (0 = Sunday) and per session. */
function buckets(times: readonly number[]): Buckets {
  const wd = new Array<number>(7).fill(0);
  const se: Record<SessionKey, number> = { asia: 0, london: 0, ny: 0, late: 0, weekend: 0 };
  for (const t of times) {
    const d = new Date(t);
    wd[d.getUTCDay()]!++;
    se[sessionOf(d)]++;
  }
  const n = times.length;
  return {
    weekday: wd.map((v) => (n ? v / n : 0)),
    session: Object.fromEntries(SESSIONS.map((k) => [k, n ? se[k] / n : 0])) as Record<SessionKey, number>,
    weekdayCount: wd,
    sessionCount: se,
  };
}

/** What the run (a finished Labor result) looks like. `maxDD` is the run's equity drawdown as a fraction. */
export interface FitRunInput {
  name: string;
  from: number;
  to: number;
  riskPct: number | null;
  maxDD: number | null;
  trades: readonly { entryTime: number; exitTime: number; r: number; pnl: number }[];
}

export function strategyFacts(run: FitRunInput): StrategyFacts {
  const t = [...run.trades].sort((a, b) => a.entryTime - b.entryTime);
  const n = t.length;
  const days = Math.max(0, (run.to - run.from) / DAY);
  const wins = t.filter((x) => x.pnl > 0).length;
  const holds = t.map((x) => x.exitTime - x.entryTime).filter((h) => fin(h) && h >= 0);
  const b = buckets(t.map((x) => x.entryTime));
  return {
    name: run.name,
    n,
    from: run.from,
    to: run.to,
    days,
    win: shareOf(wins, n),
    perWeek: days >= 7 ? n / (days / 7) : null,
    holdMedianMs: median(holds),
    longestLosing: streaks(t.map((x) => resultOf(x.pnl))).longestLoss,
    drawdownR: drawdownDepth(t.map((x) => x.r)),
    drawdownPct: fin(run.maxDD) ? run.maxDD * 100 : null,
    riskPct: fin(run.riskPct) ? run.riskPct : null,
    weekday: b.weekday,
    session: b.session,
    sumR: t.reduce((s, x) => s + x.r, 0),
  };
}

/**
 * The trader's profile from the closed trades of the whole journal (every account and market – the caller decides what to
 * hand in). `events` are the coach's behaviour events (only `stopMoved` is read); `capital` turns the money risk of a trade
 * into percent of the start capital of its account.
 */
export function journalProfile(trades: readonly EnrichedTrade[], settings: Pick<Settings, "capital">, events: readonly BehaviorEvent[] = []): JournalProfile {
  const closed = byEntry(trades.filter((t) => t.result !== "open"));
  const n = closed.length;
  const entries = closed.map(entryMs).filter(fin);
  const from = entries.length ? Math.min(...entries) : null;
  const to = entries.length ? Math.max(...entries) : null;
  const spanDays = from != null && to != null ? (to - from) / DAY : 0;
  const wins = closed.filter((t) => t.result === "win").length;
  const holds = closed.map((t) => holdMs(t)).filter((h): h is number => h != null);
  const byClose = [...closed].sort((a, b) => closeMs(a) - closeMs(b) || (a.id < b.id ? -1 : 1));
  const rs = byClose.map((t) => t.r).filter(fin);
  const risks = closed.flatMap((t) => {
    const cap = settings.capital?.[accountOf(t)];
    return fin(t.risk) && t.risk > 0 && fin(cap) && cap > 0 ? [(t.risk / cap) * 100] : [];
  });
  const b = buckets(entries);
  const ids = new Set(closed.map((t) => t.id));
  const widened = new Set<string>();
  for (const e of events) if (e.key === "stopMoved") for (const id of e.tradeIds) if (ids.has(id)) widened.add(id);
  const answered = closed.filter((t) => t.followedPlan != null);
  return {
    n,
    from,
    to,
    spanDays,
    perWeek: spanDays >= 14 ? n / (spanDays / 7) : null,
    win: shareOf(wins, n),
    hold: { n: holds.length, medianMs: median(holds) },
    longestLosing: streaks(closed.map((t) => t.result)).longestLoss,
    drawdown: { n: rs.length, depthR: drawdownDepth(rs) },
    risk: { n: risks.length, medianPct: median(risks) },
    weekday: { n: entries.length, share: b.weekday, count: b.weekdayCount },
    session: { n: entries.length, share: b.session, count: b.sessionCount },
    discipline: {
      stopSet: shareOf(closed.filter((t) => fin(t.stop) && t.stop > 0).length, n),
      widened: widened.size,
      followed: shareOf(answered.filter((t) => t.followedPlan === true).length, answered.length),
    },
  };
}

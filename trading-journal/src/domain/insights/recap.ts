/**
 * "Rückblick" (Tradezella weekly / monthly recap, in the app instead of an e-mail): the current ISO week (Mon–Sun)
 * or month, or the previous one while the current period has fewer than `RECAP_MIN_TRADES` closed trades.
 */
import type { EnrichedTrade, Setup } from "../types";
import { aggregate, type Agg } from "../agg";
import { isoWeek, localDateKey, tradeTime, weekStart } from "@/lib/dates";
import { pct0, signed } from "@/lib/format";
import { MONTHS_LONG } from "./calendar";
import { disciplineAvg, type DisciplineDay } from "./discipline";
import { edgeScoreUntil } from "./edge";
import { mistakeReport, type MistakeRow } from "./mistakes";
import { dayFromKey, groupByDay } from "./shared";
import { bucketSummary, bySession, type TimeBucket } from "./time";

export type RecapKind = "week" | "month";
/** Tradezella: a recap needs at least four closed trades. */
export const RECAP_MIN_TRADES = 4;

export interface PeriodRange {
  kind: RecapKind;
  /** 0 = current, −1 = previous … */
  offset: number;
  from: Date;
  /** exclusive */
  to: Date;
  fromKey: string;
  /** inclusive last day */
  toKey: string;
  label: string;
}

const WEEKDAY_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"] as const;

export function periodRange(kind: RecapKind, now: Date, offset = 0): PeriodRange {
  let from: Date;
  let to: Date;
  let label: string;
  if (kind === "week") {
    const ws = weekStart(now);
    from = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + offset * 7);
    to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
    label = `KW ${isoWeek(from).week}`;
  } else {
    from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    label = `${MONTHS_LONG[from.getMonth()]} ${from.getFullYear()}`;
  }
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 1);
  return { kind, offset, from, to, fromKey: localDateKey(from), toKey: localDateKey(last), label };
}

export interface RecapDay {
  key: string;
  net: number;
}

export interface Recap {
  range: PeriodRange;
  trades: EnrichedTrade[];
  g: Agg;
  tradingDays: number;
  dayWinRate: number | null;
  bestDay: RecapDay | null;
  worstDay: RecapDay | null;
  /** Edge-Score of everything up to the end of the period, and its change over the period */
  edge: number | null;
  edgeDelta: number | null;
  /** Ø Disziplin-Score of the period's traded days */
  discipline: number | null;
  leak: MistakeRow | null;
  bestSession: TimeBucket | null;
  sentence: string;
  /** ≥ `RECAP_MIN_TRADES` closed trades */
  enough: boolean;
}

export interface RecapInput {
  /** closed trades of the account view */
  closed: readonly EnrichedTrade[];
  /** start capital of the account view */
  start: number;
  setups: readonly Pick<Setup, "id">[];
  currency: string;
  /** `disciplineDays()` of the same view (optional) */
  days?: readonly DisciplineDay[];
}

const inRange = (t: EnrichedTrade, r: PeriodRange): boolean => {
  const ms = +tradeTime(t);
  return ms >= +r.from && ms < +r.to;
};

export function recapFor(input: RecapInput, range: PeriodRange): Recap {
  const trades = input.closed.filter((t) => inRange(t, range));
  const g = aggregate(trades);
  const dayNets = [...groupByDay(trades)].map(([key, ts]) => ({ key, net: aggregate(ts).net }));
  let bestDay: RecapDay | null = null;
  let worstDay: RecapDay | null = null;
  for (const d of dayNets) {
    if (d.net > 0 && (!bestDay || d.net > bestDay.net)) bestDay = d;
    if (d.net < 0 && (!worstDay || d.net < worstDay.net)) worstDay = d;
  }
  const end = edgeScoreUntil(input.closed, input.start, +range.to);
  const before = edgeScoreUntil(input.closed, input.start, +range.from);
  const leak = mistakeReport(trades, input.setups).leak;
  const bestSession = bucketSummary(bySession(trades), 2).best;
  const enough = g.n >= RECAP_MIN_TRADES;
  const r: Recap = {
    range,
    trades,
    g,
    tradingDays: dayNets.length,
    dayWinRate: dayNets.length ? dayNets.filter((d) => d.net > 0).length / dayNets.length : null,
    bestDay,
    worstDay,
    edge: end.score,
    edgeDelta: end.score != null && before.score != null ? end.score - before.score : null,
    discipline: input.days ? disciplineAvg(input.days, range.fromKey, range.toKey) : null,
    leak,
    bestSession,
    sentence: "",
    enough,
  };
  r.sentence = recapSentence(r, input.currency);
  return r;
}

/** The current period, or the previous one while the current has too few trades (then the current again if neither has enough). */
export function recap(input: RecapInput, kind: RecapKind, now = new Date()): Recap {
  const cur = recapFor(input, periodRange(kind, now, 0));
  if (cur.enough) return cur;
  const prev = recapFor(input, periodRange(kind, now, -1));
  return prev.enough ? prev : cur;
}

/** One plain-German summary sentence. */
export function recapSentence(r: Recap, currency: string): string {
  const week = r.range.kind === "week";
  if (!r.g.n) return week ? "Keine abgeschlossenen Trades in dieser Woche." : "Keine abgeschlossenen Trades in diesem Monat.";
  const day = (d: RecapDay) => WEEKDAY_LONG[dayFromKey(d.key).getDay()];
  if (r.g.net > 0) {
    const head = `${week ? "Gute Woche" : "Guter Monat"}: ${signed(r.g.net, 0)} ${currency} bei ${pct0(r.g.winRate)} Win-Rate.`;
    return r.bestDay ? `${head} Bester Tag: ${week ? day(r.bestDay) : dayFromKey(r.bestDay.key).toLocaleDateString("de-DE", { day: "numeric", month: "long" })} (${signed(r.bestDay.net, 0)}).` : head;
  }
  if (r.g.net < 0) {
    const head = `${week ? "Schwache Woche" : "Schwacher Monat"}: ${signed(r.g.net, 0)} ${currency} bei ${pct0(r.g.winRate)} Win-Rate.`;
    return r.leak ? `${head} Größtes Leck: ${r.leak.tag} (${signed(r.leak.excess, 0)}).` : head;
  }
  return week ? "Ausgeglichene Woche: plus minus null." : "Ausgeglichener Monat: plus minus null.";
}

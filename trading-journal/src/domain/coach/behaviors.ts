/**
 * What each behaviour costs (P04): per behaviour key the events, the triggering trades (the LAST evidence id of each
 * event, de-duplicated), their result and the excess against the trader's clean trades – the same yardstick as the
 * Auswertung's mistake costs (`excess = Σ P&L(group) − n · Ø P&L(clean)`, the same in R over trades with an R).
 * "Clean" = closed trades that trigger no behaviour at all. Pure.
 */
import type { EnrichedTrade } from "../types";
import { aggregate, type Agg } from "../agg";
import { BEHAVIOR_LABEL, type BehaviorEvent, type BehaviorKey, type BehaviorSeverity } from "./events";
import { BEHAVIOR_ORDER } from "./detectors";
import { fin } from "./shared";

export interface BehaviorStat {
  key: BehaviorKey;
  label: string;
  events: BehaviorEvent[];
  /** events in the window */
  count: number;
  maxSeverity: BehaviorSeverity;
  /** triggering trades that are closed (de-duplicated, time order of the events) */
  trades: EnrichedTrade[];
  g: Agg;
  /** P&L against clean trades (< 0 = it cost money) */
  excess: number;
  /** same in R (trades with an R), `null` without any */
  excessR: number | null;
  /** Σ R of the triggering trades with an R */
  sumR: number | null;
  last: number;
}

export interface BehaviorReport {
  stats: BehaviorStat[];
  clean: Agg;
  /** closed trades that trigger at least one behaviour */
  flagged: number;
  total: number;
  /** the most expensive behaviour when it cost money */
  worst: BehaviorStat | null;
}

/** Id of the triggering trade of an event (the last evidence id). */
export const triggerOf = (e: BehaviorEvent): string => e.tradeIds[e.tradeIds.length - 1] ?? "";

/** Events whose triggering instant lies in [from, to). */
export function eventsBetween(events: readonly BehaviorEvent[], from: number, to: number): BehaviorEvent[] {
  return events.filter((e) => e.at >= from && e.at < to);
}

/**
 * Behaviour report over `closed` (the account view's closed trades) – only events whose triggering trade is in that
 * set count, so an account switch or a period filter applies to the events as well.
 */
export function behaviorReport(events: readonly BehaviorEvent[], closed: readonly EnrichedTrade[]): BehaviorReport {
  const byId = new Map(closed.map((t) => [t.id, t]));
  const per = new Map<BehaviorKey, { events: BehaviorEvent[]; ids: string[] }>();
  const flaggedIds = new Set<string>();
  for (const e of events) {
    const id = triggerOf(e);
    if (!byId.has(id)) continue;
    flaggedIds.add(id);
    const p = per.get(e.key) ?? { events: [], ids: [] };
    p.events.push(e);
    if (!p.ids.includes(id)) p.ids.push(id);
    per.set(e.key, p);
  }
  const clean = aggregate(closed.filter((t) => !flaggedIds.has(t.id)));
  const stats: BehaviorStat[] = [];
  for (const key of BEHAVIOR_ORDER) {
    const p = per.get(key);
    if (!p) continue;
    const trades = p.ids.map((id) => byId.get(id)!);
    const g = aggregate(trades);
    const excess = clean.n && clean.exp != null ? g.net - g.n * clean.exp : g.net;
    const rs = trades.map((t) => t.r).filter(fin);
    const sumR = rs.length ? rs.reduce((a, b) => a + b, 0) : null;
    const excessR = sumR == null ? null : clean.avgR != null ? sumR - rs.length * clean.avgR : sumR;
    stats.push({
      key,
      label: BEHAVIOR_LABEL[key],
      events: p.events,
      count: p.events.length,
      maxSeverity: p.events.reduce<BehaviorSeverity>((m, e) => (e.severity > m ? e.severity : m), 1),
      trades,
      g,
      excess,
      excessR,
      sumR,
      last: p.events[p.events.length - 1]!.at,
    });
  }
  stats.sort((a, b) => a.excess - b.excess || b.count - a.count);
  const worst = stats[0] && stats[0].excess < 0 ? stats[0] : null;
  return { stats, clean, flagged: flaggedIds.size, total: closed.length, worst };
}

/** Events per key in two windows (for "mehr / weniger als letzte Woche"). */
export function behaviorTrend(events: readonly BehaviorEvent[], key: BehaviorKey, now: number, windowMs: number): { current: number; previous: number } {
  let current = 0;
  let previous = 0;
  for (const e of events) {
    if (e.key !== key) continue;
    if (e.at >= now - windowMs && e.at <= now) current++;
    else if (e.at >= now - 2 * windowMs && e.at < now - windowMs) previous++;
  }
  return { current, previous };
}

/**
 * The shared input of the growth computations (P08), prepared once per journal change: trades sorted by entry, the
 * closed ones, trades per local day (`dayKeyOf`), the discipline days (`insights/discipline` – reused, never
 * re-derived), the coach's behaviour events (P04) and today's key. Pure.
 */
import type { DayNotes, EnrichedTrade, Settings } from "../types";
import type { BehaviorEvent } from "../coach/events";
import { disciplineDays, disciplineLimits, type DisciplineDay, type DisciplineLimits } from "../insights/discipline";
import { dayKeyOf } from "../insights/shared";
import { localDateKey, tradeTime } from "@/lib/dates";

export interface GrowthCtx {
  /** every trade of the journal (open ones included), any order */
  list: readonly EnrichedTrade[];
  events: readonly BehaviorEvent[];
  days: DayNotes;
  settings: Settings;
  now: number;
}

export interface Prepared extends GrowthCtx {
  /** entry order */
  sorted: EnrichedTrade[];
  closed: EnrichedTrade[];
  /** local day → trades entered that day (entry order) */
  byDay: Map<string, EnrichedTrade[]>;
  /** traded day keys, ascending */
  tradeDays: string[];
  discDays: DisciplineDay[];
  limits: DisciplineLimits;
  todayKey: string;
  /** local day → behaviour events triggered that day */
  eventsByDay: Map<string, BehaviorEvent[]>;
}

export function prepare(ctx: GrowthCtx): Prepared {
  const sorted = [...ctx.list].sort((a, b) => +tradeTime(a) - +tradeTime(b));
  const byDay = new Map<string, EnrichedTrade[]>();
  for (const t of sorted) {
    const k = dayKeyOf(t);
    const arr = byDay.get(k);
    if (arr) arr.push(t);
    else byDay.set(k, [t]);
  }
  const eventsByDay = new Map<string, BehaviorEvent[]>();
  for (const e of ctx.events) {
    const k = localDateKey(new Date(e.at));
    const arr = eventsByDay.get(k);
    if (arr) arr.push(e);
    else eventsByDay.set(k, [e]);
  }
  return {
    ...ctx,
    sorted,
    closed: sorted.filter((t) => t.result !== "open"),
    byDay,
    tradeDays: [...byDay.keys()].sort(),
    discDays: disciplineDays({ list: sorted, settings: ctx.settings, notes: ctx.days }),
    limits: disciplineLimits(ctx.settings as { discipline?: unknown }),
    todayKey: localDateKey(new Date(ctx.now)),
    eventsByDay,
  };
}

/** The journal as it was at `at` (trades entered, events triggered and days up to then) – for "vor 30 Tagen". */
export function prepareAt(ctx: GrowthCtx, at: number): Prepared {
  const key = localDateKey(new Date(at));
  const days: DayNotes = {};
  for (const [k, v] of Object.entries(ctx.days)) if (k <= key) days[k] = v;
  return prepare({ ...ctx, list: ctx.list.filter((t) => +tradeTime(t) <= at), events: ctx.events.filter((e) => e.at <= at), days, now: at });
}

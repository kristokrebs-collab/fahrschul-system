/**
 * Live watcher logic (P04, pure): after a save, which behaviours did the saved trade(s) trigger that were not there
 * before – the strongest one becomes a toast with advice and a suggested cooldown. The React side
 * (`useCoachWatch` / `CoachWatcher`, `src/views/coach`) subscribes to the journal store and calls this.
 */
import type { DayNotes, EnrichedTrade, Settings } from "../types";
import { BEHAVIOR_LABEL, detectBehaviors, type BehaviorEvent, type BehaviorKey } from "./events";
import { BEHAVIOR_ADVICE } from "./copy";
import { triggerOf } from "./behaviors";

export interface CoachAlert {
  key: BehaviorKey;
  severity: 1 | 2 | 3;
  title: string;
  detail: string;
  /** suggested pause in minutes (0 none, -1 rest of the day) */
  cooldownMin: number;
  /** epoch ms the pause ends (null without one) */
  until: number | null;
  tradeId: string;
  /** further new events of the same save */
  more: number;
}

const eventKey = (e: BehaviorEvent): string => `${e.key}|${triggerOf(e)}`;

/** Local midnight after `now`. */
const midnight = (now: number): number => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
};

/**
 * New behaviour events of a save: events of `after` whose triggering trade is one of `changedIds` and which `before`
 * did not have (key + triggering trade). Strongest first.
 */
export function newEvents(before: readonly BehaviorEvent[], after: readonly BehaviorEvent[], changedIds: ReadonlySet<string>): BehaviorEvent[] {
  const had = new Set(before.map(eventKey));
  return after.filter((e) => changedIds.has(triggerOf(e)) && !had.has(eventKey(e))).sort((a, b) => b.severity - a.severity || b.at - a.at);
}

/** The toast of a save, or null (nothing new, or only hints when `minSeverity` is 2). */
export function coachAlert(input: { before: readonly EnrichedTrade[]; after: readonly EnrichedTrade[]; changedIds: ReadonlySet<string>; settings: Settings; days?: DayNotes; now: number; minSeverity?: 1 | 2 | 3 }): CoachAlert | null {
  const { settings, days, now } = input;
  const evBefore = detectBehaviors({ trades: input.before, settings, days, now });
  const evAfter = detectBehaviors({ trades: input.after, settings, days, now });
  const fresh = newEvents(evBefore, evAfter, input.changedIds).filter((e) => e.severity >= (input.minSeverity ?? 1));
  const top = fresh[0];
  if (!top) return null;
  const adv = BEHAVIOR_ADVICE[top.key];
  const until = adv.cooldownMin > 0 ? now + adv.cooldownMin * 60_000 : adv.cooldownMin < 0 ? midnight(now) : null;
  // the pause is named once: advice that already says it gets no suffix
  const pause = /Pause/.test(adv.advice) ? "" : adv.cooldownMin > 0 ? ` Pause ${adv.cooldownMin} Min.` : adv.cooldownMin < 0 ? " Pause bis morgen." : "";
  return {
    key: top.key,
    severity: top.severity,
    title: `Coach: ${BEHAVIOR_LABEL[top.key]}`,
    detail: `${top.note ? `${top.note}. ` : ""}${adv.advice}${pause}`.replace(/\.\./g, "."),
    cooldownMin: adv.cooldownMin,
    until,
    tradeId: triggerOf(top),
    more: fresh.length - 1,
  };
}

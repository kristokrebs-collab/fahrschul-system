/**
 * Data hooks of the coach (P04): the account view of the Hero's switch, the behaviour events of the whole journal (one
 * detection per enriched list + settings), and the coach's analysis of the account view (edges, recommendations, plan,
 * score, profile, lesson, tips) – memoised per `view.closed`, so every card shares one computation.
 */
import { useEffect, useMemo, useState } from "react";
import { accountView, type AccountView } from "@/domain/account";
import { behaviorProfile, coachPrefsOf, coachTips, detectBehaviors, findEdges, improvementPlan, recommendations, tradingScore, weeklyLesson, type BehaviorEvent, type BehaviorProfile, type CoachPrefs, type EdgeReport, type Recommendation, type TradingScore, type WeeklyLesson } from "@/domain/coach";
import type { DayNotes, EnrichedTrade, Settings } from "@/domain/types";
import { useAccountView, useEnriched, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

const eventsCache = new WeakMap<EnrichedTrade[], WeakMap<Settings, BehaviorEvent[]>>();

/** Behaviour events of the whole journal (memoised per enriched list and settings). */
export function eventsOf(enriched: EnrichedTrade[], settings: Settings, days?: DayNotes): BehaviorEvent[] {
  let by = eventsCache.get(enriched);
  if (!by) eventsCache.set(enriched, (by = new WeakMap()));
  let ev = by.get(settings);
  if (!ev) by.set(settings, (ev = detectBehaviors({ trades: enriched, settings, days })));
  return ev;
}

export interface CoachAnalysis {
  events: BehaviorEvent[];
  edges: EdgeReport;
  recs: Recommendation[];
  plan: Recommendation[];
  score: TradingScore;
  profile: BehaviorProfile;
  lesson: WeeklyLesson;
  tips: string[];
}

const analysisCache = new WeakMap<EnrichedTrade[], Map<string, CoachAnalysis>>();

/** The coach's analysis of an account view (pure; memoised per `view.closed`, the events and the minute of `now`). */
export function analyse(view: AccountView, settings: Settings, events: BehaviorEvent[], days: DayNotes, now: number): CoachAnalysis {
  let m = analysisCache.get(view.closed);
  if (!m) analysisCache.set(view.closed, (m = new Map()));
  const key = `${events.length}:${Math.floor(now / 3_600_000)}:${settings.currency}`;
  const hit = m.get(key);
  if (hit) return hit;
  const cur = settings.currency;
  const edges = findEdges(view.closed, { settings, events });
  const recs = recommendations({ closed: view.closed, events, edges, list: view.list, currency: cur });
  const profile = behaviorProfile({ closed: view.closed, list: view.list, settings, events, edges, currency: cur });
  const a: CoachAnalysis = {
    events,
    edges,
    recs,
    plan: improvementPlan(recs),
    score: tradingScore({ view, settings, days, now }),
    profile,
    lesson: weeklyLesson({ closed: view.closed, events, edges, now, currency: cur }),
    tips: coachTips({ recs, profile }),
  };
  m.clear();
  m.set(key, a);
  return a;
}

/** Account view of the Hero's switch, settings, day notes, journal events, coach prefs. */
export function useCoachBase() {
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const enriched = useEnriched();
  const settings = useJournal((s) => s.settings);
  const days = useJournal((s) => s.days);
  const events = useMemo(() => eventsOf(enriched, settings, days), [enriched, settings, days]);
  const prefs: CoachPrefs = useMemo(() => coachPrefsOf(settings), [settings]);
  return { acc, view, enriched, settings, days, events, prefs, cur: settings.currency };
}

/** `Date.now()` that re-renders once per minute (state set from a timer, never per frame). */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      t = setTimeout(
        () => {
          setNow(Date.now());
          arm();
        },
        60_000 - (Date.now() % 60_000) + 50,
      );
    };
    arm();
    return () => clearTimeout(t);
  }, []);
  return now;
}

/** Base + analysis (`now` = the current hour, so the lesson and the 30-day discipline move with the clock). */
export function useCoach() {
  const base = useCoachBase();
  const now = useMinuteClock();
  const hour = Math.floor(now / 3_600_000);
  const analysis = useMemo(() => analyse(base.view, base.settings, base.events, base.days, hour * 3_600_000 + 1), [base.view, base.settings, base.events, base.days, hour]);
  return { ...base, ...analysis, now };
}

/** For tests / widgets: the account view without the store. */
export const viewOf = (enriched: EnrichedTrade[], settings: Settings, acc: "all" | "makro" | "scalp" = "all") => accountView(enriched, settings, acc);

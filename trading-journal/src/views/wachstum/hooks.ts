/**
 * Data hooks of the Wachstum page (P08). One preparation per journal change + hour (`prepare` of
 * `@/domain/growth`): the coach's behaviour events are the SAME memoised list the coach page uses (`eventsOf`), the
 * discipline days the Auswertung's. Psychology is about the person, so the page reads the whole journal (no account
 * switch); a goal narrows itself with its scope.
 */
import { useMemo } from "react";
import { challengeProgress, growthOf, goalProgress, habitGrid, activeHabits, milestones, nextMilestones, personalBests, prepare, prepareAt, progressSeries, rankGoals, skillProfile, streakBoard, suggestChallenges, weekSummary, type ChallengeProgress, type GoalProgress, type GrowthPrefs, type Prepared } from "@/domain/growth";
import { reviewed } from "@/domain/coach/recommendations";
import { checkinOf, diaryDays, hasCheckin, moodOf, psychFactors, psychTrackers, type CheckIn, type Level5 } from "@/domain/psych";
import type { DayNote, EnrichedTrade } from "@/domain/types";
import { tradeTime } from "@/lib/dates";
import { useEnriched, useJournal } from "@/store/journalStore";
import { eventsOf, useMinuteClock } from "@/views/coach/hooks";
import { addDays } from "@/domain/growth/habits";

const DAY = 86_400_000;
export const REVIEW_WINDOW_DAYS = 14;
export const DIARY_DAYS = 21;

/** The prepared journal (+ events, prefs) – recomputed on data changes and once an hour. */
export function useGrowthBase() {
  const enriched = useEnriched();
  const settings = useJournal((s) => s.settings);
  const days = useJournal((s) => s.days);
  const now = useMinuteClock();
  const hour = Math.floor(now / 3_600_000);
  const events = useMemo(() => eventsOf(enriched, settings, days), [enriched, settings, days]);
  const prefs: GrowthPrefs = useMemo(() => growthOf(settings), [settings]);
  // "now" = the end of the current hour: stable within the hour (no recompute per minute) and never before a trade or
  // event saved during it; the day key is today's until 23:59:59
  const p: Prepared = useMemo(() => prepare({ list: enriched, events, days, settings, now: (hour + 1) * 3_600_000 - 1 }), [enriched, events, days, settings, hour]);
  return { enriched, settings, days, events, prefs, p, now };
}

export type GrowthBase = ReturnType<typeof useGrowthBase>;

export interface TodayState {
  key: string;
  note: DayNote | undefined;
  checkin: CheckIn | null;
  mood: Level5 | null;
  /** closed trades of the last `REVIEW_WINDOW_DAYS` days without a review, newest first */
  unreviewed: EnrichedTrade[];
  /** the last 7 days (oldest first): mood + whether there was a check-in */
  week: { key: string; mood: Level5 | null; checked: boolean }[];
}

export function useToday(b: GrowthBase): TodayState {
  const { p, days } = b;
  return useMemo(() => {
    const note = days[p.todayKey];
    const since = p.now - REVIEW_WINDOW_DAYS * DAY;
    const unreviewed = p.closed.filter((t) => +tradeTime(t) >= since && !reviewed(t)).reverse();
    const week = Array.from({ length: 7 }, (_, i) => {
      const key = addDays(p.todayKey, i - 6);
      return { key, mood: moodOf(days[key]), checked: hasCheckin(days[key]) };
    });
    return { key: p.todayKey, note, checkin: checkinOf(note), mood: moodOf(note), unreviewed, week };
  }, [p, days]);
}

export function useGoals(b: GrowthBase): { active: GoalProgress[]; week: ReturnType<typeof weekSummary> } {
  const { p, prefs } = b;
  return useMemo(() => {
    const habits = prefs.habits;
    const active = rankGoals(prefs.goals.filter((g) => g.status === "active").map((g) => goalProgress(g, p, habits)));
    return { active, week: weekSummary(active, p.now) };
  }, [p, prefs]);
}

export function useChallenges(b: GrowthBase) {
  const { p, prefs } = b;
  return useMemo(() => {
    const progress = prefs.challenges
      .filter((c) => c.status === "active")
      .map((c) => challengeProgress(c, p))
      .filter((x): x is ChallengeProgress => x !== null);
    return progress;
  }, [p, prefs]);
}

export function useStreaks(b: GrowthBase) {
  return useMemo(() => streakBoard(b.p), [b.p]);
}

export function useTrackers(b: GrowthBase) {
  const { p } = b;
  return useMemo(() => psychTrackers({ events: p.events, closed: p.closed, days: p.days, now: p.now }), [p]);
}

export function useDeck(b: GrowthBase, trackers: ReturnType<typeof useTrackers>, checkinStreak: number) {
  const { prefs } = b;
  return useMemo(() => suggestChallenges(trackers, prefs.challenges.filter((c) => c.status === "active").map((c) => c.template), checkinStreak), [trackers, prefs, checkinStreak]);
}

export function useHabits(b: GrowthBase, weeks: number) {
  const { p, prefs } = b;
  return useMemo(() => habitGrid(activeHabits(prefs), p.days, p.todayKey, weeks), [p, prefs, weeks]);
}

export function useFactors(b: GrowthBase) {
  const { p, settings } = b;
  return useMemo(() => psychFactors({ days: p.days, closed: p.closed, currency: settings.currency }), [p, settings.currency]);
}

export function useDiary(b: GrowthBase) {
  const { p } = b;
  return useMemo(() => diaryDays({ days: p.days, list: p.sorted, events: p.events, fromKey: addDays(p.todayKey, -(DIARY_DAYS - 1)), toKey: p.todayKey }), [p]);
}

export function useSkills(b: GrowthBase) {
  const { p, enriched, events, days, settings } = b;
  return useMemo(() => {
    const now = skillProfile(p);
    const before = skillProfile(prepareAt({ list: enriched, events, days, settings, now: p.now }, p.now - 30 * DAY));
    return { now, before };
  }, [p, enriched, events, days, settings]);
}

export function useBests(b: GrowthBase, streaks: ReturnType<typeof useStreaks>) {
  const { p, prefs } = b;
  return useMemo(() => {
    const bests = personalBests(p, streaks);
    const ms = milestones(p, prefs, streaks);
    return { bests, milestones: ms, next: nextMilestones(ms) };
  }, [p, prefs, streaks]);
}

export function useSeries(b: GrowthBase) {
  const { p, prefs } = b;
  return useMemo(() => progressSeries(p, activeHabits(prefs), 12), [p, prefs]);
}

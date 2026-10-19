/**
 * Writes of the Wachstum page (P08) – always through the journal store (synced like every setting / day note), always
 * with an honest toast on failure. Check-ins go into the day journal (`saveDay`, merged over the stored entry; an entry
 * left without content is deleted), goals / challenges / habits into `settings.growth` (`withGrowthItem` /
 * `withGrowthPatch` – unknown keys kept, `merge3` merges devices per id).
 */
import { addGoalFromDraft, sameGoal, activeGoalsOf, withGrowthItem, withGrowthPatch, type Challenge, type Goal, type GoalDraft, type Habit } from "@/domain/growth";
import { checkinConfigOf, dayKeyIn, deviceTimeZone, effectiveTimeZone, withCheckinConfig, type ConfigPatch } from "@/domain/checkin";
import { checkinInput, checkinStatusOf, dailyCheckinInput, dayIsEmptyWithout, EMPTY_CHECKIN, habitInput, type CheckIn, type CheckinStatus, type Level5 } from "@/domain/psych";
import type { Settings, Trade, TradePsych } from "@/domain/types";
import { newId } from "@/lib/ids";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { DAILY } from "./checkinStrings";
import { WACHSTUM } from "./strings";

const fail = (title: string) => pushToast({ kind: "error", title, detail: "Bitte noch einmal versuchen." });

/** Today's key in the zone the trader configured for the check-in (the device's zone when none). */
export function checkinToday(now: number = Date.now()): string {
  return dayKeyIn(now, effectiveTimeZone(checkinConfigOf(useJournal.getState().settings), deviceTimeZone()));
}

/**
 * Saves (or clears) the check-in + mood of `day`. Resolves `true` on success. A save carries how the prompt ended
 * (`status`, default "done") and the bookkeeping of `dailyCheckinInput` (`firstAt`, `editedAt`, `late`). Clearing TODAY's
 * check-in writes "skipped" instead of removing it – the daily prompt must not come back for what the trader just cleared;
 * clearing an earlier day removes the entry (or just the check-in when the day has more).
 */
export async function saveCheckin(day: string, c: CheckIn, mood: Level5 | null, opts: { status?: CheckinStatus; clear?: boolean; now?: number } = {}): Promise<boolean> {
  const st = useJournal.getState();
  const now = opts.now ?? Date.now();
  const todayKey = checkinToday(now);
  const clear = opts.clear === true;
  try {
    if (clear && day !== todayKey) {
      if (dayIsEmptyWithout(st.days[day], ["checkin", "mood"])) {
        if (st.days[day]) await st.deleteDay(day);
      } else await st.saveDay(day, checkinInput({ ...EMPTY_CHECKIN, emotions: [], habits: {} }, null, now));
      return true;
    }
    const answers = clear ? { ...EMPTY_CHECKIN, emotions: [], habits: {} } : c;
    await st.saveDay(day, dailyCheckinInput(st.days[day], answers, clear ? null : mood, { now, day, todayKey, status: clear ? "skipped" : (opts.status ?? "done") }));
    return true;
  } catch {
    fail(WACHSTUM.checkin.failed);
    return false;
  }
}

/** "Heute überspringen": the day's outcome is written (and synced) – no other device asks again. Never over answers. */
export async function skipCheckin(day: string, now: number = Date.now()): Promise<boolean> {
  if (checkinStatusOf(useJournal.getState().days[day]) != null) return true;
  return saveCheckin(day, { ...EMPTY_CHECKIN, emotions: [], habits: {} }, null, { status: "skipped", now });
}

/** The check-in settings (`settings.checkin`) through the synced settings path. */
export async function saveCheckinConfig(patch: ConfigPatch): Promise<boolean> {
  try {
    await useJournal.getState().saveSettings(withCheckinConfig(useJournal.getState().settings, patch));
    return true;
  } catch {
    fail(DAILY.settings.failed);
    return false;
  }
}

/** Ticks / unticks a manual habit for `day` (kept inside the day's check-in). */
export async function setHabitDone(day: string, habitId: string, done: boolean): Promise<boolean> {
  const st = useJournal.getState();
  try {
    await st.saveDay(day, habitInput(st.days[day], habitId, done, Date.now()));
    return true;
  } catch {
    fail(WACHSTUM.habits.failed);
    return false;
  }
}

async function saveSettings(next: Settings, failTitle: string): Promise<boolean> {
  try {
    await useJournal.getState().saveSettings(next);
    return true;
  } catch {
    fail(failTitle);
    return false;
  }
}

/** A goal from the sheet (the Wave-0 path, de-duplicated). */
export async function addGoal(draft: GoalDraft): Promise<Goal | null> {
  const dup = activeGoalsOf(useJournal.getState().settings).find((g) => sameGoal(g, draft));
  if (dup) {
    pushToast({ kind: "info", title: WACHSTUM.goals.duplicate, detail: dup.title });
    return null;
  }
  const g = await addGoalFromDraft(draft);
  if (g) pushToast({ kind: "success", title: WACHSTUM.goals.saved, detail: g.title });
  else fail(WACHSTUM.goals.failed);
  return g;
}

export const patchGoal = (id: string, patch: Partial<Goal>): Promise<boolean> => saveSettings(withGrowthPatch(useJournal.getState().settings, "goals", id, patch as Record<string, unknown>), WACHSTUM.goals.failed);

/** Several status write-backs in ONE settings save (reached goals, ended challenges). */
export function patchMany(patches: readonly { key: "goals" | "challenges"; id: string; patch: Record<string, unknown> }[]): Promise<boolean> {
  let s = useJournal.getState().settings;
  for (const p of patches) s = withGrowthPatch(s, p.key, p.id, p.patch);
  return saveSettings(s, "Fortschritt nicht gespeichert");
}

export async function startChallenge(template: string, title: string, day: string): Promise<Challenge | null> {
  const c: Challenge = { id: newId("ch_"), template, title, start: day, createdAt: new Date().toISOString(), status: "active" };
  const ok = await saveSettings(withGrowthItem(useJournal.getState().settings, "challenges", c), "Challenge nicht gestartet");
  if (ok) pushToast({ kind: "success", title: WACHSTUM.challenges.started, detail: title });
  return ok ? c : null;
}

export const patchChallenge = (id: string, patch: Partial<Challenge>): Promise<boolean> => saveSettings(withGrowthPatch(useJournal.getState().settings, "challenges", id, patch as Record<string, unknown>), "Challenge nicht gespeichert");

export async function addHabit(title: string, auto?: Habit["auto"], id?: string): Promise<boolean> {
  const h: Habit = { id: id ?? newId("hb_"), title: title.trim().slice(0, 60), createdAt: new Date().toISOString(), ...(auto ? { auto } : {}) };
  if (!h.title) return false;
  // re-adding a hidden automatic habit (same id) shows it again – the merge would keep `archived: true` otherwise
  if (id) h.archived = false;
  const ok = await saveSettings(withGrowthItem(useJournal.getState().settings, "habits", h), WACHSTUM.habits.failed);
  if (ok) pushToast({ kind: "success", title: WACHSTUM.habits.saved, detail: h.title });
  return ok;
}

export const archiveHabit = (id: string, archived = true): Promise<boolean> => saveSettings(withGrowthPatch(useJournal.getState().settings, "habits", id, { archived }), WACHSTUM.habits.failed);

export interface ReviewInput {
  followedPlan: boolean | null;
  stress: number | null;
  exitReason: string;
  rating: number | null;
  postNote: string;
}

/** Writes the post-trade review into the stored trade (every other field – also unknown ones – kept). */
export async function saveReview(tradeId: string, r: ReviewInput): Promise<boolean> {
  const st = useJournal.getState();
  const t = st.trades.find((x) => x.id === tradeId);
  if (!t) return false;
  const psych: TradePsych = { ...(t.psych ?? {}) };
  if (r.stress != null) psych.stress = r.stress;
  if (r.exitReason.trim()) psych.exitReason = r.exitReason.trim().slice(0, 120);
  if (r.postNote.trim()) psych.postNote = r.postNote.trim();
  const next: Trade = { ...t, psych, updatedAt: new Date().toISOString() };
  if (r.followedPlan != null) next.followedPlan = r.followedPlan;
  if (r.rating != null) next.rating = r.rating as Trade["rating"];
  try {
    await st.saveTrade(next);
    return true;
  } catch {
    fail(WACHSTUM.review.failed);
    return false;
  }
}

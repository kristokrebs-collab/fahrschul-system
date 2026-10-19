/**
 * UI state of the Wachstum page (P08). In memory: which sheet is open, the post-trade review queue, the "Ziel
 * erreicht" wipe. Per device (`localStorage`, every access in try/catch via `@/store/storage` – a private window simply
 * starts empty):
 *   - `storageKey("growth-pretrade")`  today's ticks of the pre-trade checklist (a new day starts unticked);
 *   - `storageKey("growth-seen")`      the streaks / records / skill levels this device has already celebrated, so a
 *                                       celebration plays ONCE (first visit: initialised silently – history is not
 *                                       celebrated);
 *   - `storageKey("growth-review")`    `{ auto: false }` when the trader turned the automatic review prompt off.
 * Journal data (check-ins, goals, challenges, habits) lives in the synced journal, never here.
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import { readJsonDetailed, storageKey, writeJson } from "@/store/storage";

export const PRETRADE_KEY = storageKey("growth-pretrade");
export const SEEN_KEY = storageKey("growth-seen");
export const REVIEW_KEY = storageKey("growth-review");

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function numMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isObj(v)) for (const [k, x] of Object.entries(v)) if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
  return out;
}

export interface Seen {
  init: boolean;
  streaks: Record<string, number>;
  bests: Record<string, number>;
  skills: Record<string, number>;
}

function loadSeen(): Seen {
  const r = readJsonDetailed<unknown>(SEEN_KEY);
  if (r.status !== "ok" || !isObj(r.value)) return { init: false, streaks: {}, bests: {}, skills: {} };
  return { init: r.value.init === true, streaks: numMap(r.value.streaks), bests: numMap(r.value.bests), skills: numMap(r.value.skills) };
}

function loadPretrade(): { day: string; ticked: Record<string, boolean> } {
  const r = readJsonDetailed<unknown>(PRETRADE_KEY);
  if (r.status !== "ok" || !isObj(r.value) || typeof r.value.day !== "string") return { day: "", ticked: {} };
  const ticked: Record<string, boolean> = {};
  if (isObj(r.value.ticked)) for (const [k, v] of Object.entries(r.value.ticked)) if (v === true) ticked[k] = true;
  return { day: r.value.day, ticked };
}

function loadReviewAuto(): boolean {
  const r = readJsonDetailed<unknown>(REVIEW_KEY);
  return !(r.status === "ok" && isObj(r.value) && r.value.auto === false);
}

export interface WipeState {
  titles: string[];
  detail: string;
}

interface GrowthUi {
  checkinOpen: boolean;
  /** day the check-in sheet edits (`YYYY-MM-DD`) */
  checkinDay: string | null;
  /** the sheet was opened by the daily prompt (`DailyCheckinHost`): Später / Heute überspringen / Erledigt */
  checkinDaily: boolean;
  goalOpen: boolean;
  /** post-trade review: the trade on screen and the waiting ones (oldest first) */
  reviewId: string | null;
  queue: string[];
  /** trade ids the trader dismissed with "Später" this session */
  skipped: string[];
  reviewAuto: boolean;
  wipe: WipeState | null;
  pretrade: { day: string; ticked: Record<string, boolean> };
  seen: Seen;
  /** the last skill level-up this session (`n` replays the sweep) */
  levelUp: { n: number; label: string } | null;
  /** records that became new this session (TextScramble + burst once) */
  newBests: string[];

  openCheckin(day: string, daily?: boolean): void;
  closeCheckin(): void;
  openGoal(): void;
  closeGoal(): void;
  openReview(id: string): void;
  /** closes the review (`skip` = "Später": not asked again this session) and shows the next waiting one, if any */
  closeReview(skip?: boolean): void;
  enqueueReview(ids: readonly string[]): void;
  /** the next waiting review onto the screen (the host calls it once the editor / detail are closed) */
  nextReview(): string | null;
  setReviewAuto(on: boolean): void;
  showWipe(w: WipeState): void;
  closeWipe(): void;
  toggleTick(day: string, id: string): void;
  resetTicks(day: string): void;
  markSeen(patch: Partial<Omit<Seen, "init">>): void;
  noteLevelUp(label: string): void;
  noteNewBests(keys: readonly string[]): void;
}

export const useGrowthUi = create<GrowthUi>()((set, get) => ({
  checkinOpen: false,
  checkinDay: null,
  checkinDaily: false,
  goalOpen: false,
  reviewId: null,
  queue: [],
  skipped: [],
  reviewAuto: loadReviewAuto(),
  wipe: null,
  pretrade: loadPretrade(),
  seen: loadSeen(),
  levelUp: null,
  newBests: [],

  openCheckin: (day, daily = false) => set({ checkinOpen: true, checkinDay: day, checkinDaily: daily }),
  closeCheckin: () => set({ checkinOpen: false }),
  openGoal: () => set({ goalOpen: true }),
  closeGoal: () => set({ goalOpen: false }),
  openReview: (id) => set((s) => ({ reviewId: id, queue: s.queue.filter((q) => q !== id) })),
  closeReview: (skip = false) =>
    set((s) => ({ reviewId: null, skipped: skip && s.reviewId && !s.skipped.includes(s.reviewId) ? [...s.skipped, s.reviewId] : s.skipped })),
  enqueueReview: (ids) =>
    set((s) => {
      const add = ids.filter((id) => id !== s.reviewId && !s.queue.includes(id) && !s.skipped.includes(id));
      return add.length ? { queue: [...s.queue, ...add].slice(-10) } : s;
    }),
  nextReview: () => {
    const s = get();
    if (s.reviewId || !s.queue.length) return null;
    const [id, ...rest] = s.queue;
    set({ reviewId: id!, queue: rest });
    return id!;
  },
  setReviewAuto: (on) => {
    writeJson(REVIEW_KEY, { auto: on });
    set({ reviewAuto: on, queue: on ? get().queue : [] });
  },
  showWipe: (w) => set({ wipe: w }),
  closeWipe: () => set({ wipe: null }),
  toggleTick: (day, id) => {
    const cur = get().pretrade;
    const ticked = cur.day === day ? { ...cur.ticked } : {};
    if (ticked[id]) delete ticked[id];
    else ticked[id] = true;
    const pretrade = { day, ticked };
    writeJson(PRETRADE_KEY, pretrade);
    set({ pretrade });
  },
  resetTicks: (day) => {
    const pretrade = { day, ticked: {} };
    writeJson(PRETRADE_KEY, pretrade);
    set({ pretrade });
  },
  markSeen: (patch) => {
    const cur = get().seen;
    const seen: Seen = { init: true, streaks: { ...cur.streaks, ...patch.streaks }, bests: { ...cur.bests, ...patch.bests }, skills: { ...cur.skills, ...patch.skills } };
    writeJson(SEEN_KEY, seen);
    set({ seen });
  },
  noteLevelUp: (label) => set((s) => ({ levelUp: { n: (s.levelUp?.n ?? 0) + 1, label } })),
  noteNewBests: (keys) => set((s) => ({ newBests: [...new Set([...s.newBests, ...keys])] })),
}));

/**
 * One mounted instance per sheet kind: the page and the app host (P14) may both mount the review sheet – only the
 * first mounted instance renders it, the others render nothing (no two sheets on one state).
 */
const owners = create<{ by: Record<string, string[]> }>()(() => ({ by: {} }));
let ownerSeq = 0;
export function useSheetOwner(kind: string): boolean {
  const [id] = useState(() => `o${++ownerSeq}`);
  useEffect(() => {
    owners.setState((s) => ({ by: { ...s.by, [kind]: [...(s.by[kind] ?? []), id] } }));
    return () => owners.setState((s) => ({ by: { ...s.by, [kind]: (s.by[kind] ?? []).filter((x) => x !== id) } }));
  }, [kind, id]);
  return owners((s) => (s.by[kind] ?? [])[0] === id);
}

/** Ticks of today's checklist (a stored day other than today reads as nothing ticked). */
export const ticksFor = (pretrade: { day: string; ticked: Record<string, boolean> }, day: string): Record<string, boolean> => (pretrade.day === day ? pretrade.ticked : {});

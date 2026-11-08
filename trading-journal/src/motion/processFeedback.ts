/**
 * Process feedback (Paket P, docs/PSYCHOLOGIE.md): the ONE place that pays off a finished piece of discipline – a quiet toast
 * island with its small puff (visual channel) plus, only when the person switched them on, a short vibration and a soft tone
 * (second channel; both default OFF, Einstellungen › Darstellung › Bewegung).
 *
 * It rewards PROCESS and nothing else. The event list below is closed on purpose: a finished weekly review, a complete checklist,
 * a closed day whose checklist and review were done (Paket F2), a backup that was written, a verified connection, a finished setup wizard. There is no event for a profit, a saved or closed trade
 * or a loss – and a guard test (`tests/unit/psych.guard.test.ts`) fails when this file is called from anywhere near them.
 * `processDone` ignores anything outside the list (a typed call cannot name another one; an untyped one is dropped).
 *
 * Reduced motion: the island shows without its puff (the `Celebrate` overlay shows a single fading ring instead of dots) and no
 * vibration is sent. The tone (a 90 ms sine at a low gain) is not motion – it plays whenever the person switched it on.
 */
import { create } from "zustand";
import { motionReduced, motionMode } from "@/motion/profile";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { pushToast } from "@/store/uiStore";

export const PROCESS_EVENTS = {
  weekReview: { title: "Wochenrückblick abgeschlossen", detail: "Du hast die Woche eingeordnet." },
  checklist: { title: "Checkliste vollständig", detail: "Alle Punkte für heute sind abgehakt." },
  // Paket F2 "Heute abschließen": only when the day's process items were all done at the moment of closing (`dayCloseReady`)
  dayClose: { title: "Tag abgeschlossen", detail: "Checkliste und Review für heute sind erledigt." },
  backup: { title: "Backup erstellt", detail: "Deine Daten liegen als Datei bei dir." },
  connection: { title: "Verbindung geprüft", detail: "Nur lesend – du kannst sie jederzeit trennen." },
  wizard: { title: "Einrichtung abgeschlossen", detail: "Alle Schritte sind erledigt." },
} as const;

export type ProcessEvent = keyof typeof PROCESS_EVENTS;
export const PROCESS_EVENT_IDS = Object.keys(PROCESS_EVENTS) as ProcessEvent[];

/* ------------------------------------------------------------------ the two optional channels */

export const FEEDBACK_KEY: string = storageKey("feedback");
export const FEEDBACK_VERSION = 1;

export interface FeedbackPref {
  /** soft tone after a process success – default OFF */
  sound: boolean;
  /** short vibration after a process success – default OFF */
  haptic: boolean;
}

export const FEEDBACK_DEFAULT: Readonly<FeedbackPref> = Object.freeze({ sound: false, haptic: false });

export const FEEDBACK_STRINGS = {
  title: "Rückmeldung bei geschafften Schritten",
  lead: "Nur wenn du etwas Wichtiges abgeschlossen hast – Rückblick, Checkliste, Backup, Verbindung, Einrichtung. Nie bei Gewinn, Verlust oder einem Trade.",
  haptic: "Vibration",
  sound: "Leiser Ton",
  off: "Aus – das ist die Voreinstellung.",
} as const;

/** Pure: the stored value → a preference (anything unknown is OFF). */
export function parseFeedback(raw: unknown): FeedbackPref {
  if (!raw || typeof raw !== "object") return { ...FEEDBACK_DEFAULT };
  const o = raw as { v?: unknown; sound?: unknown; haptic?: unknown };
  if (o.v !== FEEDBACK_VERSION) return { ...FEEDBACK_DEFAULT };
  return { sound: o.sound === true, haptic: o.haptic === true };
}

interface FeedbackState extends FeedbackPref {
  set(patch: Partial<FeedbackPref>): void;
}

export const useFeedbackPref = create<FeedbackState>()((set, get) => ({
  ...parseFeedback(readJson<unknown>(FEEDBACK_KEY, null)),
  set: (patch) => {
    const next: FeedbackPref = { sound: patch.sound ?? get().sound, haptic: patch.haptic ?? get().haptic };
    writeJson(FEEDBACK_KEY, { v: FEEDBACK_VERSION, ...next });
    set(next);
  },
}));

/** One soft sine blip (WebAudio, created on demand and closed again). Silent where the browser has none. */
function blip(): void {
  try {
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
    osc.onended = () => void ctx.close().catch(() => undefined);
  } catch {
    // no audio: the visual channel is enough
  }
}

/** Test seam: the two device channels (vibration, tone) – replaced in tests, real otherwise. */
export const channels = {
  vibrate: (ms: number): void => {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(ms);
    } catch {
      // not supported
    }
  },
  tone: blip,
};

/**
 * A process step was completed: one quiet toast (the island's small puff is its visual), plus vibration (not under reduced motion) and tone ONLY when the
 * person enabled them. Returns `false` for anything outside `PROCESS_EVENTS`.
 */
export function processDone(event: ProcessEvent, detail?: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(PROCESS_EVENTS, event)) return false;
  const e = PROCESS_EVENTS[event];
  pushToast({ kind: "success", title: e.title, detail: detail ?? e.detail, milestone: true });
  const reduced = motionReduced(motionMode(), typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const pref = useFeedbackPref.getState();
  if (pref.haptic && !reduced) channels.vibrate(18);
  // a tone is not motion: it plays when the person switched it on, also under reduced motion
  if (pref.sound) channels.tone();
  return true;
}

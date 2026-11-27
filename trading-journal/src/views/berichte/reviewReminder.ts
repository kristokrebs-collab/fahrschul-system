/**
 * The optional reminder for the weekly review (Paket P, docs/PSYCHOLOGIE.md) – the only "come back" nudge the journal has, and it is
 * the person's own choice:
 *
 *  - OFF by default (`REMINDER_DEFAULT.on === false`); nothing is stored until it is switched on;
 *  - in-app only: a quiet toast the next time the app is open at or after the chosen weekday and hour – no push, no e-mail, no
 *    message about prices or results;
 *  - at most ONE reminder per week (`lastKey`), none in the quiet hours, none when the week had no closed trade or the review is
 *    already closed;
 *  - the text is a fact: "Dein Rückblick für KW 45 ist bereit." – no "nur noch", no countdown, no streak warning.
 *
 * Per device (`storageKey("review-reminder")`, every access guarded by `@/store/storage`). Pure decision first, store second.
 */
import { create } from "zustand";
import { periodOf, shiftPeriod, type ReportPeriod } from "@/domain/reports";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const REMINDER_KEY: string = storageKey("review-reminder");
export const REMINDER_VERSION = 1;

/** Weekdays offered (JS `getDay()`: 0 = Sonntag). Monday reminds of the week that just ended, the others of the running one. */
export const REMINDER_DAYS = [
  { v: 5, label: "Freitag" },
  { v: 6, label: "Samstag" },
  { v: 0, label: "Sonntag" },
  { v: 1, label: "Montag" },
] as const;

export interface ReminderPref {
  on: boolean;
  /** weekday, `getDay()` */
  day: number;
  /** hour of the day (0–23) from which the reminder may appear */
  hour: number;
  /** quiet hours: no reminder from `quietFrom` (incl.) to `quietTo` (excl.); equal values = no quiet hours */
  quietFrom: number;
  quietTo: number;
  /** week key the last reminder was shown for (the frequency limit: once per week) */
  lastKey: string;
}

export const REMINDER_DEFAULT: Readonly<ReminderPref> = Object.freeze({ on: false, day: 0, hour: 18, quietFrom: 22, quietTo: 8, lastKey: "" });

const hourOf = (v: unknown, fb: number): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23 ? v : fb);

/** Pure: the stored value → a preference (anything unknown reads as the defaults, i.e. OFF). */
export function parseReminder(raw: unknown): ReminderPref {
  if (!raw || typeof raw !== "object") return { ...REMINDER_DEFAULT };
  const o = raw as Record<string, unknown>;
  if (o.v !== REMINDER_VERSION) return { ...REMINDER_DEFAULT };
  const day = REMINDER_DAYS.some((d) => d.v === o.day) ? (o.day as number) : REMINDER_DEFAULT.day;
  return {
    on: o.on === true,
    day,
    hour: hourOf(o.hour, REMINDER_DEFAULT.hour),
    quietFrom: hourOf(o.quietFrom, REMINDER_DEFAULT.quietFrom),
    quietTo: hourOf(o.quietTo, REMINDER_DEFAULT.quietTo),
    lastKey: typeof o.lastKey === "string" && o.lastKey.length <= 16 ? o.lastKey : "",
  };
}

/** Pure: is `hour` inside the quiet hours (wrapping over midnight when `from > to`)? */
export function inQuietHours(hour: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Pure: the week this reminder is about (Monday: the one that just ended) and the moment from which it may show (local time). */
export function reminderTarget(pref: Pick<ReminderPref, "day" | "hour">, now: number): { period: ReportPeriod; due: number } {
  const running = periodOf("week", now);
  const period = pref.day === 1 ? shiftPeriod(running, -1) : running;
  // `running.from` is Monday 00:00 local; the weekday offset counts from Monday (Sunday = 6)
  const offset = (pref.day + 6) % 7;
  const due = new Date(running.from);
  due.setDate(due.getDate() + offset);
  due.setHours(pref.hour, 0, 0, 0);
  return { period, due: due.getTime() };
}

export type ReminderVerdict = "show" | "off" | "early" | "quiet" | "already" | "closed" | "empty";

export interface ReminderInput {
  pref: ReminderPref;
  now: number;
  /** closed trades the target week has (the reminder never nags about an empty week) */
  tradesInWeek: (period: ReportPeriod) => number;
  /** did the trader close the review of this week key? */
  closed: (key: string) => boolean;
}

/** Pure: show the reminder now? (`show` only when every condition holds; the other values say which one did not). */
export function reminderDecision(i: ReminderInput): { verdict: ReminderVerdict; period: ReportPeriod } {
  const { period, due } = reminderTarget(i.pref, i.now);
  const v = (verdict: ReminderVerdict) => ({ verdict, period });
  if (!i.pref.on) return v("off");
  if (i.now < due) return v("early");
  if (inQuietHours(new Date(i.now).getHours(), i.pref.quietFrom, i.pref.quietTo)) return v("quiet");
  if (i.pref.lastKey === period.key) return v("already");
  if (i.closed(period.key)) return v("closed");
  if (i.tradesInWeek(period) < 1) return v("empty");
  return v("show");
}

/** The words of the reminder – facts only. */
export const REMINDER_STRINGS = {
  title: "Erinnerung an den Wochenrückblick",
  lead: "Aus – bis du sie einschaltest. Sie erscheint nur in der App, höchstens einmal pro Woche, nicht in deinen Ruhezeiten.",
  on: "Erinnern",
  day: "Wochentag",
  hour: "Ab Uhrzeit",
  quiet: "Ruhezeit",
  quietFrom: "von",
  quietTo: "bis",
  note: "Gilt nur für dieses Gerät. Es gibt keine Push-Nachrichten und keine Hinweise zu Kursen oder Ergebnissen.",
  toast: (kw: string) => `Dein Rückblick für ${kw} ist bereit`,
  toastDetail: "Wenn du magst – ein paar Minuten reichen.",
  open: "Ansehen",
} as const;

interface ReminderState extends ReminderPref {
  set(patch: Partial<ReminderPref>): void;
}

export const useReminderPref = create<ReminderState>()((set, get) => ({
  ...parseReminder(readJson<unknown>(REMINDER_KEY, null)),
  set: (patch) => {
    const cur = get();
    const next = parseReminder({ v: REMINDER_VERSION, on: patch.on ?? cur.on, day: patch.day ?? cur.day, hour: patch.hour ?? cur.hour, quietFrom: patch.quietFrom ?? cur.quietFrom, quietTo: patch.quietTo ?? cur.quietTo, lastKey: patch.lastKey ?? cur.lastKey });
    writeJson(REMINDER_KEY, { v: REMINDER_VERSION, ...next });
    set(next);
  },
}));

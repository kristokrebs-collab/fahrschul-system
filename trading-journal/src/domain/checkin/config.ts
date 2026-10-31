/**
 * `settings.checkin` (F61) – how the daily check-in behaves, a passthrough settings key synced like every setting:
 *
 *   settings.checkin = { v: 1, prompt: true, timeZone: "Europe/Berlin" | null, reminder: "07:30" | null,
 *                        fields: { stress: true, focus: false, … }, custom: [{ id, label, max, minLabel?, maxLabel?, on }] }
 *
 * `fields` merges per key and `custom` (an array of objects with an `id`) per id in the three-way settings merge, so two
 * devices that changed different things both keep their change. A key that is missing reads as its default; older
 * journals have no `checkin` key at all and behave as before. Pure.
 */
import type { Settings } from "../types";
import { isValidTimeZone, deviceTimeZone, parseClock } from "./day";

export const CHECKIN_CONFIG_VERSION = 1;

export const CHECKIN_FIELD_IDS = ["mood", "sleep", "sleepQuality", "stress", "focus", "energy", "availableTime", "session", "dayRisk", "comment", "emotions", "habits"] as const;
export type CheckinFieldId = (typeof CHECKIN_FIELD_IDS)[number];

/** German names of the fields (the settings list and the evaluation use them). */
export const CHECKIN_FIELD_LABEL: Readonly<Record<CheckinFieldId, string>> = {
  mood: "Stimmung",
  sleep: "Schlafdauer",
  sleepQuality: "Schlafqualität",
  stress: "Stress",
  focus: "Konzentration",
  energy: "Energie",
  availableTime: "Verfügbare Zeit",
  session: "Geplante Session",
  dayRisk: "Tagesrisiko",
  comment: "Kommentar",
  emotions: "Gefühle des Moments",
  habits: "Gewohnheiten",
};

/** What a new journal asks: the original check-in plus Konzentration. The rest is one switch away – nothing unnecessary. */
export const DEFAULT_CHECKIN_FIELDS: Readonly<Record<CheckinFieldId, boolean>> = Object.freeze({
  mood: true,
  sleep: true,
  sleepQuality: false,
  stress: true,
  focus: true,
  energy: true,
  availableTime: false,
  session: false,
  dayRisk: false,
  comment: false,
  emotions: true,
  habits: true,
});

/** The trader's own question with a 1…`max` scale. */
export interface CustomQuestion {
  id: string;
  label: string;
  /** scale 1 … max (3–10) */
  max: number;
  minLabel?: string;
  maxLabel?: string;
  /** asked in the check-in (false = kept, answers stay) */
  on: boolean;
}

export const CUSTOM_MAX = 5;
export const CUSTOM_LABEL_MAX = 60;

export interface CheckinConfig {
  v: number;
  /** ask once per day at the first open of the app */
  prompt: boolean;
  /** IANA zone the "day" is counted in; `null` = this device's zone */
  timeZone: string | null;
  /** `HH:mm` in that zone: "Später" asks again then (else after two hours); `null` = none */
  reminder: string | null;
  fields: Record<CheckinFieldId, boolean>;
  custom: CustomQuestion[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function questionOf(raw: unknown): CustomQuestion | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !raw.id || typeof raw.label !== "string" || !raw.label.trim()) return null;
  const max = typeof raw.max === "number" && Number.isInteger(raw.max) && raw.max >= 3 && raw.max <= 10 ? raw.max : 5;
  const q: CustomQuestion = { ...(raw as object), id: raw.id, label: raw.label.trim().slice(0, CUSTOM_LABEL_MAX), max, on: raw.on !== false };
  if (typeof raw.minLabel === "string" && raw.minLabel.trim()) q.minLabel = raw.minLabel.trim().slice(0, 24);
  else delete q.minLabel;
  if (typeof raw.maxLabel === "string" && raw.maxLabel.trim()) q.maxLabel = raw.maxLabel.trim().slice(0, 24);
  else delete q.maxLabel;
  return q;
}

/** The sanitised config of a settings object: a missing or broken key reads as the defaults. */
export function checkinConfigOf(settings: object): CheckinConfig {
  const raw = (settings as { checkin?: unknown }).checkin;
  const o = isObj(raw) ? raw : {};
  const fields = { ...DEFAULT_CHECKIN_FIELDS };
  if (isObj(o.fields)) for (const id of CHECKIN_FIELD_IDS) if (typeof o.fields[id] === "boolean") fields[id] = o.fields[id];
  const custom: CustomQuestion[] = [];
  if (Array.isArray(o.custom)) for (const x of o.custom) {
    const q = questionOf(x);
    if (q && !custom.some((c) => c.id === q.id)) custom.push(q);
  }
  return {
    v: typeof o.v === "number" ? o.v : CHECKIN_CONFIG_VERSION,
    prompt: o.prompt !== false,
    timeZone: isValidTimeZone(o.timeZone) ? o.timeZone : null,
    reminder: parseClock(o.reminder) != null ? (o.reminder as string) : null,
    fields,
    custom: custom.slice(0, CUSTOM_MAX),
  };
}

/** The zone the days are counted in: the configured one, else the device's. */
export function effectiveTimeZone(cfg: Pick<CheckinConfig, "timeZone">, device: string = deviceTimeZone()): string {
  return cfg.timeZone ?? device;
}

/** The questions the check-in asks now. */
export const activeQuestions = (cfg: Pick<CheckinConfig, "custom">): CustomQuestion[] => cfg.custom.filter((q) => q.on);

export interface ConfigPatch {
  prompt?: boolean;
  timeZone?: string | null;
  reminder?: string | null;
  fields?: Partial<Record<CheckinFieldId, boolean>>;
  /** replaces the whole question list (callers build it with `withQuestion` / `withoutQuestion`) */
  custom?: CustomQuestion[];
}

/**
 * A NEW settings object with the patch applied; every other key – and unknown keys inside `checkin` – stays. Only what is
 * given is written, so a switch changed on one device never rewrites the others' choices.
 */
export function withCheckinConfig(settings: Settings, patch: ConfigPatch): Settings {
  const s = settings as Settings & { checkin?: unknown };
  const cur = isObj(s.checkin) ? s.checkin : {};
  const next: Record<string, unknown> = { ...cur, v: CHECKIN_CONFIG_VERSION };
  if (patch.prompt !== undefined) next.prompt = patch.prompt;
  if (patch.timeZone !== undefined) next.timeZone = patch.timeZone;
  if (patch.reminder !== undefined) next.reminder = patch.reminder;
  if (patch.fields) next.fields = { ...(isObj(cur.fields) ? cur.fields : {}), ...patch.fields };
  if (patch.custom) next.custom = patch.custom.map((q) => ({ ...q }));
  return { ...s, checkin: next } as Settings;
}

/** A new question (scale 1 … `max`), or the list unchanged when the label is empty / the limit is reached. */
export function withQuestion(list: readonly CustomQuestion[], q: { id: string; label: string; max?: number; minLabel?: string; maxLabel?: string }): CustomQuestion[] {
  const label = q.label.trim();
  if (!label || list.length >= CUSTOM_MAX || list.some((x) => x.id === q.id)) return [...list];
  const next = questionOf({ ...q, label, on: true });
  return next ? [...list, next] : [...list];
}

export const withoutQuestion = (list: readonly CustomQuestion[], id: string): CustomQuestion[] => list.filter((q) => q.id !== id);
export const setQuestionOn = (list: readonly CustomQuestion[], id: string, on: boolean): CustomQuestion[] => list.map((q) => (q.id === id ? { ...q, on } : q));

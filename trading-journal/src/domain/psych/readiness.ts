/**
 * Pre-trade readiness (P08): "Bereit" or "Pause" from what is already known – today's check-in (stress, energy,
 * sleep, mood, words), the trader's own checklist (the Grundregeln, else `DEFAULT_PRE_TRADE`), the live risk limits
 * and the pause of the P05 guard (`LimitReport` incl. `cooldown`, the override of "Limit überschreiben") and the
 * coach's behaviour events of today (P04). Nothing is re-derived here and nothing blocks: the result is advice.
 * Pure – `now` injected.
 */
import type { BehaviorEvent } from "../coach/events";
import type { Cooldown, LimitKey, LimitRow, LimitState } from "../risk/limits";
import { localDateKey } from "@/lib/dates";
import { emotionTone, STRESS_LABELS, type CheckIn, type Level5 } from "./checkin";

export type ReadinessState = "ready" | "caution" | "pause";
export type ReasonTone = "ok" | "warn" | "stop";

export interface ReadinessReason {
  key: string;
  tone: ReasonTone;
  text: string;
}

export interface Readiness {
  state: ReadinessState;
  /** 0–100 */
  score: number;
  /** stop first, then warn, then ok */
  reasons: ReadinessReason[];
  /** a running pause (P05 cooldown) ends at … (epoch ms) */
  pauseUntil: number | null;
  checked: number;
  total: number;
}

export interface ChecklistPoint {
  id: string;
  text: string;
}

/** Used when the trader has no Grundregeln of their own. */
export const DEFAULT_PRE_TRADE: readonly ChecklistPoint[] = [
  { id: "pt_setup", text: "Das Setup steht in meinem Plan" },
  { id: "pt_stop", text: "Stop und Ziel stehen vor dem Einstieg" },
  { id: "pt_size", text: "Größe nach Risiko berechnet" },
  { id: "pt_chase", text: "Ich jage keinem Kurs hinterher" },
];
export const CHECKLIST_MAX = 6;

export interface ReadinessInput {
  checkin: CheckIn | null;
  mood: Level5 | null;
  checklist: readonly ChecklistPoint[];
  ticked: Readonly<Record<string, boolean>>;
  /** P05 live limits (null without capital) */
  limits: { rows: readonly Pick<LimitRow, "key" | "state" | "label" | "detail">[]; cooldown: Cooldown | null; worst: LimitState } | null;
  /** "Limit überschreiben" active until (epoch ms) */
  overrideUntil?: number | null;
  events: readonly BehaviorEvent[];
  now: number;
}

const HARD: ReadonlySet<LimitKey> = new Set(["day", "trades", "week", "drawdown"]);
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

/** The trader's checklist: their Grundregeln (≤ `CHECKLIST_MAX`), else the defaults. */
export function preTradeChecklist(rules: readonly { id: string; text: string }[] | undefined): ChecklistPoint[] {
  const own = (rules ?? []).filter((r) => r && typeof r.id === "string" && typeof r.text === "string" && r.text.trim()).slice(0, CHECKLIST_MAX);
  return own.length ? own.map((r) => ({ id: r.id, text: r.text.trim() })) : [...DEFAULT_PRE_TRADE];
}

export function readiness(input: ReadinessInput): Readiness {
  const { checkin: c, mood, checklist, ticked, limits, events, now } = input;
  const reasons: ReadinessReason[] = [];
  const add = (key: string, tone: ReasonTone, text: string) => reasons.push({ key, tone, text });
  const overridden = input.overrideUntil != null && input.overrideUntil > now;
  let pauseUntil: number | null = null;

  // P05: the pause and the limits
  const cd = limits?.cooldown && limits.cooldown.endsAt > now ? limits.cooldown : null;
  if (cd && !overridden) {
    pauseUntil = cd.endsAt;
    add("cooldown", "stop", cd.reason === "day" ? "Tageslimit erreicht – Pause bis Mitternacht." : `${cd.losses} Verluste in Folge – Pause bis ${hhmm(cd.endsAt)} Uhr.`);
  } else if (cd && overridden) add("override", "warn", "Pause überschrieben – bewusst klein bleiben.");
  for (const r of limits?.rows ?? []) {
    if (r.state === "breach" && !(cd && r.key === "day")) add(`limit-${r.key}`, HARD.has(r.key) && !overridden ? "stop" : "warn", `${r.label}: Grenze erreicht.`);
    else if (r.state === "warn") add(`limit-${r.key}`, "warn", `${r.label}: nah an der Grenze.`);
  }
  if (limits && limits.worst === "ok" && !cd) add("limits", "ok", "Limits im grünen Bereich.");

  // P04: patterns of today
  const today = localDateKey(new Date(now));
  const todays = events.filter((e) => localDateKey(new Date(e.at)) === today);
  const hot = todays.filter((e) => (e.key === "revenge" || e.key === "tilt") && e.severity >= 2);
  if (hot.length) add("tilt", "stop", "Heute schon Revenge- oder Tilt-Muster – erst Abstand gewinnen.");
  else if (todays.some((e) => e.key === "revenge" || e.key === "tilt")) add("tilt", "warn", "Heute ein Verlust-Muster erkannt – ruhig bleiben.");
  if (todays.some((e) => e.key === "overtrading")) add("overtrading", "warn", "Heute schon viele Trades – Qualität vor Menge.");

  // the check-in
  if (!c && mood == null) add("checkin", "warn", "Noch kein Check-in heute.");
  if (c?.stress === 5) add("stress", "stop", `Stress „${STRESS_LABELS[4]}“ – heute lieber zuschauen.`);
  else if (c?.stress === 4) add("stress", "warn", `Stress „${STRESS_LABELS[3]}“ – Größe reduzieren.`);
  if (c?.energy != null && c.energy <= 1) add("energy", "warn", "Kaum Energie – keine spontanen Trades.");
  if (c?.sleep != null && c.sleep < 5) add("sleep", "warn", `Nur ${String(c.sleep).replace(".", ",")} h Schlaf.`);
  if (mood != null && mood <= 1) add("mood", "warn", "Stimmung sehr schlecht – nur A-Setups.");
  const neg = (c?.emotions ?? []).filter((w) => emotionTone(w) === "neg");
  if (neg.length) add("words", "warn", `„${neg[0]}“ im Check-in – bewusst langsam.`);
  if (c && (c.stress ?? 3) <= 3 && (c.energy ?? 3) >= 3 && (c.sleep ?? 7) >= 6 && !neg.length) add("checkin-ok", "ok", "Check-in: klar im Kopf.");

  // the checklist
  const total = checklist.length;
  const checked = checklist.filter((p) => ticked[p.id]).length;
  if (total && checked < total) add("checklist", "warn", `${total - checked} von ${total} Punkten offen.`);
  else if (total) add("checklist", "ok", "Checkliste komplett.");

  const stops = reasons.filter((r) => r.tone === "stop").length;
  const warns = reasons.filter((r) => r.tone === "warn").length;
  const state: ReadinessState = stops ? "pause" : warns ? "caution" : "ready";
  const score = Math.max(0, Math.min(100, Math.round(100 - stops * 40 - warns * 12 - (total ? ((total - checked) / total) * 10 : 0))));
  const rank: Record<ReasonTone, number> = { stop: 0, warn: 1, ok: 2 };
  reasons.sort((a, b) => rank[a.tone] - rank[b.tone]);
  return { state, score: state === "ready" ? Math.max(score, 80) : state === "pause" ? Math.min(score, 39) : Math.min(Math.max(score, 40), 79), reasons, pauseUntil, checked, total };
}

export const READINESS_LABEL: Readonly<Record<ReadinessState, string>> = { ready: "Bereit", caution: "Noch nicht bereit", pause: "Pause" };

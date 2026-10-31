/**
 * "Plan → 3 Alarme" (nach dem Skill trader-alerts: Stop, Ziel und "flat by close"), erst nach ausdrücklichem Klick:
 *  - Stop und Ziel werden zwei Schlüsselmarken der App (`settings.keyLevels`, Regel "Berührung" auf 30-Minuten-Kerzen, nur
 *    Vorbereitung und Bestätigung): sie laufen im vorhandenen Alarm-System – Zustellprotokoll, aktive Zeiten, Kanäle. Die Rolle
 *    ist "Info": sie erscheinen nicht im Tagesplan und lösen dort nichts aus.
 *  - "Flat by" ist eine Uhrzeit, kein Preis; das Marken-Modell kennt nur Preise. Darum ist es eine Erinnerung zur Uhrzeit, die
 *    über denselben Toast-/Systemkanal und dasselbe Zustellprotokoll läuft (`src/market/plan/clock.ts`).
 * Alle drei laufen nur, solange die App offen ist (kein Server-Alarm), und nur für das Symbol des Live-Markts.
 * Ein Alarm ist eine Nachricht, nie eine Order.
 */
import { blankKeyLevel, type KeyLevel } from "../keylevels";
import { dayLabelIn, clockIn, HOUR } from "./time";
import { priceText } from "./format";
import type { SavedPlan } from "./config";

/** Alarms use the shortest timeframe the key levels offer, so a touch is seen within the half hour. */
export const ALARM_TF = "30m" as const;
/** A clock reminder that is found this long after its time is not announced any more (the app was closed). */
export const FLAT_BY_STALE_MS = 12 * HOUR;

const sideWord = (p: Pick<SavedPlan, "side">): string => (p.side === "long" ? "Long" : "Short");

/** The two key levels of a plan: the stop and the target (ids chosen by the caller). */
export function planAlarmLevels(p: SavedPlan, ids: { stop: string; target: string; trigger?: string }, tick: number, now: number): { stop: KeyLevel; target: KeyLevel; trigger?: KeyLevel } {
  const long = p.side === "long";
  const when = `${dayLabelIn(p.signalAt ?? p.savedAt, p.tz)} ${clockIn(p.signalAt ?? p.savedAt, p.tz)}`;
  const note = (what: string): string => `${what} aus dem Handelsplan (${sideWord(p)} ${p.symbol} vom ${when}, Einstieg ${priceText(p.entry, tick)}). Läuft nur bei geöffneter App; eine Nachricht, keine Order.`;
  const alerts = { on: true, prepare: true, confirm: true, retest: false, invalid: false, recurring: false };
  const stop = blankKeyLevel({ id: ids.stop, symbol: p.symbol, price: p.stop }, now);
  const level: KeyLevel = {
    ...stop,
    name: `Plan-Stop ${p.symbol}`,
    tf: ALARM_TF,
    direction: long ? "below" : "above",
    kind: "touch",
    role: "info",
    alerts,
    note: note("Stop"),
  };
  const target: KeyLevel = {
    ...blankKeyLevel({ id: ids.target, symbol: p.symbol, price: p.target ?? p.entry }, now),
    name: `Plan-Ziel ${p.symbol}`,
    tf: ALARM_TF,
    direction: long ? "above" : "below",
    kind: "touch",
    role: "info",
    alerts,
    note: note("Ziel"),
  };
  // F65: the price at which the planned management starts (stop to break-even, partial target, trailing) – a reminder to act
  const trigger: KeyLevel | undefined =
    ids.trigger && p.manageTrigger != null
      ? {
          ...blankKeyLevel({ id: ids.trigger, symbol: p.symbol, price: p.manageTrigger }, now),
          name: `Plan-Verwaltung ${p.symbol}`,
          tf: ALARM_TF,
          direction: long ? "above" : "below",
          kind: "touch",
          role: "info",
          alerts,
          note: note("Auslöser der Verwaltung (Stop nachziehen oder Teilziel nehmen, wie im Plan beschrieben)"),
        }
      : undefined;
  return { stop: level, target, ...(trigger ? { trigger } : {}) };
}

export interface DueFlatBy {
  plan: SavedPlan;
  /** minutes past the set time */
  lateMin: number;
  /** too old to announce: mark it missed without a message */
  stale: boolean;
}

/** The clock reminders that are due at `now` (pending, time reached). */
export function dueFlatBy(plans: readonly SavedPlan[], now: number): DueFlatBy[] {
  const out: DueFlatBy[] = [];
  for (const plan of plans) {
    const f = plan.alarms?.flatBy;
    if (!f || f.state !== "pending" || f.at > now) continue;
    out.push({ plan, lateMin: Math.floor((now - f.at) / 60_000), stale: now - f.at > FLAT_BY_STALE_MS });
  }
  return out.sort((a, b) => a.plan.alarms!.flatBy!.at - b.plan.alarms!.flatBy!.at);
}

/** The next pending reminder after `now` (ms), `null` when there is none. */
export function nextFlatBy(plans: readonly SavedPlan[], now: number): number | null {
  let best: number | null = null;
  for (const plan of plans) {
    const f = plan.alarms?.flatBy;
    if (f && f.state === "pending" && f.at > now && (best == null || f.at < best)) best = f.at;
  }
  return best;
}

/** Title and detail of the reminder. */
export function flatByMessage(p: SavedPlan, lateMin: number): { title: string; detail: string } {
  const at = p.alarms?.flatBy?.at ?? p.flatByMs ?? 0;
  const late = lateMin >= 2 ? ` (fällig war ${clockIn(at, p.tz)} Uhr, ${lateMin} Minuten her)` : "";
  return {
    title: `Flat by close: ${p.symbol}`,
    detail: `Es ist ${clockIn(at, p.tz)} Uhr${late}. Wenn dein ${sideWord(p)}-Trade noch offen ist, schließ ihn. Das ist eine Erinnerung – die App tut nichts für dich.`,
  };
}

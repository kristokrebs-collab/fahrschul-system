/**
 * Der Alarm der Demo (F58): du setzt eine Marke (Preis, Richtung, Auslöse-Regel), und die Demo spielt die Beispiel-Kerzen mit den
 * ECHTEN Funktionen der Schlüsselmarken ab – `evaluateLevel` (Stand der Marke), `observe` / `stepStages` (welche Stufe wann
 * feuert, jede Stufe einmal) und `stageMessage` (der Text der Meldung). Zu jeder Kerze sieht die Auswertung nur die Kerzen bis dahin.
 * Gezeigt wird, was die Marke täte; angelegt wird nichts – kein Eintrag in `settings.keyLevels`, kein Server, keine Benachrichtigung.
 */
import { DEFAULT_ALERT_SETTINGS, blankKeyLevel } from "../keylevels/config";
import { FRESH_MEMORY, STAGE_LABEL, observe, stageMessage, stepStages, type AlertMemory } from "../keylevels/alerts";
import { evaluateLevel, type EvalCandle } from "../keylevels/evaluate";
import type { AlertStage, KeyLevel, LevelDirection, LevelStatus, TriggerKind } from "../keylevels/types";
import { demoHourly } from "./candles";

/** Das Fenster: Index der ersten und die Zahl der Kerzen, die die Demo abspielt. */
export const ALARM_START = 1100;
export const ALARM_BARS = 240;

export type AlarmRule = Extract<TriggerKind, "touch" | "close" | "closes" | "retest">;
export const ALARM_RULES: readonly { v: AlarmRule; label: string; help: string }[] = [
  { v: "touch", label: "Berührung", help: "Meldet, sobald ein Docht die Marke erreicht – auch mitten in der Kerze." },
  { v: "close", label: "Schluss darüber / darunter", help: "Meldet erst, wenn eine Kerze jenseits der Marke schließt." },
  { v: "closes", label: "Zwei Schlüsse in Folge", help: "Meldet erst nach zwei Schlüssen hintereinander jenseits der Marke." },
  { v: "retest", label: "Schluss und Retest", help: "Meldet den Bruch und danach den Rückkehr-Test: der Kurs kommt zurück an die Marke und hält." },
];

export interface AlarmSetup {
  price: number;
  direction: LevelDirection;
  rule: AlarmRule;
}

/** Die Kerzen des Fensters als Kerzen der Marken-Auswertung. */
function candlesOf(upTo: number): EvalCandle[] {
  const bars = demoHourly();
  const out: EvalCandle[] = [];
  for (let i = 0; i <= Math.min(upTo, bars.length - 1); i++) {
    const b = bars[i]!;
    out.push({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, closed: true, closeTime: (b.t + 3600) * 1000 });
  }
  return out;
}

/** Spanne der Preise im Fenster (für den Regler und die Standardmarke). */
export function alarmRange(): { lo: number; hi: number; first: number } {
  const bars = demoHourly().slice(ALARM_START, ALARM_START + ALARM_BARS);
  return { lo: Math.min(...bars.map((b) => b.l)), hi: Math.max(...bars.map((b) => b.h)), first: bars[0]!.c };
}

/** Eine Standardmarke, die der Kurs im Fenster wirklich erreicht (Vorbereitung, Bestätigung, Retest, Ungültigkeit kommen alle vor). */
export function defaultAlarm(): AlarmSetup {
  return { price: 108, direction: "above", rule: "close" };
}

export interface AlarmEvent {
  /** Index der Kerze im Fenster (0 … ALARM_BARS − 1) */
  at: number;
  stage: AlertStage;
  stageLabel: string;
  title: string;
  detail: string;
}

export interface AlarmReplay {
  level: KeyLevel;
  /** Meldungen bis einschließlich Kerze `upTo`, in der Reihenfolge, in der sie gekommen wären */
  events: AlarmEvent[];
  /** Stand der Marke an der Kerze `upTo` */
  status: LevelStatus;
  reason: string;
  /** Kerze, an der die Marke zuerst bestätigt war (nur bis `upTo` gesucht), sonst null */
  confirmedAt: number | null;
}

/** Die Marke als Eintrag des Marken-Modells (nur im Speicher dieser Funktion; nirgends abgelegt). */
export function levelOf(setup: AlarmSetup): KeyLevel {
  const first = demoHourly()[ALARM_START]!;
  return blankKeyLevel(
    {
      id: "demo",
      symbol: "DEMOUSDT",
      price: setup.price,
      tf: "1h",
      direction: setup.direction,
      kind: setup.rule,
      closes: 2,
      name: "Beispiel-Marke",
      since: first.t * 1000,
      alerts: { on: true, prepare: true, confirm: true, retest: true, invalid: true, recurring: false },
    },
    first.t * 1000,
  );
}

/** Spielt die Kerzen ab dem Fensteranfang bis Kerze `upTo` (0 … ALARM_BARS − 1) ab – zu jeder Kerze sieht die Auswertung nur die Kerzen bis dahin. Rein, deterministisch. */
export function replayAlarm(setup: AlarmSetup, upTo: number): AlarmReplay {
  const level = levelOf(setup);
  const last = Math.max(0, Math.min(ALARM_BARS - 1, Math.round(upTo)));
  const bars = demoHourly();
  const all = candlesOf(ALARM_START + last);
  let mem: AlertMemory = FRESH_MEMORY;
  const events: AlarmEvent[] = [];
  let status: LevelStatus = "waiting";
  let reason = "";
  let confirmedAt: number | null = null;
  for (let k = 0; k <= last; k++) {
    const idx = ALARM_START + k;
    const now = (bars[idx]!.t + 3600) * 1000 + 1000;
    const ev = evaluateLevel(level, all.slice(Math.max(0, idx - 299), idx + 1), now);
    if (confirmedAt == null && ev.status === "confirmed") confirmedAt = k;
    const st = stepStages(mem, observe(level, ev, DEFAULT_ALERT_SETTINGS), level.alerts, now);
    mem = st.mem;
    if (st.fire) {
      const m = stageMessage(level, st.fire, ev);
      events.push({ at: k, stage: st.fire, stageLabel: STAGE_LABEL[st.fire], title: m.title, detail: m.detail });
    }
    status = ev.status;
    reason = ev.reason;
  }
  return { level, events, status, reason, confirmedAt };
}

export const STATUS_TEXT: Readonly<Record<LevelStatus, string>> = { waiting: "wartet", provisional: "vorläufig", confirmed: "bestätigt", invalidated: "ungültig", unknown: "unbekannt" };

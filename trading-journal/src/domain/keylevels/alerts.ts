/**
 * Mehrstufige, ruhige Alarme (F22) – the pure part: which stage a level is in, when a stage fires, whether a delivery is
 * suppressed, and the capped delivery log ("Zustellprotokoll"). No timers, no storage, no UI.
 *
 * **Stages**, in the order a level moves through them: `prepare` (Vorbereitung: the price is within the prepare distance
 * of the trigger, or – running break – the forming candle is beyond it), `confirm` (Bestätigung), `retest` (Retest) and
 * `invalid` (Ungültigkeit). A level has ONE current stage at a time (`currentStage`); a stage fires only when it is
 * higher than every stage the cycle already reached (`stepStages`), so "Vorbereitung" never follows "Bestätigung" and a
 * jump straight to a confirmation sends one message, not two.
 *
 * **One-shot vs recurring.** One-shot: every stage at most once, ever (until the user re-arms). Recurring: a new cycle
 * starts when the price went away again (`waiting` and out of the prepare distance) or the level left `invalidated`.
 * Stages that are switched off still advance the cycle silently – switching one on later never replays the past.
 *
 * **Quiet.** Active hours (device time, may wrap over midnight), a cooldown per level and stage, one dedupe key per
 * level, cycle and stage, and the channels that exist today (toast, system notification). Everything that is suppressed
 * is logged with its reason, so the log answers "why did I not get an alert?".
 *
 * Alerts only run while the app is open in a browser tab – this module knows nothing about a server.
 */
import { n0, price as fmtPrice } from "../../lib/format";
import { distanceDelta } from "./evaluate";
import { tfLabel } from "./timeframes";
import { type DeliveryOutcome, type DeliveryRecord } from "./delivery";
import { type ActiveHours, type AlertSettings, type AlertStage, type DeliveryChannel, type EventBasis, type KeyLevel, type LevelAlertRule, type LevelEvaluation, type LevelStatus } from "./types";

export const STAGE_RANK: Readonly<Record<AlertStage, number>> = { prepare: 1, confirm: 2, retest: 3, invalid: 4 };
export const STAGE_LABEL: Readonly<Record<AlertStage, string>> = { prepare: "Vorbereitung", confirm: "Bestätigung", retest: "Retest", invalid: "Ungültigkeit" };

// ------------------------------------------------------------------------------------------ active hours

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};

/**
 * `true` when alerts may be delivered at `minutes` after local midnight. Off = always. `from === to` = the whole day.
 * The browser asks with the device clock (`inActiveHours`), the server with the clock of the account's time zone.
 */
export function inActiveHoursAt(h: ActiveHours, minutes: number): boolean {
  if (!h.on) return true;
  const from = toMinutes(h.from);
  const to = toMinutes(h.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return true;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/** `true` when alerts may be delivered at `at` (device local time). Off = always. `from === to` = the whole day. */
export function inActiveHours(h: ActiveHours, at: Date): boolean {
  return inActiveHoursAt(h, at.getHours() * 60 + at.getMinutes());
}

// ------------------------------------------------------------------------------------------ observation

export interface Observation {
  status: LevelStatus;
  kind: KeyLevel["kind"];
  /** the price is short of the trigger but within the prepare distance */
  within: boolean;
  /** the rule's first leg holds (retest rule: the break by close) */
  broke: boolean;
  retestDone: boolean;
}

/** What the alert logic needs from one evaluated level and the last price. */
export function observe(level: KeyLevel, ev: LevelEvaluation, settings: Pick<AlertSettings, "prepare">): Observation {
  let within = false;
  if (ev.status === "waiting" || ev.status === "invalidated") {
    const last = ev.last;
    const trig = ev.trigger;
    if (last != null && trig != null) {
      const delta = distanceDelta({ price: level.price, distance: settings.prepare }, ev.atr);
      const gap = level.direction === "above" ? trig - last : last - trig; // > 0: still short of the trigger
      within = delta != null && gap > 0 && gap <= delta;
    }
  }
  return { status: ev.status, kind: level.kind, within, broke: ev.broke, retestDone: ev.retest === "done" };
}

/** The one stage a level is in right now (`null` = none). `unknown` has no stage. */
export function currentStage(o: Observation): AlertStage | null {
  if (o.status === "unknown") return null;
  if (o.status === "invalidated") return "invalid";
  if (o.kind === "retest") {
    if (o.status === "confirmed") return "retest";
    if (o.broke) return "confirm";
    return o.within ? "prepare" : null;
  }
  if (o.status === "confirmed") return o.retestDone ? "retest" : "confirm";
  if (o.status === "provisional") return "prepare";
  return o.within ? "prepare" : null;
}

// ------------------------------------------------------------------------------------------ stage machine

export interface AlertMemory {
  /** counts up on every reset of a recurring level; part of the dedupe key */
  cycle: number;
  /** highest stage rank reached in this cycle (0 = none) */
  reached: number;
  /** stages that fired in this cycle → time (ms) */
  fired: Partial<Record<AlertStage, number>>;
  /** one-shot: stages that fired in ANY cycle (never reset) */
  ever: Partial<Record<AlertStage, number>>;
}

export const FRESH_MEMORY: AlertMemory = Object.freeze({ cycle: 0, reached: 0, fired: {}, ever: {} });

/** First look at a level (app start, alerts switched on): remember where it stands, send nothing. */
export function seedMemory(stage: AlertStage | null): AlertMemory {
  return { cycle: 0, reached: stage ? STAGE_RANK[stage] : 0, fired: {}, ever: {} };
}

export interface StepResult {
  mem: AlertMemory;
  /** the stage to deliver now (`null` = nothing) */
  fire: AlertStage | null;
  cycle: number;
}

/** One evaluation of a level: advances the cycle and says which stage (if any) fires. */
export function stepStages(prev: AlertMemory, obs: Observation, rule: Pick<LevelAlertRule, "on" | "recurring"> & Partial<Record<AlertStage, boolean>>, now: number): StepResult {
  let mem = prev;
  const cur = currentStage(obs);
  // recurring: the price went away again, or the level left `invalidated` → a fresh cycle
  if (rule.recurring && mem.reached > 0) {
    const away = obs.status === "waiting" && !obs.within;
    const left = mem.reached === STAGE_RANK.invalid && cur !== "invalid";
    if (away || left) mem = { cycle: mem.cycle + 1, reached: 0, fired: {}, ever: mem.ever };
  }
  if (!cur || STAGE_RANK[cur] <= mem.reached) return { mem, fire: null, cycle: mem.cycle };
  const next: AlertMemory = { ...mem, reached: STAGE_RANK[cur] };
  const allowed = rule.on && rule[cur] !== false && !mem.fired[cur] && (rule.recurring || !mem.ever[cur]);
  if (!allowed) return { mem: next, fire: null, cycle: mem.cycle };
  return { mem: { ...next, fired: { ...mem.fired, [cur]: now }, ever: { ...mem.ever, [cur]: now } }, fire: cur, cycle: mem.cycle };
}

// ------------------------------------------------------------------------------------------ messages

export interface StageMessage {
  title: string;
  detail: string;
  /** what the message rests on: the forming candle (provisional) or a closed one */
  basis: EventBasis;
}

const sign = (l: KeyLevel): string => (l.direction === "above" ? "über" : "unter");

/** German toast / notification text of a stage. */
export function stageMessage(level: KeyLevel, stage: AlertStage, ev: LevelEvaluation): StageMessage {
  const where = `${level.name} · ${level.symbol} ${tfLabel(level.tf)}`;
  switch (stage) {
    case "prepare":
      return ev.status === "provisional"
        ? { title: `Vorläufig · ${where}`, detail: `Laufende Kerze ${sign(level)} ${n0(level.price)} – bestätigt erst mit dem Schluss.`, basis: "intrabar" }
        : { title: `Vorbereitung · ${where}`, detail: `Kurs ${ev.last != null ? n0(ev.last) : "–"} nähert sich ${fmtPrice(ev.trigger ?? level.price)} (${ev.reason})`, basis: "intrabar" };
    case "confirm":
      return { title: `Bestätigt · ${where}`, detail: ev.awaitingRetest ? ev.reason : ev.reason, basis: ev.basis ?? "close" };
    case "retest":
      return { title: `Retest · ${where}`, detail: ev.reason.includes("Retest") ? ev.reason : `Kurs kam zurück an ${n0(level.price)} und hielt (Schluss ${sign(level)}).`, basis: "close" };
    default:
      return { title: `Ungültig · ${where}`, detail: ev.reason, basis: "close" };
  }
}

// ------------------------------------------------------------------------------------------ delivery + log

/** One key per level, cycle and stage – the same key is never delivered twice. */
export const dedupeKey = (levelId: string, cycle: number, stage: AlertStage): string => `${levelId}|${cycle}|${stage}`;

export interface DeliveryDecision {
  send: boolean;
  outcome: DeliveryOutcome;
  channels: DeliveryChannel[];
}

/** Channel / active-hours check shared by stage alerts and plan toasts: `null` = go ahead, else the reason to hold back. */
export function quietOutcome(settings: Pick<AlertSettings, "channels" | "hours">, now: number): { outcome: DeliveryOutcome; channels: DeliveryChannel[] } | null {
  const channels = (Object.keys(settings.channels) as DeliveryChannel[]).filter((c) => settings.channels[c]);
  if (!channels.length) return { outcome: "channels", channels };
  if (!inActiveHours(settings.hours, new Date(now))) return { outcome: "hours", channels };
  return null;
}

/**
 * Whether a stage message is delivered. Order of the checks: channels, active hours, dedupe (same key sent before, or
 * the same level and stage within the cooldown). A suppressed message is still logged by the caller.
 */
export function decideDelivery(
  q: { levelId: string; stage: AlertStage; cycle: number; now: number },
  settings: Pick<AlertSettings, "channels" | "hours" | "cooldownMin">,
  log: readonly DeliveryRecord[],
): DeliveryDecision {
  const quiet = quietOutcome(settings, q.now);
  const channels = (Object.keys(settings.channels) as DeliveryChannel[]).filter((c) => settings.channels[c]);
  if (quiet) return { send: false, outcome: quiet.outcome, channels };
  const key = dedupeKey(q.levelId, q.cycle, q.stage);
  const cooldown = settings.cooldownMin * 60_000;
  for (const r of log) {
    if (r.outcome !== "sent" || r.source !== "key") continue;
    if (r.dedupeKey === key) return { send: false, outcome: "duplicate", channels };
    if (r.levelId === q.levelId && r.stage === q.stage && q.now - r.at < cooldown) return { send: false, outcome: "duplicate", channels };
  }
  return { send: true, outcome: "sent", channels };
}

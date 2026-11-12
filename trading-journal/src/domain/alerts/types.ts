/**
 * Vier Alarme (C2): the vocabulary. Pure types and constants – no React, no I/O, no clock.
 *
 * The four events are the two sides of a trend (`green` = the market turns up / the rule says "in", `red` = it turns down /
 * "out") times two levels (`warn` = Vorwarnung, `confirm` = Bestätigung). A *source* (`AlertSource`) reads ONE kind of
 * thing (industry trend state, top-trader reversal, key level) and hands the engine plain readings; the engine
 * (`engine.ts`) turns readings into events with thresholds, hysteresis, cooldown, quiet hours and a dedupe key.
 * An alert is a pointer to a rule the user switched on – never advice and never an order.
 */

export type AlertSide = "green" | "red";
export const ALERT_SIDES: readonly AlertSide[] = ["green", "red"];
export type AlertLevel = "warn" | "confirm";

/** The four events, in the order they are listed everywhere (UI, protocol, mail, call). */
export const ALERT_EVENTS = ["green_warn", "green_confirm", "red_warn", "red_confirm"] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];
export const isAlertEvent = (v: unknown): v is AlertEvent => typeof v === "string" && (ALERT_EVENTS as readonly string[]).includes(v);

export const eventOf = (side: AlertSide, level: AlertLevel): AlertEvent => `${side}_${level}`;
export const sideOf = (e: AlertEvent): AlertSide => (e.startsWith("green") ? "green" : "red");
export const levelOf = (e: AlertEvent): AlertLevel => (e.endsWith("confirm") ? "confirm" : "warn");

/** What a market is in right now: one of the four events or nothing (`none`). */
export type AlertPhase = AlertEvent | "none";

export type AlertLang = "de" | "en";

export const ALERT_EVENT_LABEL: Readonly<Record<AlertLang, Readonly<Record<AlertEvent, string>>>> = {
  de: { green_warn: "Grün-Vorwarnung", green_confirm: "Grün-Bestätigung", red_warn: "Rot-Vorwarnung", red_confirm: "Rot-Bestätigung" },
  en: { green_warn: "Green early warning", green_confirm: "Green confirmation", red_warn: "Red early warning", red_confirm: "Red confirmation" },
};

/** One line per event for the settings ("when does it fire"). */
export const ALERT_EVENT_HELP: Readonly<Record<AlertEvent, string>> = {
  green_warn: "Der Markt nähert sich dem Einstieg: der Abstand zur Grenze ist kleiner als deine Schwelle.",
  green_confirm: "Die Regel steht auf „drin“: die Grenze ist durchbrochen.",
  red_warn: "Der Markt nähert sich dem Ausstieg: der Abstand zur Grenze ist kleiner als deine Schwelle.",
  red_confirm: "Die Regel steht auf „raus“: die Grenze ist durchbrochen.",
};

// ------------------------------------------------------------------------------------------ sources and readings

export const ALERT_SOURCE_KINDS = ["industry", "whale", "keylevel"] as const;
export type AlertSourceKind = (typeof ALERT_SOURCE_KINDS)[number];
export const isAlertSourceKind = (v: unknown): v is AlertSourceKind => typeof v === "string" && (ALERT_SOURCE_KINDS as readonly string[]).includes(v);

export const ALERT_SOURCE_LABEL: Readonly<Record<AlertSourceKind, string>> = {
  industry: "Branchen-Trend",
  whale: "Top-Trader-Umschlag",
  keylevel: "Schlüsselmarken",
};

/**
 * What a source says about ONE market at one moment, in the source's own units (percent of price, percentage points …).
 *   held      the confirmed state (`green` / `red`), or `null` when the source has none right now
 *   margin    how far INSIDE the confirmed state it is, in the source's units (`Infinity` for a source whose state is discrete)
 *   approach  where the market is heading: the side it would confirm and the distance still to go (≥ 0)
 * No number is ever invented: a source that cannot read a market returns no reading for it.
 */
export interface AlertReading {
  /** stable key of the (source, market) pair: `industry:Softw`, `whale:BTCUSDT` */
  key: string;
  source: AlertSourceKind;
  /** the market's display name ("Software", "BTCUSDT") – short, plain text */
  market: string;
  held: AlertSide | null;
  margin: number;
  approach: { side: AlertSide; distance: number } | null;
  /** when the data behind the reading is from (ms) – the engine ignores a reading older than `maxAgeMs` */
  asOf: number;
  /** one short honest line for the protocol ("Stand der Daten: 30.09.2026") */
  detail?: string;
}

/** What the engine needs from a source. `read` does the I/O (server) – the pure part is the reading builders in `sources/`. */
export interface AlertSource {
  kind: AlertSourceKind;
  /** how often the source needs reading (ms) – a monthly data file is not fetched every 5 minutes */
  everyMs: number;
  /** a reading older than this is "stale": it changes nothing and is shown as such */
  maxAgeMs: number;
  read(ctx: AlertReadContext): Promise<AlertReading[]>;
}

export interface AlertReadContext {
  now: number;
  /** the markets the account picked for this source (industry codes, symbols); empty for the key-level source */
  markets: readonly string[];
  /** the account's thresholds for this source */
  params: SourceParams;
  /** account id – only the key-level source needs it (to read the account's own levels) */
  userId: string;
}

/** Thresholds of one source, in the source's own units. */
export interface SourceParams {
  /** a warning is on when the distance to the confirming line is at most this */
  warn: number;
  /** a state counts as confirmed from this margin on (0 = as soon as the source says so) */
  confirm: number;
  /** hysteresis: a warning ends only above `warn + hyst`, a confirmation only below `confirm - hyst` */
  hyst: number;
}

// ------------------------------------------------------------------------------------------ engine memory

/** What the engine remembers per (source, market). Small and JSON-safe (stored in `alert_state`). */
export interface AlertMemory {
  /** the phase after the last reading */
  phase: AlertPhase;
  /** the cycle number: a new one starts when the market falls back to `none` or confirms the OTHER side */
  cycle: number;
  /** fires of each event in this cycle (the occurrence number of the dedupe key) */
  counts: Partial<Record<AlertEvent, number>>;
  /** the events that fired in this cycle and are still "used up" (warnings are re-armed when the market recedes) */
  fired: AlertEvent[];
  /** the side of the last confirmation (decides when a confirmation starts a new cycle) */
  lastConfirm: AlertSide | null;
  /** ms of the last fire of each event (cooldown) */
  last: Partial<Record<AlertEvent, number>>;
  /** ms of the last reading that was used */
  seen: number;
}

export type AlertMemoryMap = Readonly<Record<string, AlertMemory>>;

/** An event the engine decided on. */
export interface AlertFire {
  /** unique per (account, source, market, cycle, event, occurrence) – the database refuses a second row with the same key */
  dedupKey: string;
  key: string;
  source: AlertSourceKind;
  market: string;
  event: AlertEvent;
  at: number;
  /** the reading behind it, small */
  detail: string;
  /** the distance (warnings) or margin (confirmations) the event fired with, in the source's units; `null` for a discrete state */
  value: number | null;
  /** the moment is inside the user's quiet hours */
  quiet: boolean;
  /** `null` = deliver; `cooldown` = held back because the same event fired less than the cooldown ago */
  suppressed: "cooldown" | null;
}

/** Why a market was left out of a step (the protocol says so, nothing is guessed). */
export type AlertSkip = { key: string; reason: "stale" | "no_data" };

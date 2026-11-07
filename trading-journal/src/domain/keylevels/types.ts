/**
 * Schlüsselmarken (F09): the data model of the user's own key levels. Pure types and constants – no React, no I/O.
 *
 * A key level is a freely named price on ONE market symbol with its own timeframe, direction (`above` = the market is
 * supposed to get above it, `below` = under it) and ONE trigger rule (`TriggerKind`). Rules are separate on purpose:
 * a touch, a running (intrabar, provisional) break, a single close, N consecutive closes, a close beyond a distance
 * buffer and a confirmed retest answer different questions and are never mixed into one fuzzy "breakout".
 */

/** Timeframes a key level can watch – exactly what the market feed can serve (see `timeframes.ts`). */
export const KEY_TIMEFRAMES = ["30m", "1h", "2h", "3h", "4h", "1D", "1W"] as const;
export type KeyTf = (typeof KEY_TIMEFRAMES)[number];

const MIN = 60_000;
export const KEY_TF_MS: Readonly<Record<KeyTf, number>> = {
  "30m": 30 * MIN,
  "1h": 60 * MIN,
  "2h": 120 * MIN,
  "3h": 180 * MIN,
  "4h": 240 * MIN,
  "1D": 1440 * MIN,
  "1W": 7 * 1440 * MIN,
};
export const isKeyTf = (v: unknown): v is KeyTf => typeof v === "string" && (KEY_TIMEFRAMES as readonly string[]).includes(v);

export type LevelDirection = "above" | "below";
export const LEVEL_DIRECTIONS: readonly LevelDirection[] = ["above", "below"];

export const TRIGGER_KINDS = ["touch", "running", "close", "closes", "buffer", "retest"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];
export const isTriggerKind = (v: unknown): v is TriggerKind => typeof v === "string" && (TRIGGER_KINDS as readonly string[]).includes(v);

/** How a distance is measured: percent of the level price, or a multiple of the ATR(14) of the level's timeframe. */
export type DistanceMode = "pct" | "atr";
export interface Distance {
  mode: DistanceMode;
  value: number;
}

/**
 * What the level means for the day plan (F08). `auto`: `above` → Long-Trigger, `below` → Short-Trigger; `stop`: a
 * level whose break kills a view (shown as invalidation, never as a trigger); `info`: drawn and watched, not part of
 * the plan.
 */
export type PlanRole = "auto" | "long" | "short" | "stop" | "info";
export const PLAN_ROLES: readonly PlanRole[] = ["auto", "long", "short", "stop", "info"];

/** Alert stages (F22), in the order a level moves through them. */
export type AlertStage = "prepare" | "confirm" | "retest" | "invalid";
export const ALERT_STAGES: readonly AlertStage[] = ["prepare", "confirm", "retest", "invalid"];

/** Per-level alert rule. Off by default: a level never alerts before the user asked for it. */
export interface LevelAlertRule {
  /** master switch of this level */
  on: boolean;
  prepare: boolean;
  confirm: boolean;
  retest: boolean;
  invalid: boolean;
  /** `false` = one-shot (each stage at most once, until re-armed by hand), `true` = a new cycle after the level reset */
  recurring: boolean;
}

/** The five fixed levels of `settings.market`, mapped into the model (read-only copies, see `config.ts`). */
export type LegacyKey = "longTrigger" | "longStop" | "shortTrigger" | "invalidation" | "lowerHigh";

export interface KeyLevel {
  id: string;
  name: string;
  /** Binance symbol (`BTCUSDT`). Levels of another symbol are kept but not evaluated (the feed serves one symbol). */
  symbol: string;
  price: number;
  tf: KeyTf;
  direction: LevelDirection;
  kind: TriggerKind;
  /** `closes`: number of consecutive closes (2 … 10) */
  closes: number;
  /** `buffer`: the close must be this far beyond the level; `retest`: how close the retest has to come */
  distance: Distance;
  /** optional price that kills the view once a candle CLOSES beyond it (above-level: under it; below-level: over it) */
  invalidation: number | null;
  /** 1 (highest) … 9 – decides when `precedence` is `priority` */
  priority: number;
  role: PlanRole;
  enabled: boolean;
  /**
   * Evaluation starts with the first candle that OPENED at or after this time (ms): a level made today never
   * "confirms" on yesterday's candles. `null` = stateless (the fixed levels: the latest closed candle decides).
   */
  since: number | null;
  alerts: LevelAlertRule;
  note: string;
  /** set on the read-only copies of the five fixed levels */
  legacy?: LegacyKey;
}

/** Which timeframe wins when levels of different timeframes point in opposite directions. */
export type Precedence = "higher" | "lower" | "priority" | "wait";
export const PRECEDENCES: readonly Precedence[] = ["higher", "lower", "priority", "wait"];

export type DeliveryChannel = "toast" | "system";

export interface ActiveHours {
  on: boolean;
  /** `HH:MM`, device local time; `from > to` wraps over midnight */
  from: string;
  to: string;
}

/** Global alert settings (F22): where, when and how often. */
export interface AlertSettings {
  channels: Record<DeliveryChannel, boolean>;
  hours: ActiveHours;
  /** "Vorbereitung": the price is within this distance of the level (still short of the trigger) */
  prepare: Distance;
  /** same level and stage are not delivered twice within this time (minutes), also across cycles */
  cooldownMin: number;
}

/** `settings.keyLevels` (versioned passthrough key). Unknown keys survive every write. */
export interface KeyLevelsCfg {
  v: 1;
  levels: KeyLevel[];
  precedence: Precedence;
  alerts: AlertSettings;
  /** toast when the day plan changes (F08); `null` = default (on once the user has an own level) */
  planToast: boolean | null;
}

/** The statuses of a level. `unknown` = no usable data: it NEVER counts as confirmed. */
export type LevelStatus = "waiting" | "provisional" | "confirmed" | "invalidated" | "unknown";
export const LEVEL_STATUSES: readonly LevelStatus[] = ["waiting", "provisional", "confirmed", "invalidated", "unknown"];

/** The basis a state rests on: still moving candle (intrabar, provisional) or a closed candle. */
export type EventBasis = "intrabar" | "close";
export type LevelEventKind = "provisional" | "unconfirmed" | "touch" | "break" | "confirmed" | "retest" | "invalidated";
export interface LevelEvent {
  /** open time (ms) of the candle the event belongs to */
  at: number;
  kind: LevelEventKind;
  basis: EventBasis;
  price: number;
  text: string;
}

export interface LevelEvaluation {
  status: LevelStatus;
  /** what the status rests on (`null` for waiting / unknown) */
  basis: EventBasis | null;
  /** German one-liner: why the level has this status */
  reason: string;
  /** `closes`: closes counted so far / needed */
  progress: { have: number; need: number } | null;
  /** price the close / touch has to reach (level ± buffer); `null` when it cannot be computed */
  trigger: number | null;
  /** last known price (forming candle close, else last closed close) */
  last: number | null;
  /** signed distance of `last` to the trigger in % of the level: positive = already beyond (in the level's direction) */
  distancePct: number | null;
  /** after a confirmation: price came back to the level and held (retest done) */
  retest: "none" | "done";
  /** the rule's first leg holds: a confirmed level, or (retest rule) the break by close – the retest is still to come */
  broke: boolean;
  /** retest rule: break closed, retest still to come */
  awaitingRetest: boolean;
  /** ATR(14) of the level's timeframe on closed candles (`null` = not enough candles) */
  atr: number | null;
  /** the evaluated events, oldest first (last 30) */
  events: LevelEvent[];
  /** open time of the newest candle that was read */
  asOf: number | null;
}

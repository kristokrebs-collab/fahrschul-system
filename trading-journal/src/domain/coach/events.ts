/**
 * Behaviour events contract (Wave 0 – owner P04, consumers P08 psych tracker, P05 guard, P12 mentor queue).
 * Pure. Signatures are final; `detectBehaviors` runs the P04 detectors (`detectors.ts`, rules and tuning there).
 */
import type { DayNotes, EnrichedTrade, Settings } from "../types";
import { runDetectors } from "./detectors";

export const BEHAVIOR_KEYS = [
  "revenge",
  "tilt",
  "overtrading",
  "fomo",
  "stopMoved",
  "earlyProfit",
  "lossAversion",
  "overconfidence",
  "impulsive",
  "boredom",
  "ruleViolation",
] as const;
export type BehaviorKey = (typeof BEHAVIOR_KEYS)[number];

/** 1 = Hinweis, 2 = Warnung, 3 = kritisch. */
export type BehaviorSeverity = 1 | 2 | 3;

export const BEHAVIOR_LABEL: Readonly<Record<BehaviorKey, string>> = {
  revenge: "Revenge-Trade",
  tilt: "Tilt",
  overtrading: "Overtrading",
  fomo: "FOMO",
  stopMoved: "Stop verschoben",
  earlyProfit: "Frühe Gewinnmitnahme",
  lossAversion: "Verlustangst",
  overconfidence: "Selbstüberschätzung",
  impulsive: "Impulsiver Einstieg",
  boredom: "Langeweile-Trade",
  ruleViolation: "Regelverstoß",
};

export interface BehaviorEvent {
  key: BehaviorKey;
  /** Trades that make up the evidence (the triggering trade last). */
  tradeIds: string[];
  /** Epoch ms of the triggering trade (`tradeTime`), so `dayKeyOf`-style bucketing works. */
  at: number;
  severity: BehaviorSeverity;
  /** Short German evidence line ("3 Trades in 20 min nach Verlust"). */
  note?: string;
}

export interface DetectInput {
  /** Enriched trades, any order (detectors sort by time themselves). */
  trades: readonly EnrichedTrade[];
  settings: Settings;
  /** Day journal (check-ins, P08) when available. */
  days?: DayNotes;
  /** Epoch ms "now" for deterministic tests. */
  now?: number;
}

/**
 * All behaviour events of the journal, oldest first: revenge, tilt, overtrading, FOMO, stop moved, early profit, loss
 * aversion, overconfidence, impulsive, boredom and rule violations (from the discipline limits). Deterministic – the
 * same journal always gives the same events; `now` is accepted for the contract, no detector depends on the clock.
 */
export function detectBehaviors(input: DetectInput): BehaviorEvent[] {
  return runDetectors(input);
}

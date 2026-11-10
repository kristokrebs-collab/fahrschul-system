/**
 * The behaviour vocabulary of the coach (keys, labels, severity) – split from `events.ts` (P14) so the trade editor and
 * the trade detail (first load) can name behaviours without importing the detectors (`events.ts` → `detectors.ts`).
 * Pure constants; `events.ts` re-exports everything here, the contract is unchanged.
 */
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

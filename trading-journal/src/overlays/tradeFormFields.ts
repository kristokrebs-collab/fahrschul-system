/**
 * The ids of every movable unit of the trade form, in reading order (= the order inside a zone). No imports on purpose:
 * the e2e helpers (Node, no build defines) read it too. The catalog with labels, zones and spans is `tradeFormLayout.ts`.
 * 29 units: 14 single fields, 15 blocks.
 */
export const FIELD_IDS = [
  "pair",
  "side",
  "date",
  "account",
  "timeframe",
  "status",
  "entry",
  "stop",
  "target",
  "exit",
  "size",
  "leverage",
  "fees",
  "pnlManual",
  "signal",
  "execution",
  "setups",
  "reason",
  "checklist",
  "conviction",
  "followedPlan",
  "emotion",
  "tags",
  "rating",
  "psych",
  "mistakes",
  "notes",
  "chart",
  "shots",
] as const;
export type FieldId = (typeof FIELD_IDS)[number];

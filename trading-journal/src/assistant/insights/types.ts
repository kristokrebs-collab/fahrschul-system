/**
 * The inputs of the assistant's evaluation tools (types only – this file costs nothing at run time). Each tool reads its
 * figures from an EXISTING deterministic function (`auditRun`, `accountView`, `buildBalance` …); the inputs below are what
 * those functions need. Normally the tools fetch them from the app's stores when asked (`sources.ts`); a test hands them in
 * through `ToolEnv.insight`, so no store, no candle feed and no clock is needed.
 */
import type { LabResult } from "@/domain/backtest/job";
import type { Bar } from "@/domain/backtest/types";
import type { DeliveryRecord } from "@/domain/keylevels/delivery";
import type { ForwardAccount, ForwardCompare } from "@/domain/forward";
import type { KeyTf } from "@/domain/keylevels";
import type { FilterCompare } from "@/domain/lab/filters";
import type { StressRows } from "@/domain/lab/stress/types";
import type { SignalEvent } from "@/domain/missed/archive";
import type { PresenceSeg } from "@/domain/missed/presence";
import type { SignalOutcome } from "@/domain/missed/outcome";
import type { SimilarResult, SimUnit } from "@/domain/similar";
import type { TrendView } from "@/market/trendlines/store";

/** The last finished Labor run as the store holds it (`null` = none). */
export interface LabRunInput {
  result: LabResult;
  bars: readonly Bar[];
  /** percent of capital risked per trade of that run */
  riskPct: number | null;
}

/** An extra of the Labor (stress scenarios, filter comparison): only what is already computed is read. */
export interface ExtraInput<R> {
  status: "idle" | "running" | "done" | "error" | "cancelled";
  result: R | null;
}

export interface ForwardInput {
  accounts: readonly ForwardAccount[];
  /** the comparison with the backtest per account id, if the trader started it */
  compare: Readonly<Record<string, { status: string; result: ForwardCompare | null } | undefined>>;
}

export interface SignalsInput {
  events: readonly SignalEvent[];
  /** the outcomes that are already known: the cache of final results and what this session computed – never fetched here */
  outcomes: ReadonlyMap<string, SignalOutcome>;
  log: readonly DeliveryRecord[];
  presence: readonly PresenceSeg[];
}

/** „Ähnliche Situationen“ on one timeframe, computed from the market feed's closed candles (`null` result = no candles). */
export interface SimilarInput {
  /** `idle`: the live market is not running; `waiting`: running, but this timeframe has no candles (yet) */
  state: "idle" | "waiting" | "ok";
  tf: KeyTf;
  horizon: number;
  unit: SimUnit;
  /** why there are no candles (German), `null` otherwise */
  reason: string | null;
  result: SimilarResult | null;
}

export interface InsightInputs {
  lab?: LabRunInput | null;
  stress?: ExtraInput<StressRows>;
  filters?: ExtraInput<FilterCompare>;
  forward?: ForwardInput;
  trend?: TrendView;
  signals?: SignalsInput;
  /** the answer for the asked timeframe (`tf` of the question, else the card's choice) */
  similar?: SimilarInput;
}

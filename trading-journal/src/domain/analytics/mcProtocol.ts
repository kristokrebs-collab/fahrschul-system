/** Message types between `mcRunner.ts` and `mc.worker.ts` (P03). */
import type { MonteCarloOptions, MonteCarloResult, RiskOfRuinInput, RiskOfRuinResult } from "./montecarlo";

/** A job without its id. */
export type McJob = { kind: "mc"; sample: number[]; opts: MonteCarloOptions } | { kind: "ror"; input: RiskOfRuinInput; opts: { runs?: number; trades?: number; seed?: number } };

export type McRequest = McJob & { id: number };

export type McResponse =
  | { id: number; kind: "mc"; result: MonteCarloResult }
  | { id: number; kind: "ror"; result: RiskOfRuinResult }
  | { id: number; kind: "error"; message: string };

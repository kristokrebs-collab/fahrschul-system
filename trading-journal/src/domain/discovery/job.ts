/**
 * The miner as a stepped job: `step(deadline)` works until the deadline (a worker steps it in 40 ms slices and reports the
 * progress, the idle-chunk fallback in short slices on the main thread), `result()` runs it to the end. Same input and seed,
 * same result – the stepping only decides WHEN, never WHAT.
 */
import { now, type Stepper } from "../backtest/strategies/types";
import { discover } from "./mine";
import type { DiscoveryInput, DiscoveryResult } from "./types";

export type DiscoveryJob = Stepper<DiscoveryResult>;

export function createDiscoveryJob(input: DiscoveryInput): DiscoveryJob {
  const prog = { value: 0 };
  const gen = discover(input, prog);
  const t0 = now();
  let res: DiscoveryResult | null = null;
  const job: DiscoveryJob = {
    step(deadline: number): boolean {
      while (!res) {
        const r = gen.next();
        if (r.done) {
          res = { ...r.value, ms: Math.round(now() - t0) };
          break;
        }
        if (now() >= deadline) return false;
      }
      return true;
    },
    progress: () => (res ? 1 : Math.min(0.999, prog.value)),
    result(): DiscoveryResult {
      while (!job.step(Number.POSITIVE_INFINITY)) {
        /* run to the end */
      }
      return res!;
    },
  };
  return job;
}

/** Runs the whole analysis at once (tests, small inputs). */
export function runDiscoverySync(input: DiscoveryInput): DiscoveryResult {
  return createDiscoveryJob(input).result();
}

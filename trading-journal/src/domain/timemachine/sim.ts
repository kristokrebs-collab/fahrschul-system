/**
 * Part (a): the simulated sessions (pure, deterministic, stepped).
 *
 * One session = the plan's entry price, then `horizon` candles rebuilt from the pool (`pool.ts`): at every step a real candle of
 * the same time of day (±radius) is drawn – a single candle (`single`) or a run of consecutive real candles (`block`, keeps
 * volatility clustering and short trends) – and scaled to the current price. The first simulated candle OPENS at the entry price
 * (its shape is kept). The trade is then played through the backtest engine (`play.ts`), so stop / target / time stop, the rule
 * "both in one candle → the stop counts", fees, slippage and funding are the engine's.
 *
 * Every run has its own generator, seeded from (seed, run number): the result does not depend on how the work is sliced, and
 * run k can be repeated alone. The price path continues to the end of the session whatever the trade did (like the skill's
 * "where does the price sit at the close"); the fan chart is made from those paths.
 */
import type { Bar, BtStrategy, EngineCfg } from "../backtest/types";
import { costInR, excursionR, onceAtStart, playSegment, signalOf } from "./play";
import { riskOf } from "./plan";
import { slotOf, type Pool } from "./pool";
import { rng } from "./stats";
import { FAN_CELL_CAP, SAMPLE_PATHS, type FanPath, type TmInput } from "./types";

/** Seed of run `i` (a 32-bit mix, so neighbouring runs do not share a stream). */
export function runSeed(seed: number, i: number): number {
  let h = (Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(i + 1, 0xc2b2ae35)) | 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Outcome classes of a run, as stored in `kinds`. */
export const K_TARGET = 0;
export const K_STOP = 1;
export const K_NEITHER = 2;
export const K_MOVED = 3;
export const K_SKIPPED = 255;

export interface SimOut {
  runs: number;
  r: Float64Array;
  kind: Uint8Array;
  bars: Uint16Array;
  mae: Float32Array;
  cost: Float32Array;
  ambiguous: number;
  skipped: number;
  /** closes in R, run-major (`stride` = horizon + 1 per run); only the first `bandRuns` runs */
  fan: Float32Array;
  bandRuns: number;
  stride: number;
  paths: FanPath[];
}

export class SimJob {
  readonly out: SimOut;
  done = 0;
  private readonly pool: Pool;
  private readonly work: Bar[];
  private readonly strat: BtStrategy & { signal: ReturnType<typeof signalOf> };
  private readonly cfg: EngineCfg;
  private readonly atr: number[];
  private readonly startSec: number;
  private readonly slot0: number;
  private readonly risk: number;
  private readonly dir: 1 | -1;

  constructor(
    private readonly input: TmInput,
    pool: Pool,
    atr0: number,
  ) {
    this.pool = pool;
    const H = input.horizon;
    const { plan } = input;
    const last = pool.bars[pool.bars.length - 1]!;
    this.startSec = input.startMs != null ? Math.floor(input.startMs / 1000) : last.t + pool.secLen;
    this.slot0 = slotOf(this.startSec, pool.secLen, pool.slots);
    this.risk = riskOf(plan);
    this.dir = plan.side === "long" ? 1 : -1;
    this.work = Array.from({ length: H + 1 }, () => ({ t: 0, o: 0, h: 0, l: 0, c: 0 }));
    this.atr = new Array<number>(H + 1).fill(atr0);
    this.strat = onceAtStart(signalOf(plan, plan.stop, plan.target, H, input.manage));
    this.cfg = { capital: 10_000, riskPct: 0.01, maxLeverage: 1_000_000, compounding: false, costs: input.costs };
    const stride = H + 1;
    const bandRuns = Math.max(Math.min(input.runs, 500), Math.min(input.runs, Math.floor(FAN_CELL_CAP / stride)));
    this.out = {
      runs: input.runs,
      r: new Float64Array(input.runs),
      kind: new Uint8Array(input.runs).fill(K_SKIPPED),
      bars: new Uint16Array(input.runs),
      mae: new Float32Array(input.runs),
      cost: new Float32Array(input.runs),
      ambiguous: 0,
      skipped: 0,
      fan: new Float32Array(bandRuns * stride),
      bandRuns,
      stride,
      paths: [],
    };
  }

  get progress(): number {
    return this.input.runs ? this.done / this.input.runs : 1;
  }

  /** Simulates runs until `deadline` (performance.now() ms) or the end; true when all runs are done. */
  step(deadline: number): boolean {
    const { runs } = this.input;
    while (this.done < runs) {
      this.runOne(this.done);
      this.done++;
      if ((this.done & 15) === 0 && performance.now() >= deadline) break;
    }
    return this.done >= runs;
  }

  /** Builds the candles of run `k` into `work` (the stub candle at index 0 holds the entry price). */
  private generate(k: number): void {
    const { input, pool, work } = this;
    const H = input.horizon;
    const { plan } = input;
    const rand = rng(runSeed(input.seed, k));
    const { ro, rh, rl, rc, run } = pool;
    const secLen = pool.secLen;
    const single = input.method === "single";
    const L = Math.max(1, Math.round(input.blockLen));
    const stub = work[0]!;
    stub.t = this.startSec - secLen;
    stub.o = stub.h = stub.l = stub.c = plan.entry;
    let price = plan.entry;
    let slot = this.slot0;
    let left = 0;
    let j = 0;
    for (let s = 1; s <= H; s++) {
      if (left > 0) {
        j++;
        left--;
      } else {
        const cand = pool.win[slot]!;
        j = cand[Math.min(cand.length - 1, Math.floor(rand() * cand.length))]!;
        left = single ? 0 : Math.min(L, run[j]!) - 1;
      }
      const b = work[s]!;
      b.t = this.startSec + (s - 1) * secLen;
      if (s === 1) {
        // the first candle opens AT the entry price and keeps its shape
        const f = plan.entry / ro[j]!;
        b.o = plan.entry;
        b.h = f * rh[j]!;
        b.l = f * rl[j]!;
        b.c = f * rc[j]!;
      } else {
        b.o = price * ro[j]!;
        b.h = price * rh[j]!;
        b.l = price * rl[j]!;
        b.c = price * rc[j]!;
      }
      price = b.c;
      slot = slot + 1 === pool.slots ? 0 : slot + 1;
    }
  }

  private runOne(k: number): void {
    const { input, out, work } = this;
    const H = input.horizon;
    this.generate(k);
    // the path in R (kept for the fan: all runs up to `bandRuns`)
    const base = k < out.bandRuns ? k * out.stride : -1;
    if (base >= 0) {
      out.fan[base] = 0;
      for (let s = 1; s <= H; s++) out.fan[base + s] = (this.dir * (work[s]!.c - input.plan.entry)) / this.risk;
    }
    const played = playSegment(work, this.atr, this.strat, this.cfg, this.pool.secLen);
    const t = played.trade;
    if (!t) {
      out.skipped++;
      return;
    }
    const kind = t.reason === "target" ? K_TARGET : t.reason === "stop" ? K_STOP : t.reason === "breakeven" || t.reason === "trail" ? K_MOVED : K_NEITHER;
    out.r[k] = t.r;
    out.kind[k] = kind;
    out.bars[k] = t.bars;
    out.mae[k] = excursionR(work, t).mae;
    out.cost[k] = costInR(t);
    if (t.ambiguous) out.ambiguous++;
    if (k < SAMPLE_PATHS) {
      const r: number[] = [0];
      for (let s = 1; s <= H; s++) r.push(Math.round(((this.dir * (work[s]!.c - input.plan.entry)) / this.risk) * 1000) / 1000 + 0);
      out.paths.push({ r, exit: kind === K_NEITHER ? null : t.exitIndex, kind: kind === K_TARGET ? "target" : kind === K_STOP ? "stop" : kind === K_MOVED ? "moved" : "neither" });
    }
  }

  /** The candles of run `k` (a copy), for tests and for repeating one run. */
  candlesOf(k: number): Bar[] {
    this.generate(k);
    return this.work.map((b) => ({ ...b }));
  }
}

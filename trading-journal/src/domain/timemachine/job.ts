/**
 * The Zeitmaschine as a stepped job (pure, deterministic): `step(deadline)` works until a `performance.now()` deadline and
 * returns true when everything is done, so the SAME job runs in a Web Worker (`tm.worker.ts`) and, where there is none, in
 * short slices on the main thread (`tmRunner.ts`) – identical results either way.
 *
 *   pool     real candles → ratios and time-of-day pools, ATR, the plan as a rule for the history search
 *   sim      part (a): the simulated sessions through the backtest engine
 *   fan      the percentile bands of the price paths, step by step
 *   history  part (b): every earlier occasion on the real candles through the same engine
 *   summary  shares with intervals, expectancy, histogram, worst / median / best case, verdict, comparison, notes
 */
import { atrSeries } from "../backtest/bars";
import { HistoryJob } from "./history";
import { checkInput, isRefusal, relativeOf, targetROf, type Relative } from "./plan";
import { buildPool, type Pool } from "./pool";
import { K_MOVED, K_NEITHER, K_SKIPPED, K_STOP, K_TARGET, SimJob, type SimOut } from "./sim";
import { histogram, meanOf, prob, quantile, quart } from "./stats";
import { compareOf, notesOf, verdictOf } from "./texts";
import { MIN_POOL_BARS, type FanBand, type TmFan, type TmInput, type TmPhase, type TmResult, type TmSim } from "./types";

export interface TmJob {
  step(deadline: number): boolean;
  progress(): number;
  phase(): TmPhase;
  result(): TmResult | null;
}

const BANDS: readonly [FanBand, number][] = [
  ["p5", 0.05],
  ["p25", 0.25],
  ["p50", 0.5],
  ["p75", 0.75],
  ["p95", 0.95],
];
const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;

/** Weights of the phases in the progress bar. */
const W = { pool: 0.02, sim: 0.6, fan: 0.08, history: 0.27, summary: 0.03 } as const;

export function createTmJob(input: TmInput): TmJob {
  const refusal = checkInput(input);
  if (refusal) throw new Error(refusal.why);
  let phase: TmPhase = "pool";
  let pool: Pool;
  let atr: number[];
  let rel: Relative;
  let sim: SimJob;
  let hist: HistoryJob;
  let col = 0;
  const bands: Record<FanBand, number[]> = { p5: [], p25: [], p50: [], p75: [], p95: [] };
  let tmp: Float64Array;
  let res: TmResult | null = null;

  const fanStep = (deadline: number): boolean => {
    const o = sim.out;
    const H = input.horizon;
    while (col <= H) {
      for (let r = 0; r < o.bandRuns; r++) tmp[r] = o.fan[r * o.stride + col]!;
      tmp.sort();
      for (const [name, p] of BANDS) bands[name].push(r3(quantile(tmp, p)));
      col++;
      if (performance.now() >= deadline) break;
    }
    return col > H;
  };

  return {
    step(deadline) {
      if (phase === "done") return true;
      if (phase === "pool") {
        pool = buildPool(input.bars, input.interval, input.drift, input.vol);
        if (pool.n < MIN_POOL_BARS) throw new Error(`Nur ${pool.n} brauchbare Kerzen (von ${input.bars.length}) – mindestens ${MIN_POOL_BARS} sind nötig.`);
        atr = atrSeries(pool.bars);
        const r = relativeOf(input.plan, pool.bars, input.trigger, atr);
        if (isRefusal(r)) throw new Error(r.why);
        rel = r;
        sim = new SimJob(input, pool, rel.atr);
        hist = new HistoryJob(input, pool.bars, rel, pool.secLen, atr);
        tmp = new Float64Array(sim.out.bandRuns);
        phase = "sim";
      }
      if (phase === "sim") {
        if (sim.step(deadline)) phase = "fan";
        else return false;
      }
      if (phase === "fan") {
        if (fanStep(deadline)) phase = "history";
        else return false;
      }
      if (phase === "history") {
        if (hist.step(deadline)) phase = "summary";
        else return false;
      }
      if (phase === "summary") {
        res = summarize(input, pool, rel, sim.out, bands, hist);
        phase = "done";
      }
      return true;
    },
    progress() {
      switch (phase) {
        case "pool":
          return 0;
        case "sim":
          return W.pool + W.sim * sim.progress;
        case "fan":
          return W.pool + W.sim + W.fan * Math.min(1, col / (input.horizon + 1));
        case "history":
          return W.pool + W.sim + W.fan + W.history * hist.progress;
        case "summary":
          return 1 - W.summary;
        case "done":
          return 1;
      }
    },
    phase: () => phase,
    result: () => res,
  };
}

/** Runs the whole job in one go (tests, small inputs). */
export function runTimeMachineSync(input: TmInput): TmResult {
  const job = createTmJob(input);
  while (!job.step(performance.now() + 1000)) {
    /* keep stepping */
  }
  return job.result()!;
}

function summarizeSim(input: TmInput, o: SimOut, bands: Record<FanBand, number[]>, targetR: number): TmSim {
  const idx: number[] = [];
  for (let k = 0; k < o.runs; k++) if (o.kind[k] !== K_SKIPPED) idx.push(k);
  const n = idx.length;
  const r = Float64Array.from(idx, (k) => o.r[k]!);
  let nT = 0;
  let nS = 0;
  let nN = 0;
  let nM = 0;
  let cost = 0;
  const tT: number[] = [];
  const tS: number[] = [];
  const maeAll: number[] = [];
  const maeT: number[] = [];
  for (const k of idx) {
    const kind = o.kind[k]!;
    cost += o.cost[k]!;
    maeAll.push(o.mae[k]!);
    if (kind === K_TARGET) {
      nT++;
      tT.push(o.bars[k]!);
      maeT.push(o.mae[k]!);
    } else if (kind === K_STOP) {
      nS++;
      tS.push(o.bars[k]!);
    } else if (kind === K_MOVED) nM++;
    else if (kind === K_NEITHER) nN++;
  }
  const sorted = Float64Array.from(r).sort();
  const exp = meanOf(r) ?? { n, mean: n ? r[0]! : 0, sd: 0, lo: n ? r[0]! : 0, hi: n ? r[0]! : 0 };
  const last = input.horizon;
  const fan: TmFan = {
    steps: Array.from({ length: last + 1 }, (_, i) => i),
    bands,
    paths: o.paths,
    bandRuns: o.bandRuns,
  };
  return {
    runs: n,
    skipped: o.skipped,
    horizon: input.horizon,
    target: prob(nT, n),
    stop: prob(nS, n),
    neither: prob(nN, n),
    moved: prob(nM, n),
    expectancy: exp,
    costR: n ? cost / n : 0,
    cases: { worst: sorted[0] ?? 0, p5: n ? quantile(sorted, 0.05) : 0, median: n ? quantile(sorted, 0.5) : 0, mean: exp.mean, p95: n ? quantile(sorted, 0.95) : 0, best: sorted[n - 1] ?? 0 },
    hist: histogram(r, n, [-1, targetR]),
    timeTarget: quart(tT),
    timeStop: quart(tS),
    maeAll: quart(maeAll),
    maeTarget: quart(maeT),
    endR: { p5: bands.p5[last] ?? 0, p50: bands.p50[last] ?? 0, p95: bands.p95[last] ?? 0 },
    ambiguous: o.ambiguous,
    fan,
  };
}

function summarize(input: TmInput, pool: Pool, rel: Relative, o: SimOut, bands: Record<FanBand, number[]>, hist: HistoryJob): TmResult {
  const targetR = targetROf(input.plan);
  const sim = summarizeSim(input, o, bands, targetR);
  const history = hist.result();
  let radiusMin = 255;
  let radiusMax = 0;
  let thinnest = Infinity;
  for (let s = 0; s < pool.slots; s++) {
    radiusMin = Math.min(radiusMin, pool.radius[s]!);
    radiusMax = Math.max(radiusMax, pool.radius[s]!);
    thinnest = Math.min(thinnest, pool.win[s]!.length);
  }
  const { now, median } = pool.atrPct;
  const first = pool.bars[0]!;
  const lastBar = pool.bars[pool.bars.length - 1]!;
  const part = {
    v: 1 as const,
    symbol: input.symbol,
    plan: { ...input.plan },
    interval: input.interval,
    seed: input.seed,
    options: { runs: input.runs, seed: input.seed, horizon: input.horizon, method: input.method, blockLen: input.blockLen, drift: input.drift, vol: input.vol, trigger: input.trigger, validBars: input.validBars, manage: { ...input.manage } },
    targetR,
    pool: { bars: pool.n, slots: pool.slots, radiusMin, radiusMax, thinnest, fromMs: first.t * 1000, toMs: (lastBar.t + pool.secLen) * 1000, driftPerBar: pool.drift, volRatio: now != null && median != null && median > 0 ? now / median : null, volScale: pool.scale },
    sim,
    history,
    relative: { atr: rel.atr, stopAtr: rel.stopAtr, targetAtr: rel.targetAtr, entryOffsetAtr: rel.entryOffsetAtr, rangePos: rel.rangePos, kind: rel.kind },
  };
  return { ...part, compare: compareOf(sim, history), verdict: verdictOf(sim, targetR), notes: notesOf(part) };
}

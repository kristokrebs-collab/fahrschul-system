/**
 * Walk-forward analysis (P07, pure): rolling train / test windows over the chosen period. In every window the grid is
 * optimised on the TRAIN part only and the winner trades the following TEST part unseen; the test parts line up
 * without overlap, so their trades form one honest out-of-sample record. Walk-forward efficiency (WFE) = Ø R of the
 * test trades ÷ Ø R the winners had in training (≥ 0,5 is commonly read as robust).
 */
import { bestTrial, evaluate, trialOf, type Window } from "./optimize";
import type { LabStrategy, Params, Prepared } from "./strategies/types";
import type { BtTrade, EngineCfg } from "./types";

export interface WfWindow {
  index: number;
  train: Window;
  test: Window;
  /** ms of the window edges (bar opens / closes) */
  trainFrom: number;
  testFrom: number;
  testTo: number;
  /** the winner of the train part (null: no set had enough trades) */
  best: Params | null;
  trainMeanR: number | null;
  trainN: number;
  testTrades: BtTrade[];
  testMeanR: number | null;
  testSumR: number;
}

export interface WalkForward {
  windows: WfWindow[];
  /** all test trades, in time order */
  oos: BtTrade[];
  oosMeanR: number | null;
  /** Ø R of the test trades ÷ Ø R of the winners in training; null without a positive training edge */
  efficiency: number | null;
  /** share of windows whose test part made money (Σ R > 0) among the windows that traded */
  positiveShare: number | null;
}

/** Window layout: `k` test windows, each train part `trainMult` × as long as a test part. Null when too short. */
export function wfLayout(from: number, to: number, k = 5, trainMult = 2): { train: Window; test: Window }[] | null {
  const len = to - from + 1;
  const test = Math.floor(len / (k + trainMult));
  if (test < 10) return null;
  const train = test * trainMult;
  const out: { train: Window; test: Window }[] = [];
  for (let w = 0; w < k; w++) {
    const s = from + w * test;
    const tr = { from: s, to: s + train - 1 };
    const te = { from: s + train, to: w === k - 1 ? to : s + train + test - 1 };
    out.push({ train: tr, test: te });
  }
  return out;
}

/** One window: optimise on train, trade test. */
export function wfWindow<F>(strategy: LabStrategy<F, unknown>, prep: Prepared<F>, grid: readonly Params[], cfg: EngineCfg, index: number, train: Window, test: Window, secLen: number): WfWindow {
  const trials = grid.map((p) => trialOf(p, evaluate(strategy, prep, p, cfg, train).trades));
  const best = bestTrial(trials);
  const testTrades = best ? evaluate(strategy, prep, best.params, cfg, test).trades : [];
  const rs = testTrades.map((t) => t.r);
  const bars = prep.bars;
  return {
    index,
    train,
    test,
    trainFrom: bars[train.from]!.t * 1000,
    testFrom: bars[test.from]!.t * 1000,
    testTo: (bars[test.to]!.t + secLen) * 1000,
    best: best?.params ?? null,
    trainMeanR: best?.meanR ?? null,
    trainN: best?.n ?? 0,
    testTrades,
    testMeanR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    testSumR: rs.reduce((a, b) => a + b, 0),
  };
}

/** Summary of finished windows. */
export function summarizeWf(windows: WfWindow[]): WalkForward {
  const oos = windows.flatMap((w) => w.testTrades);
  const rs = oos.map((t) => t.r);
  const oosMeanR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  const trained = windows.filter((w) => w.best && w.trainMeanR != null);
  const isMean = trained.length ? trained.reduce((s, w) => s + w.trainMeanR!, 0) / trained.length : null;
  const efficiency = oosMeanR != null && isMean != null && isMean > 0 ? oosMeanR / isMean : null;
  const traded = windows.filter((w) => w.testTrades.length > 0);
  return {
    windows,
    oos,
    oosMeanR,
    efficiency,
    positiveShare: traded.length ? traded.filter((w) => w.testSumR > 0).length / traded.length : null,
  };
}

/**
 * Walk-forward windows of the optimiser (pure). The tradable bars `lo … hi` are cut into consecutive, NON-overlapping parts:
 *
 *   |  training  | test 1 | test 2 | test 3 | test 4 | confirmation |
 *   lo                                                              hi
 *
 * - every test window starts after the training part and after the previous test window (anchored walk-forward: the training
 *   of window k is everything before it, `folds[k].train`, so training never touches its own test window);
 * - the score of a variant is measured on the test windows only;
 * - the confirmation window at the end ("Bestätigungsfenster") is never used to rank or select anything: it is looked at once,
 *   for the finalists, when a proposal is made.
 *
 * The windows are bar indices (inclusive). The training part takes the rounding rest, so the parts always add up to the
 * whole span.
 */
import type { EvolveOpts } from "./types";

export interface Win {
  from: number;
  to: number;
}

export interface EvolveWindows {
  /** the part before the first test window */
  train: Win;
  tests: Win[];
  holdout: Win;
  /** anchored walk-forward: test window k with ALL the bars before it as its training */
  folds: { train: Win; test: Win }[];
}

/** Fewest bars a window may have; shorter data is refused with a reason. */
export const MIN_WINDOW_BARS = 30;

export type WindowResult = { ok: true; windows: EvolveWindows } | { ok: false; reason: string };

export function evolveWindows(lo: number, hi: number, o: Pick<EvolveOpts, "folds" | "trainFrac" | "holdoutFrac">): WindowResult {
  const span = hi - lo + 1;
  if (!(span > 0)) return { ok: false, reason: "Keine Kerzen im Zeitraum." };
  const holdLen = Math.floor(span * o.holdoutFrac);
  const testLen = Math.floor((span * (1 - o.trainFrac - o.holdoutFrac)) / o.folds);
  const trainLen = span - holdLen - o.folds * testLen;
  if (testLen < MIN_WINDOW_BARS || holdLen < MIN_WINDOW_BARS || trainLen < MIN_WINDOW_BARS) {
    return { ok: false, reason: `Zu wenige Kerzen für ${o.folds} Testfenster plus Training und Bestätigungsfenster (${span} Kerzen; jedes Fenster braucht mindestens ${MIN_WINDOW_BARS}). Wähle einen längeren Zeitraum.` };
  }
  const train: Win = { from: lo, to: lo + trainLen - 1 };
  const tests: Win[] = [];
  for (let k = 0; k < o.folds; k++) tests.push({ from: lo + trainLen + k * testLen, to: lo + trainLen + (k + 1) * testLen - 1 });
  const holdout: Win = { from: lo + trainLen + o.folds * testLen, to: hi };
  return { ok: true, windows: { train, tests, holdout, folds: tests.map((t) => ({ train: { from: lo, to: t.from - 1 }, test: t })) } };
}

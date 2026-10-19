/**
 * Strategy wrappers of the stress test (F20): the same entry signals, executed differently. Both keep the decision at the
 * CLOSE of a bar (nothing is looked at that the original did not see).
 */
import type { Bar, BtStrategy, EntrySignal, OpenPosition } from "../../backtest/types";

/**
 * One candle later: an order the original strategy hands over at the close of bar i - 1 is only placed at the close of
 * bar i, so it fills at the open of bar i + 1. A signal that appeared while the engine was in a position (the engine did
 * not ask at i - 1) stays unused, exactly as in the base run. Stop and target keep their prices; the engine skips the
 * order when the later open already lies beyond one of them (counted as skipped).
 */
export function delayed(inner: BtStrategy): BtStrategy {
  const asked = new Set<number>();
  return {
    start: inner.start,
    signalAt(i: number): EntrySignal | null {
      asked.add(i);
      return asked.has(i - 1) && i - 1 >= inner.start ? inner.signalAt(i - 1) : null;
    },
    exitAt: inner.exitAt ? (i: number, pos: OpenPosition) => (i - 1 >= pos.entryIndex ? (inner.exitAt!(i - 1, pos) ?? null) : null) : undefined,
  };
}

/**
 * The stop distance scaled by `factor` around the close of the signal bar (the price every template measures its stop
 * from); the target keeps its price, so the target in R changes with it. Position management stays as configured and
 * follows the new distance (it is measured in R of the ORIGINAL stop).
 */
export function stopScaled(inner: BtStrategy, bars: readonly Bar[], factor: number): BtStrategy {
  return {
    start: inner.start,
    signalAt(i: number): EntrySignal | null {
      const s = inner.signalAt(i);
      const ref = bars[i]?.c;
      if (!s || ref == null || !(factor > 0)) return s;
      const dist = Math.abs(ref - s.stop) * factor;
      return { ...s, stop: s.side === "long" ? ref - dist : ref + dist };
    },
    exitAt: inner.exitAt,
  };
}

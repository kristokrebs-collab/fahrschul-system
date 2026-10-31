/** Shared by the F19 tests: a seeded pseudo-random walk of closed candles (deterministic). */
import type { SimCandle } from "@/domain/similar";

export const H = 3_600_000;
/** a Monday, 00:00 UTC */
export const T0 = Date.UTC(2026, 0, 5);

/** Seeded pseudo-random walk (deterministic) with volume. */
export function walk(n: number, seed = 7, step = H): SimCandle[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const out: SimCandle[] = [];
  let c = 100;
  for (let i = 0; i < n; i++) {
    const o = c;
    c = Math.max(5, c + (rnd() - 0.5) * 3);
    const hi = Math.max(o, c) + rnd() * 1.2;
    const lo = Math.min(o, c) - rnd() * 1.2;
    out.push({ time: T0 + i * step, open: o, high: hi, low: lo, close: c, volume: 50 + rnd() * 100, closed: true, closeTime: T0 + (i + 1) * step - 1 });
  }
  return out;
}


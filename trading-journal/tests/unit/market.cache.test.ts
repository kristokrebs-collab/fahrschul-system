import { describe, expect, it } from "vitest";
import { upsertBar, upsertSeries } from "@/market/cache";

type P = { time: number; v: string };
const p = (time: number, v = `v${time}`): P => ({ time, v });

/** The original Map + sort implementation: the reference semantics. */
function reference<T extends { time: number }>(existing: readonly T[], incoming: readonly T[], cap: number): T[] {
  if (incoming.length === 0) return existing.slice(-cap);
  const map = new Map<number, T>();
  for (const x of existing) map.set(x.time, x);
  for (const x of incoming) map.set(x.time, x);
  const merged = [...map.values()].sort((a, b) => a.time - b.time);
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("market cache series upserts", () => {
  it("upsertSeries matches the reference merge for random rings and polls", () => {
    const rand = rng(42);
    for (let round = 0; round < 400; round++) {
      const n = Math.floor(rand() * 40);
      const existing: P[] = [];
      let t = Math.floor(rand() * 10);
      for (let i = 0; i < n; i++) {
        t += 1 + Math.floor(rand() * 3);
        existing.push(p(t, `e${t}`));
      }
      const m = Math.floor(rand() * 8);
      const incoming: P[] = [];
      for (let i = 0; i < m; i++) {
        const time = Math.floor(rand() * (t + 10));
        incoming.push(p(time, `i${round}-${i}`));
      }
      if (rand() < 0.5) incoming.sort((a, b) => a.time - b.time);
      const cap = 5 + Math.floor(rand() * 50);
      expect(upsertSeries(existing, incoming, cap)).toEqual(reference(existing, incoming, cap));
    }
  });

  it("upsertSeries rebuilds a ring that is not strictly ascending (external cache data)", () => {
    const broken = [p(3), p(1), p(2), p(2, "dup")];
    expect(upsertSeries(broken, [p(4)], 10)).toEqual(reference(broken, [p(4)], 10));
  });

  it("upsertBar replaces the forming bar, appends the next one, trims and never mutates", () => {
    const ring = [p(1), p(2), p(3)];
    const replaced = upsertBar(ring, p(3, "tick"), 10);
    expect(replaced).toEqual([p(1), p(2), p(3, "tick")]);
    expect(replaced).not.toBe(ring);
    expect(ring).toEqual([p(1), p(2), p(3)]);

    const appended = upsertBar(ring, p(4), 10);
    expect(appended).toEqual([p(1), p(2), p(3), p(4)]);
    expect(upsertBar(ring, p(4), 3)).toEqual([p(2), p(3), p(4)]);
    expect(upsertBar([], p(7), 3)).toEqual([p(7)]);
    expect(upsertBar([p(1), p(2), p(3), p(4)], p(4, "x"), 3)).toEqual([p(2), p(3), p(4, "x")]);
  });

  it("upsertBar falls back to the full merge for an out-of-order point", () => {
    const ring = [p(1), p(3), p(5)];
    expect(upsertBar(ring, p(2), 10)).toEqual([p(1), p(2), p(3), p(5)]);
    expect(upsertBar(ring, p(3, "late"), 10)).toEqual([p(1), p(3, "late"), p(5)]);
  });
});

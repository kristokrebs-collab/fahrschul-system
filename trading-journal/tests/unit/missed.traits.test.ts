/**
 * F32 verpasste Gewinner gegen verpasste Verlierer: nothing below 20 decided missed signals, both groups need a sample, trait
 * values need a sample, the interval decides what „sticht heraus“, counterexamples are always returned.
 */
import { describe, expect, it } from "vitest";
import { compareTraits, TRAIT_MIN_DECIDED, TRAIT_MIN_VALUE, traitsOf, type SignalEvent, type SignalOutcome } from "@/domain/missed";
import { signalEvent } from "./missed.fixtures";

const out = (kind: "target" | "stop"): SignalOutcome => ({ kind, basis: "own", sameBar: false, entry: 100, stop: 95, target: 110, rr: 2, r: kind === "target" ? 2 : -1, hitAt: 1, bars: 3, coveredUntil: 1, horizon: false, reason: null });

/** `n` missed signals: the first `wins` of them won. Even indexes are Long, odd Short (long = winners in the tests that want a pattern). */
function sample(spec: Array<{ side: "long" | "short"; win: boolean; tf?: string; at?: number }>): { events: SignalEvent[]; outcomes: Map<string, SignalOutcome> } {
  const events = spec.map((s, i) => signalEvent({ key: `m${i}`, side: s.side, tf: s.tf ?? "1h", at: s.at ?? new Date(2026, 2, 1 + i, 10).getTime() }));
  const outcomes = new Map(events.map((e, i) => [e.id, out(spec[i]!.win ? "target" : "stop")]));
  return { events, outcomes };
}

describe("compareTraits", () => {
  it("says how many signals are missing below the minimum and shows nothing else", () => {
    const { events, outcomes } = sample(Array.from({ length: 12 }, (_, i) => ({ side: "long" as const, win: i % 2 === 0 })));
    const r = compareTraits(events, outcomes);
    expect(r).toMatchObject({ enough: false, decided: 12, rows: [] });
    expect(r.blocked).toContain(`${TRAIT_MIN_DECIDED}`);
    expect(r.blocked).toContain("bisher 12");
  });

  it("only decided outcomes count – open and unusable ones are left out", () => {
    const { events, outcomes } = sample(Array.from({ length: 22 }, (_, i) => ({ side: "long" as const, win: i % 2 === 0 })));
    outcomes.set(events[0]!.id, { ...out("target"), kind: "open", r: null });
    outcomes.set(events[1]!.id, { ...out("target"), kind: "unusable", r: null });
    expect(compareTraits(events, outcomes).decided).toBe(20);
    expect(compareTraits(events.slice(0, 5), new Map()).decided).toBe(0);
  });

  it("needs a few of each group", () => {
    const { events, outcomes } = sample(Array.from({ length: 22 }, (_, i) => ({ side: "long" as const, win: i < 2 })));
    const r = compareTraits(events, outcomes);
    expect(r.enough).toBe(false);
    expect(r.blocked).toContain("2 Gewinner und 20 Verlierer");
  });

  it("lists the trait values with winners, losers, the interval – and always counterexamples", () => {
    // 12 longs: 9 win; 12 shorts: 3 win → overall 12 / 24 = 50 %
    const spec = [
      ...Array.from({ length: 12 }, (_, i) => ({ side: "long" as const, win: i < 9 })),
      ...Array.from({ length: 12 }, (_, i) => ({ side: "short" as const, win: i < 3 })),
    ];
    const { events, outcomes } = sample(spec);
    const r = compareTraits(events, outcomes);
    expect(r).toMatchObject({ enough: true, decided: 24, winners: 12, losers: 12, overall: 0.5 });
    const longRow = r.rows.find((t) => t.dim === "side" && t.value === "Long")!;
    expect(longRow).toMatchObject({ winners: 9, losers: 3, rate: 0.75 });
    expect(longRow.lo).toBeGreaterThan(0.5); // 80 % Wilson of 9/12: the whole interval above the overall rate
    expect(longRow.stands).toBe("higher");
    // the counterexamples of a good trait are signals WITH it that lost (newest first, at most 3)
    expect(longRow.counter).toHaveLength(3);
    expect(longRow.counter.every((c) => c.side === "long" && outcomes.get(c.id)!.kind === "stop")).toBe(true);
    expect(longRow.counter[0]!.at).toBeGreaterThan(longRow.counter[2]!.at);
    const shortRow = r.rows.find((t) => t.dim === "side" && t.value === "Short")!;
    expect(shortRow).toMatchObject({ rate: 0.25, stands: "lower" });
    expect(shortRow.counter.every((c) => c.side === "short" && outcomes.get(c.id)!.kind === "target")).toBe(true);
  });

  it("a trait without a clear gap does not stand out", () => {
    const spec = Array.from({ length: 24 }, (_, i) => ({ side: (i % 2 ? "long" : "short") as "long" | "short", win: i % 4 < 2 }));
    const { events, outcomes } = sample(spec);
    const r = compareTraits(events, outcomes);
    expect(r.enough).toBe(true);
    expect(r.rows.find((t) => t.dim === "side" && t.value === "Long")!.stands).toBeNull();
  });

  it("trait values below the minimum sample are not listed", () => {
    const spec = [
      ...Array.from({ length: 20 }, (_, i) => ({ side: "long" as const, win: i % 2 === 0, tf: "1h" })),
      ...Array.from({ length: TRAIT_MIN_VALUE - 1 }, () => ({ side: "long" as const, win: true, tf: "4h" })),
    ];
    const { events, outcomes } = sample(spec);
    const r = compareTraits(events, outcomes);
    expect(r.rows.some((t) => t.dim === "tf" && t.value === "4h")).toBe(false);
    expect(r.rows.some((t) => t.dim === "tf" && t.value === "1h")).toBe(true);
  });

  it("is deterministic and bounded", () => {
    const spec = Array.from({ length: 40 }, (_, i) => ({ side: (i % 3 ? "long" : "short") as "long" | "short", win: i % 5 < 2, tf: i % 2 ? "1h" : "4h" }));
    const { events, outcomes } = sample(spec);
    expect(compareTraits(events, outcomes)).toEqual(compareTraits([...events].reverse(), outcomes));
    expect(compareTraits(events, outcomes).rows.length).toBeLessThanOrEqual(10);
  });
});

describe("traitsOf", () => {
  it("reads side, kind, timeframe, part of the day, strength and market off the event", () => {
    const t = traitsOf(signalEvent({ side: "short", tf: "4h", symbol: "ETHUSDT", strength: 2, at: new Date(2026, 2, 4, 14).getTime() }));
    expect(t).toMatchObject({ side: "Short", type: "Einstiegs-Check", tf: "4h", symbol: "ETHUSDT", strength: "Stärke 2", time: "Nachmittag (12–18 Uhr)" });
    expect(traitsOf(signalEvent({ source: "box", kind: "scan", strength: null })).type).toBe("Box-Scanner");
    expect(traitsOf(signalEvent({ source: "key", kind: "confirm", strength: null })).strength).toBeNull();
  });
});

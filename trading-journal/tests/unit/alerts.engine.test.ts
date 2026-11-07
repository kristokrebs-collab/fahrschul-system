/**
 * Vier Alarme (C2) – the engine (`src/domain/alerts/engine.ts`): thresholds, hysteresis, one message per jump, order, cycles,
 * cooldown, stale readings, quiet hours, deduplication. Pure, no clock, no network – every number is spelled out.
 */
import { describe, expect, it } from "vitest";
import { phaseOf, stepAlerts, type StepOptions } from "@/domain/alerts/engine";
import type { AlertMemoryMap, AlertReading, SourceParams } from "@/domain/alerts/types";

const P: SourceParams = { warn: 2, confirm: 0, hyst: 0.5 };
const WHALE: SourceParams = { warn: 3, confirm: 2, hyst: 1 };
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 2, 12, 0, 0);

function opts(over: Partial<StepOptions> = {}): StepOptions {
  return { now: T0, userId: "u1", params: { industry: P, whale: WHALE, keylevel: { warn: 0, confirm: 0, hyst: 0 } }, cooldownMs: 0, maxAgeMs: { industry: 1e12, whale: 15 * MIN, keylevel: 1e12 }, quiet: () => false, ...over };
}

function reading(over: Partial<AlertReading> = {}): AlertReading {
  return { key: "industry:Softw", source: "industry", market: "Software", held: "red", margin: Infinity, approach: null, asOf: T0, ...over };
}

/** Feeds readings one after the other (each at its own minute) and collects every fire. */
function run(rs: Partial<AlertReading>[], o: Partial<StepOptions> = {}, start: AlertMemoryMap = {}) {
  let mem = start;
  const fires = [];
  rs.forEach((r, i) => {
    const now = T0 + i * 5 * MIN;
    const s = stepAlerts(mem, [reading({ asOf: now, ...r })], opts({ now, ...o }));
    mem = s.memory;
    fires.push(...s.fires);
  });
  return { mem, fires };
}

const events = (f: { event: string }[]): string[] => f.map((x) => x.event);

describe("first look", () => {
  it("is silent: a state that already holds is the baseline, not news", () => {
    const { fires, mem } = run([{ held: "green" }]);
    expect(fires).toEqual([]);
    expect(mem["industry:Softw"]!.phase).toBe("green_confirm");
  });

  it("is silent for a warning that already holds, but the confirmation that follows is news", () => {
    const { fires } = run([{ held: "red", approach: { side: "green", distance: 1 } }, { held: "green" }]);
    expect(events(fires)).toEqual(["green_confirm"]);
  });
});

describe("the industry cycle (confirmed state, warnings toward the other side)", () => {
  const cash = { held: "red" as const };
  const nearEntry = { held: "red" as const, approach: { side: "green" as const, distance: 1.2 } };
  const farEntry = { held: "red" as const, approach: { side: "green" as const, distance: 6 } };
  const inn = { held: "green" as const };
  const nearStop = { held: "green" as const, approach: { side: "red" as const, distance: 0.8 } };

  it("goes red confirm → green warn → green confirm → red warn → red confirm, one event each, in this order", () => {
    const { fires } = run([cash, farEntry, nearEntry, inn, nearStop, cash]);
    expect(events(fires)).toEqual(["green_warn", "green_confirm", "red_warn", "red_confirm"]);
  });

  it("falling back to the steady state is silent (the warning receded, the old confirmation is not repeated)", () => {
    const { fires } = run([cash, nearEntry, farEntry, nearEntry]);
    // the second approach is a new warning (the first one receded) – with the cooldown off it fires again, the retreat in between did not
    expect(events(fires)).toEqual(["green_warn", "green_warn"]);
  });

  it("a warning toward the other side wins over the held state; the held state never fires again in its cycle", () => {
    const { fires } = run([inn, nearStop, inn, nearStop]);
    expect(events(fires)).toEqual(["red_warn", "red_warn"]);
  });

  it("a jump straight to a confirmation is ONE event, never 'warning and then confirmation'", () => {
    const { fires } = run([cash, farEntry, inn]);
    expect(events(fires)).toEqual(["green_confirm"]);
  });
});

describe("hysteresis", () => {
  const near = (d: number) => ({ held: null, approach: { side: "green" as const, distance: d } });

  it("a warning starts at distance <= warn and ends only above warn + hyst", () => {
    const { fires, mem } = run([near(9), near(2), near(2.4), near(2.5), near(2.6)]);
    expect(events(fires)).toEqual(["green_warn"]); // 2.4 and 2.5 are inside the band (2 + 0.5): no second event, no end
    expect(mem["industry:Softw"]!.phase).toBe("none"); // 2.6 > 2.5: over
  });

  it("hovering on the line does not flicker: 1.9, 2.1, 1.9, 2.1 is one warning", () => {
    const { fires } = run([near(9), near(1.9), near(2.1), near(1.9), near(2.1)]);
    expect(events(fires)).toEqual(["green_warn"]);
  });

  it("a confirmation starts at margin >= confirm and ends only below confirm - hyst (whale)", () => {
    const w = (margin: number, side: "green" | "red" = "green") => ({ key: "whale:BTCUSDT", source: "whale" as const, market: "BTCUSDT", held: side, margin, approach: null });
    const { fires, mem } = run([w(0.5), w(1.9), w(2.0), w(1.5), w(0.9), w(1.1)], {});
    expect(events(fires)).toEqual(["green_confirm"]);
    // 2.0 confirms; 1.5 and 1.1 are inside the band (2 - 1 = 1) and keep it; 0.9 ended it
    expect(mem["whale:BTCUSDT"]!.phase).toBe("none");
  });

  it("phaseOf: a warning toward the other side beats the held state, toward the same side gives way", () => {
    expect(phaseOf({ held: "green", margin: Infinity, approach: { side: "red", distance: 1 } }, "none", P)).toBe("red_warn");
    expect(phaseOf({ held: "green", margin: Infinity, approach: { side: "green", distance: 1 } }, "none", P)).toBe("green_confirm");
    expect(phaseOf({ held: null, margin: 0, approach: null }, "green_warn", P)).toBe("none");
  });
});

describe("order and cycles", () => {
  const w = (margin: number, side: "green" | "red", approach: AlertReading["approach"] = null) => ({ key: "whale:BTCUSDT", source: "whale" as const, market: "BTCUSDT", held: side, margin, approach });

  it("a warning never follows the confirmation of its own side in the same cycle", () => {
    const { fires } = run([
      w(0, "green"), // baseline: none (margin 0 < confirm 2)
      w(2.5, "green"), // confirm
      w(0.5, "green", { side: "green", distance: 1 }), // fell inside the band? 0.5 < 1 → confirmation ends … warning toward green
    ]);
    expect(events(fires)).toEqual(["green_confirm"]);
  });

  it("falling back to none ends the cycle: the same warning fires again, under a new key", () => {
    const near = { held: null, approach: { side: "green" as const, distance: 1 } };
    const far = { held: null, approach: null };
    const { fires } = run([far, near, far, near]);
    expect(events(fires)).toEqual(["green_warn", "green_warn"]);
    expect(fires[0]!.dedupKey).not.toBe(fires[1]!.dedupKey);
    expect(fires[0]!.dedupKey).toContain("c1");
    expect(fires[1]!.dedupKey).toContain("c2");
  });

  it("the confirmation of the OTHER side starts a new cycle", () => {
    const { fires } = run([{ held: "red" }, { held: "green" }, { held: "red" }]);
    expect(events(fires)).toEqual(["green_confirm", "red_confirm"]);
    expect(fires[0]!.dedupKey).toContain("c2");
    expect(fires[1]!.dedupKey).toContain("c3");
  });

  it("several markets in one look leave confirmations first, then warnings, then by key – the same every run", () => {
    const rs = [
      reading({ key: "industry:B", market: "B", held: "red", approach: { side: "green", distance: 1 } }),
      reading({ key: "industry:A", market: "A", held: "green" }),
      reading({ key: "industry:C", market: "C", held: "red", approach: { side: "green", distance: 1 } }),
    ];
    // first look sets the baselines (red/red/green), then a second look moves A to red-confirm … build the moves explicitly
    const base = stepAlerts({}, [reading({ key: "industry:B", held: "red" }), reading({ key: "industry:A", held: "red" }), reading({ key: "industry:C", held: "red" })], opts());
    const next = stepAlerts(base.memory, rs, opts({ now: T0 + 5 * MIN }));
    expect(next.fires.map((f) => `${f.key}:${f.event}`)).toEqual(["industry:A:green_confirm", "industry:B:green_warn", "industry:C:green_warn"]);
    const again = stepAlerts(base.memory, [...rs].reverse(), opts({ now: T0 + 5 * MIN }));
    expect(again.fires.map((f) => f.dedupKey)).toEqual(next.fires.map((f) => f.dedupKey));
  });
});

describe("cooldown", () => {
  const near = { held: null, approach: { side: "green" as const, distance: 1 } };
  const far = { held: null, approach: null };

  it("the same event of the same market is held back within the cooldown (kept, marked suppressed) and goes through after it", () => {
    // look every 5 minutes: fire at 5, re-enter at 15 (10 min later: inside 30), re-enter at 40 (35 min after the first: outside)
    const { fires } = run([far, near, far, near, far, far, far, far, near], { cooldownMs: 30 * MIN });
    expect(fires.map((f) => [f.event, f.suppressed])).toEqual([
      ["green_warn", null],
      ["green_warn", "cooldown"],
      ["green_warn", null],
    ]);
  });

  it("a suppressed fire still advances the cycle: it does not fire later by itself", () => {
    const { fires } = run([far, near, far, near, near, near], { cooldownMs: 60 * MIN });
    expect(fires.filter((f) => !f.suppressed)).toHaveLength(1);
  });
});

describe("stale and missing readings", () => {
  it("a reading older than its source's limit changes nothing and is reported", () => {
    const start = stepAlerts({}, [reading({ key: "whale:BTCUSDT", source: "whale", market: "BTCUSDT", held: "green", margin: 0 })], opts()).memory;
    const stale = stepAlerts(start, [reading({ key: "whale:BTCUSDT", source: "whale", market: "BTCUSDT", held: "green", margin: 9, asOf: T0 - 20 * MIN })], opts());
    expect(stale.fires).toEqual([]);
    expect(stale.skipped).toEqual([{ key: "whale:BTCUSDT", reason: "stale" }]);
    expect(stale.memory).toEqual(start);
  });

  it("a market without a reading keeps its memory (a source that is down resets nothing)", () => {
    const start = stepAlerts({}, [reading({ held: "green" })], opts()).memory;
    const none = stepAlerts(start, [], opts({ now: T0 + 5 * MIN }));
    expect(none.memory).toEqual(start);
    expect(none.fires).toEqual([]);
  });

  it("a stale first reading sets no baseline", () => {
    const s = stepAlerts({}, [reading({ source: "whale", key: "whale:X", asOf: T0 - 3600_000 })], opts());
    expect(s.memory).toEqual({});
  });
});

describe("deduplication", () => {
  it("the same step run twice with the same memory gives the same events with the same keys (a crash and a rerun make no new event)", () => {
    const start = stepAlerts({}, [reading({ held: "red" })], opts()).memory;
    const r = reading({ held: "green", asOf: T0 + 5 * MIN });
    const a = stepAlerts(start, [r], opts({ now: T0 + 5 * MIN }));
    const b = stepAlerts(start, [r], opts({ now: T0 + 5 * MIN }));
    expect(a.fires).toHaveLength(1);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.fires[0]!.dedupKey).toBe("u1|industry:Softw|c2|green_confirm|n1");
  });

  it("two readings of one market in one look count once", () => {
    const start = stepAlerts({}, [reading({ held: "red" })], opts()).memory;
    const s = stepAlerts(start, [reading({ held: "green" }), reading({ held: "green" })], opts({ now: T0 + MIN }));
    expect(s.fires).toHaveLength(1);
  });

  it("the account is part of the key: two accounts never share one", () => {
    const start = stepAlerts({}, [reading({ held: "red" })], opts()).memory;
    const a = stepAlerts(start, [reading({ held: "green" })], opts({ userId: "u1", now: T0 + MIN }));
    const b = stepAlerts(start, [reading({ held: "green" })], opts({ userId: "u2", now: T0 + MIN }));
    expect(a.fires[0]!.dedupKey).not.toBe(b.fires[0]!.dedupKey);
  });
});

describe("quiet hours", () => {
  it("marks a fire inside the quiet hours; the engine still decides it (what to do about it is the delivery's business)", () => {
    const start = stepAlerts({}, [reading({ held: "red" })], opts()).memory;
    const s = stepAlerts(start, [reading({ held: "green" })], opts({ now: T0 + MIN, quiet: () => true }));
    expect(s.fires.map((f) => [f.event, f.quiet, f.suppressed])).toEqual([["green_confirm", true, null]]);
  });
});

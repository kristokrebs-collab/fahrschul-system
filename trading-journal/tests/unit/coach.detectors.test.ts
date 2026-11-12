/**
 * P04 behaviour detectors (`src/domain/coach/detectors.ts` via the Wave-0 `detectBehaviors`): every detector with a
 * positive and a negative case, severities, evidence order (triggering trade last), determinism and speed.
 */
import { describe, expect, it } from "vitest";
import { detectBehaviors, type BehaviorEvent, type BehaviorKey } from "@/domain/coach/events";
import { stopWidenings } from "@/domain/coach/detectors";
import type { Trade } from "@/domain/types";
import { at, COACH_SETTINGS, coachJournal, ct, enrichC } from "./coach.fixtures";

const run = (ts: Trade[]) => detectBehaviors({ trades: enrichC(ts), settings: COACH_SETTINGS, now: 0 });
const of = (ev: BehaviorEvent[], key: BehaviorKey) => ev.filter((e) => e.key === key);
const last = (e: BehaviorEvent) => e.tradeIds[e.tradeIds.length - 1];

describe("Revenge", () => {
  it("flags an entry within 60 minutes after a loss, with the loss as evidence", () => {
    const ev = run([ct(at(0, 600), { id: "L", p: -100 }), ct(at(0, 620), { id: "R", p: 50 })]);
    const r = of(ev, "revenge");
    expect(r).toHaveLength(1);
    expect(r[0]!.tradeIds).toEqual(["L", "R"]);
    expect(last(r[0]!)).toBe("R");
    expect(r[0]!.severity).toBe(1);
    expect(r[0]!.note).toContain("20 Min nach einem Verlust");
  });

  it("does not flag an entry after more than 60 minutes or after a win", () => {
    expect(of(run([ct(at(0, 600), { p: -100 }), ct(at(0, 661), { p: 50 })]), "revenge")).toHaveLength(0);
    expect(of(run([ct(at(0, 600), { p: 100 }), ct(at(0, 610), { p: 50 })]), "revenge")).toHaveLength(0);
  });

  it("measures from the exit time when the loss has one, never during the losing trade", () => {
    const loss = ct(at(0, 540), { id: "L", p: -100, exitDate: at(0, 660) });
    const during = ct(at(0, 600), { id: "D", p: 20 });
    const after = ct(at(0, 690), { id: "A", p: 20 });
    const r = of(run([loss, during, after]), "revenge");
    expect(r.map(last)).toEqual(["A"]);
  });

  it("gets more severe when sized up, hot and losing", () => {
    const base = Array.from({ length: 6 }, (_, i) => ct(at(i, 600), { p: 50 }));
    const ev = run([...base, ct(at(7, 600), { id: "L", p: -100 }), ct(at(7, 610), { id: "R", p: -300, risk: 300 })]);
    const r = of(ev, "revenge")[0]!;
    expect(r.severity).toBe(3);
    expect(r.note).toContain("3× üblich");
  });

  it("counts an explicit mark without a preceding loss", () => {
    const r = of(run([ct(at(0, 600), { id: "X", emotion: "Revenge", p: -10 })]), "revenge");
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe(2);
    expect(r[0]!.tradeIds).toEqual(["X"]);
  });
});

describe("Tilt", () => {
  it("flags trades after two losses in a row on the same day", () => {
    const ev = run([ct(at(0, 540), { id: "a", p: -100 }), ct(at(0, 560), { id: "b", p: -100 }), ct(at(0, 700), { id: "c", p: -50 })]);
    const t = of(ev, "tilt");
    expect(t).toHaveLength(1);
    expect(t[0]!.tradeIds).toEqual(["a", "b", "c"]);
  });

  it("a win in between or a new day resets the streak", () => {
    expect(of(run([ct(at(0, 540), { p: -100 }), ct(at(0, 560), { p: 100 }), ct(at(0, 580), { p: -100 }), ct(at(0, 700), { p: 10 })]), "tilt")).toHaveLength(0);
    expect(of(run([ct(at(0, 540), { p: -100 }), ct(at(0, 560), { p: -100 }), ct(at(1, 700), { p: 10 })]), "tilt")).toHaveLength(0);
  });

  it("is critical once the day loss limit is already breached", () => {
    const ev = run([ct(at(0, 540), { p: -300 }), ct(at(0, 560), { p: -200 }), ct(at(0, 700), { id: "t", p: -10 })]);
    const t = of(ev, "tilt")[0]!;
    expect(t.severity).toBe(3);
    expect(t.note).toContain("Tageslimit");
  });
});

describe("Overtrading", () => {
  it("flags a day over the account's trade limit, the first trade over the limit last", () => {
    const ts = Array.from({ length: 7 }, (_, i) => ct(at(0, 480 + i * 70), { id: `o${i}`, p: 10 }));
    const o = of(run(ts), "overtrading");
    expect(o).toHaveLength(1);
    expect(last(o[0]!)).toBe("o5");
    expect(o[0]!.severity).toBe(2);
    expect(o[0]!.note).toContain("7 Trades");
  });

  it("flags a burst of four trades within an hour", () => {
    const ts = Array.from({ length: 4 }, (_, i) => ct(at(0, 600 + i * 12), { id: `b${i}`, p: 10 }));
    const o = of(run(ts), "overtrading");
    expect(o).toHaveLength(1);
    expect(o[0]!.severity).toBe(1);
    expect(o[0]!.tradeIds).toEqual(["b0", "b1", "b2", "b3"]);
  });
});

describe("FOMO", () => {
  it("counts the emotion and a chased entry", () => {
    const ev = run([ct(at(0, 600), { id: "f", emotion: "FOMO", p: 10 }), ct(at(1, 600), { id: "c", plannedEntry: 99.5, p: 10 })]);
    const f = of(ev, "fomo");
    expect(f.map(last)).toEqual(["f", "c"]);
    expect(f[0]!.severity).toBe(2);
    expect(f[1]!.severity).toBe(1);
    expect(f[1]!.note).toContain("schlechter als geplant");
  });

  it("an entry at the planned price is no FOMO", () => {
    expect(of(run([ct(at(0, 600), { plannedEntry: 100, p: 10 })]), "fomo")).toHaveLength(0);
  });
});

describe("Stop verschoben", () => {
  it("finds moves away from the entry, not trailing stops", () => {
    expect(stopWidenings({ side: "long", stopHistory: [{ at: "2026-03-02T10:00", price: 95 }, { at: "2026-03-02T10:30", price: 92 }] })).toHaveLength(1);
    expect(stopWidenings({ side: "long", stopHistory: [{ at: "2026-03-02T10:00", price: 95 }, { at: "2026-03-02T10:30", price: 97 }] })).toHaveLength(0);
    expect(stopWidenings({ side: "short", stopHistory: [{ at: "2026-03-02T10:00", price: 105 }, { at: "2026-03-02T10:30", price: 108 }] })).toHaveLength(1);
  });

  it("is critical when the widened trade then lost more than 1 R; a large loss without history is only a hint", () => {
    const moved = ct(at(0, 600), { id: "m", p: -150, stopHistory: [{ at: at(0, 600), price: 99 }, { at: at(0, 620), price: 98, source: "exchange" }] });
    const big = ct(at(1, 600), { id: "g", p: -200 });
    const s = of(run([moved, big]), "stopMoved");
    expect(s.map((e) => [last(e), e.severity])).toEqual([
      ["m", 3],
      ["g", 1],
    ]);
    expect(s[0]!.note).toContain("laut Börse");
  });
});

describe("Frühe Gewinnmitnahme", () => {
  it("uses the excursion when measured, else the planned R:R", () => {
    const mfe = ct(at(0, 600), { id: "x", p: 50, mfeR: 3, target: 103 });
    const rr = ct(at(1, 600), { id: "y", p: 50, target: 103 });
    const ok = ct(at(2, 600), { id: "z", p: 50, target: 103, psych: { exitReason: "Ziel erreicht" } });
    const e = of(run([mfe, rr, ok]), "earlyProfit");
    expect(e.map((x) => [last(x), x.severity])).toEqual([
      ["x", 2],
      ["y", 1],
    ]);
  });
});

describe("Verlustangst", () => {
  it("flags losers held at least twice as long as the winners' median", () => {
    const ts: Trade[] = [];
    for (let i = 0; i < 5; i++) ts.push(ct(at(i, 600), { p: 100, exitDate: at(i, 630) }));
    for (let i = 0; i < 5; i++) ts.push(ct(at(10 + i, 600), { id: `l${i}`, p: -100, exitDate: at(10 + i, 780) }));
    const l = of(run(ts), "lossAversion");
    expect(l.map(last)).toEqual(["l0", "l1", "l2", "l3", "l4"]);
    expect(l[0]!.note).toContain("3 Std");
  });

  it("needs enough held trades on both sides", () => {
    expect(of(run([ct(at(0, 600), { p: 100, exitDate: at(0, 610) }), ct(at(1, 600), { p: -100, exitDate: at(1, 900) })]), "lossAversion")).toHaveLength(0);
  });
});

describe("Selbstüberschätzung", () => {
  it("flags a sized-up entry after three wins in a row", () => {
    const ts = Array.from({ length: 6 }, (_, i) => ct(at(i, 600), { p: 100 }));
    ts.push(ct(at(7, 600), { id: "big", p: -250, risk: 250 }));
    const o = of(run(ts), "overconfidence");
    expect(o).toHaveLength(1);
    expect(last(o[0]!)).toBe("big");
    expect(o[0]!.severity).toBe(3);
  });
});

describe("Impulsiv und Langeweile", () => {
  it("a trade without setup and reason is impulsive; low conviction without setup is boredom", () => {
    const base = Array.from({ length: 4 }, (_, i) => ct(at(i, 600), { p: 10 }));
    const ev = run([...base, ct(at(5, 600), { id: "imp", setups: [], reason: "", p: -10 }), ct(at(6, 600), { id: "bor", setups: [], conviction: 1, p: -10 })]);
    expect(of(ev, "impulsive").map(last)).toEqual(["imp"]);
    expect(of(ev, "boredom").map(last)).toEqual(["bor"]);
  });

  it("a journal without setups is not flagged for missing setups", () => {
    const ts = Array.from({ length: 5 }, (_, i) => ct(at(i, 600), { setups: [], reason: "", p: 10 }));
    expect(of(run(ts), "impulsive")).toHaveLength(0);
  });
});

describe("Regelverstöße", () => {
  it("lists the broken trade rules and the day loss limit", () => {
    const ev = run([ct(at(0, 540), { id: "ns", stop: null, p: -50 }), ct(at(0, 600), { id: "big", p: -300 }), ct(at(0, 660), { id: "day", p: -150 })]);
    const r = of(ev, "ruleViolation");
    const noStop = r.find((e) => last(e) === "ns")!;
    expect(noStop.note).toContain("kein Stop");
    const big = r.find((e) => last(e) === "big" && e.note!.includes("Verlust über"))!;
    expect(big.severity).toBe(3);
    const day = r.find((e) => e.note!.includes("Tagesverlust"))!;
    expect(last(day)).toBe("day");
    expect(day.severity).toBe(3);
  });

  it("a clean trade breaks nothing", () => {
    expect(of(run([ct(at(0, 600), { p: 50, followedPlan: true })]), "ruleViolation")).toHaveLength(0);
  });
});

describe("Ganzes Journal", () => {
  it("is deterministic and independent of the input order", () => {
    const ts = coachJournal(40);
    const a = run(ts);
    const b = run([...ts].reverse());
    expect(b).toEqual(a);
    expect(a.length).toBeGreaterThan(5);
    for (let i = 1; i < a.length; i++) expect(a[i]!.at).toBeGreaterThanOrEqual(a[i - 1]!.at);
  });

  it("finds the planted revenge entries", () => {
    const ts = coachJournal(60);
    const planted = ts.filter((t) => t.id.startsWith("r")).map((t) => t.id);
    const found = new Set(of(run(ts), "revenge").map(last));
    expect(planted.length).toBeGreaterThan(5);
    for (const id of planted) expect(found.has(id)).toBe(true);
  });

  it("runs 3000 trades fast", () => {
    const ts = coachJournal(1200);
    const t0 = performance.now();
    run(ts);
    expect(ts.length).toBeGreaterThan(2000);
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});

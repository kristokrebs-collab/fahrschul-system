/**
 * F25 Signalbilanz: counts per group, the outcome rates with sample and interval per row, the basis filter, and the comparison
 * „deine Trades gegen alle Signale“ with its three readings and the difference.
 */
import { describe, expect, it } from "vitest";
import { buildBalance, sampleLevel, SELECTION_NOTE, type SignalEvent, type SignalOutcome } from "@/domain/missed";
import { at, ct, enrichC } from "./coach.fixtures";
import { H, signalEvent } from "./missed.fixtures";

const T = new Date(at(0, 600)).getTime();
const NOW = T + 3 * 86_400_000;

const out = (kind: SignalOutcome["kind"], over: Partial<SignalOutcome> = {}): SignalOutcome => ({ kind, basis: "own", sameBar: false, entry: 100, stop: 95, target: 110, rr: 2, r: kind === "target" ? 2 : kind === "stop" ? -1 : null, hitAt: 1, bars: 3, coveredUntil: 1, horizon: false, reason: null, ...over });

/** 6 signals: 4 Einstiegs-Check (1h) at T, T+7h … , 2 Box-Setups (4h). */
function fixture() {
  const ev = (key: string, over: Partial<SignalEvent> = {}) => signalEvent({ key, at: T + Number(key.slice(1)) * 7 * H, ...over });
  const events = [
    ev("e1"), // traded below
    ev("e2"), // left out
    ev("e3"), // expired
    ev("e4"),
    ev("e5", { source: "box", kind: "setup", tf: "4h", strength: null, name: "Ausbruch Long", grade: "A+" }),
    ev("e6", { source: "box", kind: "setup", tf: "4h", strength: null, name: "Range Short", side: "short", grade: "A" }),
    ev("c7", { entry: false, kind: "breakout", source: "box" }),
  ];
  // e1 traded (long BTC right after), the rest not
  const trades = enrichC([ct(at(0, 1025), { id: "t1", p: 300, risk: 100, pair: "BTC/USDT" })]);
  events[1] = { ...events[1]!, skip: "doubt", skipAt: T };
  const outcomes = new Map<string, SignalOutcome>([
    [events[0]!.id, out("target")],
    [events[1]!.id, out("stop")],
    [events[2]!.id, out("target")],
    [events[3]!.id, out("open")],
    [events[4]!.id, out("target", { basis: "standard" })],
    [events[5]!.id, out("stop", { basis: "standard" })],
  ]);
  return { events, trades, outcomes };
}

describe("buildBalance", () => {
  it("counts the entry signals per kind, with traded / left out / expired / running", () => {
    const { events, trades, outcomes } = fixture();
    const bal = buildBalance(events, trades, outcomes, NOW, "type");
    expect(bal.signals).toBe(6);
    expect(bal.context).toBe(1);
    const check = bal.rows.find((r) => r.key === "Einstiegs-Check")!;
    const box = bal.rows.find((r) => r.key === "Box-Setup")!;
    expect(check).toMatchObject({ n: 4, left: 1, expired: expect.any(Number) });
    expect(box.n).toBe(2);
    expect(bal.total.n).toBe(6);
    expect(bal.total.traded + bal.total.left + bal.total.expired + bal.total.running).toBe(6);
  });

  it("hit rate = target ÷ (target + stop) with the Wilson interval; open and unusable do not count", () => {
    const { events, trades, outcomes } = fixture();
    const bal = buildBalance(events, trades, outcomes, NOW, "type");
    const check = bal.rows.find((r) => r.key === "Einstiegs-Check")!;
    expect(check).toMatchObject({ target: 2, stop: 1, open: 1, decided: 3 });
    expect(check.hitRate).toBeCloseTo(2 / 3, 6);
    expect(check.hitCi!.lo).toBeLessThan(2 / 3);
    expect(check.hitCi!.hi).toBeGreaterThan(2 / 3);
    expect(check.avgR).toBeCloseTo((2 - 1 + 2) / 3, 6);
    expect(check.level).toBe("zu wenig");
    expect(check.rCi).not.toBeNull(); // three values
  });

  it("groups by setup name and by timeframe", () => {
    const { events, trades, outcomes } = fixture();
    expect(buildBalance(events, trades, outcomes, NOW, "setup").rows.map((r) => r.label).sort()).toEqual(["Ausbruch Long", "Einstiegs-Check", "Range Short"]);
    const tf = buildBalance(events, trades, outcomes, NOW, "tf");
    expect(tf.rows.map((r) => r.key).sort()).toEqual(["1h", "4h"]);
  });

  it("the basis filter keeps own marks and the standard measure apart", () => {
    const { events, trades, outcomes } = fixture();
    const own = buildBalance(events, trades, outcomes, NOW, "type", "own");
    const std = buildBalance(events, trades, outcomes, NOW, "type", "standard");
    expect(own.total).toMatchObject({ target: 2, stop: 1 }); // e1, e2, e3
    expect(std.total).toMatchObject({ target: 1, stop: 1 }); // e5, e6
    expect(own.total.pending).toBeGreaterThan(0); // the other basis is not part of this reading
  });

  it("without computed outcomes every signal is pending and no rate is made up", () => {
    const { events, trades } = fixture();
    const bal = buildBalance(events, trades, new Map(), NOW);
    expect(bal.total).toMatchObject({ decided: 0, hitRate: null, avgR: null, hitCi: null, level: "keine", pending: 6 });
    expect(bal.comparison.all).toMatchObject({ n: 0, avgR: null });
    expect(bal.comparison.diff).toBeNull();
  });

  it("compares the trades with all signals – three readings and the difference, each with its n", () => {
    const { events, trades, outcomes } = fixture();
    const c = buildBalance(events, trades, outcomes, NOW).comparison;
    // decided: e1 +2, e2 −1, e3 +2, e5 +2, e6 −1 → mean 4/5
    expect(c.all.n).toBe(5);
    expect(c.all.avgR).toBeCloseTo(0.8, 6);
    // traded: e1 only (its outcome +2); the journal booked 3 R on it (300 on a 100 risk)
    expect(c.tradedSignals).toMatchObject({ n: 1, avgR: 2 });
    expect(c.tradedBooked.n).toBe(1);
    expect(c.tradedBooked.avgR).toBeCloseTo(3, 6);
    // the others that were decided: e2 −1, e3 +2, e5 +2, e6 −1 (left out or expired)
    expect(c.notTraded.n).toBe(4);
    expect(c.notTraded.avgR).toBeCloseTo(0.5, 6);
    expect(c.diff).toBeCloseTo(3 - 0.8, 6);
    expect(c.all.ci).not.toBeNull();
    expect(c.tradedSignals.ci).toBeNull(); // one value: no interval
  });

  it("a trade matched to two signals is booked once", () => {
    const { events, trades, outcomes } = fixture();
    const twin = signalEvent({ key: "twin", at: events[0]!.at + 60_000 });
    const withTwin = [...events, twin];
    const oc = new Map(outcomes).set(twin.id, out("stop"));
    const c = buildBalance(withTwin, trades, oc, NOW).comparison;
    expect(c.tradedSignals.n).toBe(2);
    expect(c.tradedBooked.n).toBe(1);
  });

  it("names the selection effect", () => {
    expect(SELECTION_NOTE).toContain("Auswahl");
    expect(SELECTION_NOTE).toContain("keine Aussage über die Qualität der Signale");
  });
});

describe("sampleLevel", () => {
  it("uses the week review's words", () => {
    expect([0, 3, 7, 12].map(sampleLevel)).toEqual(["keine", "zu wenig", "dünn", "tragfähig"]);
  });
});

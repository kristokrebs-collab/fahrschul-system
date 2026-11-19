/**
 * P04 edge finder / leak detection (`src/domain/coach/edges.ts`): the planted edge and leak are found with "klar",
 * pure noise produces no "klar" (Benjamini-Hochberg), the result is deterministic (seeded bootstrap, order-independent),
 * minN is respected and the confidence score is monotone.
 */
import { describe, expect, it } from "vitest";
import { detectBehaviors } from "@/domain/coach/events";
import { edgeConfidence, findEdges, EDGE_MIN_N } from "@/domain/coach/edges";
import { rng } from "@/domain/analytics/stats";
import type { Trade } from "@/domain/types";
import { at, COACH_SETTINGS, coachJournal, ct, enrichC } from "./coach.fixtures";

const closedOf = (ts: Trade[]) => enrichC(ts).filter((t) => t.result !== "open");

describe("Edge Finder", () => {
  const ts = coachJournal(90);
  const closed = closedOf(ts);
  const events = detectBehaviors({ trades: closed, settings: COACH_SETTINGS });
  const rep = findEdges(closed, { settings: COACH_SETTINGS, events });

  it("finds the planted edge and leak", () => {
    expect(rep.unit).toBe("R");
    expect(rep.edges.some((e) => e.id === "setup=s_good")).toBe(true);
    const good = rep.edges.find((e) => e.id === "setup=s_good")!;
    expect(good.mean).toBeGreaterThan(0);
    expect(good.diff).toBeGreaterThan(0);
    expect(good.ci!.lo).toBeGreaterThan(0);
    expect(good.diffCi!.lo).toBeGreaterThan(0);
    expect(["klar", "Tendenz"]).toContain(good.verdict);
    expect(good.confidence).toBeGreaterThan(50);
    const leakIds = rep.leaks.map((l) => l.id);
    expect(leakIds.some((id) => id.includes("setup=s_bad") || id.includes("behavior=revenge"))).toBe(true);
  });

  it("reports the FDR family size and minN", () => {
    expect(rep.tested).toBeGreaterThan(10);
    expect(rep.minN).toBe(EDGE_MIN_N);
    for (const c of [...rep.edges, ...rep.leaks]) expect(c.n).toBeGreaterThanOrEqual(EDGE_MIN_N);
  });

  it("is deterministic and independent of the input order", () => {
    const again = findEdges([...closed].reverse(), { settings: COACH_SETTINGS, events });
    const strip = (r: typeof rep) => [...r.edges, ...r.leaks].map((c) => ({ id: c.id, mean: c.mean, ci: c.ci, diffCi: c.diffCi, q: c.q, confidence: c.confidence, verdict: c.verdict }));
    expect(strip(again)).toEqual(strip(rep));
  });

  it("combinations add information over their parents", () => {
    for (const c of [...rep.edges, ...rep.leaks].filter((x) => x.factors.length === 2)) {
      expect(c.id).toContain("&");
      expect(c.n).toBeLessThan(closed.length);
    }
  });
});

describe("FDR auf Rauschen", () => {
  it("a journal of coin flips produces no 'klar' edge", () => {
    const rand = rng(99);
    const ts: Trade[] = [];
    for (let i = 0; i < 160; i++) {
      const win = rand() < 0.5;
      ts.push(ct(at(Math.floor(i / 2), 480 + (i % 2) * 300), { p: win ? 100 : -100, setups: [rand() < 0.5 ? "s_good" : "s_bad"], side: rand() < 0.5 ? "short" : "long", conviction: (1 + Math.floor(rand() * 5)) as 1 | 2 | 3 | 4 | 5, emotion: rand() < 0.5 ? "Ruhig" : "Unsicher" }));
    }
    const rep = findEdges(closedOf(ts), { settings: COACH_SETTINGS });
    expect([...rep.edges, ...rep.leaks].filter((c) => c.verdict === "klar")).toEqual([]);
    expect([...rep.edges, ...rep.leaks].length).toBeLessThanOrEqual(2);
  });
});

describe("Zu wenig Daten", () => {
  it("returns nothing below 2 · minN trades", () => {
    const ts = Array.from({ length: 10 }, (_, i) => ct(at(i, 600), { p: i % 2 ? 100 : -50 }));
    const rep = findEdges(closedOf(ts), { settings: COACH_SETTINGS });
    expect(rep.edges).toEqual([]);
    expect(rep.leaks).toEqual([]);
    expect(rep.tested).toBe(0);
  });
});

describe("Konfidenz", () => {
  it("rises with a smaller q, a clear interval and stability", () => {
    const base = { n: 40, p: 0.01, diffCi: { lo: 0.1, hi: 0.9 }, halves: { first: 0.4, second: 0.5, stable: true } };
    const strong = edgeConfidence({ ...base, q: 0.02 });
    const weak = edgeConfidence({ ...base, q: 0.4 });
    const unstable = edgeConfidence({ ...base, q: 0.02, halves: { first: 0.4, second: -0.1, stable: false } });
    expect(strong.confidence).toBeGreaterThan(weak.confidence);
    expect(strong.confidence).toBeGreaterThan(unstable.confidence);
    expect(strong.verdict).toBe("klar");
    expect(unstable.verdict).toBe("Tendenz");
    expect(edgeConfidence({ n: 8, p: 0.6, q: 0.9, diffCi: { lo: -1, hi: 1 }, halves: { first: null, second: null, stable: null } }).verdict).toBe("zu wenig Daten");
  });
});

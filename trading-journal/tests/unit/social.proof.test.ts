import { describe, expect, it } from "vitest";
import { enrichTrade } from "@/domain/enrich";
import type { EnrichedTrade, Settings } from "@/domain/types";
import { PROOF_MAX_TRADES, parseSharePayload, proofProblem, SharedProofSchema, type ProofTrade, type SharedProof } from "@/social/contract";
import { shareTitle } from "@/social/format";
import { compareProofs, proofFigures } from "@/social/proof";
import { buildProof, costInR, dayAgo, journalSpan } from "@/social/proofBuild";
import { mkTrade, settings } from "./domain.fixtures";

const S: Settings = settings();
const SETUP = S.setups[0]!;

/** entry 100, stop 90 → 10 per unit; size 500 → qty 5 → risk 50 in money */
function trade(id: string, date: string, over: Record<string, unknown> = {}): EnrichedTrade {
  return enrichTrade(mkTrade({ id, date, pair: "BTCUSDT", side: "long", entry: 100, stop: 90, exit: 110, size: 500, fees: 0, ...over } as never), S);
}

const P = (trades: ProofTrade[], over: Partial<SharedProof> = {}): SharedProof => ({
  v: 1,
  kind: "proof",
  strategy: "Breakout 4h",
  basis: "live",
  from: "2026-09-01",
  to: "2026-10-01",
  scope: { only: null, inPeriod: trades.length, open: 0 },
  trades,
  ...over,
});

const BASE: ProofTrade[] = [
  ["2026-09-03", 1.5, 0.04, "api"],
  ["2026-09-10", -1, 0.05, "api"],
  ["2026-09-20", -1.2, null, "manual"],
  ["2026-09-28", null, null, "csv"],
];

describe("Beleg: Kennzahlen aus der Liste (proofFigures)", () => {
  it("rechnet jede Zahl aus den Einträgen – Verluste und Trades ohne R inklusive", () => {
    const f = proofFigures(P(BASE));
    expect(f.n).toBe(4);
    expect(f.scored).toBe(3);
    expect(f.noR).toBe(1);
    expect(f.wins).toBe(1);
    expect(f.losses).toBe(2);
    expect(f.flat).toBe(0);
    expect(f.sumR).toBe(-0.7); // 1,5 − 1 − 1,2
    expect(f.expectancyR).toBe(-0.23);
    expect(f.winRate).toBe(33.3);
    expect(f.best).toBe(1.5);
    expect(f.worst).toBe(-1.2);
    expect(f.sumWithoutBest).toBe(-2.2); // without the luckiest trade the list is a loss of 2,2 R
    expect(f.profitFactor).toBe(0.68); // 1,5 / 2,2
    expect(f.curve).toEqual([0, 1.5, 0.5, expect.closeTo(-0.7, 10)]);
    expect(f.maxDrawdownR).toBe(2.2); // from the peak 1,5 down to −0,7
    expect(f.drawdownSpan).toEqual([1, 3]);
    expect(f.longestLosing).toBe(2);
    expect(f.spanDays).toBe(25);
  });

  it("Kosten: nur bekannte zählen, unbekannte werden benannt statt als 0 gerechnet", () => {
    const f = proofFigures(P(BASE));
    expect(f.costs).toEqual({ known: 2, unknown: 2, sumR: 0.09, avgR: 0.045 });
    expect(proofFigures(P([["2026-09-03", 1, null, "manual"]])).costs).toEqual({ known: 0, unknown: 1, sumR: 0, avgR: null });
  });

  it("Herkunft: Zählung je Weg und die Klasse der ganzen Liste (80 %)", () => {
    const f = proofFigures(P(BASE));
    expect(f.origins).toEqual({ api: 2, csv: 1, manual: 1, auto: 0 });
    expect(f.dataClass).toBe("mixed");
    const api = proofFigures(P(Array.from({ length: 5 }, (_, i) => ["2026-09-0" + (i + 1), 1, 0.01, i === 4 ? "csv" : "api"] as ProofTrade)));
    expect(api.dataClass).toBe("api");
  });

  it("ohne Trades mit R: keine erfundenen Zahlen", () => {
    const f = proofFigures(P([["2026-09-03", null, null, "manual"]]));
    expect(f.scored).toBe(0);
    expect(f.expectancyR).toBeNull();
    expect(f.winRate).toBeNull();
    expect(f.best).toBeNull();
    expect(f.sumWithoutBest).toBeNull();
    expect(f.profitFactor).toBeNull();
    expect(f.maxDrawdownR).toBe(0);
    expect(f.drawdownSpan).toBeNull();
    const empty = proofFigures(P([]));
    expect(empty.n).toBe(0);
    expect(empty.spanDays).toBeNull();
  });

  it("ein Gewinn-Glückstreffer fällt auf: die Summe ohne den besten Trade", () => {
    const f = proofFigures(P([["2026-09-01", 12, 0, "api"], ["2026-09-02", -1, 0, "api"], ["2026-09-03", -1, 0, "api"], ["2026-09-04", 0.5, 0, "api"]]));
    expect(f.sumR).toBe(10.5);
    expect(f.sumWithoutBest).toBe(-1.5);
  });

  it("ein Verlust bleibt in jeder Zahl: dieselbe Liste ohne ihn sähe anders aus", () => {
    const withLoss = proofFigures(P(BASE));
    const without = proofFigures(P(BASE.filter((t) => (t[1] ?? 0) >= 0)));
    expect(without.sumR).toBeGreaterThan(withLoss.sumR);
    expect(without.maxDrawdownR).toBeLessThan(withLoss.maxDrawdownR);
    expect(withLoss.losses).toBe(2);
  });
});

describe("Beleg: Fortschreibung (compareProofs)", () => {
  const prev = P(BASE.slice(0, 3), { to: "2026-09-25" });

  it("alles Frühere ist da, Neues kommt dazu → unverändert enthalten", () => {
    const c = compareProofs(prev, P(BASE));
    expect(c).toMatchObject({ expected: 3, kept: 3, added: 1, outside: 0, endsEarlier: false, narrowed: false, intact: true });
    expect(c.missing).toEqual([]);
  });

  it("ein weggelassener Verlust wird benannt", () => {
    const c = compareProofs(prev, P([BASE[0]!, BASE[2]!, BASE[3]!]));
    expect(c.intact).toBe(false);
    expect(c.missing).toEqual([BASE[1]]);
    expect(c.kept).toBe(2);
  });

  it("ein geänderter Wert zählt als fehlender Eintrag (gleicher Tag, anderes R)", () => {
    const c = compareProofs(prev, P([BASE[0]!, ["2026-09-10", -0.5, 0.05, "api"], BASE[2]!, BASE[3]!]));
    expect(c.missing).toEqual([BASE[1]]);
    expect(c.added).toBe(2);
  });

  it("Dubletten werden eins zu eins gezählt", () => {
    const twin = P([["2026-09-03", 1, 0, "api"], ["2026-09-03", 1, 0, "api"]], { to: "2026-09-25" });
    expect(compareProofs(twin, P([["2026-09-03", 1, 0, "api"]])).missing).toHaveLength(1);
    expect(compareProofs(twin, twin).intact).toBe(true);
  });

  it("ein späterer Beginn ist keine Entnahme; ein früheres Ende und eine engere Auswahl werden gemeldet", () => {
    const later = P(BASE.slice(1), { from: "2026-09-08" });
    const c = compareProofs(prev, later);
    expect(c.outside).toBe(1);
    expect(c.missing).toEqual([]);
    expect(compareProofs(P(BASE), P(BASE, { to: "2026-09-30" })).endsEarlier).toBe(true);
    expect(compareProofs(P(BASE), P(BASE, { scope: { only: "Breakout", inPeriod: 9, open: 0 } })).narrowed).toBe(true);
    expect(compareProofs(P(BASE), P(BASE, { scope: { only: "Breakout", inPeriod: 9, open: 0 } })).intact).toBe(false);
  });
});

describe("Beleg: Vertrag (Schema)", () => {
  it("nimmt einen gültigen Beleg und gibt ihm einen Titel", () => {
    const p = P(BASE);
    expect(parseSharePayload(p)).toEqual(p);
    expect(shareTitle(p)).toBe("Beleg · Breakout 4h · 4 Trades");
    expect(shareTitle(P([BASE[0]!]))).toBe("Beleg · Breakout 4h · 1 Trade");
  });

  it("kennt nur Liste, Zeitraum und Auswahl – kein Geld, kein Markt, keine Uhrzeit", () => {
    expect(SharedProofSchema.safeParse({ ...P(BASE), pnl: 1 }).success).toBe(false);
    expect(SharedProofSchema.safeParse({ ...P(BASE), balance: 20000 }).success).toBe(false);
    expect(SharedProofSchema.safeParse(P([["2026-09-03T10:00", 1, 0, "api"]])).success).toBe(false);
    expect(SharedProofSchema.safeParse(P([["2026-09-03", 1, 0, "api", "BTCUSDT"] as never])).success).toBe(false);
    expect(SharedProofSchema.safeParse(P([["2026-09-03", 1, 0, "binance" as never]])).success).toBe(false);
    expect(SharedProofSchema.safeParse({ ...P(BASE), scope: { only: null, inPeriod: 4, open: 0, account: "x" } }).success).toBe(false);
  });

  it("die Rechenregeln: Zeitraum, Reihenfolge, Vollständigkeit, höchstens 500", () => {
    expect(proofProblem(P(BASE))).toBeNull();
    expect(proofProblem(P(BASE, { to: "2026-08-01" }))).toMatch(/to before from/);
    expect(proofProblem(P(BASE, { from: "2024-01-01" }))).toMatch(/too long/);
    expect(proofProblem(P([BASE[1]!, BASE[0]!]))).toMatch(/time order/);
    expect(proofProblem(P(BASE, { to: "2026-09-25" }))).toMatch(/outside/);
    expect(proofProblem(P(BASE, { scope: { only: null, inPeriod: 9, open: 0 } }))).toMatch(/every trade/);
    expect(proofProblem(P(BASE, { scope: { only: "G", inPeriod: 3, open: 0 } }))).toMatch(/fewer/);
    expect(proofProblem(P(BASE, { scope: { only: "G", inPeriod: 9, open: 0 } }))).toBeNull();
    const many = (n: number) => P(Array.from({ length: n }, () => ["2026-09-15", 1, 0, "api"] as ProofTrade));
    expect(SharedProofSchema.safeParse(many(PROOF_MAX_TRADES)).success).toBe(true);
    expect(SharedProofSchema.safeParse(many(PROOF_MAX_TRADES + 1)).success).toBe(false);
  });
});

describe("Beleg: aus dem Journal bauen (buildProof)", () => {
  const J = [
    trade("w1", "2026-09-03T09:00", { exit: 115, fees: 2 }), // (115 − 100) · 5 − 2 = 73 → 1,46 R
    trade("l1", "2026-09-10T14:30", { exit: 95, fees: 2.5 }), // −25 − 2,5 = −27,5 → −0,55 R
    trade("l2", "2026-09-20T08:15", { exit: 90, fees: 0 }), // −50 → −1 R
    trade("m1", "2026-09-22T08:15", { exit: 112, pnlManual: 40, fees: 3 }), // hand-entered P&L → costs unknown
    trade("o1", "2026-09-25T08:15", { status: "open", exit: null }), // still open: not in the list
    trade("old", "2026-07-01T08:00", { exit: 120 }), // before the period
    trade("n1", "2026-09-28T08:00", { exit: 104, fees: null, setups: [SETUP.id] }), // no fees entered → costs unknown
  ];

  it("nimmt jeden geschlossenen Trade des Zeitraums, in zeitlicher Reihenfolge, ohne Markt und Uhrzeit", () => {
    const b = buildProof(J, S.setups, { strategy: " Breakout 4h ", basis: "live", from: "2026-09-01", to: "2026-10-01" });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const p = b.payload;
    expect(p.strategy).toBe("Breakout 4h");
    expect(p.trades.map((t) => t[0])).toEqual(["2026-09-03", "2026-09-10", "2026-09-20", "2026-09-22", "2026-09-28"]);
    expect(p.scope).toEqual({ only: null, inPeriod: 5, open: 1 });
    expect(p.trades[1]![1]).toBe(-0.55); // the loss is in
    expect(JSON.stringify(p)).not.toMatch(/BTCUSDT|T09:00|T14:30|pnl|notes|size|"fees"/);
    expect(SharedProofSchema.parse(p)).toEqual(p);
  });

  it("Kosten in R: Gebühren ÷ Risiko; Hand-P&L und fehlende Gebühren bleiben unbekannt, nie 0", () => {
    const b = buildProof(J, S.setups, { strategy: "x", basis: "demo", from: "2026-09-01", to: "2026-10-01" });
    if (!b.ok) throw new Error("expected a proof");
    expect(b.payload.trades.map((t) => t[2])).toEqual([0.04, 0.05, 0, null, null]);
    expect(costInR(J[3]!)).toBeNull();
    expect(costInR(J[6]!)).toBeNull();
    expect(costInR({ fees: 1, fundingFees: 0.5, fills: undefined, pnlManual: null, risk: 50 })).toBe(0.03);
    expect(costInR({ fees: null, fundingFees: 2, fills: undefined, pnlManual: null, risk: 50 })).toBe(0.04); // funding alone is known
    expect(costInR({ fees: 1, fundingFees: null, fills: undefined, pnlManual: null, risk: null })).toBeNull(); // no risk, no R scale
  });

  it("eine Grundlage als Auswahl: die Liste sagt, wie viele Trades der Zeitraum insgesamt hat", () => {
    const b = buildProof(J, S.setups, { strategy: "Nur Setup", basis: "live", from: "2026-09-01", to: "2026-10-01", setupId: SETUP.id });
    if (!b.ok) throw new Error("expected a proof");
    expect(b.payload.trades).toHaveLength(1);
    expect(b.payload.scope).toEqual({ only: SETUP.name.slice(0, 40), inPeriod: 5, open: 1 });
    expect(buildProof(J, S.setups, { strategy: "x", basis: "live", from: "2026-09-01", to: "2026-10-01", setupId: "gibt-es-nicht" })).toEqual({ ok: false, reason: "empty" });
  });

  it("sagt, warum nicht: ohne Namen, schlechter Zeitraum, leer – und kürzt nie still", () => {
    const o = { basis: "live" as const, from: "2026-09-01", to: "2026-10-01" };
    expect(buildProof(J, S.setups, { ...o, strategy: "  " })).toEqual({ ok: false, reason: "strategy" });
    expect(buildProof(J, S.setups, { ...o, strategy: "x", to: "2026-08-01" })).toEqual({ ok: false, reason: "range" });
    expect(buildProof(J, S.setups, { ...o, strategy: "x", from: "2024-01-01" })).toEqual({ ok: false, reason: "range" });
    expect(buildProof(J, S.setups, { ...o, strategy: "x", from: "2026-01-01", to: "2026-01-31" })).toEqual({ ok: false, reason: "empty" });
    const many = Array.from({ length: PROOF_MAX_TRADES + 1 }, (_, i) => trade(`t${i}`, "2026-09-15T10:00"));
    expect(buildProof(many, S.setups, { ...o, strategy: "x" })).toEqual({ ok: false, reason: "tooMany", count: PROOF_MAX_TRADES + 1 });
    expect(buildProof(many.slice(0, PROOF_MAX_TRADES), S.setups, { ...o, strategy: "x" }).ok).toBe(true);
  });

  it("die Fortschreibung merkt sich nur das Kürzel der früheren Fassung", () => {
    const b = buildProof(J, S.setups, { strategy: "x", basis: "live", from: "2026-09-01", to: "2026-10-01", prev: "AbCdEfGhIjKlMnOpQrStUv" });
    if (!b.ok) throw new Error("expected a proof");
    expect(b.payload.prev).toBe("AbCdEfGhIjKlMnOpQrStUv");
  });

  it("Zeitraum-Hilfen", () => {
    expect(journalSpan(J)).toEqual({ first: "2026-07-01", last: "2026-09-28" });
    expect(journalSpan([])).toBeNull();
    expect(dayAgo(new Date(2026, 9, 12, 15, 0), 0)).toBe("2026-10-12");
    expect(dayAgo(new Date(2026, 9, 12, 15, 0), 90)).toBe("2026-07-14");
    expect(dayAgo(new Date(2026, 2, 1, 0, 30), 1)).toBe("2026-02-28");
  });
});

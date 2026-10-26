/** P05 exposure, correlation, scenario, streak risk and risk per strategy / asset. */
import { describe, expect, it } from "vitest";
import {
  assetOf,
  clusterRisks,
  correlationClusters,
  correlationMatrix,
  exposureReport,
  liquidationShock,
  logReturns,
  pearson,
  riskSpread,
  riskWarnings,
  scenarioAt,
  scenarioCurve,
  streakDrawdown,
  streakRisk,
  symbolOf,
  limitStatus,
  type DailyClose,
  type ScenarioLeg,
  type VenuePosition,
} from "@/domain/risk";
import type { Trade, TradeResult } from "@/domain/types";
import { mkTrade } from "./domain.fixtures";
import { enrich, qt, settingsWith } from "./insights.fixtures";

const openT = (id: string, pair: string, side: "long" | "short", entry: number, size: number, extra: Partial<Trade> = {}): Trade =>
  mkTrade({ id, date: "2026-10-14T09:00", status: "open", pair, side, entry, size, stop: side === "long" ? entry * 0.95 : entry * 1.05, ...extra });

const pos = (p: Partial<VenuePosition> & { id: string; symbol: string }): VenuePosition => ({
  exchange: "bitunix",
  side: "long",
  qty: 1,
  entry: 100,
  mark: 110,
  leverage: 5,
  marginMode: "isolated",
  margin: 20,
  liqPrice: 82,
  unrealizedPnl: 10,
  ...p,
});

describe("Exposure", () => {
  it("assets and symbols from free pair text", () => {
    expect(assetOf("BTC/USDT")).toBe("BTC");
    expect(assetOf("BINANCE:ETHUSDT.P")).toBe("ETH");
    expect(assetOf("solusdt")).toBe("SOL");
    expect(assetOf("")).toBe("–");
    expect(symbolOf("btc/usdt")).toBe("BTCUSDT");
    expect(symbolOf("ETH")).toBe("ETHUSDT");
  });

  it("gross / net per asset, hedges, HHI, live marks → uPnL; journal only without P11", () => {
    const open = enrich([openT("a", "BTC/USDT", "long", 100, 1000), openT("b", "BTC/USDT", "short", 100, 400), openT("c", "ETH/USDT", "long", 50, 500)]);
    const r = exposureReport({ open, prices: { BTCUSDT: 110 }, capital: 1000 });
    expect(r.sources).toEqual({ journal: 3, exchange: 0 });
    const btc = r.byAsset.find((g) => g.key === "BTC")!;
    expect(btc.long).toBeCloseTo(1100, 8); // 10 × 110
    expect(btc.short).toBeCloseTo(440, 8);
    expect(btc.hedged).toBeCloseTo(440, 8);
    expect(r.gross).toBeCloseTo(1100 + 440 + 500, 8);
    expect(r.net).toBeCloseTo(1100 - 440 + 500, 8);
    expect(r.netRatio).toBeCloseTo(r.net / r.gross, 10);
    expect(r.leverage).toBeCloseTo(r.gross / 1000, 10);
    const shares = r.byAsset.map((g) => g.share);
    expect(r.hhi).toBeCloseTo(shares.reduce((s, x) => s + x * x, 0), 10);
    expect(r.upnl).toBeCloseTo(10 * 10 - 4 * 10, 8);
    expect(r.legs.find((l) => l.tradeId === "c")!.upnl).toBeNull();
  });

  it("a journal trade that is a venue position counts once (venue wins); cross-venue concentration", () => {
    const open = enrich([openT("a", "BTC/USDT", "long", 100, 100, { exchange: "bitunix" }), openT("b", "ETH/USDT", "long", 100, 100, { externalId: "p2" })]);
    const positions = [pos({ id: "p1", symbol: "BTCUSDT" }), pos({ id: "p2", symbol: "ETHUSDT" }), pos({ id: "p3", symbol: "BTCUSDT", exchange: "binance" })];
    const r = exposureReport({ open, positions });
    expect(r.legs).toHaveLength(3);
    expect(r.sources).toEqual({ journal: 0, exchange: 3 });
    expect(r.crossVenue).toEqual(["BTC"]);
    expect(r.byVenue.map((v) => v.key).sort()).toEqual(["binance", "bitunix"]);
    expect(r.upnl).toBeCloseTo(30, 10);
  });

  it("concentration and cross-venue warnings", () => {
    const open = enrich([openT("a", "BTC/USDT", "long", 100, 900), openT("b", "ETH/USDT", "long", 100, 100)]);
    const s = settingsWith({ capital: { makro: 10_000, scalp: 1000 } });
    const report = limitStatus({ trades: open, settings: s, scope: "scalp", now: Date.now() });
    const w = riskWarnings({ report, exposure: exposureReport({ open }), now: Date.now() });
    expect(w.some((x) => x.key === "exposure:concentration:BTC")).toBe(true);
  });
});

describe("Korrelation", () => {
  const day = 86_400_000;
  const series = (fn: (i: number) => number, n = 60): DailyClose[] => Array.from({ length: n }, (_, i) => ({ t: i * day, c: fn(i) }));
  const noise = (i: number, k: number) => Math.sin(i * k) * 0.02;

  it("log returns and Pearson", () => {
    const r = logReturns([{ t: 0, c: 100 }, { t: day, c: 110 }]);
    expect(r.get(day)).toBeCloseTo(Math.log(1.1), 12);
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pearson([1, 2], [1, 2])).toBeNull();
  });

  it("matrix aligned by day; cluster of the pairs moving together; same-side legs in a cluster warn", () => {
    let a = 100;
    let b = 50;
    let c = 10;
    const A: DailyClose[] = [];
    const B: DailyClose[] = [];
    const C: DailyClose[] = [];
    for (let i = 0; i < 80; i++) {
      const m = noise(i, 1.7);
      a *= 1 + m;
      b *= 1 + m * 0.9 + noise(i, 5.3) * 0.1;
      c *= 1 + noise(i, 0.37);
      A.push({ t: i * day, c: a });
      B.push({ t: i * day, c: b });
      C.push({ t: i * day, c: c });
    }
    const cm = correlationMatrix({ BTCUSDT: A, ETHUSDT: B, XRPUSDT: C.slice(40) });
    expect(cm.symbols).toEqual(["BTCUSDT", "ETHUSDT", "XRPUSDT"]);
    expect(cm.rho[0]![1]).toBeGreaterThan(0.9);
    expect(cm.rho[0]![0]).toBe(1);
    expect(cm.n[0]![2]).toBe(39);
    const cl = correlationClusters(cm);
    expect(cl).toHaveLength(1);
    expect(cl[0]!.symbols.sort()).toEqual(["BTCUSDT", "ETHUSDT"]);
    const risks = clusterRisks(cl, [
      { symbol: "BTCUSDT", side: "long", notional: 1000 },
      { symbol: "ETHUSDT", side: "long", notional: 500 },
      { symbol: "XRPUSDT", side: "long", notional: 100 },
    ]);
    expect(risks).toHaveLength(1);
    expect(risks[0]!.notional).toBe(1500);
    expect(clusterRisks(cl, [{ symbol: "BTCUSDT", side: "long", notional: 1 }, { symbol: "ETHUSDT", side: "short", notional: 1 }])).toEqual([]);
    // too little overlap → null, never a guess
    expect(correlationMatrix({ A: series((i) => 100 + i), B: series((i) => 100 + i).slice(-5) }).rho[0]![1]).toBeNull();
  });
});

describe("Szenario", () => {
  const legs: ScenarioLeg[] = [
    { id: "l", label: "BTC Long", side: "long", qty: 1, entry: 100, price: 110, margin: 20, liqPrice: 82 },
    { id: "s", label: "ETH Short", side: "short", qty: 2, entry: 50, price: 50, margin: null, liqPrice: null },
  ];

  it("shock → P&L against now, liquidation caps the isolated loss at the margin", () => {
    const up = scenarioAt(legs, 0.1, 1000);
    expect(up.pnl).toBeCloseTo(11 - 10, 10);
    expect(up.liquidated).toEqual([]);
    const crash = scenarioAt(legs, -0.3, 1000);
    // long: 110 → 77 ≤ 82 → liquidated: −(20 + 10 uPnL now) = −30; short: +2 × 15 = +30
    expect(crash.liquidated).toEqual(["l"]);
    expect(crash.legs[0]!.pnl).toBeCloseTo(-30, 10);
    expect(crash.pnl).toBeCloseTo(0, 10);
    expect(crash.equityAfter).toBeCloseTo(1000, 10);
    expect(scenarioAt(legs, 0, 1000).marginLoad).toBeCloseTo(20 / 1000, 10);
  });

  it("curve over the range and the shock of each liquidation", () => {
    const c = scenarioCurve(legs, 0.3, 61);
    expect(c.shocks).toHaveLength(61);
    expect(c.shocks[0]).toBeCloseTo(-0.3, 10);
    expect(c.shocks[30]).toBeCloseTo(0, 10);
    expect(c.pnl[30]).toBeCloseTo(0, 10);
    expect(liquidationShock(legs[0]!)).toBeCloseTo(82 / 110 - 1, 10);
    expect(liquidationShock(legs[1]!)).toBeNull();
  });
});

describe("Serien-Risiko", () => {
  const seqOf = (s: string): TradeResult[] => s.split("").map((c) => (c === "w" ? "win" : c === "l" ? "loss" : "be"));

  it("expectation vs. the current streak, MC from the own R, drawdown of a streak", () => {
    const results = seqOf("wlwwlwlwwlwlwwlwlwll");
    const sample = results.map((r) => (r === "win" ? 1.5 : -1));
    const s = streakRisk({ results, sample, riskPct: 0.01, horizon: 100 });
    expect(s.n).toBe(20);
    expect(s.winRate).toBeCloseTo(11 / 20, 10);
    expect(s.expected).toBeGreaterThan(4);
    expect(s.mc).not.toBeNull();
    expect(s.mc!.p95).toBeGreaterThanOrEqual(s.mc!.p50);
    expect(s.current).toEqual({ kind: "loss", length: 2 });
    expect(["normal", "erhöht"]).toContain(s.status);
    expect(s.ddExpected).toBeCloseTo(streakDrawdown(Math.round(s.expected), 0.01), 12);
    // deterministic (seeded)
    expect(streakRisk({ results, sample, riskPct: 0.01 }).mc).toEqual(s.mc);
    const akut = streakRisk({ results: [...results, ...seqOf("llllll")], sample: [...sample, -1, -1, -1, -1, -1, -1], riskPct: 0.01 });
    expect(akut.status).toBe("akut");
    expect(streakRisk({ results: seqOf("wl"), sample: [1, -1], riskPct: 0.01 }).status).toBe("zu wenig");
    expect(streakDrawdown(5, 0.02)).toBeCloseTo(1 - 0.98 ** 5, 12);
  });
});

describe("Risiko je Strategie und Asset", () => {
  it("risk % of the account capital per setup / asset: mean, sd, max, consistency, above the limit", () => {
    const s = settingsWith({ capital: { makro: 10_000, scalp: 1000 }, setups: [{ id: "s_bo", name: "Breakout", account: "both", color: "#fff", desc: "", checklist: [] }] });
    const closed = enrich(
      [
        qt("2026-10-01T10:00", { p: 10, risk: 10 }),
        qt("2026-10-02T10:00", { p: 10, risk: 10 }),
        qt("2026-10-03T10:00", { p: 10, risk: 30, pair: "ETH/USDT" }),
        qt("2026-10-04T10:00", { p: 10, risk: 10, setups: [] }),
        mkTrade({ id: "x", date: "2026-10-05T10:00", pnlManual: 5 }),
      ],
      s,
    );
    const bySetup = riskSpread(closed, s, "setup", 0.02);
    expect(bySetup.missing).toBe(1);
    const bo = bySetup.rows.find((r) => r.key === "s_bo")!;
    expect(bo.label).toBe("Breakout");
    expect(bo.n).toBe(3);
    expect(bo.mean).toBeCloseTo((0.01 + 0.01 + 0.03) / 3, 10);
    expect(bo.max).toBeCloseTo(0.03, 10);
    expect(bo.over).toBe(1);
    expect(bo.consistency).toBeGreaterThanOrEqual(0);
    expect(bySetup.rows.find((r) => r.key === "__none")!.label).toBe("Ohne Grundlage");
    const byAsset = riskSpread(closed, s, "asset", 0.02);
    expect(byAsset.rows.map((r) => r.key)).toEqual(["BTC", "ETH"]);
    expect(byAsset.overall!.n).toBe(4);
  });
});

describe("Partial exits (review MM-1): only what is still held counts as open exposure", () => {
  // what the editor stores for a trade with fills: Ø entry, qty = Σ opened, size = Ø × Σ opened
  const partial = (extra: Partial<Trade> = {}): Trade =>
    mkTrade({
      id: "p1",
      date: "2026-10-13T08:00",
      status: "open",
      exit: null,
      pair: "BTC/USDT",
      side: "long",
      entry: 60000,
      stop: 59000,
      target: 63000,
      size: 120000,
      qty: 2,
      leverage: 5,
      fills: [
        { id: "a", at: "2026-10-13T08:00", side: "open", price: 60000, qty: 2, kind: "entry" },
        { id: "b", at: "2026-10-13T09:00", side: "close", price: 61500, qty: 1, kind: "partial" },
      ],
      ...extra,
    });

  it("exposure, uPnL, margin and risk of the leg use the remaining 1 BTC, not the 2 opened", () => {
    const [t] = enrich([partial()]);
    const r = exposureReport({ open: [t!], prices: { BTCUSDT: 61500 }, capital: 10000 });
    const leg = r.legs[0]!;
    expect(leg).toMatchObject({ qty: 1, entry: 60000 });
    expect(r.gross).toBeCloseTo(61500, 8);
    expect(r.upnl).toBeCloseTo(1500, 8);
    expect(leg.margin).toBeCloseTo(12000, 8); // 1 × 60000 ÷ 5
    expect(leg.risk).toBeCloseTo(1000, 8);
    // the trade's own R basis stays the initial position (2 BTC × 1000 to the stop)
    expect(t!.risk).toBeCloseTo(2000, 8);
  });

  it("the running Ø entry of what is held (DCA add after a partial)", () => {
    const [t] = enrich([
      partial({
        fills: [
          { id: "a", at: "2026-10-13T08:00", side: "open", price: 60000, qty: 2, kind: "entry" },
          { id: "b", at: "2026-10-13T09:00", side: "close", price: 61500, qty: 1, kind: "partial" },
          { id: "c", at: "2026-10-13T10:00", side: "open", price: 63000, qty: 1, kind: "add" },
        ],
      }),
    ]);
    const leg = exposureReport({ open: [t!], prices: { BTCUSDT: 62000 } }).legs[0]!;
    expect(leg.qty).toBeCloseTo(2, 8);
    expect(leg.entry).toBeCloseTo(61500, 8);
    expect(leg.upnl).toBeCloseTo(1000, 8);
    expect(leg.risk).toBeCloseTo(5000, 8); // |61500 − 59000| × 2
  });

  it("everything closed by fills while the status is still open: no leg at all", () => {
    const [t] = enrich([
      partial({
        fills: [
          { id: "a", at: "2026-10-13T08:00", side: "open", price: 60000, qty: 2, kind: "entry" },
          { id: "b", at: "2026-10-13T09:00", side: "close", price: 61500, qty: 2, kind: "exit" },
        ],
      }),
    ]);
    expect(exposureReport({ open: [t!], prices: { BTCUSDT: 61500 } }).legs).toEqual([]);
  });

  it("open risk limit: 1000 for the remainder, nothing once the stop sits at the entry", () => {
    const s = settingsWith({ capital: { makro: 10_000, scalp: 100_000 } });
    const now = new Date(2026, 9, 13, 10, 0).getTime();
    const report = limitStatus({ trades: enrich([partial()], s), settings: s, scope: "scalp", now });
    expect(report.rows.find((x) => x.key === "openRisk")!.used).toBeCloseTo(1000, 8);
    const be = limitStatus({ trades: enrich([partial({ stop: 60000 })], s), settings: s, scope: "scalp", now });
    expect(be.rows.find((x) => x.key === "openRisk")!.used).toBe(0);
    expect(be.openNoStop).toBe(0);
  });
});

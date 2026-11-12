// @vitest-environment node
/// <reference types="node" />
/**
 * P11 mapping (`netlify/functions/_lib/exchanges/mapping.ts`): realistic Bitunix payloads (tests/fixtures/bitunix-*.json,
 * shapes per the official docs) → journal trades: net P&L and sign conventions, local wall clock per time zone,
 * TP/SL → stop / target / history / ladder, fills (DCA + partial exit), the upsert item split and live positions.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseClosedPosition, parseFill, parseOpenPosition, parseTpSl } from "../../netlify/functions/_lib/exchanges/bitunix";
import {
  detectPnlConvention,
  fillsOf,
  localWallClock,
  mapClosedPosition,
  mapOpenPosition,
  netPnl,
  safeTz,
  stopTargetOf,
  symbolToPair,
  type MapContext,
} from "../../netlify/functions/_lib/exchanges/mapping";
import type { VenueClosedPosition, VenueFill, VenueTpSl } from "../../netlify/functions/_lib/exchanges/types";
import { SYNC_FILL_KEYS, SYNC_SET_KEYS } from "../../src/exchanges/syncFields";
import { normalizeTrade } from "../../src/domain/normalize";
import { deriveTrade } from "../../src/domain/derive";
import type { Trade } from "../../src/domain/types";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as { data: Record<string, unknown> };
const positions = (fixture("bitunix-history-positions.json").data.positionList as Record<string, unknown>[]).map((r) => parseClosedPosition(r)!) as VenueClosedPosition[];
const fills = (fixture("bitunix-history-trades.json").data.tradeList as Record<string, unknown>[]).map((r) => parseFill(r)!) as VenueFill[];
const tpsl = (fixture("bitunix-tpsl-history.json").data.orderList as Record<string, unknown>[]).map((r) => parseTpSl(r)!) as VenueTpSl[];
const byId = (id: string) => positions.find((p) => p.positionId === id)!;

const NOW = "2026-10-12T07:15:00.000Z";
const ctx = (over: Partial<MapContext> = {}): MapContext => ({ exchange: "bitunix", tz: "Europe/Berlin", journalAccount: "scalp", nowIso: NOW, tpsl, ...over });

describe("pairs, zones, wall clock", () => {
  it("symbol → journal pair", () => {
    expect(symbolToPair("BTCUSDT")).toBe("BTC/USDT");
    expect(symbolToPair("1000PEPEUSDT")).toBe("1000PEPE/USDT");
    expect(symbolToPair("ETHUSDC")).toBe("ETH/USDC");
    expect(symbolToPair("ETHBTC")).toBe("ETH/BTC");
    expect(symbolToPair("WEIRD")).toBe("WEIRD");
  });

  it("local wall clock per IANA zone (DST aware), invalid zones fall back to Europe/Berlin", () => {
    const t = Date.parse("2026-10-05T07:30:12Z");
    expect(localWallClock(t, "Europe/Berlin")).toBe("2026-10-05T09:30");
    expect(localWallClock(t, "Europe/Berlin", true)).toBe("2026-10-05T09:30:12");
    expect(localWallClock(t, "America/New_York")).toBe("2026-10-05T03:30");
    expect(localWallClock(Date.parse("2026-12-05T07:30:00Z"), "Europe/Berlin")).toBe("2026-12-05T08:30"); // CET
    expect(localWallClock(Date.parse("2026-10-05T22:30:00Z"), "Asia/Tokyo")).toBe("2026-10-06T07:30"); // day rolls over
    expect(safeTz("Mars/Olympus")).toBe("Europe/Berlin");
    expect(safeTz(undefined)).toBe("Europe/Berlin");
  });
});

describe("P&L convention", () => {
  it("documented convention: realizedPNL is the gross move → detected as fees excluded", () => {
    const c = detectPnlConvention(positions);
    expect(c.feesIncluded).toBe(false);
    expect(c.votesExcluded).toBe(4); // the liquidated XRP position does not vote
    expect(c.votesIncluded).toBe(0);
  });

  it("detects a venue that already subtracts the fees and never subtracts them twice", () => {
    const inc = positions.map((p) => ({ ...p, realizedPnl: Math.round(((p.closePrice - p.entryPrice) * p.maxQty * (p.side === "short" ? -1 : 1) - Math.abs(p.fee)) * 1e6) / 1e6 }));
    expect(detectPnlConvention(inc).feesIncluded).toBe(true);
    const btc = inc.find((p) => p.positionId === "1844291077356544000")!;
    expect(netPnl(btc, true)).toBe(59.1829); // 62 − 2.5048 − 0.3123 funding paid
  });

  it("undecided with fewer than 3 clean positions", () => {
    expect(detectPnlConvention(positions.slice(0, 2)).feesIncluded).toBeNull();
  });

  it("net = realized − |fee| + funding (funding < 0 is paid)", () => {
    expect(netPnl({ realizedPnl: 62, fee: 2.5048, funding: -0.3123 }, false)).toBe(59.1829);
    expect(netPnl({ realizedPnl: -37.92, fee: 2.3713, funding: 0.4102 }, false)).toBe(-39.8811);
    expect(netPnl({ realizedPnl: 10, fee: -1, funding: 0 }, false)).toBe(9); // a fee reported negative is still a cost
  });
});

describe("closed position → trade", () => {
  it("BTC long: ids, times, quantities, fees, funding, net P&L, TP/SL", () => {
    const m = mapClosedPosition(byId("1844291077356544000"), ctx());
    const t = m.trade;
    expect(t).toMatchObject({
      id: "t_bx_1844291077356544000",
      externalId: "1844291077356544000",
      exchange: "bitunix",
      syncSource: "bitunix-api",
      syncedAt: NOW,
      origin: { kind: "api" },
      market: "perp",
      account: "scalp",
      side: "long",
      status: "closed",
      pair: "BTC/USDT",
      date: "2026-10-05T09:30",
      exitDate: "2026-10-05T13:02",
      entry: 62000,
      exit: 63240,
      qty: 0.05,
      size: 3100,
      leverage: 10,
      marginMode: "isolated",
      fees: 2.5048,
      fundingFees: 0.3123,
      pnlManual: 59.1829,
      pnl: 59.1829,
      stop: 61200,
      target: 64000,
      r: 1.4796,
      setups: [],
      notes: "",
      emotion: "",
      timeframe: "",
    });
    expect(t.stopHistory).toEqual([
      { at: "2026-10-05T09:30", price: 61200, source: "exchange" },
      { at: "2026-10-05T12:10", price: 62500, source: "exchange" },
    ]);
    expect(t.targets).toBeUndefined();
    expect(t.fills).toBeUndefined();
    expect(m.check).toMatchObject({ gross: 62, realizedPnl: 62, fee: 2.5048, funding: -0.3123, net: 59.1829 });
  });

  it("ETH short: funding received lowers the cost, TP ladder with shares", () => {
    const t = mapClosedPosition(byId("1844720365120983041"), ctx({ journalAccount: "makro", exchangeAccount: "Main" })).trade;
    expect(t).toMatchObject({ side: "short", account: "makro", exchangeAccount: "Main", fundingFees: -0.4102, pnlManual: -39.8811, stop: 2510, target: 2380, marginMode: "cross" });
    expect(t.targets).toEqual([
      { price: 2380, qty: 0.6, pct: 50 },
      { price: 2320, qty: 0.6, pct: 50 },
    ]);
  });

  it("liquidated XRP: loss incl. fee and funding, no stop invented", () => {
    const t = mapClosedPosition(byId("1845710492211843077"), ctx()).trade;
    expect(t).toMatchObject({ pnlManual: -279.9, stop: null, target: null, r: null, liqPrice: 0.5574 });
  });

  it("BTC short with fills: DCA entry + partial exit, fees per fill, local time with seconds", () => {
    const t = mapClosedPosition(byId("1846203915577018372"), ctx({ fills })).trade;
    expect(t.fills).toEqual([
      { id: "bx_90014", at: "2026-10-10T10:10:00", side: "open", price: 63700, qty: 0.04, kind: "entry", fee: 1 },
      { id: "bx_90015", at: "2026-10-10T10:42:10", side: "open", price: 63300, qty: 0.04, kind: "add", fee: 1.01 },
      { id: "bx_90016", at: "2026-10-10T11:20:00", side: "close", price: 63000, qty: 0.03, kind: "partial", fee: 0.75 },
      { id: "bx_90017", at: "2026-10-10T11:55:55", side: "close", price: 62920, qty: 0.05, kind: "exit", fee: 1.3 },
    ]);
    expect(t.pnlManual).toBe(39.94);
  });

  it("an incomplete fill list (cut-off page) is dropped instead of half-stored", () => {
    expect(fillsOf(fills.slice(1), "short", "Europe/Berlin")).toBeNull(); // last exit missing → not flat
    expect(fillsOf([], "short", "Europe/Berlin")).toBeNull();
    const noSide = fills.map((f) => ({ ...f, side: null }));
    expect(fillsOf(noSide, "short", "Europe/Berlin")?.map((f) => f.kind)).toEqual(["entry", "add", "partial", "exit"]); // reduceOnly decides
  });

  it("the journal derives the same P&L / R as the sync wrote, and the record normalises losslessly", () => {
    for (const p of positions) {
      const t = normalizeTrade(mapClosedPosition(p, ctx({ fills })).trade) as Trade;
      const d = deriveTrade(t);
      expect(d.pnl).toBe(t.pnlManual);
      expect(d.result).toBe((t.pnlManual ?? 0) > 0 ? "win" : "loss");
      expect(t.exchange).toBe("bitunix");
      expect(t.origin).toEqual({ kind: "api" });
    }
  });

  it("upsert item: SET keys only from the exchange list, FILL only stop/target family, trader fields only in `new`", () => {
    const { item } = mapClosedPosition(byId("1844291077356544000"), ctx());
    expect(Object.keys(item.set).every((k) => (SYNC_SET_KEYS as readonly string[]).includes(k))).toBe(true);
    expect(Object.keys(item.fill).every((k) => (SYNC_FILL_KEYS as readonly string[]).includes(k))).toBe(true);
    expect(item.fill).toMatchObject({ stop: 61200, target: 64000 });
    for (const k of ["notes", "setups", "emotion", "checks", "account", "timeframe", "mistakes"]) {
      expect(item.set).not.toHaveProperty(k);
      expect(item.new).toHaveProperty(k);
    }
  });

  it("stopTargetOf: consecutive equal SL prices are one entry, single SL → no history", () => {
    const o = (id: string, at: number, sl: number | null, tp: number | null): VenueTpSl => ({ id, positionId: "p", symbol: "X", tpPrice: tp, slPrice: sl, tpQty: null, slQty: null, status: "", createdAt: at, triggeredAt: null });
    expect(stopTargetOf([o("a", 1, 10, null), o("b", 2, 10, 20)], "UTC", 1)).toEqual({ stop: 10, target: 20 });
    expect(stopTargetOf([o("b", 2, 9, null), o("a", 1, 10, null)], "UTC", 1).stopHistory?.map((s) => s.price)).toEqual([10, 9]);
  });
});

describe("open position → live position (P05 contract)", () => {
  const open = (fixture("bitunix-pending-positions.json").data as unknown as Record<string, unknown>[]).map((r) => parseOpenPosition(r)!);
  it("mark from the ticker, notional = qty × mark, funding paid positive", () => {
    const p = mapOpenPosition(open[0]!, "bitunix", { symbol: "BTCUSDT", markPrice: 63920.5, lastPrice: 63921 }, 1, "Main");
    expect(p).toMatchObject({ id: "1846609912001233921", exchange: "bitunix", account: "Main", symbol: "BTCUSDT", side: "long", qty: 0.06, entry: 63800, mark: 63920.5, notional: 3835.23, leverage: 10, marginMode: "isolated", margin: 382.8, liqPrice: 57716.2, unrealizedPnl: 18.6, fundingFees: 0.21, openedAt: 1791720000000 });
  });
  it("without a ticker the mark is derived from the unrealized P&L (short: sign flipped)", () => {
    expect(mapOpenPosition(open[0]!, "bitunix", undefined, 1).mark).toBe(64110);
    const eth = mapOpenPosition(open[1]!, "bitunix", undefined, 1);
    expect(eth).toMatchObject({ entry: 2460, mark: 2475.5, liqPrice: null, fundingFees: -0.12 });
  });
});

// @vitest-environment node
/**
 * The Binance adapter against a fake venue (Form laut Dokumentation – NICHT live geprüft, die Sandbox erreicht Binance
 * nicht): every request is signed and verified, only GET and only the allowed read paths are called, history is read in
 * the venue's windows, positions are rebuilt from fills, errors come back in German.
 */
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { BINANCE_READ_PATHS, binanceAdapter, BinanceClient } from "../../netlify/functions/_lib/exchanges/binance";
import { ExchangeError } from "../../netlify/functions/_lib/exchanges/types";
import { fut, income, newVenue, resetSeq, spot, venueRuntime, type BinanceVenue } from "./helpers/binanceVenue";

const DAY = 86_400_000;
let venue: BinanceVenue;
let sleeps: number[];

const creds = () => ({ apiKey: venue.key, secret: venue.secret });
const futures = () => binanceAdapter(creds(), venueRuntime(venue, sleeps), { market: "futures" });
const spotAdapter = (symbols?: string[]) => binanceAdapter(creds(), venueRuntime(venue, sleeps), { market: "spot", symbols });
const window = (days: number) => ({ startTime: venue.now - days * DAY, endTime: venue.now });

beforeEach(() => {
  resetSeq();
  venue = newVenue({ now: 1_790_000_000_000 });
  sleeps = [];
});
afterEach(() => undefined);

function seedFutures(): void {
  const t = venue.now - 5 * DAY;
  venue.futuresTrades = [
    fut({ id: 1, side: "BUY", price: 60000, qty: 0.1, fee: 0.6, at: t }),
    fut({ id: 2, side: "SELL", price: 62000, qty: 0.1, pnl: 200, fee: 0.62, at: t + 3_600_000 }),
    fut({ id: 3, symbol: "ETHUSDT", side: "SELL", price: 3100, qty: 2, fee: 0.3, at: t + 2 * 3_600_000 }),
    fut({ id: 4, symbol: "ETHUSDT", side: "BUY", price: 3000, qty: 2, pnl: 200, fee: 0.3, at: t + 3 * 3_600_000 }),
  ];
  venue.income = [
    income("BTCUSDT", "REALIZED_PNL", 200, t + 3_600_000),
    income("ETHUSDT", "REALIZED_PNL", 200, t + 3 * 3_600_000),
    income("BTCUSDT", "FUNDING_FEE", -0.25, t + 1_800_000),
    income("", "TRANSFER", 1000, t - DAY),
  ];
}

describe("futures", () => {
  it("validate: signed GET of the futures balance, no secret in the URL", async () => {
    const a = futures();
    const acc = await a.validate();
    expect(acc).toMatchObject({ marginCoin: "USDT", available: 800.5, unrealizedPnl: 12.25 });
    const call = venue.calls[0]!;
    expect(call).toMatchObject({ method: "GET", path: "/fapi/v3/balance", host: "fapi.binance.com" });
    expect(JSON.stringify(venue.calls)).not.toContain(venue.secret);
  });

  it("rebuilds positions of every traded symbol from the fills and adds the funding", async () => {
    seedFutures();
    const a = futures();
    const res = await a.fetchClosedPositions(window(30));
    expect(res.complete).toBe(true);
    const byId = Object.fromEntries(res.items.map((p) => [p.positionId, p]));
    expect(Object.keys(byId).sort()).toEqual(["f-BTCUSDT-1", "f-ETHUSDT-3"]);
    expect(byId["f-BTCUSDT-1"]).toMatchObject({ side: "long", entryPrice: 60000, closePrice: 62000, realizedPnl: 200, funding: -0.25 });
    expect(byId["f-BTCUSDT-1"]!.fee).toBeCloseTo(1.22, 8);
    expect(byId["f-ETHUSDT-3"]).toMatchObject({ side: "short", realizedPnl: 200 });
    // the fills of a position are served without another request
    const before = venue.calls.length;
    const fills = await a.fetchFills({ positionId: "f-BTCUSDT-1" });
    expect(fills.items.map((f) => f.tradeId)).toEqual(["1", "2"]);
    expect(venue.calls.length).toBe(before);
    expect(a.notes?.()).toMatchObject({ orphanFills: 0, symbols: 2 });
  });

  it("ONLY signed GETs of the allowed read paths ever go out; every user trade request spans at most 7 days", async () => {
    seedFutures();
    const a = futures();
    await a.validate();
    await a.fetchClosedPositions(window(40));
    await a.fetchOpenPositions();
    expect(venue.calls.length).toBeGreaterThan(4);
    for (const c of venue.calls) {
      expect(c.method).toBe("GET");
      expect(BINANCE_READ_PATHS.has(c.path)).toBe(true);
      if (c.path === "/fapi/v1/userTrades") expect(Number(c.query.endTime) - Number(c.query.startTime)).toBeLessThanOrEqual(7 * DAY);
    }
    expect(venue.calls.some((c) => /order|withdraw|transfer/i.test(c.path))).toBe(false);
  });

  it("the client refuses any path outside the allowlist, before a request is made", async () => {
    const client = new BinanceClient(creds(), venueRuntime(venue, sleeps));
    await expect(client.get("spot", "/api/v3/order")).rejects.toMatchObject({ code: "forbidden_path" });
    await expect(client.get("spot", "/sapi/v1/capital/withdraw/apply")).rejects.toMatchObject({ code: "forbidden_path" });
    expect(venue.calls).toHaveLength(0);
  });

  it("repeated reads give the same positions (incremental sync: no duplicates by id)", async () => {
    seedFutures();
    const first = (await futures().fetchClosedPositions(window(30))).items.map((p) => p.positionId);
    const second = (await futures().fetchClosedPositions(window(6))).items.map((p) => p.positionId);
    expect(second.sort()).toEqual(first.sort()); // the lookback re-reads the opening fills, the ids stay the same
  });

  it("a position is returned by the slice it CLOSED in", async () => {
    seedFutures();
    const res = await futures().fetchClosedPositions({ startTime: venue.now - 2 * DAY, endTime: venue.now });
    expect(res.items).toHaveLength(0); // closed 5 days ago
  });

  it("the deadline stops between symbols and says where to resume", async () => {
    seedFutures();
    const a = futures();
    const r1 = await a.fetchClosedPositions(window(30), { deadline: venue.now - 1 }); // already over: nothing is read
    expect(r1.complete).toBe(false);
    expect(r1.resumeSkip).toBe(0);
    const r2 = await futures().fetchClosedPositions(window(30), { skip: 1 });
    expect(r2.complete).toBe(true);
    expect(r2.items.map((p) => p.symbol)).toEqual(["ETHUSDT"]);
  });

  it("history older than the 3 months the venue keeps is not asked for", async () => {
    const t0 = venue.now;
    await futures().fetchClosedPositions({ startTime: t0 - 200 * DAY, endTime: t0 });
    const oldest = Math.min(...venue.calls.filter((c) => c.path === "/fapi/v1/income").map((c) => Number(c.query.startTime)));
    expect(t0 - oldest).toBeLessThanOrEqual(89 * DAY);
  });

  it("open positions come from positionRisk", async () => {
    const open = await futures().fetchOpenPositions();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ symbol: "BTCUSDT", side: "long", qty: 0.05, entryPrice: 63000, liqPrice: 40000 });
  });
});

describe("spot", () => {
  it("finds the pairs of the coins held, reads fills from the start and pages by fromId", async () => {
    const t = venue.now - 6 * DAY;
    venue.spotTrades = [spot({ id: 1, buy: true, price: 60000, qty: 0.5, fee: 0.0005, asset: "BTC", at: t }), spot({ id: 2, buy: false, price: 63000, qty: 0.4995, fee: 31, at: t + 3_600_000 })];
    venue.balances = [
      { asset: "USDT", free: "10", locked: "0" },
      { asset: "BTC", free: "0.2", locked: "0" },
    ];
    const res = await spotAdapter().fetchClosedPositions(window(30));
    expect(res.items.map((p) => p.positionId)).toEqual(["s-BTCUSDT-1"]);
    expect(res.items[0]).toMatchObject({ side: "long", closePrice: 63000 });
    const paths = venue.calls.map((c) => c.path);
    expect(paths).toContain("/api/v3/account");
    expect(paths).toContain("/api/v3/ticker/price");
    expect(venue.calls.filter((c) => c.path === "/api/v3/myTrades").every((c) => c.host === "api.binance.com")).toBe(true);
  });

  it("a fully sold coin is found only through the configured extra pairs; unknown pairs are skipped silently", async () => {
    const t = venue.now - 3 * DAY;
    venue.balances = [{ asset: "USDT", free: "10", locked: "0" }];
    venue.spotTrades = [spot({ id: 7, symbol: "SOLUSDT", buy: true, price: 100, qty: 10, at: t }), spot({ id: 8, symbol: "SOLUSDT", buy: false, price: 120, qty: 10, at: t + 1000 })];
    expect((await spotAdapter().fetchClosedPositions(window(30))).items).toHaveLength(0);
    resetSeq();
    const withExtra = await spotAdapter(["SOLUSDT", "NOPEUSDT"]).fetchClosedPositions(window(30));
    expect(withExtra.items.map((p) => p.positionId)).toEqual(["s-SOLUSDT-7"]);
    expect(withExtra.items[0]!.realizedPnl).toBe(200);
  });

  it("spot has no open positions and no futures call", async () => {
    expect(await spotAdapter().fetchOpenPositions()).toEqual([]);
    expect(venue.calls).toHaveLength(0);
  });
});

describe("errors (German, no secret)", () => {
  const fails = async (p: Promise<unknown>): Promise<ExchangeError> => {
    try {
      await p;
    } catch (e) {
      return e as ExchangeError;
    }
    throw new Error("did not fail");
  };

  it("451 → a region message that blames the server location, not the key", async () => {
    venue.force = { status: 451, body: { msg: "Service unavailable from a restricted location" } };
    const e = await fails(futures().validate());
    expect(e).toBeInstanceOf(ExchangeError);
    expect(e.code).toBe("binance_451");
    expect(e.authFailure).toBe(false);
    expect(e.message).toMatch(/Server-Standort/);
  });

  it("-2015 (key, IP or rights) and -1022 (signature) are credential problems", async () => {
    venue.error = { code: -2015, msg: "Invalid API-key, IP, or permissions for action." };
    const a = await fails(futures().validate());
    expect(a).toMatchObject({ code: "binance_2015", authFailure: true });
    expect(a.message).toMatch(/Futures/);
    venue.error = { code: -1022, msg: "Signature for this request is not valid." };
    expect(await fails(futures().validate())).toMatchObject({ code: "binance_1022", authFailure: true });
    const wrong = binanceAdapter({ apiKey: venue.key, secret: "wrong-secret-wrong-secret" }, venueRuntime(venue, sleeps), { market: "futures" });
    venue.error = undefined;
    expect(await fails(wrong.validate())).toMatchObject({ authFailure: true });
    for (const e of [a]) expect(`${e.message}${e.code}`).not.toContain(venue.secret);
  });

  it("a rate-limit answer waits and retries once", async () => {
    let n = 0;
    const rt = venueRuntime(venue, sleeps);
    const inner = rt.fetch;
    rt.fetch = (async (...args: Parameters<typeof fetch>) => {
      if (n++ === 0) return new Response(JSON.stringify({ code: -1003, msg: "Too many requests" }), { status: 429, headers: { "retry-after": "2" } });
      return inner(...args);
    }) as typeof fetch;
    const acc = await binanceAdapter(creds(), rt, { market: "futures" }).validate();
    expect(acc.available).toBe(800.5);
    expect(sleeps.some((s) => s >= 1000)).toBe(true);
  });

  it("requests are spaced by their weight (income weighs 30 → ≈ 1 s apart)", async () => {
    seedFutures();
    await futures().fetchClosedPositions(window(30));
    const incomeCalls = venue.calls.filter((c) => c.path === "/fapi/v1/income").length;
    expect(incomeCalls).toBeGreaterThanOrEqual(2);
    expect(sleeps.some((s) => s >= 900)).toBe(true);
  });
});

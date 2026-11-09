// @vitest-environment node
/**
 * Binance, the pure parts (Paket Verbindungen): the HMAC signature, the rights check (what may be connected), the fill
 * parsers and the grouping of fills into closed positions – including the duplicate protection (the same fills read
 * twice give the same ids). Payload shapes follow the official docs; nothing here ran against the live exchange.
 */
import { describe, expect, it } from "vitest";
import {
  buildQuery,
  checkRights,
  cleanSymbols,
  evaluateRights,
  feeInQuote,
  parseFuturesTrade,
  parseRestrictions,
  parseSpotTrade,
  signedQuery,
  signQuery,
  splitSymbol,
} from "../../netlify/functions/_lib/exchanges/binance";
import { allocateFunding, groupFuturesFills, groupSpotFills } from "../../netlify/functions/_lib/exchanges/binanceTrades";
import { fut, newVenue, resetSeq, restrictions, spot, venueRuntime } from "./helpers/binanceVenue";

const H = 3_600_000;
const T0 = 1_780_000_000_000;

const futFills = (rows: ReturnType<typeof fut>[]) => rows.map((r) => parseFuturesTrade(r)!);
const spotFills = (rows: ReturnType<typeof spot>[]) => rows.map((r) => parseSpotTrade(r)!);

describe("signing", () => {
  it("HMAC SHA256 matches the example of the Binance docs", () => {
    // developers.binance.com "SIGNED Endpoint examples for POST /api/v3/order" (HMAC keys)
    const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
    const query = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
    expect(signQuery(query, secret)).toBe("c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
  });

  it("the signature is the LAST parameter and signs exactly the text that is sent", () => {
    const qs = signedQuery({ symbol: "BTCUSDT", limit: 5, skipped: undefined, empty: "" }, "s3cret", 1_700_000_000_000);
    expect(qs).toMatch(/^symbol=BTCUSDT&limit=5&recvWindow=10000&timestamp=1700000000000&signature=[0-9a-f]{64}$/);
    const [base, sig] = qs.split("&signature=");
    expect(sig).toBe(signQuery(base!, "s3cret"));
    expect(buildQuery({ a: "x y", b: 1 })).toBe("a=x%20y&b=1");
  });
});

describe("rights check", () => {
  it("a read-only key is fine for spot and carries no issue but the info about the open IP", () => {
    const v = evaluateRights(parseRestrictions(restrictions())!, "spot");
    expect(v.ok).toBe(true);
    expect(v.needsConfirm).toBe(false);
    expect(v.permissions).toEqual(["read"]);
    expect(v.issues.map((i) => i.code)).toEqual(["ip_open"]);
  });

  it.each([
    ["withdraw", { enableWithdrawals: true }],
    ["transfer", { enableInternalTransfer: true }],
    ["transfer", { permitsUniversalTransfer: true }],
    ["spot_trade", { enableSpotAndMarginTrading: true }],
    ["margin", { enableMargin: true }],
    ["options", { enableVanillaOptions: true }],
    ["fix_trade", { enableFixApiTrade: true }],
    ["portfolio", { enablePortfolioMarginTrading: true }],
    ["no_read", { enableReading: false }],
  ])("%s is refused for both markets", (code, over) => {
    for (const market of ["spot", "futures"] as const) {
      const v = evaluateRights(parseRestrictions(restrictions(over))!, market);
      expect(v.ok, `${code} ${market}`).toBe(false);
      expect(v.issues.some((i) => i.code === code && i.level === "block")).toBe(true);
    }
  });

  it("Futures access is a warning for futures (no read-only flag exists there) and for spot (not needed) – never silent", () => {
    const f = evaluateRights(parseRestrictions(restrictions({ enableFutures: true }))!, "futures");
    expect(f.ok).toBe(true);
    expect(f.needsConfirm).toBe(true);
    expect(f.permissions).toContain("futures_enabled");
    expect(f.issues.find((i) => i.level === "warn")?.text).toMatch(/reines Lese-Recht gibt es dort nicht/);
    const s = evaluateRights(parseRestrictions(restrictions({ enableFutures: true }))!, "spot");
    expect(s.needsConfirm).toBe(true);
    expect(s.permissions).not.toContain("futures_enabled");
  });

  it("a bound IP is noted as a permission tag, not as an issue", () => {
    const v = evaluateRights(parseRestrictions(restrictions({ ipRestrict: true }))!, "spot");
    expect(v.permissions).toEqual(["read", "ip_restricted"]);
    expect(v.issues).toEqual([]);
  });

  it("an answer that is not an object is no rights answer", () => {
    expect(parseRestrictions(null)).toBeNull();
    expect(parseRestrictions([])).toBeNull();
  });

  it("checkRights reads the key's rights from the venue (signed GET, one call)", async () => {
    const venue = newVenue({ restrictions: restrictions({ enableWithdrawals: true }) });
    const out = await checkRights({ apiKey: venue.key, secret: venue.secret }, "futures", venueRuntime(venue));
    expect(out.ok).toBe(false);
    expect(venue.calls).toHaveLength(1);
    expect(venue.calls[0]).toMatchObject({ method: "GET", path: "/sapi/v1/account/apiRestrictions", host: "api.binance.com" });
  });
});

describe("symbols and fees", () => {
  it("splits a symbol at the longest known quote", () => {
    expect(splitSymbol("BTCUSDT")).toEqual({ base: "BTC", quote: "USDT" });
    expect(splitSymbol("ETHBTC")).toEqual({ base: "ETH", quote: "BTC" });
    expect(splitSymbol("SOLFDUSD")).toEqual({ base: "SOL", quote: "FDUSD" });
    expect(splitSymbol("XYZ")).toEqual({ base: "XYZ", quote: "" });
  });

  it("converts a fee only when it can: quote coin as is, base coin × price, any other coin (BNB) is unknown", () => {
    expect(feeInQuote(0.5, "USDT", "BTCUSDT", 60000)).toEqual({ fee: 0.5, unknown: false });
    expect(feeInQuote(0.001, "BTC", "BTCUSDT", 60000)).toEqual({ fee: 60, unknown: false });
    expect(feeInQuote(0.002, "BNB", "BTCUSDT", 60000)).toEqual({ fee: 0, unknown: true });
    expect(feeInQuote(0, "BNB", "BTCUSDT", 60000)).toEqual({ fee: 0, unknown: false });
  });

  it("extra spot pairs are cleaned: upper case, valid, unique, at most 30", () => {
    expect(cleanSymbols(["solusdt", "SOLUSDT", "BTC/USDT", "x", 5, "DOGEUSDT"])).toEqual(["SOLUSDT", "DOGEUSDT"]);
    expect(cleanSymbols("nope")).toEqual([]);
    expect(cleanSymbols(Array.from({ length: 50 }, (_, i) => `COIN${i}USDT`))).toHaveLength(30);
  });
});

describe("futures fills → closed positions", () => {
  it("one-way: adds, a partial close and the rest make ONE position with the venue's own P&L", () => {
    resetSeq();
    const fills = futFills([
      fut({ id: 1, side: "BUY", price: 60000, qty: 0.1, fee: 0.6, at: T0 }),
      fut({ id: 2, side: "BUY", price: 61000, qty: 0.1, fee: 0.61, at: T0 + H }),
      fut({ id: 3, side: "SELL", price: 62000, qty: 0.1, pnl: 150, fee: 0.62, at: T0 + 2 * H }),
      fut({ id: 4, side: "SELL", price: 63000, qty: 0.1, pnl: 250, fee: 0.63, at: T0 + 3 * H }),
    ]);
    const out = groupFuturesFills(fills);
    expect(out.positions).toHaveLength(1);
    const p = out.positions[0]!.position;
    expect(p.positionId).toBe("f-BTCUSDT-1");
    expect(p).toMatchObject({ side: "long", maxQty: 0.2, entryPrice: 60500, closePrice: 62500, realizedPnl: 400, openedAt: T0, closedAt: T0 + 3 * H });
    expect(p.fee).toBeCloseTo(2.46, 8);
    expect(out.positions[0]!.fills.map((f) => f.tradeId)).toEqual(["1", "2", "3", "4"]);
    expect(out.orphanFills).toBe(0);
  });

  it("a fill through zero closes the long and opens a short (one-way); both are separate positions", () => {
    resetSeq();
    const out = groupFuturesFills(
      futFills([
        fut({ id: 1, side: "BUY", price: 100, qty: 1, fee: 0.1, at: T0 }),
        fut({ id: 2, side: "SELL", price: 110, qty: 1.5, pnl: 10, fee: 0.15, at: T0 + H }),
        fut({ id: 3, side: "BUY", price: 105, qty: 0.5, pnl: 2.5, fee: 0.05, at: T0 + 2 * H }),
      ]),
    );
    expect(out.positions.map((p) => [p.position.positionId, p.position.side, p.position.realizedPnl])).toEqual([
      ["f-BTCUSDT-1", "long", 10],
      ["f-BTCUSDT-2", "short", 2.5],
    ]);
    const short = out.positions[1]!.position;
    expect(short.maxQty).toBe(0.5);
    expect(short.entryPrice).toBe(110);
    expect(short.fee).toBeCloseTo(0.05 + 0.05, 8); // the opening share of the flipping fill + the closing fill
  });

  it("hedge mode: LONG and SHORT legs of one symbol are separate positions", () => {
    resetSeq();
    const out = groupFuturesFills(
      futFills([
        fut({ id: 10, symbol: "ETHUSDT", side: "BUY", price: 3000, qty: 1, ps: "LONG", at: T0 }),
        fut({ id: 11, symbol: "ETHUSDT", side: "SELL", price: 3100, qty: 1, ps: "SHORT", at: T0 + H }),
        fut({ id: 12, symbol: "ETHUSDT", side: "SELL", price: 3200, qty: 1, ps: "LONG", pnl: 200, at: T0 + 2 * H }),
        fut({ id: 13, symbol: "ETHUSDT", side: "BUY", price: 3050, qty: 1, ps: "SHORT", pnl: 50, at: T0 + 3 * H }),
      ]),
    );
    expect(out.positions.map((p) => [p.position.positionId, p.position.side, p.position.realizedPnl, p.position.positionMode])).toEqual([
      ["f-ETHUSDT-long-10", "long", 200, "hedge"],
      ["f-ETHUSDT-short-11", "short", 50, "hedge"],
    ]);
  });

  it("a closing fill without its opening is an orphan (counted, never turned into a trade); an unfinished position is not returned", () => {
    resetSeq();
    const out = groupFuturesFills(
      futFills([
        fut({ id: 1, side: "SELL", price: 100, qty: 1, pnl: 30, at: T0 }), // opened before the history
        fut({ id: 2, side: "BUY", price: 100, qty: 1, at: T0 + H }),
        fut({ id: 3, side: "SELL", price: 101, qty: 0.4, pnl: 0.4, at: T0 + 2 * H }),
      ]),
    );
    expect(out.orphanFills).toBe(1);
    expect(out.positions).toHaveLength(0);
    expect(out.open).toEqual([{ symbol: "BTCUSDT", side: "long", qty: 0.6 }]);
  });

  it("DUPLICATES: reading the same fills twice (overlapping windows) gives the same ids and no second trade", () => {
    resetSeq();
    const rows = [
      fut({ id: 1, side: "BUY", price: 100, qty: 1, at: T0 }),
      fut({ id: 2, side: "SELL", price: 110, qty: 1, pnl: 10, at: T0 + H }),
    ];
    const once = groupFuturesFills(futFills(rows));
    const twice = groupFuturesFills(futFills([...rows, ...rows]));
    expect(twice.positions.map((p) => p.position.positionId)).toEqual(once.positions.map((p) => p.position.positionId));
    expect(twice.positions).toHaveLength(1);
    expect(twice.positions[0]!.position.fee).toBe(once.positions[0]!.position.fee);
    // a later window that starts mid-way (the opening fill is read again through the lookback) keeps the id of the FIRST fill
    const later = groupFuturesFills(futFills([rows[1]!, rows[0]!]));
    expect(later.positions[0]!.position.positionId).toBe("f-BTCUSDT-1");
  });

  it("fees in BNB are not converted: counted as unknown, 0 in the trade", () => {
    resetSeq();
    const out = groupFuturesFills(
      futFills([fut({ id: 1, side: "BUY", price: 100, qty: 1, fee: 0.01, asset: "BNB", at: T0 }), fut({ id: 2, side: "SELL", price: 101, qty: 1, pnl: 1, fee: 0.01, asset: "BNB", at: T0 + H })]),
    );
    expect(out.unknownFees).toBe(2);
    expect(out.positions[0]!.position.fee).toBe(0);
  });

  it("funding is split between the positions that were open (hedge: evenly), others are ignored", () => {
    resetSeq();
    const out = groupFuturesFills(
      futFills([
        fut({ id: 10, symbol: "ETHUSDT", side: "BUY", price: 3000, qty: 1, ps: "LONG", at: T0 }),
        fut({ id: 11, symbol: "ETHUSDT", side: "SELL", price: 3100, qty: 1, ps: "SHORT", at: T0 }),
        fut({ id: 12, symbol: "ETHUSDT", side: "SELL", price: 3200, qty: 1, ps: "LONG", pnl: 200, at: T0 + 10 * H }),
        fut({ id: 13, symbol: "ETHUSDT", side: "BUY", price: 3050, qty: 1, ps: "SHORT", pnl: 50, at: T0 + 10 * H }),
      ]),
    );
    const positions = out.positions.map((p) => p.position);
    allocateFunding(positions, [
      { symbol: "ETHUSDT", amount: -0.4, at: T0 + 8 * H },
      { symbol: "ETHUSDT", amount: 0.2, at: T0 + 9 * H },
      { symbol: "ETHUSDT", amount: -9, at: T0 + 20 * H }, // after both closed
      { symbol: "BTCUSDT", amount: -5, at: T0 + H }, // another symbol
    ]);
    expect(positions.map((p) => p.funding)).toEqual([-0.1, -0.1]);
  });

  it("the quantity tolerance: a position is flat when the rest is below 1e-9 of its size", () => {
    resetSeq();
    const out = groupFuturesFills(futFills([fut({ id: 1, side: "BUY", price: 1, qty: 0.3, at: T0 }), fut({ id: 2, side: "SELL", price: 2, qty: 0.1, pnl: 0.1, at: T0 + H }), fut({ id: 3, side: "SELL", price: 2, qty: 0.2, pnl: 0.2, at: T0 + 2 * H })]));
    expect(out.positions).toHaveLength(1);
  });
});

describe("spot fills → round trips", () => {
  it("buy, buy, sell all: average cost, fee in the base coin leaves the holding, flat → one trade", () => {
    resetSeq();
    const out = groupSpotFills(
      spotFills([
        spot({ id: 1, buy: true, price: 60000, qty: 0.1, fee: 0.0001, asset: "BTC", at: T0 }),
        spot({ id: 2, buy: true, price: 62000, qty: 0.1, fee: 0.0001, asset: "BTC", at: T0 + H }),
        spot({ id: 3, buy: false, price: 65000, qty: 0.1998, fee: 12.9, asset: "USDT", at: T0 + 2 * H }),
      ]),
    );
    expect(out.positions).toHaveLength(1);
    const p = out.positions[0]!.position;
    expect(p.positionId).toBe("s-BTCUSDT-1");
    expect(p.side).toBe("long");
    expect(p.entryPrice).toBeCloseTo((60000 * 0.0999 + 62000 * 0.0999) / 0.1998, 6);
    expect(p.closePrice).toBe(65000);
    expect(p.realizedPnl).toBeCloseTo((65000 - 61000) * 0.1998, 6);
    expect(p.fee).toBeCloseTo(0.0001 * 60000 + 0.0001 * 62000 + 12.9, 6);
  });

  it("a sale above what was bought in the history is an orphan; dust after rounding still closes the trade", () => {
    resetSeq();
    const orphan = groupSpotFills(spotFills([spot({ id: 1, buy: false, price: 100, qty: 1, at: T0 })]));
    expect(orphan.orphanFills).toBe(1);
    expect(orphan.positions).toHaveLength(0);
    resetSeq();
    const dust = groupSpotFills(spotFills([spot({ id: 1, buy: true, price: 100, qty: 1, at: T0 }), spot({ id: 2, buy: false, price: 110, qty: 0.9995, at: T0 + H })]));
    expect(dust.positions).toHaveLength(1); // 0.05 % left = lot-size dust
    resetSeq();
    const open = groupSpotFills(spotFills([spot({ id: 1, buy: true, price: 100, qty: 1, at: T0 }), spot({ id: 2, buy: false, price: 110, qty: 0.5, at: T0 + H })]));
    expect(open.positions).toHaveLength(0);
    expect(open.open).toEqual([{ symbol: "BTCUSDT", side: "long", qty: 0.5 }]);
  });

  it("DUPLICATES: the same spot fills read twice make one trade with the id of the first buy", () => {
    resetSeq();
    const rows = [spot({ id: 5, buy: true, price: 100, qty: 1, at: T0 }), spot({ id: 6, buy: false, price: 120, qty: 1, at: T0 + H })];
    const out = groupSpotFills(spotFills([...rows, ...rows]));
    expect(out.positions.map((p) => p.position.positionId)).toEqual(["s-BTCUSDT-5"]);
  });
});

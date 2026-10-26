/**
 * Where the scanner's candles come from: the stock contract (daily and 5-minute) and Binance (crypto top-N by volume,
 * daily and 15-minute) – plus the universe the user picks. Network mocked; a refusal is a typed reason, never a gap.
 */
import { describe, expect, it, vi } from "vitest";
import { clampCap, cryptoTargets, defaultParamsFor, parseTickers, stockUniverse, runScan, DEFAULT_PARAMS, type ScanSource } from "@/domain/scanner";
import { createCryptoClient, CRYPTO_BUDGET, nySessionOf, stockScanSource, utcDaySession } from "@/market/stocks/scanSources";
import { ok, stale, unavailable } from "@/market/stocks/result";
import type { StockBars, StockCandle, StockDataContract, StockResult, SymbolEntry } from "@/market/stocks/types";

const FRI_OPEN = Date.UTC(2026, 9, 23, 13, 30);
const stamp = { source: "yahoo", asOf: FRI_OPEN, receivedAt: FRI_OPEN + 7 * 3_600_000, fetchedAt: FRI_OPEN + 7 * 3_600_000 };

const candle = (time: number, close: number): StockCandle => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 1000, closed: true });
const barsOf = (symbol: string, interval: "1d" | "5m", n = 3): StockBars => ({ symbol, interval, range: "6mo", candles: Array.from({ length: n }, (_, i) => candle(FRI_OPEN + i * (interval === "1d" ? 86_400_000 : 300_000), 10 + i)), meta: { name: null, currency: "USD", exchange: null, price: null, prevClose: null, volume: null, marketTime: null } });

describe("stock scan source", () => {
  const fake = (answer: (s: string) => StockResult<StockBars>): StockDataContract =>
    ({ barsMany: vi.fn(async (symbols: readonly string[]) => Object.fromEntries(symbols.map((s) => [s, answer(s)]))) }) as unknown as StockDataContract;

  it("turns the contract's results into load outcomes: ok, stale with its reason, unavailable with the reason", async () => {
    const data = fake((s) => (s === "A" ? ok(barsOf("A", "1d"), stamp) : s === "B" ? stale(barsOf("B", "1d"), stamp, "network", "Server weg", 5) : unavailable("rate-limited", 5, "Zu viele Abrufe.")));
    const src = stockScanSource("daily", data);
    expect(src).toMatchObject({ kind: "stock", interval: "1d", barMs: 86_400_000, batchSize: 16 });
    const out = await src.load([{ symbol: "A" }, { symbol: "B" }, { symbol: "C" }], new AbortController().signal);
    expect(out["A"]).toMatchObject({ ok: true, stand: { source: "yahoo", receivedAt: stamp.receivedAt, fetchedAt: stamp.fetchedAt } });
    expect(out["A"]!.ok && out["A"]!.candles).toHaveLength(3);
    expect(out["B"]).toMatchObject({ ok: true, stand: { stale: { reason: "network", message: "Server weg" } } });
    expect(out["C"]).toEqual({ ok: false, reason: "rate-limited", message: "Zu viele Abrufe." });
    expect(data.barsMany).toHaveBeenCalledWith(["A", "B", "C"], "1d", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("reads 5-minute candles for the opening range and gives it the New York session of the newest candle", async () => {
    const src = stockScanSource("orb", fake((s) => ok(barsOf(s, "5m"), stamp)));
    expect(src).toMatchObject({ interval: "5m", barMs: 300_000 });
    const out = await src.load([{ symbol: "A" }], new AbortController().signal);
    const loaded = out["A"]!;
    const candles = loaded.ok ? loaded.candles : [];
    const s = src.sessionFor!(candles, stamp.fetchedAt);
    expect(s).toMatchObject({ openMs: FRI_OPEN, closeMs: FRI_OPEN + 6.5 * 3_600_000, timeZone: "America/New_York", zoneLabel: "NY" });
    expect(nySessionOf([])).toBeUndefined();
    expect(nySessionOf([candle(Date.UTC(2026, 10, 26, 15, 0), 1)])).toBeUndefined(); // Thanksgiving: no session
    expect(stockScanSource("daily", fake(() => unavailable("blocked", 1))).sessionFor).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ crypto */

const ticker = (symbol: string, quoteVolume: number) => ({ symbol, priceChangePercent: "1.0", lastPrice: "10", highPrice: "11", lowPrice: "9", volume: "5", quoteVolume: String(quoteVolume), closeTime: 1 });
const TICKERS = [ticker("BTCUSDT", 9e9), ticker("ETHUSDT", 5e9), ticker("DOGEUSDT", 1e8), ticker("BTCUSDT_250627", 8e9), ticker("ETHBTC", 7e9), ticker("DEADUSDT", 0), ticker("SOLUSDT", 3e9)];

/** klines row: [open time, o, h, l, c, v, close time, quote volume, trades, taker base, taker quote, ignore] */
const row = (time: number, close: number, closeTime: number): unknown[] => [time, String(close), String(close + 1), String(close - 1), String(close), "10", closeTime, "100", 5, "5", "50", "0"];

function cryptoFetch(handlers: { ticker?: () => Response; klines?: (u: URL) => Response } = {}) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (input: string) => {
    calls.push(input);
    const u = new URL(input, "https://x.test");
    if (u.pathname.endsWith("/fapi/v1/ticker/24hr")) return handlers.ticker?.() ?? new Response(JSON.stringify(TICKERS), { status: 200, headers: { "content-type": "application/json" } });
    if (u.pathname.endsWith("/fapi/v1/klines")) return handlers.klines?.(u) ?? new Response(JSON.stringify([row(1, 10, 2), row(3, 11, 4)]), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("{}", { status: 404 });
  });
  return { fetchFn, calls };
}

describe("crypto universe and source", () => {
  it("ranks the USDT perpetuals by 24 h quote volume and leaves out delivery contracts, cross pairs and dead markets", () => {
    expect(cryptoTargets(TICKERS.map((t) => ({ symbol: t.symbol, quoteVolume: Number(t.quoteVolume) })), 3)).toEqual([
      { symbol: "BTCUSDT", name: "BTC" },
      { symbol: "ETHUSDT", name: "ETH" },
      { symbol: "SOLUSDT", name: "SOL" },
    ]);
  });

  it("asks Binance for the tickers and returns the top N with a stamp", async () => {
    const { fetchFn, calls } = cryptoFetch();
    const c = createCryptoClient({ fetch: fetchFn, now: () => 1_000 });
    const r = await c.top(2);
    expect(r).toMatchObject({ ok: true, targets: [{ symbol: "BTCUSDT" }, { symbol: "ETHUSDT" }], stamp: { source: "binance", receivedAt: 1000 } });
    expect(calls[0]).toBe("https://fapi.binance.com/fapi/v1/ticker/24hr");
  });

  it("names a geo-block, a limit and an empty answer", async () => {
    const blocked = createCryptoClient({ fetch: cryptoFetch({ ticker: () => new Response("{}", { status: 451 }) }).fetchFn, proxy: () => null });
    expect(await blocked.top(5)).toMatchObject({ ok: false, reason: "blocked", message: "Binance ist von hier aus nicht erreichbar (HTTP 451)." });
    const limited = createCryptoClient({ fetch: cryptoFetch({ ticker: () => new Response("{}", { status: 429 }) }).fetchFn, proxy: () => null });
    expect(await limited.top(5)).toMatchObject({ ok: false, reason: "rate-limited" });
    const empty = createCryptoClient({ fetch: cryptoFetch({ ticker: () => new Response("[]", { status: 200 }) }).fetchFn });
    expect(await empty.top(5)).toMatchObject({ ok: false, reason: "no-data" });
  });

  it("loads 1-day candles per symbol and marks the complete ones", async () => {
    const { fetchFn, calls } = cryptoFetch({ klines: () => new Response(JSON.stringify([row(1, 10, 500), row(2, 11, 5_000_000_000_000)]), { status: 200 }) });
    const c = createCryptoClient({ fetch: fetchFn, now: () => 1_000_000 });
    const src = c.source("daily");
    expect(src).toMatchObject({ kind: "crypto", interval: "1d", barMs: 86_400_000 });
    const out = await src.load([{ symbol: "BTCUSDT" }, { symbol: "ETHUSDT" }], new AbortController().signal);
    const a = out["BTCUSDT"]!;
    expect(a.ok && a.candles.map((k) => k.closed)).toEqual([true, false]);
    expect(a.ok && a.stand).toMatchObject({ source: "binance", receivedAt: 1_000_000 });
    expect(calls.filter((u) => u.includes("klines"))).toEqual(["https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=99", "https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT&interval=1d&limit=99"]);
  });

  it("reads 15-minute candles for the opening range of the UTC day", () => {
    const src = createCryptoClient().source("orb");
    expect(src).toMatchObject({ interval: "15m", barMs: 900_000 });
    const noon = Date.UTC(2026, 9, 25, 12, 0);
    expect(src.sessionFor!([], noon)).toEqual(utcDaySession(noon));
    expect(utcDaySession(noon)).toMatchObject({ openMs: Date.UTC(2026, 9, 25), closeMs: Date.UTC(2026, 9, 26), timeZone: "UTC", zoneLabel: "UTC" });
    expect(createCryptoClient().source("daily").sessionFor).toBeUndefined();
  });

  it("reports one refused symbol with its reason and goes on", async () => {
    const { fetchFn } = cryptoFetch({ klines: (u) => (u.searchParams.get("symbol") === "ETHUSDT" ? new Response(JSON.stringify({ code: -1121, msg: "Invalid symbol." }), { status: 400 }) : new Response(JSON.stringify([row(1, 10, 2)]), { status: 200 })) });
    const out = await createCryptoClient({ fetch: fetchFn, proxy: () => null }).source("daily").load([{ symbol: "ETHUSDT" }, { symbol: "BTCUSDT" }], new AbortController().signal);
    expect(out["ETHUSDT"]).toMatchObject({ ok: false, reason: "bad-symbol" });
    expect(out["BTCUSDT"]!.ok).toBe(true);
  });

  it("switches to the same-origin proxy for the session when the direct route cannot be read", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (input: string) => {
      calls.push(input);
      if (input.startsWith("https://fapi.binance.com")) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify([row(1, 10, 2)]), { status: 200 });
    });
    const c = createCryptoClient({ fetch: fetchFn });
    const out = await c.source("daily").load([{ symbol: "BTCUSDT" }, { symbol: "ETHUSDT" }], new AbortController().signal);
    const btc = out["BTCUSDT"]!;
    expect(btc.ok && btc.stand.source).toBe("proxy");
    expect(calls.filter((u) => u.startsWith("/api/binance")).length).toBe(2);
    expect(calls.filter((u) => u.startsWith("https://fapi.binance.com")).length).toBe(1); // asked once, then never again
  });

  it("waits for the scan's own budget instead of hammering Binance", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const { fetchFn } = cryptoFetch();
    const c = createCryptoClient({ fetch: fetchFn, now: () => t, sleep: async (ms) => void (sleeps.push(ms), (t += ms)) });
    const batch = Array.from({ length: CRYPTO_BUDGET.capacity + 5 }, (_, i) => ({ symbol: `C${i}USDT` }));
    await c.source("daily").load(batch, new AbortController().signal);
    expect(sleeps.length).toBeGreaterThan(0);
  });

  it("runs a whole crypto scan through the kernel", async () => {
    // ten daily closes falling, then a bounce: RSI(14) needs more bars – so use the oversold rule on 30 candles
    const closes = [...Array.from({ length: 29 }, (_, i) => 100 - i * 1.5 + (i % 4 === 0 ? 2.5 : 0)), 61.5];
    const klines = closes.map((c, i) => row(i * 86_400_000, c, i * 86_400_000 + 86_399_999));
    const { fetchFn } = cryptoFetch({ klines: () => new Response(JSON.stringify(klines), { status: 200 }) });
    const c = createCryptoClient({ fetch: fetchFn, now: () => 31 * 86_400_000 });
    const params = defaultParamsFor("crypto", "daily");
    const out = await runScan({ source: c.source("daily") as ScanSource, targets: [{ symbol: "BTCUSDT", name: "BTC" }], params, setups: ["rsi"], now: () => 31 * 86_400_000 });
    expect(out).toMatchObject({ scanned: 1, failed: 0, skipped: 0 });
    expect(out.hits[0]).toMatchObject({ symbol: "BTCUSDT", setup: "rsi", stand: { source: "binance" } });
  });
});

describe("universe", () => {
  const dir: SymbolEntry[] = Array.from({ length: 25 }, (_, i) => ({ symbol: `AA${String.fromCharCode(65 + i)}`, name: `Name ${i}`, exchange: "NYSE", fin: i === 3 ? "D" : "N" }));

  it("cuts the directory into blocks of the chosen size and says how many exist", () => {
    const spec = { source: "directory" as const, cap: 10, block: 1, custom: "" };
    const a = stockUniverse(spec, dir, []);
    expect(a).toMatchObject({ available: 25, blocks: 3 });
    expect(a.targets).toHaveLength(10);
    expect(a.targets[0]).toEqual({ symbol: "AAA", name: "Name 0", fin: "N" });
    expect(stockUniverse({ ...spec, block: 3 }, dir, []).targets).toHaveLength(5);
    expect(stockUniverse({ ...spec, block: 99 }, dir, []).targets).toHaveLength(5); // clamped to the last block
    expect(stockUniverse({ ...spec, block: 0 }, dir, []).targets[0]!.symbol).toBe("AAA");
    expect(stockUniverse({ ...spec, block: 1 }, null, [])).toMatchObject({ targets: [], available: 0, blocks: 1 });
  });

  it("reads typed tickers, says which are no ticker and which the directory does not list", () => {
    expect(parseTickers("aapl, msft;NVDA\nbrk.b  AAPL $$ 12345678")).toEqual({ symbols: ["AAPL", "MSFT", "NVDA", "BRK.B"], invalid: ["$$", "12345678"] });
    const u = stockUniverse({ source: "custom", cap: 10, block: 1, custom: "AAA, ZZZ, 99" }, dir, []);
    expect(u.targets.map((t) => t.symbol)).toEqual(["AAA", "ZZZ"]);
    expect(u).toMatchObject({ invalid: ["99"], unlisted: ["ZZZ"], available: 2 });
    expect(u.targets[0]).toMatchObject({ name: "Name 0", fin: "N" });
  });

  it("uses the watchlist's stocks and caps them", () => {
    const u = stockUniverse({ source: "watchlist", cap: 10, block: 1, custom: "" }, dir, ["AAB", "AAB", "AAC"]);
    expect(u.targets.map((t) => t.symbol)).toEqual(["AAB", "AAC"]);
    const many = Array.from({ length: 30 }, (_, i) => `W${String.fromCharCode(65 + (i % 26))}${i > 25 ? "A" : ""}`);
    expect(stockUniverse({ source: "watchlist", cap: 10, block: 1, custom: "" }, null, many).targets).toHaveLength(10);
  });

  it("holds the cap between 10 and the hard cap and has crypto thresholds of its own", () => {
    expect([clampCap(1), clampCap(150), clampCap(99999), clampCap(NaN)]).toEqual([10, 150, 400, 100]);
    expect(defaultParamsFor("stock", "daily")).toEqual(DEFAULT_PARAMS);
    expect(defaultParamsFor("stock", "orb").pre.minVolume).toBe(0);
    expect(defaultParamsFor("crypto", "orb")).toMatchObject({ orb: { orMinutes: 60, latestMinutes: null }, pre: { minPrice: 0, minVolume: 0, normalStatusOnly: false } });
  });
});

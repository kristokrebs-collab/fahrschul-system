/**
 * Binance / Bybit market-data fixtures of the Showroom (Paket S) – GENERATED, not recorded, and pure (no DOM, no Node): every number comes from
 * the deterministic synthetic market of `./synth.ts` (the same price path and ratio scripts the e2e suite grades against). Nothing here is a
 * real quote; the Showroom's banner says so.
 *
 * The ratio script is `slide-account` (`synth.ts`): the top-trader POSITION series flipped from net long to net short about 60 periods
 * (hours) ago – inside the last 14 days, so the Wal-Karte and the Flip-Grafik show a chart AND the mark at the flip – and the ACCOUNT series
 * slides down over the same window, so the alert rule's Vorwarnung and Bestätigung have something to sit on.
 *
 * `binanceRest()` answers `https://fapi.binance.com/*` and the same-origin proxy `/api/binance/*` (the EU relay of `netlify.toml`),
 * `bybitRest()` answers `https://api.bybit.com/*`. `wsFrame()` builds one combined-stream frame (`{stream, data}`) for the fake WebSocket.
 */
import { CORS, type MockRes } from "./http";
import { SYNTH_INTERVAL_MS, SYNTH_LIVE_PRICE, synthKlines, synthPrice, synthRatios, type RatioKind, type RatioScript } from "./synth";

export interface MarketCtx {
  /** "now" of the exchange (ms) */
  now: () => number;
  /** time anchor of the price path (fixed for a whole visit, so every request sees the same history) */
  anchor: number;
  /** ratio script, default `slide-account` */
  script?: RatioScript;
}

const HOUR = 3_600_000;
const num = (v: string | null): number | undefined => (v === null || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));

/** Relative price level of a symbol against BTC (the path is BTC's; an other symbol is the same shape at its own level). */
function levelOf(symbol: string): number {
  if (symbol === "BTCUSDT") return 1;
  let h = 7;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) % 9973;
  return 0.0004 + (h / 9973) * 0.04;
}

const ok = (body: unknown): MockRes => ({ status: 200, headers: { "content-type": "application/json", ...CORS }, body: JSON.stringify(body) });
const fail = (status: number, body: unknown): MockRes => ({ status, headers: { "content-type": "application/json", ...CORS }, body: JSON.stringify(body) });

const RATIO_KIND: Record<string, RatioKind> = {
  "/futures/data/topLongShortPositionRatio": "top-position",
  "/futures/data/topLongShortAccountRatio": "top-account",
  "/futures/data/globalLongShortAccountRatio": "global",
};

type KlineRow = ReturnType<typeof synthKlines>[number];

function scaled(rows: KlineRow[], k: number): KlineRow[] {
  if (k === 1) return rows;
  return rows.map((r) => [r[0], ...([1, 2, 3, 4] as const).map((i) => (Number(r[i]) * k).toFixed(k < 0.01 ? 4 : 2)), r[5], r[6], r[7], r[8], r[9], r[10], r[11]] as KlineRow);
}

/** The live price of a symbol with a tiny wiggle (the ticker moves a little, like a quiet market). */
export function livePrice(symbol: string, now: number): number {
  const wiggle = 1 + 0.00018 * Math.sin(now / 4300) + 0.00009 * Math.sin(now / 1700 + 1);
  return SYNTH_LIVE_PRICE * levelOf(symbol) * wiggle;
}

const fixed = (p: number): string => p.toFixed(p < 1 ? 5 : 2);

/** Path (without the `/api/binance` proxy prefix) → response; `null` when the endpoint is not part of the Showroom's data. */
export function binanceRest(url: URL, ctx: MarketCtx): MockRes | null {
  const path = url.pathname.replace(/^\/api\/binance/, "");
  const symbol = url.searchParams.get("symbol") ?? "BTCUSDT";
  const level = levelOf(symbol);
  const now = ctx.now();
  const q = { limit: num(url.searchParams.get("limit")), startTime: num(url.searchParams.get("startTime")), endTime: num(url.searchParams.get("endTime")) };
  const live = livePrice(symbol, now);
  switch (path) {
    case "/fapi/v1/time":
      return ok({ serverTime: now });
    case "/fapi/v1/klines":
    case "/fapi/v1/markPriceKlines": {
      const iv = url.searchParams.get("interval") ?? "1h";
      if (!SYNTH_INTERVAL_MS[iv]) return fail(400, { code: -1120, msg: "Invalid interval." });
      return ok(scaled(synthKlines(iv, q, ctx.anchor, now), level));
    }
    case "/fapi/v1/premiumIndex": {
      const mark = {
        symbol,
        markPrice: `${fixed(live)}000`,
        indexPrice: `${fixed(live * 0.9998)}000`,
        estimatedSettlePrice: fixed(live * 0.9997),
        lastFundingRate: "0.00010000",
        interestRate: "0.00010000",
        nextFundingTime: Math.ceil(now / (8 * HOUR)) * 8 * HOUR,
        time: now,
      };
      return ok(url.searchParams.get("symbol") ? mark : [mark]);
    }
    case "/fapi/v1/ticker/24hr": {
      const open = synthPrice(now - 24 * HOUR, ctx.anchor) * level;
      const change = live - open;
      const t = {
        symbol,
        priceChange: change.toFixed(2),
        priceChangePercent: ((change / open) * 100).toFixed(3),
        weightedAvgPrice: fixed((live + open) / 2),
        lastPrice: fixed(live),
        lastQty: "0.012",
        openPrice: fixed(open),
        highPrice: fixed(Math.max(open, live) * 1.006),
        lowPrice: fixed(Math.min(open, live) * 0.992),
        volume: "182345.123",
        quoteVolume: (182345.123 * live).toFixed(2),
        openTime: now - 24 * HOUR,
        closeTime: now,
        firstId: 5000000000,
        lastId: 5001234567,
        count: 1234567,
      };
      return ok(url.searchParams.get("symbol") ? t : [t]);
    }
    case "/fapi/v1/ticker/price":
      return ok(url.searchParams.get("symbol") ? { symbol, price: fixed(live), time: now } : [{ symbol, price: fixed(live), time: now }]);
    case "/fapi/v1/openInterest":
      return ok({ openInterest: (78321.456 * (1 + 0.004 * Math.sin(now / HOUR))).toFixed(3), symbol, time: now });
    case "/fapi/v1/fundingRate": {
      const limit = Math.min(1000, q.limit ?? 100);
      const last = Math.floor(now / (8 * HOUR)) * 8 * HOUR;
      return ok(
        Array.from({ length: limit }, (_, i) => {
          const t = last - (limit - 1 - i) * 8 * HOUR;
          return { symbol, fundingTime: t, fundingRate: (0.0001 + 0.00006 * Math.sin(t / (31 * HOUR))).toFixed(8), markPrice: fixed(synthPrice(t, ctx.anchor) * level) };
        }),
      );
    }
    case "/fapi/v1/depth": {
      const book = (side: 1 | -1) =>
        Array.from({ length: 20 }, (_, i) => [fixed(live + side * (0.1 + i * live * 0.00004)), (0.4 + ((i * 7) % 5) * 0.9 + (i === 3 ? 6 : 0)).toFixed(3)]);
      return ok({ lastUpdateId: now, E: now, T: now, bids: book(-1), asks: book(1) });
    }
    case "/futures/data/openInterestHist": {
      const step = SYNTH_INTERVAL_MS[url.searchParams.get("period") ?? "1h"] ?? HOUR;
      const limit = Math.min(500, q.limit ?? 30);
      const end = Math.floor((q.endTime ?? now) / step) * step;
      return ok(
        Array.from({ length: limit }, (_, i) => {
          const t = end - (limit - 1 - i) * step;
          const oi = 76000 + 2200 * Math.sin(t / (13 * HOUR)) + 900 * Math.sin(t / (3.1 * HOUR));
          return { symbol, sumOpenInterest: oi.toFixed(3), sumOpenInterestValue: (oi * synthPrice(t, ctx.anchor) * level).toFixed(2), CMCCirculatingSupply: "19900000.00", timestamp: String(t) };
        }),
      );
    }
    case "/futures/data/takerlongshortRatio": {
      const step = SYNTH_INTERVAL_MS[url.searchParams.get("period") ?? "1h"] ?? HOUR;
      const limit = Math.min(500, q.limit ?? 30);
      const end = Math.floor((q.endTime ?? now) / step) * step;
      return ok(
        Array.from({ length: limit }, (_, i) => {
          const t = end - (limit - 1 - i) * step;
          const ratio = 1 + 0.07 * Math.sin(t / (5 * HOUR)) + 0.03 * Math.sin(t / (1.7 * HOUR));
          const sell = 1200 + 150 * Math.sin(t / (7 * HOUR));
          return { buySellRatio: ratio.toFixed(4), buyVol: (sell * ratio).toFixed(3), sellVol: sell.toFixed(3), timestamp: String(t) };
        }),
      );
    }
    default: {
      const kind = RATIO_KIND[path];
      if (kind) return ok(synthRatios(kind, url.searchParams.get("period") ?? "1h", q, ctx.script ?? "slide-account", now));
      return null;
    }
  }
}

const BYBIT_INTERVAL: Record<string, string> = { "1": "1m", "5": "5m", "15": "15m", "30": "30m", "60": "1h", "240": "4h", D: "1d", W: "1w" };

/** `https://api.bybit.com/*` (a fallback source of the app): klines from the same path, a ticker, the server time; everything else "not mocked". */
export function bybitRest(url: URL, ctx: MarketCtx): MockRes {
  const now = ctx.now();
  const body = (result: unknown) => ok({ retCode: 0, retMsg: "OK", result, time: now });
  switch (url.pathname) {
    case "/v5/market/kline": {
      const iv = BYBIT_INTERVAL[url.searchParams.get("interval") ?? "60"] ?? "1h";
      const rows = synthKlines(iv, { limit: num(url.searchParams.get("limit")) ?? 200, startTime: num(url.searchParams.get("start")), endTime: num(url.searchParams.get("end")) }, ctx.anchor, now);
      return body({ category: "linear", symbol: "BTCUSDT", list: rows.map((r) => [String(r[0]), r[1], r[2], r[3], r[4], r[5], r[7]]).reverse() });
    }
    case "/v5/market/tickers":
      return body({ category: "linear", list: [{ symbol: "BTCUSDT", lastPrice: fixed(livePrice("BTCUSDT", now)), price24hPcnt: "-0.0132", fundingRate: "0.0001", openInterest: "78321.456" }] });
    case "/v5/market/time":
      return ok({ retCode: 0, retMsg: "OK", result: { timeSecond: String(Math.floor(now / 1000)), timeNano: String(now * 1_000_000) }, time: now });
    default:
      return ok({ retCode: 10001, retMsg: "not mocked", result: {} });
  }
}

/** One combined-stream frame for a stream name (`btcusdt@markPrice@1s`, `@aggTrade`, `@bookTicker`, `@kline_1h`), or `null` for an unknown stream. */
export function wsFrame(stream: string, ctx: MarketCtx, n: number): { stream: string; data: unknown } | null {
  const at = stream.indexOf("@");
  if (at < 0) return null;
  const symbol = stream.slice(0, at).toUpperCase();
  const rest = stream.slice(at + 1);
  const now = ctx.now();
  const p = livePrice(symbol, now);
  if (rest.startsWith("markPrice")) return { stream, data: { e: "markPriceUpdate", E: now, s: symbol, p: `${fixed(p)}000`, i: `${fixed(p * 0.9998)}000`, P: fixed(p * 0.9997), r: "0.00010000", T: Math.ceil(now / (8 * HOUR)) * 8 * HOUR } };
  if (rest === "aggTrade") return { stream, data: { e: "aggTrade", E: now, s: symbol, a: 2812345678 + n, p: fixed(p), q: (0.01 + ((n * 7) % 9) / 100).toFixed(3), nq: "0.035", f: 6012345670 + n, l: 6012345670 + n, T: now - 2, m: n % 2 === 0 } };
  if (rest === "bookTicker") return { stream, data: { e: "bookTicker", u: 7712345678 + n, E: now, T: now - 1, s: symbol, b: fixed(p - 0.1), B: "3.210", a: fixed(p + 0.1), A: "1.045" } };
  if (rest.startsWith("kline_")) {
    const iv = rest.slice(6);
    const step = SYNTH_INTERVAL_MS[iv];
    if (!step) return null;
    const row = synthKlines(iv, { limit: 1 }, ctx.anchor, now)[0];
    if (!row) return null;
    const k = levelOf(symbol);
    return { stream, data: { e: "kline", E: now, s: symbol, k: { t: row[0], T: row[0] + step - 1, s: symbol, i: iv, f: 5001200000, L: 5001234567, o: fixed(Number(row[1]) * k), c: fixed(p), h: fixed(Math.max(Number(row[2]) * k, p)), l: fixed(Math.min(Number(row[3]) * k, p)), v: row[5], n: 15234, x: false, q: row[7], V: row[9], Q: row[10], B: "0" } } };
  }
  return null;
}

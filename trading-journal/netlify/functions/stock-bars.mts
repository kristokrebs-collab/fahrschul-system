/**
 * GET /api/v1/stocks/bars?symbols=AAPL,MSFT&interval=5m[&range=1d] – candles of US stocks (F67), from Yahoo Finance's
 * "chart" endpoint. Public data, no key, nothing personal in or out (only tickers, an interval and a range).
 *
 * Why a function: the browser cannot read Yahoo (CORS). The source is UNOFFICIAL – it may rate-limit or block this server
 * at any time; that is answered honestly (per symbol `ok: false` + reason, or – when every symbol failed for the same
 * upstream reason – HTTP 429 / 502 with a German message), never with invented candles.
 *
 * Guards (`_lib/stocks/guard.ts`): plan gate `boxScanner` once payments are on (open before), 240 requests / 10 min per
 * user or pseudonymised IP, ≤ 8 tickers per request, interval / range from a fixed list. Answers are `private` and cached
 * for a short time per interval (also in memory, so many users asking the same ticker cause one request upstream).
 * Candles are cleaned (`yahoo.ts`): no half-empty candles, intraday only inside the regular session, one per day for 1d.
 */
import type { Config } from "@netlify/functions";
import { DEFAULT_RANGE, RANGES_BY_INTERVAL, STOCK_INTERVALS, STOCK_LIMITS, type StockInterval } from "../../src/market/stocks/types";
import type { BarsResponse } from "../../src/market/stocks/wire";
import { handler, HttpError, requireMethod } from "./_lib/http";
import { createMemo, stockGuard, stockJson } from "./_lib/stocks/guard";
import { parseSymbols } from "./_lib/stocks/params";
import { barsPayload, failOf, LATE_FAIL, fetchChart, mapPool, upstreamWideError, type YahooDeps } from "./_lib/stocks/yahoo";

/** How long a candle answer stays fresh, per interval (ms). */
export const BARS_TTL_MS: Readonly<Record<StockInterval, number>> = { "1m": 20_000, "5m": 45_000, "15m": 90_000, "1h": 300_000, "1d": 600_000 };
/** Wall-clock budget of one request; tickers not started by then answer `timeout`. */
export const BUDGET_MS = 9000;

type BarsResult = BarsResponse["results"][string];
const memo = createMemo<BarsResult>();

/** Tests: forget cached answers and inject Yahoo's transport. */
export const barsTesting = {
  clear: (): void => memo.clear(),
  deps: {} as YahooDeps,
};

export default handler(async (req, ctx) => {
  requireMethod(req, "GET");
  await stockGuard(req, ctx, { scope: "stock-bars", max: 240, windowSec: 600 });
  const url = new URL(req.url);
  const symbols = parseSymbols(url.searchParams.get("symbols"), STOCK_LIMITS.barsPerRequest);
  const interval = url.searchParams.get("interval") as StockInterval | null;
  if (!interval || !(STOCK_INTERVALS as readonly string[]).includes(interval)) throw new HttpError(400, "bad_interval", `Zeiteinheit unbekannt. Erlaubt: ${STOCK_INTERVALS.join(", ")}.`);
  const range = url.searchParams.get("range") ?? DEFAULT_RANGE[interval];
  if (!RANGES_BY_INTERVAL[interval].includes(range)) throw new HttpError(400, "bad_range", `Für ${interval}-Kerzen sind diese Zeiträume erlaubt: ${RANGES_BY_INTERVAL[interval].join(", ")}.`);

  const started = Date.now();
  let oldest = started;
  const entries = await mapPool<string, [string, BarsResult]>(
    symbols,
    4,
    async (symbol): Promise<[string, BarsResult]> => {
      try {
        const r = await memo.wrap(`${symbol}|${interval}|${range}`, BARS_TTL_MS[interval], async () => barsPayload(await fetchChart(symbol, interval, range, barsTesting.deps)));
        oldest = Math.min(oldest, r.at);
        return [symbol, r.value];
      } catch (e) {
        return [symbol, failOf(e)];
      }
    },
    { deadline: started + BUDGET_MS, onLate: (symbol) => [symbol, LATE_FAIL] },
  );
  const results = Object.fromEntries(entries);
  const wide = upstreamWideError(results);
  if (wide) throw wide;
  const body: BarsResponse = { source: "yahoo", interval, range, fetchedAt: oldest, results };
  return stockJson(body, BARS_TTL_MS[interval] / 1000);
});

export const config: Config = { path: "/api/v1/stocks/bars", method: ["GET"] };

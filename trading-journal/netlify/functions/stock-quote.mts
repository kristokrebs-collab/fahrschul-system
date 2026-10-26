/**
 * GET /api/v1/stocks/quote?symbols=AAPL,MSFT – last price, previous close and day figures of US stocks (F67/F68),
 * from the same Yahoo Finance "chart" endpoint as the candles (daily candles over 5 days: the previous close is the close
 * of the session before, never a guess). Public data, no key, nothing personal. UNOFFICIAL source: a block or limit is
 * answered honestly (per symbol, or HTTP 429 / 502 when every symbol failed for the same reason).
 * Guards as `stock-bars` (own limit: 240 / 10 min), ≤ 20 tickers per request, answers `private` for 15 s.
 */
import type { Config } from "@netlify/functions";
import { STOCK_LIMITS } from "../../src/market/stocks/types";
import type { QuoteResponse } from "../../src/market/stocks/wire";
import { handler, requireMethod } from "./_lib/http";
import { createMemo, stockGuard, stockJson } from "./_lib/stocks/guard";
import { parseSymbols } from "./_lib/stocks/params";
import { failOf, LATE_FAIL, fetchChart, mapPool, quotePayload, upstreamWideError, type YahooDeps } from "./_lib/stocks/yahoo";

export const QUOTE_TTL_MS = 15_000;
export const BUDGET_MS = 9000;

type QuoteResult = QuoteResponse["results"][string];
const memo = createMemo<QuoteResult>();

export const quoteTesting = {
  clear: (): void => memo.clear(),
  deps: {} as YahooDeps,
};

export default handler(async (req, ctx) => {
  requireMethod(req, "GET");
  await stockGuard(req, ctx, { scope: "stock-quote", max: 240, windowSec: 600 });
  const symbols = parseSymbols(new URL(req.url).searchParams.get("symbols"), STOCK_LIMITS.quotesPerRequest);
  const started = Date.now();
  let oldest = started;
  const entries = await mapPool<string, [string, QuoteResult]>(
    symbols,
    5,
    async (symbol): Promise<[string, QuoteResult]> => {
      try {
        const r = await memo.wrap(symbol, QUOTE_TTL_MS, async () => quotePayload(await fetchChart(symbol, "1d", "5d", quoteTesting.deps)));
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
  const body: QuoteResponse = { source: "yahoo", fetchedAt: oldest, results };
  return stockJson(body, QUOTE_TTL_MS / 1000);
});

export const config: Config = { path: "/api/v1/stocks/quote", method: ["GET"] };

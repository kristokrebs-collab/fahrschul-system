/**
 * GET /api/v1/stocks/news?symbols=TSLA,NVDA – Yahoo Finance headlines per ticker (F68, public RSS, no key, nothing
 * personal). A headline is a lead, not a fact: the answer carries title, link, publisher (the link's host), time and the
 * feed's short summary – nothing is rewritten or rated here (the app marks keywords on the device).
 * SEC filings (8-K) are another source and another function; the app merges sources on the device.
 * Guards as `stock-bars` (own limit: 120 / 10 min), ≤ 8 tickers per request, answers `private` for 5 min.
 */
import type { Config } from "@netlify/functions";
import { STOCK_LIMITS } from "../../src/market/stocks/types";
import type { NewsResponse } from "../../src/market/stocks/wire";
import { handler, requireMethod } from "./_lib/http";
import { createMemo, stockGuard, stockJson } from "./_lib/stocks/guard";
import { parseSymbols } from "./_lib/stocks/params";
import { fetchHeadlines, type RssDeps } from "./_lib/stocks/rss";
import { failOf, LATE_FAIL, mapPool, upstreamWideError } from "./_lib/stocks/yahoo";

export const NEWS_TTL_MS = 300_000;
export const BUDGET_MS = 9000;

type NewsResult = NewsResponse["results"][string];
const memo = createMemo<NewsResult>();

export const newsTesting = {
  clear: (): void => memo.clear(),
  deps: {} as RssDeps,
};

export default handler(async (req, ctx) => {
  requireMethod(req, "GET");
  await stockGuard(req, ctx, { scope: "stock-news", max: 120, windowSec: 600 });
  const symbols = parseSymbols(new URL(req.url).searchParams.get("symbols"), STOCK_LIMITS.newsPerRequest);
  const started = Date.now();
  let oldest = started;
  const entries = await mapPool<string, [string, NewsResult]>(
    symbols,
    4,
    async (symbol): Promise<[string, NewsResult]> => {
      try {
        const r = await memo.wrap(symbol, NEWS_TTL_MS, async () => ({ ok: true as const, items: await fetchHeadlines(symbol, newsTesting.deps) }));
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
  const body: NewsResponse = { source: "yahoo-rss", fetchedAt: oldest, results };
  return stockJson(body, NEWS_TTL_MS / 1000);
});

export const config: Config = { path: "/api/v1/stocks/news", method: ["GET"] };

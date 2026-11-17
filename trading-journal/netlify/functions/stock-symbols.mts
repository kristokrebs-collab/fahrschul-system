/**
 * GET /api/v1/stocks/symbols – the list of US-listed common stocks and ADRs (F67) from Nasdaq Trader's two public symbol
 * directories (`nasdaqlisted.txt`, `otherlisted.txt`). ETFs, test issues, warrants, rights, units, notes and preferred
 * shares are left out (rule in `_lib/stocks/nasdaq.ts`); the answer says how many rows were read and why the others
 * were dropped. The files are rewritten every night, so the answer is cached per day: in memory for 12 h, in the
 * browser for 6 h. Public data, no key, nothing personal in or out.
 * Guards as `stock-bars` (own limit: 20 / 10 min). Failure: HTTP 429 / 502 with a German message, never a made-up list.
 */
import type { Config } from "@netlify/functions";
import type { SymbolsResponse } from "../../src/market/stocks/wire";
import { handler, HttpError, requireMethod } from "./_lib/http";
import { createMemo, stockGuard, stockJson } from "./_lib/stocks/guard";
import { DirectoryFetchError, DirectoryFormatError, fetchDirectory } from "./_lib/stocks/nasdaq";

export const SYMBOLS_TTL_MS = 12 * 3_600_000;
export const SYMBOLS_BROWSER_S = 6 * 3600;

const memo = createMemo<SymbolsResponse>(2);

export const symbolsTesting = {
  clear: (): void => memo.clear(),
  fetch: undefined as ((url: string, init?: RequestInit) => Promise<Response>) | undefined,
};

export default handler(async (req, ctx) => {
  requireMethod(req, "GET");
  await stockGuard(req, ctx, { scope: "stock-symbols", max: 20, windowSec: 600 });
  try {
    const r = await memo.wrap("directory", SYMBOLS_TTL_MS, async (): Promise<SymbolsResponse> => {
      const dir = await fetchDirectory(symbolsTesting.fetch);
      return {
        source: "nasdaqtrader",
        fileTime: dir.fileTime,
        fetchedAt: Date.now(),
        counts: dir.counts,
        symbols: dir.entries.map((e) => [e.symbol, e.name, e.exchange, e.fin] as [string, string, string, string | null]),
      };
    });
    return stockJson(r.value, SYMBOLS_BROWSER_S);
  } catch (e) {
    if (e instanceof DirectoryFetchError) {
      if (e.reason === "rate-limited") throw new HttpError(429, "stock_upstream_rate_limited", e.message, undefined, { "retry-after": "300" });
      if (e.reason === "blocked") throw new HttpError(502, "stock_upstream_blocked", e.message);
      throw new HttpError(502, "stock_upstream_unavailable", e.message);
    }
    if (e instanceof DirectoryFormatError) throw new HttpError(502, "stock_upstream_format", "Das Symbolverzeichnis von Nasdaq Trader hat ein unbekanntes Format. Der Scanner kann die Liste gerade nicht aufbauen.");
    throw e;
  }
});

export const config: Config = { path: "/api/v1/stocks/symbols", method: ["GET"] };

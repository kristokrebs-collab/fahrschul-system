/**
 * Binance SPOT klines – the last rung of the Labor's fallback chain (`src/views/labor/historySource.ts`), never a live
 * feed. Host `https://data-api.binance.vision` (Binance's market-data-only mirror of the spot API: public data, no keys,
 * CORS-enabled), `GET /api/v3/klines`. The rows have the same 12 fields as the futures klines (`klinesSchema`), at most
 * 1000 per page, and `startTime` / `limit` paging works the same way.
 *
 * SPOT IS NOT FUTURES: the price differs by the basis, there is no funding, and a futures-only market has no spot
 * symbol (answer 400 `-1121` → `bad_symbol`). Whoever shows spot candles must say so; this client stamps nothing.
 *
 * The same rows are also served by the app's own small function (`netlify/functions/klines-proxy.mts`,
 * `GET /api/v1/klines?venue=spot`) for browsers that cannot reach the Binance host themselves: `spotRest({ viaApp: true })`.
 */
import type { Candle } from "../types";
import type { FetchInterval } from "../period";
import { klinesSchema, mapKline } from "./binance";
import { fetchJson, qs, withExtras, type FetchLike, type RequestExtras } from "./http";

export const SPOT_REST = "https://data-api.binance.vision";
/** Same-origin function that relays the same rows (host allow-list, timeout, cache). */
export const KLINES_APP_PATH = "/api/v1/klines";
/** Binance's page limit for spot klines. */
export const SPOT_PAGE = 1000;

export interface SpotOptions {
  base?: string;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
  /** read through the app's own function instead of the Binance host */
  viaApp?: boolean;
}

export function spotRest(opts: SpotOptions = {}) {
  const now = opts.now ?? (() => Date.now());
  const io = { fetch: opts.fetch, timeoutMs: opts.timeoutMs ?? 15_000 };
  const viaApp = opts.viaApp === true;
  const base = opts.base ?? (viaApp ? "" : SPOT_REST);
  const url = (params: Record<string, string | number | undefined>) => (viaApp ? `${base}${KLINES_APP_PATH}${qs({ venue: "spot", ...params })}` : `${base}/api/v3/klines${qs(params)}`);
  return {
    source: viaApp ? ("spot-app" as const) : ("spot" as const),
    /** One page of spot candles from `startTime` (ascending, at most `limit` ≤ 1000). */
    async klines(symbol: string, interval: FetchInterval, p: RequestExtras & { limit?: number; startTime?: number; endTime?: number } = {}): Promise<Candle[]> {
      const rows = await fetchJson(url({ symbol, interval, limit: Math.min(SPOT_PAGE, p.limit ?? SPOT_PAGE), startTime: p.startTime, endTime: p.endTime }), klinesSchema, withExtras(io, p));
      const t = now();
      return rows.map((r) => mapKline(r, t));
    },
  };
}
export type SpotRest = ReturnType<typeof spotRest>;

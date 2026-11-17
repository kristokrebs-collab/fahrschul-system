/**
 * Ausführbarkeit (F44), the data: ONE order-book snapshot (`/fapi/v1/depth`, the deepest the exchange gives, 1000 levels) and the
 * 24 h turnover (`/fapi/v1/ticker/24hr`) of a Binance USDⓈ-M symbol, read on the user's click – no polling, no stream. The
 * route is the usual one: direct, and after a 451 / CORS / network answer through the same-origin EU proxy. A failure is
 * returned with its reason (never thrown, never replaced by a number): the card then says „keine Daten“ and leaves the plan's
 * own checks alone – a book that could not be read is no green light.
 *
 * Nothing is sent but two public GET requests; no keys, no custom headers.
 */
import { bookOf, type Book } from "@/domain/execution";
import { isFileProtocol, IS_FILE_BUILD } from "@/edition";
import { binanceRest, type BinanceRest } from "../sources/binance";
import { toRestError } from "../sources/http";
import { proxyRest } from "../sources/proxy";
import { RestRoute, abortableFetch } from "../sources/route";

/** Levels asked for: the most the exchange gives (weight 20 – one click, so it does not matter). */
export const DEPTH_LEVELS = 1000;

export interface BookDeps {
  rest: () => BinanceRest;
  proxy: () => BinanceRest | null;
  now: () => number;
  online: () => boolean;
}

export const defaultBookDeps = (signal?: AbortSignal): BookDeps => ({
  rest: () => binanceRest({ fetch: abortableFetch(signal) }),
  proxy: () => (IS_FILE_BUILD || isFileProtocol() ? null : proxyRest({ fetch: abortableFetch(signal) })),
  now: () => Date.now(),
  online: () => typeof navigator === "undefined" || (navigator as { onLine?: boolean }).onLine !== false,
});

export type BookResult =
  | {
      ok: true;
      symbol: string;
      book: Book;
      /** exchange time of the snapshot (ms) */
      asOf: number;
      /** device time the answer arrived (ms) */
      receivedAt: number;
      route: "direct" | "proxy";
      levels: number;
      /** turnover of the last 24 h in quote currency, `null` when that request failed */
      quoteVolume24h: number | null;
      volumeNote: string | null;
    }
  | { ok: false; symbol: string; kind: string; at: number };

/** Reads the snapshot. Never throws. */
export async function loadBook(symbol: string, deps: BookDeps = defaultBookDeps()): Promise<BookResult> {
  const sym = symbol.trim().toUpperCase();
  const at = deps.now();
  if (!sym) return { ok: false, symbol: sym, kind: "bad_symbol", at };
  if (!deps.online()) return { ok: false, symbol: sym, kind: "offline", at };
  const net = new RestRoute(deps.rest, deps.proxy);
  let depth;
  try {
    depth = await net.call((r) => r.depth(sym, DEPTH_LEVELS));
  } catch (e) {
    return { ok: false, symbol: sym, kind: toRestError(e).kind as string, at: deps.now() };
  }
  let quoteVolume24h: number | null = null;
  let volumeNote: string | null = null;
  try {
    const t = await net.call((r) => r.ticker24h(sym));
    quoteVolume24h = Number.isFinite(t.data.quoteVolume) && t.data.quoteVolume > 0 ? t.data.quoteVolume : null;
    if (quoteVolume24h === null) volumeNote = "Der Tagesumsatz kam ohne Wert.";
  } catch (e) {
    volumeNote = `Der Tagesumsatz ließ sich nicht lesen (${toRestError(e).kind}).`;
  }
  const d = depth.data;
  return {
    ok: true,
    symbol: sym,
    book: bookOf(d.bids, d.asks, d.time),
    asOf: depth.asOf,
    receivedAt: deps.now(),
    route: net.route,
    levels: Math.max(d.bids.length, d.asks.length),
    quoteVolume24h,
    volumeNote,
  };
}

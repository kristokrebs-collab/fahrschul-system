/**
 * The route to Binance for reads that may be blocked (the archive's collector and history load, the order-book check): direct first; after a 451 / CORS / network /
 * rate-limit answer the same request is tried once through the same-origin EU proxy (`/api/binance`), and from then on the
 * proxy is used for the rest of the session. The file build has no proxy (`proxy()` returns `null`).
 */
import type { BinanceRest } from "./binance";
import { toRestError, type FetchLike } from "./http";

/** Failure kinds after which the same request is tried once through the proxy. */
export const PROXY_FALLBACK: ReadonlySet<string> = new Set(["blocked_451", "network", "cors", "rate_limited"]);

export class RestRoute {
  private viaProxy = false;

  constructor(
    private readonly rest: () => BinanceRest,
    private readonly proxy: () => BinanceRest | null,
  ) {}

  get route(): "direct" | "proxy" {
    return this.viaProxy ? "proxy" : "direct";
  }

  /** Runs `fn` on the current route; throws a `RestError`. */
  async call<T>(fn: (r: BinanceRest) => Promise<T>): Promise<T> {
    const proxy = this.proxy();
    const first = this.viaProxy && proxy ? proxy : this.rest();
    try {
      return await fn(first);
    } catch (e) {
      const err = toRestError(e);
      if (!this.viaProxy && proxy && PROXY_FALLBACK.has(err.kind)) {
        try {
          const v = await fn(proxy);
          this.viaProxy = true;
          return v;
        } catch (e2) {
          throw toRestError(e2);
        }
      }
      throw err;
    }
  }
}

/** A fetch that is cut off by `signal` (a cancel button reaches a request that is under way). */
export const abortableFetch =
  (signal: AbortSignal | undefined): FetchLike =>
  (input, init) =>
    fetch(input, { ...init, signal: signal ?? init?.signal });

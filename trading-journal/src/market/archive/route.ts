/**
 * The route to Binance for the archive's reads (collector and history load): direct first; after a 451 / CORS / network /
 * rate-limit answer the same request is tried once through the same-origin EU proxy (`/api/binance`), and from then on the
 * proxy is used for the rest of the session. The file build has no proxy (`proxy()` returns `null`).
 */
import type { BinanceRest } from "../sources/binance";
import { toRestError } from "../sources/http";

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

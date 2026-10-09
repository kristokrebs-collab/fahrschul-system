/**
 * Same-origin Binance proxy under `/api/binance/*` (Plan 4.4 probe, 4.6). On Netlify it is a plain proxy rewrite in
 * `netlify.toml` (`/api/binance/futures/data/* → https://fapi.binance.com/futures/data/:splat 200`, served from the
 * CDN edge next to the visitor); the optional Netlify function (`netlify/functions-disabled/binance.mts`) answers on
 * the same paths and adds `x-upstream-status`. The provider routes the Binance-only ratio feeds through it when the
 * browser cannot read `fapi.binance.com` directly (CORS / network), when Binance is geo-blocked, or when the user
 * prefers it (`EU-Proxy verwenden`). Single-file builds (`file://`) have no proxy.
 */
import { binanceRest, type BinanceRest } from "./binance";
import type { FetchLike } from "./http";

export const PROXY_BASE = "/api/binance";

export interface ProxyProbe {
  /** the proxy returns Binance JSON (`serverTime`) */
  usable: boolean;
  /** Binance answered 451 through the proxy (the proxy's egress region is blocked) */
  blocked: boolean;
  upstreamStatus: number | null;
}

/**
 * `usable = res.ok && content-type JSON && body.serverTime is a number` (the function's `x-upstream-status` header
 * is optional: the netlify.toml proxy rewrite passes Binance's own headers). A 200 with an HTML body (SPA fallback,
 * no proxy deployed) → `usable:false`. HTTP 451 or `x-upstream-status: 451` → `usable:false, blocked:true`.
 */
export async function probeProxy(fetchImpl: FetchLike = (u, i) => fetch(u, i), base = PROXY_BASE): Promise<ProxyProbe> {
  try {
    const res = await fetchImpl(`${base}/fapi/v1/time`, { method: "GET", cache: "no-store" });
    const upstreamHeader = res.headers.get("x-upstream-status");
    const upstreamStatus = upstreamHeader === null ? res.status : Number(upstreamHeader);
    if (res.status === 451 || upstreamStatus === 451) return { usable: false, blocked: true, upstreamStatus: 451 };
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok || !ct.includes("json")) return { usable: false, blocked: false, upstreamStatus };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { usable: false, blocked: false, upstreamStatus };
    }
    const ok = typeof body === "object" && body !== null && typeof (body as { serverTime?: unknown }).serverTime === "number";
    return { usable: ok, blocked: false, upstreamStatus };
  } catch {
    return { usable: false, blocked: false, upstreamStatus: null };
  }
}

export function proxyRest(opts: { fetch?: FetchLike; now?: () => number; base?: string } = {}): BinanceRest {
  return binanceRest({ base: opts.base ?? PROXY_BASE, fetch: opts.fetch, now: opts.now, source: "proxy" });
}

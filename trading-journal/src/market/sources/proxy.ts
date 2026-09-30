/**
 * Netlify EU proxy (Plan 4.4 probe, 4.6 function). Same REST surface as Binance under `/api/binance/*`.
 * Only used when `primary.blocked && proxy.usable` and Bybit cannot serve the feed.
 */
import { binanceRest, type BinanceRest } from "./binance";
import type { FetchLike } from "./http";

export const PROXY_BASE = "/api/binance";

export interface ProxyProbe {
  usable: boolean;
  /** upstream answered 451 (function runs in a blocked region) */
  blocked: boolean;
  upstreamStatus: number | null;
}

/**
 * `usable = res.ok && content-type JSON && x-upstream-status present && body.serverTime is a number`.
 * A 200 with an HTML body (SPA redirect without a function) or without `x-upstream-status` → `usable:false`.
 * `x-upstream-status: 451` → `usable:true, blocked:true`.
 */
export async function probeProxy(fetchImpl: FetchLike = (u, i) => fetch(u, i), base = PROXY_BASE): Promise<ProxyProbe> {
  try {
    const res = await fetchImpl(`${base}/fapi/v1/time`, { method: "GET", cache: "no-store" });
    const upstreamHeader = res.headers.get("x-upstream-status");
    const upstreamStatus = upstreamHeader === null ? null : Number(upstreamHeader);
    if (upstreamStatus === 451) return { usable: true, blocked: true, upstreamStatus };
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok || !ct.includes("application/json") || upstreamHeader === null) return { usable: false, blocked: false, upstreamStatus };
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

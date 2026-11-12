/**
 * EU proxy for Binance USDⓈ-M public market data (Plan 4.6). Disabled by default: lives in
 * `netlify/functions-disabled/`; move to `netlify/functions/` to enable. `region: "fra"` requires a Netlify
 * Pro/Enterprise plan — on Free the function runs in Ohio and Binance answers 451, which the client sees
 * through `x-upstream-status` and shows as `EU-Proxy: Region blockiert (451)`.
 *
 * Client contract (`src/market/sources/proxy.ts`): path `/api/binance/*`, JSON body, `x-upstream-status`
 * header always present, CORS to `SITE_ORIGIN`.
 */
import type { Config, Context } from "@netlify/functions";

const UPSTREAM = "https://fapi.binance.com";
const ALLOW = /^\/(fapi\/v1\/(klines|premiumIndex|fundingRate|openInterest|ticker\/24hr|time)|futures\/data\/(topLongShortPositionRatio|topLongShortAccountRatio|globalLongShortAccountRatio|takerlongshortRatio|openInterestHist))$/;
const ALLOWED_PARAMS = new Set(["symbol", "interval", "period", "limit", "startTime", "endTime"]);

function corsHeaders(origin: string | null): Record<string, string> {
  const site = process.env.SITE_ORIGIN;
  const allow = site ? (origin === site ? site : site) : "*";
  return { "access-control-allow-origin": allow, "access-control-allow-methods": "GET, OPTIONS", "access-control-expose-headers": "x-upstream-status", vary: "origin" };
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return new Response(JSON.stringify({ code: -1, msg: "method not allowed" }), { status: 405, headers: { ...cors, "content-type": "application/json", "x-upstream-status": "0" } });

  const path = url.pathname.replace(/^\/api\/binance/, "");
  if (!ALLOW.test(path)) return new Response(JSON.stringify({ code: -1, msg: "forbidden" }), { status: 403, headers: { ...cors, "content-type": "application/json", "x-upstream-status": "0" } });

  const params = new URLSearchParams();
  for (const [k, v] of url.searchParams) if (ALLOWED_PARAMS.has(k)) params.set(k, v);
  const search = params.toString() ? `?${params}` : "";

  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}${path}${search}`, { headers: { accept: "application/json" } });
  } catch {
    return new Response(JSON.stringify({ code: -1, msg: "upstream unreachable" }), { status: 502, headers: { ...cors, "content-type": "application/json", "x-upstream-status": "0" } });
  }

  const body = await upstream.text();
  const isJson = (upstream.headers.get("content-type") ?? "").includes("json") || body.trimStart().startsWith("{") || body.trimStart().startsWith("[");
  const cacheControl = path.startsWith("/futures/data") ? "public, s-maxage=120, stale-while-revalidate=300" : "public, s-maxage=5";
  return new Response(isJson ? body : JSON.stringify({ code: upstream.status, msg: body.slice(0, 200) }), {
    status: upstream.status,
    headers: {
      ...cors,
      "content-type": "application/json",
      "netlify-cdn-cache-control": upstream.ok ? cacheControl : "no-store",
      "cache-control": "no-store",
      "x-upstream-status": String(upstream.status),
    },
  });
};

export const config: Config = { path: "/api/binance/*", region: "fra" };

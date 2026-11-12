/**
 * GET /api/v1/klines?venue=spot|futures&symbol=BTCUSDT&interval=1h[&startTime=ms][&endTime=ms][&limit=n] – a small relay
 * of PUBLIC Binance candles for browsers that cannot read the Binance host themselves (a network or DNS block, a browser
 * extension, a corporate proxy, a CORS failure). Used by the Backtest-Labor as the last rung of its fallback chain
 * (`src/views/labor/historySource.ts`, `venue=spot`): the same-origin path needs no CSP entry and no CORS.
 *
 * What it is NOT: no secret, no key, no account, nothing personal – only a symbol, an interval and a time window go out.
 * What it guards (a public relay must never run open):
 *  - host allow-list: exactly two upstream URLs, built here from `VENUES` (`data-api.binance.vision` spot, `fapi.binance.com`
 *    futures); the caller can choose a venue by name, never a host or a path;
 *  - fixed parameters: symbol `[A-Z0-9]{5,20}`, interval from a list, numbers as integers, `limit` ≤ the venue's page size;
 *  - a time limit on the upstream call (`UPSTREAM_TIMEOUT_MS`) and a clear German error with the reason: 504 on a hang,
 *    451 when Binance blocks the server's region, 429 on a rate limit, 502 otherwise – never an empty 200;
 *  - a cache: a full page of closed history is immutable (one day, shared at the CDN edge), anything near "now" lives 20 s;
 *    identical requests inside one instance are answered from memory (many users, one request upstream);
 *  - a per-IP counter (120 requests a minute per instance).
 *
 * SPOT IS NOT FUTURES. The answer carries `x-klines-venue`, and the app labels the candles it draws from them accordingly.
 * The futures venue is served too (same code), but from the default function region Binance usually answers 451 – the
 * EU proxy rewrite in `netlify.toml` (`/api/binance/fapi/v1/klines`) stays the way to Futures.
 */
import type { Config, Context } from "@netlify/functions";
import { BASE_HEADERS, error, handler, HttpError, requireMethod } from "./_lib/http";

interface Venue {
  url: string;
  /** most rows per page upstream */
  max: number;
}

/** The ONLY hosts this function ever talks to. */
export const VENUES: Readonly<Record<string, Venue>> = {
  spot: { url: "https://data-api.binance.vision/api/v3/klines", max: 1000 },
  futures: { url: "https://fapi.binance.com/fapi/v1/klines", max: 1500 },
};

export const INTERVALS: ReadonlySet<string> = new Set(["1m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w"]);
export const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;
export const UPSTREAM_TIMEOUT_MS = 8_000;
export const RATE_MAX = 120;
export const RATE_WINDOW_MS = 60_000;
/** Interval length (ms) for the cache rule. */
const IV_MS: Readonly<Record<string, number>> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "1d": 86_400_000, "1w": 604_800_000 };

interface Entry {
  at: number;
  ttl: number;
  status: number;
  body: string;
}

const memo = new Map<string, Entry>();
const slots = new Map<string, { count: number; resetAt: number }>();
const MEMO_MAX = 300;

/** Tests: forget the cache and the counters, inject the upstream transport. */
export const klinesTesting = {
  clear: (): void => {
    memo.clear();
    slots.clear();
  },
  fetch: undefined as typeof fetch | undefined,
  now: undefined as (() => number) | undefined,
};

const nowMs = (): number => klinesTesting.now?.() ?? Date.now();

function limitIp(ip: string): void {
  const t = nowMs();
  if (slots.size > 2_000) for (const [k, s] of slots) if (s.resetAt <= t) slots.delete(k);
  let s = slots.get(ip);
  if (!s || s.resetAt <= t) {
    s = { count: 0, resetAt: t + RATE_WINDOW_MS };
    slots.set(ip, s);
  }
  if (++s.count > RATE_MAX) throw new HttpError(429, "rate_limited", "Zu viele Kerzen-Abrufe. Bitte kurz warten.", undefined, { "retry-after": String(Math.max(1, Math.ceil((s.resetAt - t) / 1000))) });
}

function int(raw: string | null, name: string, min: number, max: number): number | undefined {
  if (raw === null || raw === "") return undefined;
  if (!/^\d{1,16}$/.test(raw)) throw new HttpError(400, "bad_param", `Parameter ${name} ist keine ganze Zahl.`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new HttpError(400, "bad_param", `Parameter ${name} liegt außerhalb des erlaubten Bereichs.`);
  return n;
}

/** How long an answer may be reused: a full page that ends well in the past never changes. */
export function ttlOf(body: string, interval: string, limit: number, t: number): number {
  try {
    const rows = JSON.parse(body) as unknown;
    if (Array.isArray(rows) && rows.length >= limit && rows.length > 0) {
      const last = rows[rows.length - 1] as unknown[];
      const closeTime = Array.isArray(last) ? Number(last[6]) : NaN;
      if (Number.isFinite(closeTime) && closeTime < t - 2 * (IV_MS[interval] ?? 86_400_000)) return 86_400;
    }
  } catch {
    /* not JSON: short */
  }
  return 20;
}

function ok(entry: Entry, venue: string, hit: boolean): Response {
  return new Response(entry.body, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      "content-type": "application/json; charset=utf-8",
      // the CDN edge keeps a page of old history for a day; browsers a little less
      "cache-control": `public, max-age=${Math.min(entry.ttl, 3_600)}`,
      "netlify-cdn-cache-control": `public, s-maxage=${entry.ttl}, stale-while-revalidate=60`,
      "x-klines-venue": venue,
      "x-klines-cache": hit ? "hit" : "miss",
      "x-upstream-status": "200",
    },
  });
}

export default handler(async (req: Request, ctx: Context) => {
  requireMethod(req, "GET");
  const url = new URL(req.url);
  const q = url.searchParams;
  const venueName = q.get("venue") ?? "spot";
  const venue = Object.hasOwn(VENUES, venueName) ? VENUES[venueName]! : undefined;
  if (!venue) throw new HttpError(400, "bad_venue", "Unbekannte Börse. Erlaubt: spot, futures.");
  const symbol = (q.get("symbol") ?? "").toUpperCase();
  if (!SYMBOL_RE.test(symbol)) throw new HttpError(400, "bad_symbol", "Der Markt ist ungültig. Beispiel: BTCUSDT.");
  const interval = q.get("interval") ?? "";
  if (!INTERVALS.has(interval)) throw new HttpError(400, "bad_interval", `Zeiteinheit unbekannt. Erlaubt: ${[...INTERVALS].join(", ")}.`);
  const limit = int(q.get("limit"), "limit", 1, venue.max) ?? 500;
  const startTime = int(q.get("startTime"), "startTime", 0, 4_102_444_800_000);
  const endTime = int(q.get("endTime"), "endTime", 0, 4_102_444_800_000);

  limitIp(ctx?.ip ?? req.headers.get("x-nf-client-connection-ip") ?? "unknown");

  const up = new URL(venue.url);
  up.searchParams.set("symbol", symbol);
  up.searchParams.set("interval", interval);
  up.searchParams.set("limit", String(limit));
  if (startTime !== undefined) up.searchParams.set("startTime", String(startTime));
  if (endTime !== undefined) up.searchParams.set("endTime", String(endTime));
  const key = up.toString();

  const t = nowMs();
  const hit = memo.get(key);
  if (hit && t - hit.at < hit.ttl * 1000) return ok(hit, venueName, true);

  let res: Response;
  try {
    res = await (klinesTesting.fetch ?? fetch)(key, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return error(timeout ? 504 : 502, timeout ? "upstream_timeout" : "upstream_unreachable", timeout ? `Binance hat nicht innerhalb von ${UPSTREAM_TIMEOUT_MS / 1000} s geantwortet.` : "Binance ist von diesem Server aus nicht erreichbar.", undefined, { headers: { "x-upstream-status": "0" } });
  }

  let body: string;
  try {
    body = await res.text();
  } catch {
    return error(504, "upstream_timeout", `Binance hat die Antwort nicht innerhalb von ${UPSTREAM_TIMEOUT_MS / 1000} s geliefert.`, undefined, { headers: { "x-upstream-status": String(res.status) } });
  }
  const upstream = { headers: { "x-upstream-status": String(res.status) } };
  if (res.status === 451) return error(451, "upstream_blocked", "Binance sperrt die Region dieses Servers (HTTP 451).", undefined, upstream);
  if (res.status === 429 || res.status === 418 || res.status === 403) return error(429, "upstream_rate_limited", "Binance lehnt die Abrufe gerade ab (zu viele Anfragen oder gesperrt).", undefined, upstream);
  if (res.status === 400) {
    // Binance's own answer (`{ code: -1121, msg }`) tells the app that the market does not exist there
    return new Response(body, { status: 400, headers: { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", "x-upstream-status": "400" } });
  }
  if (!res.ok) return error(502, "upstream_error", `Binance meldet einen Fehler (HTTP ${res.status}).`, undefined, upstream);
  let rows: unknown;
  try {
    rows = JSON.parse(body);
  } catch {
    rows = null;
  }
  if (!Array.isArray(rows)) return error(502, "upstream_bad_answer", "Binance hat keine Kerzen geliefert.", undefined, upstream);

  const entry: Entry = { at: t, ttl: ttlOf(body, interval, limit, t), status: 200, body };
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
  memo.set(key, entry);
  return ok(entry, venueName, false);
});

export const config: Config = { path: "/api/v1/klines", method: ["GET"] };

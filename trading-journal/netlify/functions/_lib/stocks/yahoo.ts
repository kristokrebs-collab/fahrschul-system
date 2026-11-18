/**
 * Yahoo Finance "chart" endpoint (`/v8/finance/chart/<symbol>`) – unofficial, keyless, free. Yahoo may change or block it
 * at any time, so every failure is a typed `UpstreamError` the functions turn into a plain German message; nothing is
 * ever filled in. This is the only place that knows Yahoo's JSON.
 *
 * Why a server at all: the browser cannot read Yahoo (no CORS headers), and the endpoint wants an ordinary User-Agent.
 * What leaves the app is a ticker, an interval and a range – nothing else.
 *
 * Rules applied to what comes back (the same ones the trader-scanner skill documents):
 *  - candles with a missing open / high / low / close (a halt, a null tick) are dropped;
 *  - intraday: a candle off the interval grid (the live tick, 10:49:45) is dropped, and so is everything outside the
 *    regular session (pre-market, after hours, the 16:00 closing print);
 *  - daily: one candle per New York day (a late duplicate wins).
 */
import { nyParts, regularOnly } from "../../../../src/market/stocks/session";
import { STOCK_INTERVAL_MS, type StockInterval } from "../../../../src/market/stocks/types";
import type { WireBar, WireFail, WireReason } from "../../../../src/market/stocks/wire";
import { HttpError } from "../http";

export const YAHOO_HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"] as const;
export const YAHOO_USER_AGENT = "Mozilla/5.0 (compatible; TradingJournal/1.0)";
/** Yahoo's interval word per interval of the app. */
export const YAHOO_INTERVAL: Readonly<Record<StockInterval, string>> = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "60m", "1d": "1d" };

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class UpstreamError extends Error {
  constructor(
    readonly reason: WireReason,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/** What a ticker answers when the time budget of the request ran out before it was started. */
export const LATE_FAIL: WireFail = { ok: false, reason: "timeout", message: "Der Abruf wurde abgebrochen, weil die Zeit für diese Anfrage aufgebraucht war." };

export const failOf = (e: unknown): WireFail => {
  if (e instanceof UpstreamError) return { ok: false, reason: e.reason, message: e.message };
  return { ok: false, reason: "upstream", message: "Yahoo Finance ist gerade nicht erreichbar." };
};

/** Yahoo spells a class share `BRK-B`; the directory (and the app) `BRK.B`. */
export const toYahooSymbol = (symbol: string): string => symbol.trim().toUpperCase().replace(/\./g, "-");

/* ------------------------------------------------------------------ transport */

/** After a 429 from Yahoo the instance stops asking for a while (one answer for everyone instead of a hammered source). */
let pausedUntil = 0;
let pausedReason: { reason: WireReason; message: string } | null = null;
export const RATE_PAUSE_MS = 30_000;

export function resetYahooStateForTests(): void {
  pausedUntil = 0;
  pausedReason = null;
}

export interface YahooDeps {
  fetch?: FetchFn;
  now?: () => number;
  /** per request, ms */
  timeoutMs?: number;
}

const BLOCKED_TEXT = "Yahoo Finance verweigert die Abrufe dieses Servers (HTTP {s}). Die Quelle ist inoffiziell und kann ohne Vorwarnung sperren.";
const LIMIT_TEXT = "Yahoo Finance begrenzt die Abrufe gerade (HTTP 429). Bitte in einigen Minuten erneut versuchen.";

async function getJson(path: string, deps: YahooDeps): Promise<{ status: number; body: unknown }> {
  const now = (deps.now ?? Date.now)();
  if (pausedReason && now < pausedUntil) throw new UpstreamError(pausedReason.reason, pausedReason.message, 429);
  const f: FetchFn = deps.fetch ?? ((u, i) => fetch(u, i));
  let last: UpstreamError = new UpstreamError("upstream", "Yahoo Finance ist gerade nicht erreichbar.");
  for (const host of YAHOO_HOSTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 6000);
    try {
      const res = await f(`${host}${path}`, { headers: { "user-agent": YAHOO_USER_AGENT, accept: "application/json,*/*" }, signal: ctrl.signal });
      if (res.status === 429) {
        last = new UpstreamError("rate-limited", LIMIT_TEXT, 429);
        pausedReason = { reason: "rate-limited", message: LIMIT_TEXT };
        pausedUntil = now + RATE_PAUSE_MS;
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        last = new UpstreamError("blocked", BLOCKED_TEXT.replace("{s}", String(res.status)), res.status);
        continue;
      }
      if (res.status >= 500) {
        last = new UpstreamError("upstream", `Yahoo Finance meldet einen Serverfehler (HTTP ${res.status}).`, res.status);
        continue;
      }
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        if (res.status === 404) throw new UpstreamError("bad-symbol", "Yahoo Finance kennt dieses Kürzel nicht.", 404);
        throw new UpstreamError("bad-response", "Yahoo Finance hat keine lesbare Antwort geschickt.", res.status);
      }
      return { status: res.status, body };
    } catch (e) {
      if (e instanceof UpstreamError) throw e;
      const aborted = typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
      last = new UpstreamError(aborted ? "timeout" : "upstream", aborted ? "Yahoo Finance antwortet nicht rechtzeitig." : "Yahoo Finance ist gerade nicht erreichbar.");
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

/* ------------------------------------------------------------------ parsing */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export interface RawCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartMeta {
  name: string | null;
  currency: string | null;
  exchange: string | null;
  price: number | null;
  volume: number | null;
  marketTime: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /** Yahoo's own previous close (only trustworthy for a one-day range) */
  previousClose: number | null;
}

export interface ChartData {
  candles: RawCandle[];
  meta: ChartMeta;
  interval: StockInterval;
  range: string;
}

/** Yahoo's chart answer → candles and meta. Throws `UpstreamError` for "no such symbol", "no data" and shapes it does not know. */
export function parseChart(doc: unknown, interval: StockInterval, range: string): ChartData {
  const root = isRec(doc) && isRec(doc.chart) ? doc.chart : null;
  if (!root) throw new UpstreamError("bad-response", "Yahoo Finance hat in einem unbekannten Format geantwortet.");
  const err = isRec(root.error) ? root.error : null;
  if (err) {
    const code = str(err.code) ?? "";
    if (/not found/i.test(code) || /no data found|delisted/i.test(str(err.description) ?? "")) throw new UpstreamError("bad-symbol", "Yahoo Finance kennt dieses Kürzel nicht (oder es ist nicht mehr gelistet).", 404);
    throw new UpstreamError("upstream", `Yahoo Finance meldet: ${str(err.description) ?? code ?? "Fehler"}`);
  }
  const result = Array.isArray(root.result) ? root.result[0] : null;
  if (!isRec(result)) throw new UpstreamError("bad-response", "Yahoo Finance hat keine Daten geliefert.");
  const meta = isRec(result.meta) ? result.meta : {};
  const ts = Array.isArray(result.timestamp) ? result.timestamp : [];
  const indicators = isRec(result.indicators) ? result.indicators : {};
  const q = Array.isArray(indicators.quote) && isRec(indicators.quote[0]) ? indicators.quote[0] : {};
  const col = (k: string): unknown[] => (Array.isArray(q[k]) ? (q[k] as unknown[]) : []);
  const [o, h, l, c, v] = [col("open"), col("high"), col("low"), col("close"), col("volume")];
  const step = STOCK_INTERVAL_MS[interval];
  const grid = interval === "1h" ? 1_800_000 : step;
  let candles: RawCandle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = num(ts[i]);
    const open = num(o[i]);
    const high = num(h[i]);
    const low = num(l[i]);
    const close = num(c[i]);
    if (t == null || open == null || high == null || low == null || close == null || close <= 0) continue;
    const time = t * 1000;
    if (interval !== "1d" && time % grid !== 0) continue; // the live tick is off the grid
    candles.push({ time, open, high, low, close, volume: num(v[i]) ?? 0 });
  }
  if (interval !== "1d") candles = regularOnly(candles);
  candles.sort((a, b) => a.time - b.time);
  // one candle per time (intraday) / per New York day (daily): the later one wins
  const byKey = new Map<string, RawCandle>();
  for (const k of candles) byKey.set(interval === "1d" ? nyParts(k.time).date : String(k.time), k);
  candles = [...byKey.values()];
  if (!candles.length) throw new UpstreamError("no-data", "Für dieses Kürzel liegen im gewählten Zeitraum keine Kerzen vor (kein Handel, neu gelistet oder ausgesetzt).");
  const mt = num(meta.regularMarketTime);
  return {
    candles,
    interval,
    range,
    meta: {
      name: str(meta.longName) ?? str(meta.shortName),
      currency: str(meta.currency),
      exchange: str(meta.fullExchangeName) ?? str(meta.exchangeName),
      price: num(meta.regularMarketPrice),
      volume: num(meta.regularMarketVolume),
      marketTime: mt != null ? mt * 1000 : null,
      dayHigh: num(meta.regularMarketDayHigh),
      dayLow: num(meta.regularMarketDayLow),
      fiftyTwoWeekHigh: num(meta.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: num(meta.fiftyTwoWeekLow),
      previousClose: num(meta.previousClose) ?? num(meta.chartPreviousClose),
    },
  };
}

/**
 * The close of the session before the one the quote belongs to. From daily candles: the candle before the one of the
 * market's last trading day (when the last candle is an older day, it IS the previous session). From a one-day
 * intraday range: Yahoo's own `previousClose`. Otherwise unknown.
 */
export function prevCloseOf(chart: ChartData): number | null {
  const { candles, meta } = chart;
  if (chart.interval === "1d") {
    const last = candles[candles.length - 1];
    if (!last) return null;
    const marketDate = meta.marketTime != null ? nyParts(meta.marketTime).date : nyParts(last.time).date;
    const lastDate = nyParts(last.time).date;
    if (lastDate === marketDate) return candles.length >= 2 ? candles[candles.length - 2]!.close : null;
    return last.close;
  }
  return chart.range === "1d" ? meta.previousClose : null;
}

/* ------------------------------------------------------------------ the two requests the functions make */

export async function fetchChart(symbol: string, interval: StockInterval, range: string, deps: YahooDeps = {}): Promise<ChartData> {
  const path = `/v8/finance/chart/${encodeURIComponent(toYahooSymbol(symbol))}?interval=${YAHOO_INTERVAL[interval]}&range=${encodeURIComponent(range)}&includePrePost=false&events=div%2Csplit`;
  const { body } = await getJson(path, deps);
  return parseChart(body, interval, range);
}

export function barsPayload(chart: ChartData): { ok: true; bars: WireBar[]; meta: { name: string | null; currency: string | null; exchange: string | null; price: number | null; prevClose: number | null; volume: number | null; marketTime: number | null } } {
  return {
    ok: true,
    bars: chart.candles.map((k) => [k.time, k.open, k.high, k.low, k.close, k.volume] as WireBar),
    meta: { name: chart.meta.name, currency: chart.meta.currency, exchange: chart.meta.exchange, price: chart.meta.price, prevClose: prevCloseOf(chart), volume: chart.meta.volume, marketTime: chart.meta.marketTime },
  };
}

export function quotePayload(chart: ChartData): {
  ok: true;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  price: number;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  marketTime: number | null;
} {
  const m = chart.meta;
  const price = m.price ?? chart.candles[chart.candles.length - 1]?.close ?? null;
  if (price == null) throw new UpstreamError("no-data", "Yahoo Finance nennt keinen Kurs für dieses Kürzel.");
  const prev = prevCloseOf(chart);
  const change = prev != null ? price - prev : null;
  return {
    ok: true,
    name: m.name,
    currency: m.currency,
    exchange: m.exchange,
    price,
    prevClose: prev,
    change,
    changePct: change != null && prev ? (change / prev) * 100 : null,
    dayHigh: m.dayHigh,
    dayLow: m.dayLow,
    volume: m.volume,
    fiftyTwoWeekHigh: m.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: m.fiftyTwoWeekLow,
    marketTime: m.marketTime,
  };
}

/* ------------------------------------------------------------------ batches */

/** `fn` over `items` with at most `limit` in flight; items not started when `deadline` (ms epoch) passes get `onLate`. */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>, opts: { deadline?: number; now?: () => number; onLate: (item: T) => R }): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const now = opts.now ?? Date.now;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i]!;
      out[i] = opts.deadline != null && now() >= opts.deadline ? opts.onLate(item) : await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * When EVERY symbol of a request failed for the same upstream reason (blocked / rate limited), the source itself is the
 * problem: one honest HTTP error instead of a 200 with a list of identical failures. Anything else stays per symbol.
 */
export function upstreamWideError(results: Readonly<Record<string, { ok: boolean; reason?: WireReason; message?: string }>>): HttpError | null {
  const all = Object.values(results);
  if (!all.length || all.some((r) => r.ok)) return null;
  const first = all[0]!;
  if (!first.reason || !all.every((r) => r.reason === first.reason)) return null;
  if (first.reason === "rate-limited") return new HttpError(429, "stock_upstream_rate_limited", first.message ?? LIMIT_TEXT, undefined, { "retry-after": String(Math.ceil(RATE_PAUSE_MS / 1000)) });
  if (first.reason === "blocked") return new HttpError(502, "stock_upstream_blocked", first.message ?? BLOCKED_TEXT.replace("{s}", "403"));
  if (first.reason === "upstream" || first.reason === "timeout") return new HttpError(502, "stock_upstream_unavailable", first.message ?? "Yahoo Finance ist gerade nicht erreichbar.");
  return null;
}

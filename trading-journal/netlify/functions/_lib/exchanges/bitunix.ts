/**
 * Bitunix futures OpenAPI – read-only adapter (P11).
 *
 * Signing (official docs "Sign" page + the official Node demo `BitunixOfficial/open-api` Demo/Node/openApiHttpSign.js,
 * checked 2026-10-12):
 *   queryParams = keys sorted ascending (ASCII), each key directly followed by its value, no separators ("id1uid200")
 *   body        = the exact compact JSON string that is sent ("" for GET)
 *   digest      = SHA256hex(nonce + timestamp + apiKey + queryParams + body)
 *   sign        = SHA256hex(digest + secretKey)
 * Headers: api-key, nonce (32 random hex chars), timestamp (epoch MILLISECONDS – the doc example "20241120123045" is a
 * placeholder, the demo and the header table use ms), sign, Content-Type: application/json, language: en-US.
 * It is double SHA-256, not HMAC. The URL query is sent in the same sorted order with the same raw values (only
 * percent-encoded), so the signed string and the sent parameters always agree.
 *
 * Read-only by construction: `request()` only issues GET and only to `READ_PATHS`; there is no order / transfer call in
 * this file. Rate limit: 10 req/s per UID → requests are spaced `MIN_SPACING_MS` apart (≤ 9/s) and a 10005 / 10006
 * answer is retried once after `RATE_BACKOFF_MS`.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  ExchangeError,
  type AdapterRuntime,
  type ExchangeAdapter,
  type ExchangeCredentials,
  type FillQuery,
  type ListOptions,
  type ListResult,
  type TimeWindow,
  type VenueAccount,
  type VenueClosedPosition,
  type VenueFill,
  type VenueOpenPosition,
  type VenueOrder,
  type VenueTicker,
  type VenueTpSl,
} from "./types";

export const BITUNIX_BASE = "https://fapi.bitunix.com";

export const BITUNIX_PATHS = {
  account: "/api/v1/futures/account",
  historyPositions: "/api/v1/futures/position/get_history_positions",
  pendingPositions: "/api/v1/futures/position/get_pending_positions",
  historyOrders: "/api/v1/futures/trade/get_history_orders",
  historyTrades: "/api/v1/futures/trade/get_history_trades",
  tpslHistory: "/api/v1/futures/tpsl/get_history_orders",
  tickers: "/api/v1/futures/market/tickers",
} as const;

/** The only paths this adapter ever calls (all GET, all read-only). */
export const READ_PATHS: ReadonlySet<string> = new Set(Object.values(BITUNIX_PATHS));
const PUBLIC_PATHS: ReadonlySet<string> = new Set([BITUNIX_PATHS.tickers]);

/** ≤ 9 requests per second (limit: 10 / s / UID). */
export const MIN_SPACING_MS = 110;
export const RATE_BACKOFF_MS = 1_000;
export const PAGE_LIMIT = 100;
const MAX_PAGES = 400;
const REQUEST_TIMEOUT_MS = 8_000;

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

/* ------------------------------------------------------------------ signing (pure) */

export const sha256hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** Drops null / undefined / "" and stringifies the rest (the signed and the sent values are these strings). */
export function cleanQuery(q: Query = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") out[k] = String(v);
  return out;
}

const sortedKeys = (q: Record<string, string>): string[] => Object.keys(q).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Signature input of the query: `id1uid200` (keys ASCII-sorted, key + value, no separators). */
export function canonicalQuery(q: Record<string, string>): string {
  return sortedKeys(q)
    .map((k) => k + q[k])
    .join("");
}

/** URL query in the same order: `id=1&uid=200` (percent-encoded). */
export function urlQuery(q: Record<string, string>): string {
  return sortedKeys(q)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(q[k]!)}`)
    .join("&");
}

export interface SignParts {
  nonce: string;
  timestamp: string;
  apiKey: string;
  secretKey: string;
  /** Already canonical (`canonicalQuery`). */
  queryParams: string;
  /** The exact body string ("" for GET). */
  body: string;
}

/** Double SHA-256 exactly as the official demo: `sign = sha256(sha256(nonce+timestamp+apiKey+query+body) + secret)`. */
export function signBitunix(p: SignParts): { digest: string; sign: string } {
  const digest = sha256hex(p.nonce + p.timestamp + p.apiKey + p.queryParams + p.body);
  return { digest, sign: sha256hex(digest + p.secretKey) };
}

/** 32 random hex chars (the demo's `crypto.randomBytes(16).toString('hex')`). */
export const randomNonce = (): string => randomBytes(16).toString("hex");

/** Auth headers of one GET request. */
export function authHeaders(creds: ExchangeCredentials, query: Record<string, string>, nonce: string, timestamp: string, body = ""): Record<string, string> {
  const { sign } = signBitunix({ nonce, timestamp, apiKey: creds.apiKey, secretKey: creds.secret, queryParams: canonicalQuery(query), body });
  return { "api-key": creds.apiKey, nonce, timestamp, sign, "content-type": "application/json", language: "en-US" };
}

/* ------------------------------------------------------------------ errors */

/** German messages of the documented codes (Demo/Node/errorCodes.js + the error-code page). */
export const BITUNIX_ERRORS: Readonly<Record<number, { message: string; status: number; auth?: boolean; retry?: boolean }>> = {
  403: { message: "Dieser API-Key darf das nicht. Erstelle einen Key mit Leserechten (Read-only).", status: 403, auth: true },
  10001: { message: "Bitunix ist gerade nicht erreichbar. Der Sync versucht es später erneut.", status: 502, retry: true },
  10002: { message: "Bitunix hat die Anfrage abgelehnt (Parameter). Bitte später erneut versuchen.", status: 502 },
  10003: { message: "Bitunix hat keinen API-Key erhalten. Bitte Key und Secret neu eintragen.", status: 401, auth: true },
  10004: {
    message: "Bitunix lehnt diese Server-IP ab. Erstelle den Key ohne IP-Bindung – die Server-IPs wechseln.",
    status: 403,
    auth: true,
  },
  10005: { message: "Bitunix meldet zu viele Anfragen. Der Sync versucht es gleich erneut.", status: 429, retry: true },
  10006: { message: "Zu schnelle Anfragen an Bitunix. Bitte kurz warten und erneut versuchen.", status: 429, retry: true },
  10007: { message: "Signatur ungültig: API-Key oder Secret stimmt nicht. Bitte prüfen und neu verbinden.", status: 401, auth: true },
  10008: { message: "Bitunix hat einen Wert abgelehnt. Bitte später erneut versuchen.", status: 502 },
  20014: { message: "Das Bitunix-Konto ist gelöscht.", status: 403, auth: true },
};

/** `ExchangeError` of a Bitunix business code (unknown codes → generic German text with the code). */
export function bitunixError(code: number, msg?: string): ExchangeError {
  const known = BITUNIX_ERRORS[code];
  if (known) return new ExchangeError(`bitunix_${code}`, known.message, { status: known.status, authFailure: !!known.auth, retryable: !!known.retry });
  const detail = typeof msg === "string" && /^[\w .,:'()-]{1,80}$/.test(msg) ? ` (${msg})` : "";
  return new ExchangeError(`bitunix_${code}`, `Bitunix meldet einen Fehler (Code ${code})${detail}.`, { status: 502 });
}

/* ------------------------------------------------------------------ parsing (pure) */

/** Number from a venue string / number; `fallback` for anything unparsable. */
export function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function numOrNull(v: unknown): number | null {
  const n = num(v, NaN);
  return Number.isFinite(n) ? n : null;
}

/**
 * Epoch ms from a venue timestamp. The docs say int64 ms; values below 1e11 are taken as SECONDS (a known doc / demo
 * disagreement for the websocket) so either unit lands on the right day. 0 / invalid → 0.
 */
export function toMs(v: unknown): number {
  const n = num(v, 0);
  if (n <= 0) return 0;
  return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

const sideOf = (v: unknown): "long" | "short" => (String(v).toUpperCase() === "SHORT" ? "short" : "long");
const tradeSide = (v: unknown): "buy" | "sell" | null => {
  const s = String(v ?? "").toUpperCase();
  return s === "BUY" ? "buy" : s === "SELL" ? "sell" : null;
};
const marginModeOf = (v: unknown): "isolated" | "cross" | null => {
  const s = String(v ?? "").toUpperCase();
  return s === "ISOLATION" || s === "ISOLATED" ? "isolated" : s === "CROSS" ? "cross" : null;
};
const positionModeOf = (v: unknown): "one_way" | "hedge" | null => {
  const s = String(v ?? "").toUpperCase();
  return s === "ONE_WAY" ? "one_way" : s === "HEDGE" ? "hedge" : null;
};
const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : null);
const positive = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n !== null && n > 0 ? n : null;
};

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseClosedPosition(r: Raw): VenueClosedPosition | null {
  const positionId = str(r.positionId);
  const symbol = str(r.symbol);
  if (!positionId || !symbol) return null;
  return {
    positionId,
    symbol,
    side: sideOf(r.side),
    maxQty: num(r.maxQty ?? r.qty),
    entryPrice: num(r.entryPrice ?? r.avgOpenPrice),
    closePrice: num(r.closePrice),
    liqQty: num(r.liqQty),
    marginMode: marginModeOf(r.marginMode),
    positionMode: positionModeOf(r.positionMode),
    leverage: positive(r.leverage),
    fee: num(r.fee),
    funding: num(r.funding),
    realizedPnl: num(r.realizedPNL ?? r.realizedPnl),
    liqPrice: positive(r.liqPrice),
    openedAt: toMs(r.ctime),
    closedAt: toMs(r.mtime ?? r.ctime),
  };
}

export function parseOpenPosition(r: Raw): VenueOpenPosition | null {
  const positionId = str(r.positionId);
  const symbol = str(r.symbol);
  if (!positionId || !symbol) return null;
  const qty = num(r.qty);
  const entryValue = num(r.entryValue);
  const avg = num(r.avgOpenPrice);
  return {
    positionId,
    symbol,
    side: sideOf(r.side),
    qty,
    // avgOpenPrice when sent, else entryValue / qty
    entryPrice: avg > 0 ? avg : qty > 0 && entryValue > 0 ? entryValue / qty : 0,
    marginMode: marginModeOf(r.marginMode),
    leverage: positive(r.leverage),
    fee: num(r.fee),
    funding: num(r.funding),
    realizedPnl: num(r.realizedPNL),
    unrealizedPnl: numOrNull(r.unrealizedPNL),
    margin: numOrNull(r.margin),
    liqPrice: positive(r.liqPrice),
    openedAt: toMs(r.ctime),
    updatedAt: toMs(r.mtime ?? r.ctime),
  };
}

export function parseFill(r: Raw): VenueFill | null {
  const tradeId = str(r.tradeId);
  if (!tradeId) return null;
  return {
    tradeId,
    orderId: str(r.orderId),
    symbol: str(r.symbol),
    side: tradeSide(r.side),
    qty: num(r.qty),
    price: num(r.price),
    fee: num(r.fee),
    realizedPnl: num(r.realizedPNL),
    reduceOnly: boolOrNull(r.reduceOnly),
    at: toMs(r.ctime),
  };
}

export function parseOrder(r: Raw): VenueOrder | null {
  const orderId = str(r.orderId);
  if (!orderId) return null;
  return {
    orderId,
    symbol: str(r.symbol),
    side: tradeSide(r.side),
    qty: num(r.qty),
    tradeQty: num(r.tradeQty),
    price: positive(r.price),
    status: str(r.status),
    reduceOnly: boolOrNull(r.reduceOnly),
    tpPrice: positive(r.tpPrice),
    slPrice: positive(r.slPrice),
    createdAt: toMs(r.ctime),
    updatedAt: toMs(r.mtime ?? r.ctime),
  };
}

export function parseTpSl(r: Raw): VenueTpSl | null {
  const id = str(r.id ?? r.orderId);
  const positionId = str(r.positionId);
  if (!positionId) return null;
  return {
    id: id || `${positionId}:${str(r.ctime)}`,
    positionId,
    symbol: str(r.symbol),
    tpPrice: positive(r.tpPrice),
    slPrice: positive(r.slPrice),
    tpQty: positive(r.tpQty),
    slQty: positive(r.slQty),
    status: str(r.status),
    createdAt: toMs(r.ctime),
    triggeredAt: toMs(r.triggerTime) || null,
  };
}

export function parseAccount(data: unknown, marginCoin = "USDT"): VenueAccount | null {
  const list = Array.isArray(data) ? data : isObj(data) ? [data] : [];
  const r = (list.find((x) => isObj(x) && String(x.marginCoin).toUpperCase() === marginCoin.toUpperCase()) ?? list[0]) as Raw | undefined;
  if (!isObj(r)) return null;
  return {
    marginCoin: str(r.marginCoin) || marginCoin,
    available: num(r.available),
    frozen: num(r.frozen),
    margin: num(r.margin),
    unrealizedPnl: Math.round((num(r.crossUnrealizedPNL) + num(r.isolationUnrealizedPNL)) * 1e8) / 1e8,
    positionMode: positionModeOf(r.positionMode),
  };
}

/** The list inside a page: `data.<key>`, or `data` itself when the venue answered with a bare array. */
export function listOf(data: unknown, key: string): Raw[] {
  const raw = Array.isArray(data) ? data : isObj(data) ? data[key] : null;
  return Array.isArray(raw) ? raw.filter(isObj) : [];
}

export function totalOf(data: unknown): number | null {
  return isObj(data) ? numOrNull(data.total) : null;
}

/* ------------------------------------------------------------------ client */

export const defaultRuntime = (): AdapterRuntime => ({
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});

export interface BitunixClientStats {
  requests: number;
}

/** Signed GET requests with spacing, one retry on rate-limit codes, German errors. Never logs credentials. */
export class BitunixClient {
  readonly stats: BitunixClientStats = { requests: 0 };
  private nextAt = 0;
  constructor(
    private readonly creds: ExchangeCredentials,
    private readonly rt: AdapterRuntime = defaultRuntime(),
  ) {}

  private async space(): Promise<void> {
    const now = this.rt.now();
    if (now < this.nextAt) await this.rt.sleep(this.nextAt - now);
    this.nextAt = Math.max(now, this.nextAt) + MIN_SPACING_MS;
  }

  /** GET `path` (must be in `READ_PATHS`) → `data` of the `{ code, msg, data }` envelope. */
  async get(path: string, query: Query = {}, attempt = 0): Promise<unknown> {
    if (!READ_PATHS.has(path)) throw new ExchangeError("forbidden_path", "Diese Bitunix-Anfrage ist nicht erlaubt.", { status: 500 });
    const q = cleanQuery(query);
    const qs = urlQuery(q);
    const isPublic = PUBLIC_PATHS.has(path);
    const headers: Record<string, string> = isPublic
      ? { "content-type": "application/json", language: "en-US" }
      : authHeaders(this.creds, q, (this.rt.nonce ?? randomNonce)(), String(this.rt.now()));
    await this.space();
    this.stats.requests++;
    let res: Response;
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      res = await this.rt.fetch(`${BITUNIX_BASE}${path}${qs ? `?${qs}` : ""}`, { method: "GET", headers, signal: ctrl?.signal });
    } catch {
      if (attempt === 0) return this.get(path, query, 1);
      throw new ExchangeError("network", "Bitunix ist gerade nicht erreichbar. Bitte später erneut versuchen.", { status: 502, retryable: true });
    } finally {
      if (timer) clearTimeout(timer);
    }
    let body: unknown;
    const text = await res.text().catch(() => "");
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const env = isObj(body) ? body : null;
    const code = env ? num(env.code, NaN) : NaN;
    if (env && Number.isFinite(code) && code !== 0) {
      const err = bitunixError(code, typeof env.msg === "string" ? env.msg : undefined);
      if (err.retryable && attempt === 0 && (code === 10005 || code === 10006)) {
        await this.rt.sleep(RATE_BACKOFF_MS);
        return this.get(path, query, 1);
      }
      throw err;
    }
    if (!res.ok) {
      if (res.status === 429) throw bitunixError(10005);
      if (res.status === 401 || res.status === 403) throw new ExchangeError(`http_${res.status}`, BITUNIX_ERRORS[403]!.message, { status: 403, authFailure: res.status === 401 });
      throw new ExchangeError(`http_${res.status}`, "Bitunix antwortet gerade nicht. Bitte später erneut versuchen.", { status: 502, retryable: true });
    }
    if (!env || !Number.isFinite(code)) throw new ExchangeError("bad_response", "Bitunix hat eine unerwartete Antwort geschickt.", { status: 502, retryable: true });
    return env.data;
  }

  /** Pages a skip/limit list until it is complete, the deadline passed or `max` items were read. */
  async list<T>(path: string, query: Query, key: string, parse: (r: Raw) => T | null, opts: ListOptions = {}): Promise<ListResult<T>> {
    const items: T[] = [];
    let skip = Math.max(0, Math.floor(opts.skip ?? 0));
    const start = this.stats.requests;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (opts.deadline !== undefined && this.rt.now() >= opts.deadline) return { items, complete: false, nextSkip: skip, requests: this.stats.requests - start };
      if (opts.max !== undefined && items.length >= opts.max) return { items, complete: false, nextSkip: skip, requests: this.stats.requests - start };
      const data = await this.get(path, { ...query, skip, limit: PAGE_LIMIT });
      const rows = listOf(data, key);
      for (const r of rows) {
        const p = parse(r);
        if (p !== null) items.push(p);
      }
      skip += rows.length;
      const total = totalOf(data);
      if (rows.length < PAGE_LIMIT || (total !== null && skip >= total)) return { items, complete: true, nextSkip: skip, requests: this.stats.requests - start };
    }
    return { items, complete: false, nextSkip: skip, requests: this.stats.requests - start };
  }
}

/* ------------------------------------------------------------------ adapter */

export function bitunixAdapter(creds: ExchangeCredentials, rt: AdapterRuntime = defaultRuntime()): ExchangeAdapter & { client: BitunixClient } {
  const client = new BitunixClient(creds, rt);
  const win = (w: TimeWindow) => ({ startTime: Math.floor(w.startTime), endTime: Math.floor(w.endTime) });
  const fetchAccount = async (marginCoin = "USDT"): Promise<VenueAccount> => {
    const data = await client.get(BITUNIX_PATHS.account, { marginCoin });
    const acc = parseAccount(data, marginCoin);
    if (!acc) throw new ExchangeError("bad_response", "Bitunix hat kein Futures-Konto gemeldet.", { status: 502 });
    return acc;
  };
  return {
    id: "bitunix",
    client,
    validate: () => fetchAccount("USDT"),
    fetchAccount,
    fetchClosedPositions: (w, opts) => client.list(BITUNIX_PATHS.historyPositions, win(w), "positionList", parseClosedPosition, opts),
    fetchOrders: (w, opts) => client.list(BITUNIX_PATHS.historyOrders, win(w), "orderList", parseOrder, opts),
    fetchFills: (q: FillQuery, opts) =>
      client.list(BITUNIX_PATHS.historyTrades, "positionId" in q ? { positionId: q.positionId } : { symbol: q.symbol, ...win(q) }, "tradeList", parseFill, opts),
    fetchTpSl: (w, opts) => client.list(BITUNIX_PATHS.tpslHistory, win(w), "orderList", parseTpSl, opts),
    fetchOpenPositions: async () => {
      const data = await client.get(BITUNIX_PATHS.pendingPositions);
      return listOf(data, "positionList")
        .map(parseOpenPosition)
        .filter((p): p is VenueOpenPosition => p !== null && p.qty > 0);
    },
    fetchTickers: async (symbols) => {
      const unique = [...new Set(symbols.filter((s) => /^[A-Z0-9]{2,30}$/.test(s)))];
      if (!unique.length) return [];
      const data = await client.get(BITUNIX_PATHS.tickers, { symbols: unique.join(",") });
      return listOf(data, "list").map((r): VenueTicker => ({ symbol: str(r.symbol), markPrice: positive(r.markPrice), lastPrice: positive(r.lastPrice ?? r.last) }));
    },
  };
}

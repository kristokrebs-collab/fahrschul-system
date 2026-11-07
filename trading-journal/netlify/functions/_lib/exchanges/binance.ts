/**
 * Binance read-only adapter (Paket Verbindungen, B2) – API-key route, spot and USDⓈ-M futures kept apart.
 *
 * Written from the official docs (developers.binance.com, checked 2026-11-06); NOT run against the live exchange (the
 * sandbox cannot reach it, HTTP 451) – the tests use recorded-shape fixtures and a fake fetch. Every venue field is
 * parsed defensively (`num`, `str`), a missing field never throws.
 *
 * Signing: `signature = HMAC_SHA256(secret, queryString)` (hex), appended as the LAST parameter; header
 * `X-MBX-APIKEY`; `timestamp` (ms) and `recvWindow` are part of the signed query.
 *
 * Read-only by construction: `get()` only issues GET and only to `READ_PATHS`; this file contains no order, transfer
 * or withdrawal call. `checkRights()` reads `/sapi/v1/account/apiRestrictions` and `evaluateRights()` decides whether
 * a key may be connected at all (withdrawal / transfer / trading rights are refused).
 *
 * Endpoints: spot `api/v3/account`, `api/v3/myTrades`, `api/v3/ticker/price`; futures `fapi/v3/balance`,
 * `fapi/v3/positionRisk`, `fapi/v1/userTrades` (venue keeps 3 months), `fapi/v1/income` (3 months), `fapi/v1/ticker/price`.
 */
import { createHmac } from "node:crypto";
import { envOptional } from "../env";
import { allocateFunding, groupFuturesFills, groupSpotFills, type BnFill, type FundingRow, type GroupResult } from "./binanceTrades";
import { defaultRuntime } from "./bitunix";
import {
  ExchangeError,
  type AdapterNotes,
  type AdapterRuntime,
  type ExchangeAdapter,
  type ExchangeCredentials,
  type ExchangeMarket,
  type FillQuery,
  type ListOptions,
  type ListResult,
  type TimeWindow,
  type VenueAccount,
  type VenueClosedPosition,
  type VenueFill,
  type VenueOpenPosition,
  type VenueTicker,
} from "./types";

export const BINANCE_SPOT_BASE = "https://api.binance.com";
export const BINANCE_FUTURES_BASE = "https://fapi.binance.com";

/** Operator override (a proxy in an allowed region): `BINANCE_SPOT_BASE` / `BINANCE_FUTURES_BASE`, https only. */
export function binanceBase(market: ExchangeMarket): string {
  const v = envOptional(market === "spot" ? "BINANCE_SPOT_BASE" : "BINANCE_FUTURES_BASE");
  if (v && /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(v.trim().replace(/\/+$/, ""))) return v.trim().replace(/\/+$/, "");
  return market === "spot" ? BINANCE_SPOT_BASE : BINANCE_FUTURES_BASE;
}

export const BINANCE_PATHS = {
  restrictions: "/sapi/v1/account/apiRestrictions",
  spotAccount: "/api/v3/account",
  spotTrades: "/api/v3/myTrades",
  spotPrices: "/api/v3/ticker/price",
  futBalance: "/fapi/v3/balance",
  futPositions: "/fapi/v3/positionRisk",
  futTrades: "/fapi/v1/userTrades",
  futIncome: "/fapi/v1/income",
  futPrices: "/fapi/v1/ticker/price",
} as const;

/** The only paths this adapter calls (all GET, all read-only). */
export const BINANCE_READ_PATHS: ReadonlySet<string> = new Set(Object.values(BINANCE_PATHS));
const PUBLIC_PATHS: ReadonlySet<string> = new Set([BINANCE_PATHS.spotPrices, BINANCE_PATHS.futPrices]);

/** Request weights (docs) and the per-minute budget we allow ourselves (≈ 80 % of the venue's limit). */
const WEIGHT: Readonly<Record<string, number>> = {
  [BINANCE_PATHS.restrictions]: 1,
  [BINANCE_PATHS.spotAccount]: 20,
  [BINANCE_PATHS.spotTrades]: 20,
  [BINANCE_PATHS.spotPrices]: 4,
  [BINANCE_PATHS.futBalance]: 5,
  [BINANCE_PATHS.futPositions]: 5,
  [BINANCE_PATHS.futTrades]: 5,
  [BINANCE_PATHS.futIncome]: 30,
  [BINANCE_PATHS.futPrices]: 2,
};
const BUDGET_PER_MIN: Readonly<Record<ExchangeMarket, number>> = { spot: 4800, futures: 1900 };

export const RECV_WINDOW_MS = 10_000;
export const PAGE_LIMIT = 1000;
const MAX_PAGES = 60;
const REQUEST_TIMEOUT_MS = 8_000;
const DAY_MS = 86_400_000;
/** The venue returns futures trades / income of the last 3 months only. */
export const FUTURES_HISTORY_MS = 89 * DAY_MS;
/** A position may have been opened before the window: fills are read this far back and re-reading is harmless. */
export const FILL_LOOKBACK_MS = 30 * DAY_MS;
/** Spot pairs a held coin may trade in (the symbol list of an account is not available from the venue). */
export const SPOT_QUOTES = ["USDT", "USDC", "FDUSD", "EUR", "BTC", "ETH", "BNB"] as const;

/* ------------------------------------------------------------------ signing (pure) */

export function signQuery(queryString: string, secret: string): string {
  return createHmac("sha256", secret).update(queryString, "utf8").digest("hex");
}

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

/** `a=1&b=2` in insertion order (the signed string and the sent string are the same text). */
export function buildQuery(q: Query): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.join("&");
}

/** The signed query string: params + timestamp + recvWindow, then `&signature=…`. */
export function signedQuery(q: Query, secret: string, timestamp: number, recvWindow = RECV_WINDOW_MS): string {
  const base = buildQuery({ ...q, recvWindow, timestamp });
  return `${base}&signature=${signQuery(base, secret)}`;
}

/* ------------------------------------------------------------------ errors */

/** German texts of the documented codes. `auth` marks credential problems (the connection becomes `invalid`). */
export const BINANCE_ERRORS: Readonly<Record<number, { message: string; status: number; auth?: boolean; retry?: boolean }>> = {
  [-2014]: { message: "Der API-Key hat ein ungültiges Format. Bitte Key neu kopieren.", status: 401, auth: true },
  [-2015]: {
    message: "Binance lehnt den Key ab: falscher Key, nicht erlaubte IP oder fehlendes Recht (Lesen, bei Futures zusätzlich „Futures“). Prüfe die Key-Einstellungen bei Binance.",
    status: 401,
    auth: true,
  },
  [-2008]: { message: "Binance kennt diesen API-Key nicht. Bitte Key neu eintragen.", status: 401, auth: true },
  [-1022]: { message: "Die Signatur ist ungültig: API-Key oder Secret stimmt nicht. Bitte prüfen und neu verbinden.", status: 401, auth: true },
  [-1021]: { message: "Die Uhrzeit des Servers weicht zu stark von Binance ab. Bitte später erneut versuchen.", status: 502, retry: true },
  [-1003]: { message: "Binance meldet zu viele Anfragen. Der Abgleich versucht es gleich erneut.", status: 429, retry: true },
  [-1015]: { message: "Binance meldet zu viele Aufträge. Bitte kurz warten.", status: 429, retry: true },
  [-1000]: { message: "Binance hat einen internen Fehler gemeldet. Bitte später erneut versuchen.", status: 502, retry: true },
  [-1001]: { message: "Binance ist gerade nicht erreichbar. Bitte später erneut versuchen.", status: 502, retry: true },
  [-1007]: { message: "Binance antwortet zu langsam. Bitte später erneut versuchen.", status: 502, retry: true },
  [-4400]: { message: "Dieser API-Key darf diese Daten nicht lesen.", status: 403, auth: true },
};

/** Code that only means "this pair does not exist" – the symbol is skipped, nothing fails. */
export const BINANCE_INVALID_SYMBOL = -1121;

export function binanceError(code: number, msg?: string): ExchangeError {
  const known = BINANCE_ERRORS[code];
  if (known) return new ExchangeError(`binance_${Math.abs(code)}`, known.message, { status: known.status, authFailure: !!known.auth, retryable: !!known.retry });
  const detail = typeof msg === "string" && /^[\w .,:'()/-]{1,80}$/.test(msg) ? ` (${msg})` : "";
  return new ExchangeError(`binance_${Math.abs(code)}`, `Binance meldet einen Fehler (Code ${code})${detail}.`, { status: 502 });
}

const REGION_ERROR = (): ExchangeError =>
  new ExchangeError(
    "binance_451",
    "Binance lehnt Anfragen von diesem Server-Standort ab (Region). Das ist eine Einstellung des Betreibers, nicht dein Key – bitte melde es dem Betreiber.",
    { status: 503 },
  );

/* ------------------------------------------------------------------ rights check (pure) */

/** `GET /sapi/v1/account/apiRestrictions` as the venue answers it (every field optional here). */
export interface BinanceRestrictions {
  ipRestrict?: boolean;
  enableReading?: boolean;
  enableWithdrawals?: boolean;
  enableInternalTransfer?: boolean;
  enableMargin?: boolean;
  enableFutures?: boolean;
  permitsUniversalTransfer?: boolean;
  enableVanillaOptions?: boolean;
  enableFixApiTrade?: boolean;
  enableSpotAndMarginTrading?: boolean;
  enablePortfolioMarginTrading?: boolean;
}

export type RightIssueCode =
  | "no_read"
  | "withdraw"
  | "transfer"
  | "spot_trade"
  | "margin"
  | "options"
  | "fix_trade"
  | "portfolio"
  | "futures_access"
  | "futures_unused"
  | "ip_open";

export interface RightIssue {
  code: RightIssueCode;
  /** `block`: the key is refused. `warn`: allowed only after an explicit confirmation. `info`: a note. */
  level: "block" | "warn" | "info";
  text: string;
}

export interface RightsVerdict {
  /** No blocker. */
  ok: boolean;
  /** Warnings need `acceptWarnings` from the user. */
  needsConfirm: boolean;
  issues: RightIssue[];
  /** Short tags stored with the connection (`read`, `futures_enabled`, `ip_restricted`). */
  permissions: string[];
}

const on = (v: unknown): boolean => v === true;

/**
 * Decides whether a key may be connected for `market`.
 * Refused: no read right, withdrawal, internal / universal transfer, spot / margin trading, options, FIX trading,
 * portfolio margin. Binance has no read-only flag for the futures API: reading USDⓈ-M data needs "Futures" to be on, which
 * on Binance also means the key could trade there – that is a WARNING the user must confirm (our code only calls GET
 * endpoints), never a silent pass. A spot connection with "Futures" on is also a warning (not needed).
 */
export function evaluateRights(r: BinanceRestrictions, market: ExchangeMarket): RightsVerdict {
  const issues: RightIssue[] = [];
  const add = (code: RightIssueCode, level: RightIssue["level"], text: string) => issues.push({ code, level, text });
  if (!on(r.enableReading)) add("no_read", "block", "Der Key hat kein Leserecht („Enable Reading“). Ohne Lesen kann nichts abgeglichen werden.");
  if (on(r.enableWithdrawals)) add("withdraw", "block", "Der Key darf Geld abheben („Enable Withdrawals“). So einen Key verbinden wir nicht – schalte das Recht bei Binance aus oder lege einen neuen Key an.");
  if (on(r.enableInternalTransfer) || on(r.permitsUniversalTransfer)) add("transfer", "block", "Der Key darf Geld zwischen Konten verschieben („Transfer“). Bitte ausschalten.");
  if (on(r.enableSpotAndMarginTrading)) add("spot_trade", "block", "Der Key darf Spot und Margin handeln („Enable Spot & Margin Trading“). Für das Journal reicht Lesen – bitte ausschalten.");
  if (on(r.enableMargin)) add("margin", "block", "Der Key darf Margin nutzen. Bitte ausschalten.");
  if (on(r.enableVanillaOptions)) add("options", "block", "Der Key darf Optionen handeln. Bitte ausschalten.");
  if (on(r.enableFixApiTrade)) add("fix_trade", "block", "Der Key darf über FIX handeln. Bitte ausschalten.");
  if (on(r.enablePortfolioMarginTrading)) add("portfolio", "block", "Der Key hat Portfolio-Margin-Zugriff. Bitte ausschalten.");
  if (market === "futures" && on(r.enableFutures)) {
    add(
      "futures_access",
      "warn",
      "Für Futures verlangt Binance das Recht „Futures“ – ein reines Lese-Recht gibt es dort nicht. Der Key könnte also bei Binance auch Futures handeln. Wir rufen nur Lese-Funktionen auf. Verbinde nur, wenn du das bewusst so willst; sonst lege dafür einen eigenen Key an und schränke die IP ein.",
    );
  } else if (market === "spot" && on(r.enableFutures)) {
    add("futures_unused", "warn", "Beim Key ist „Futures“ an. Für Spot ist das nicht nötig – am besten ausschalten.");
  }
  if (r.ipRestrict === false) add("ip_open", "info", "Der Key ist nicht an IP-Adressen gebunden. Mit nur Leserecht ist das okay; wer den Key kennt, kann Kontodaten lesen, aber nichts bewegen.");
  const permissions: string[] = [];
  if (on(r.enableReading)) permissions.push("read");
  if (market === "futures" && on(r.enableFutures)) permissions.push("futures_enabled");
  if (on(r.ipRestrict)) permissions.push("ip_restricted");
  return {
    ok: !issues.some((i) => i.level === "block"),
    needsConfirm: issues.some((i) => i.level === "warn"),
    issues,
    permissions,
  };
}

export function parseRestrictions(data: unknown): BinanceRestrictions | null {
  if (!isObj(data)) return null;
  const pick = (k: keyof BinanceRestrictions): boolean | undefined => (typeof data[k] === "boolean" ? (data[k] as boolean) : undefined);
  return {
    ipRestrict: pick("ipRestrict"),
    enableReading: pick("enableReading"),
    enableWithdrawals: pick("enableWithdrawals"),
    enableInternalTransfer: pick("enableInternalTransfer"),
    enableMargin: pick("enableMargin"),
    enableFutures: pick("enableFutures"),
    permitsUniversalTransfer: pick("permitsUniversalTransfer"),
    enableVanillaOptions: pick("enableVanillaOptions"),
    enableFixApiTrade: pick("enableFixApiTrade"),
    enableSpotAndMarginTrading: pick("enableSpotAndMarginTrading"),
    enablePortfolioMarginTrading: pick("enablePortfolioMarginTrading"),
  };
}

/* ------------------------------------------------------------------ parsing (pure) */

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

const QUOTES = ["FDUSD", "USDT", "USDC", "BUSD", "TUSD", "USDP", "EUR", "TRY", "BRL", "GBP", "BTC", "ETH", "BNB"] as const;

/** `BTCUSDT` → `{ base: "BTC", quote: "USDT" }` (longest known quote suffix); unknown → whole symbol as base. */
export function splitSymbol(symbol: string): { base: string; quote: string } {
  const s = symbol.toUpperCase();
  for (const q of QUOTES) if (s.length > q.length && s.endsWith(q)) return { base: s.slice(0, -q.length), quote: q };
  return { base: s, quote: "" };
}

/** Fee in the quote coin: paid in the quote coin → as is; in the base coin → × price; any other coin (BNB discount) → unknown. */
export function feeInQuote(commission: number, asset: string, symbol: string, price: number): { fee: number; unknown: boolean } {
  const c = Math.abs(commission);
  if (c === 0) return { fee: 0, unknown: false };
  const { base, quote } = splitSymbol(symbol);
  const a = asset.toUpperCase();
  if (a === quote || (!quote && a === "USDT")) return { fee: c, unknown: false };
  if (a === base) return { fee: c * price, unknown: false };
  return { fee: 0, unknown: true };
}

export function parseSpotTrade(r: Raw): BnFill | null {
  const id = str(r.id);
  const symbol = str(r.symbol).toUpperCase();
  if (!id || !symbol) return null;
  const price = num(r.price);
  const qty = num(r.qty);
  const { base } = splitSymbol(symbol);
  const buy = r.isBuyer === true;
  const asset = str(r.commissionAsset).toUpperCase();
  const commission = num(r.commission);
  const f = feeInQuote(commission, asset, symbol, price);
  return {
    id,
    orderId: str(r.orderId),
    symbol,
    side: buy ? "buy" : "sell",
    price,
    qty,
    // a BUY fee paid in the base coin is taken out of what arrives
    qtyNet: buy && asset === base ? Math.max(0, qty - Math.abs(commission)) : qty,
    fee: f.fee,
    feeUnknown: f.unknown,
    realizedPnl: 0,
    at: Math.round(num(r.time)),
    positionSide: "both",
  };
}

export function parseFuturesTrade(r: Raw): BnFill | null {
  const id = str(r.id);
  const symbol = str(r.symbol).toUpperCase();
  if (!id || !symbol) return null;
  const price = num(r.price);
  const side = String(r.side ?? "").toUpperCase() === "SELL" ? "sell" : "buy";
  const ps = String(r.positionSide ?? "BOTH").toUpperCase();
  const f = feeInQuote(num(r.commission), str(r.commissionAsset), symbol, price);
  return {
    id,
    orderId: str(r.orderId),
    symbol,
    side,
    price,
    qty: num(r.qty),
    qtyNet: num(r.qty),
    fee: f.fee,
    feeUnknown: f.unknown,
    realizedPnl: num(r.realizedPnl),
    at: Math.round(num(r.time)),
    positionSide: ps === "LONG" ? "long" : ps === "SHORT" ? "short" : "both",
  };
}

const STABLE = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD"]);

export function parseIncome(r: Raw): (FundingRow & { type: string; asset: string }) | null {
  const symbol = str(r.symbol).toUpperCase();
  const type = str(r.incomeType);
  if (!type) return null;
  return { symbol, amount: num(r.income), at: Math.round(num(r.time)), type, asset: str(r.asset).toUpperCase() };
}

export function parseSpotAccount(data: unknown): VenueAccount | null {
  if (!isObj(data)) return null;
  const balances = Array.isArray(data.balances) ? data.balances.filter(isObj) : [];
  const usdt = balances.find((b) => str(b.asset).toUpperCase() === "USDT");
  return { marginCoin: "USDT", available: num(usdt?.free), frozen: num(usdt?.locked), margin: 0, unrealizedPnl: 0, positionMode: null };
}

export function parseFuturesBalance(data: unknown, coin = "USDT"): VenueAccount | null {
  const list = Array.isArray(data) ? data.filter(isObj) : [];
  const r = list.find((x) => str(x.asset).toUpperCase() === coin) ?? list[0];
  if (!r) return null;
  const balance = num(r.balance);
  const available = num(r.availableBalance);
  return { marginCoin: str(r.asset) || coin, available, frozen: 0, margin: Math.max(0, balance - available), unrealizedPnl: num(r.crossUnPnl), positionMode: null };
}

export function parseFuturesPosition(r: Raw): VenueOpenPosition | null {
  const symbol = str(r.symbol).toUpperCase();
  const amt = num(r.positionAmt);
  if (!symbol || amt === 0) return null;
  const ps = String(r.positionSide ?? "BOTH").toUpperCase();
  const side = ps === "SHORT" ? "short" : ps === "LONG" ? "long" : amt < 0 ? "short" : "long";
  const liq = num(r.liquidationPrice);
  const entry = num(r.entryPrice);
  const updated = Math.round(num(r.updateTime));
  const margin = num(r.isolatedWallet, NaN);
  return {
    positionId: `f-${symbol}${ps === "BOTH" ? "" : `-${ps.toLowerCase()}`}`,
    symbol,
    side,
    qty: Math.abs(amt),
    entryPrice: entry,
    marginMode: String(r.marginType ?? "").toLowerCase() === "isolated" ? "isolated" : String(r.marginType ?? "").toLowerCase() === "cross" ? "cross" : null,
    leverage: num(r.leverage) > 0 ? num(r.leverage) : null,
    fee: 0,
    funding: 0,
    realizedPnl: 0,
    unrealizedPnl: Number.isFinite(num(r.unRealizedProfit, NaN)) ? num(r.unRealizedProfit) : null,
    margin: Number.isFinite(margin) && margin > 0 ? margin : null,
    liqPrice: liq > 0 ? liq : null,
    openedAt: 0,
    updatedAt: updated,
  };
}

/* ------------------------------------------------------------------ client */

export interface BinanceClientStats {
  requests: number;
}

/** Signed GET requests with weight-based spacing, one retry on rate-limit answers, German errors. Never logs credentials. */
export class BinanceClient {
  readonly stats: BinanceClientStats = { requests: 0 };
  private nextAt: Record<ExchangeMarket, number> = { spot: 0, futures: 0 };
  constructor(
    private readonly creds: ExchangeCredentials,
    private readonly rt: AdapterRuntime = defaultRuntime(),
  ) {}

  private async space(market: ExchangeMarket, path: string): Promise<void> {
    const now = this.rt.now();
    if (now < this.nextAt[market]) await this.rt.sleep(this.nextAt[market] - now);
    const gap = Math.ceil(((WEIGHT[path] ?? 5) * 60_000) / BUDGET_PER_MIN[market]);
    this.nextAt[market] = Math.max(now, this.nextAt[market]) + gap;
  }

  /** GET `path` (must be in `BINANCE_READ_PATHS`) on the spot or futures host → parsed JSON. */
  async get(market: ExchangeMarket, path: string, query: Query = {}, attempt = 0): Promise<unknown> {
    if (!BINANCE_READ_PATHS.has(path)) throw new ExchangeError("forbidden_path", "Diese Binance-Anfrage ist nicht erlaubt.", { status: 500 });
    const isPublic = PUBLIC_PATHS.has(path);
    const qs = isPublic ? buildQuery(query) : signedQuery(query, this.creds.secret, this.rt.now());
    const headers: Record<string, string> = isPublic ? {} : { "X-MBX-APIKEY": this.creds.apiKey };
    await this.space(market, path);
    this.stats.requests++;
    let res: Response;
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      res = await this.rt.fetch(`${binanceBase(market)}${path}${qs ? `?${qs}` : ""}`, { method: "GET", headers, signal: ctrl?.signal });
    } catch {
      if (attempt === 0) return this.get(market, path, query, 1);
      throw new ExchangeError("network", "Binance ist gerade nicht erreichbar. Bitte später erneut versuchen.", { status: 502, retryable: true });
    } finally {
      if (timer) clearTimeout(timer);
    }
    const text = await res.text().catch(() => "");
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (res.status === 451) throw REGION_ERROR();
    if (res.status === 418) throw new ExchangeError("binance_418", "Binance hat diese Server-Adresse vorübergehend gesperrt (zu viele Anfragen). Der Abgleich pausiert.", { status: 429, retryable: true });
    if (res.status === 429) {
      if (attempt === 0) {
        const wait = Math.min(5_000, Math.max(1_000, num(res.headers.get("retry-after")) * 1000));
        await this.rt.sleep(wait);
        return this.get(market, path, query, 1);
      }
      throw binanceError(-1003);
    }
    if (isObj(body) && typeof body.code === "number" && body.code < 0) {
      if (body.code === -1003 && attempt === 0) {
        await this.rt.sleep(2_000);
        return this.get(market, path, query, 1);
      }
      throw binanceError(body.code, typeof body.msg === "string" ? body.msg : undefined);
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new ExchangeError(`http_${res.status}`, BINANCE_ERRORS[-2015]!.message, { status: 403, authFailure: true });
      throw new ExchangeError(`http_${res.status}`, "Binance antwortet gerade nicht. Bitte später erneut versuchen.", { status: 502, retryable: true });
    }
    if (body === null) throw new ExchangeError("bad_response", "Binance hat eine unerwartete Antwort geschickt.", { status: 502, retryable: true });
    return body;
  }
}

/* ------------------------------------------------------------------ rights check against the venue */

/** Reads and evaluates the key's rights (one call, weight 1). */
export async function checkRights(creds: ExchangeCredentials, market: ExchangeMarket, rt: AdapterRuntime = defaultRuntime()): Promise<RightsVerdict & { restrictions: BinanceRestrictions }> {
  const client = new BinanceClient(creds, rt);
  const data = await client.get("spot", BINANCE_PATHS.restrictions);
  const restrictions = parseRestrictions(data);
  if (!restrictions) throw new ExchangeError("bad_response", "Binance hat die Key-Rechte nicht gemeldet. Bitte später erneut versuchen.", { status: 502, retryable: true });
  return { ...evaluateRights(restrictions, market), restrictions };
}

/* ------------------------------------------------------------------ adapter */

export interface BinanceOptions {
  market: ExchangeMarket;
  /** Spot: further pairs to read (a fully sold coin leaves no balance to find them by), e.g. `["SOLUSDT"]`. */
  symbols?: readonly string[];
}

const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;
export const cleanSymbols = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === "string").map((s) => s.toUpperCase().trim()).filter((s) => SYMBOL_RE.test(s)))].slice(0, 30) : [];

export function binanceAdapter(creds: ExchangeCredentials, rt: AdapterRuntime = defaultRuntime(), opts: BinanceOptions = { market: "futures" }): ExchangeAdapter & { client: BinanceClient } {
  const client = new BinanceClient(creds, rt);
  const market = opts.market;
  const notes: AdapterNotes = { orphanFills: 0, unknownFees: 0, symbols: 0 };
  /** fills per position id of the last `fetchClosedPositions` (served by `fetchFills`, no extra request) */
  const fillsByPosition = new Map<string, VenueFill[]>();
  let discovered: { key: string; symbols: string[]; funding: FundingRow[] } | null = null;

  const fetchAccount = async (): Promise<VenueAccount> => {
    if (market === "spot") {
      const acc = parseSpotAccount(await client.get("spot", BINANCE_PATHS.spotAccount, { omitZeroBalances: true }));
      if (!acc) throw new ExchangeError("bad_response", "Binance hat kein Spot-Konto gemeldet.", { status: 502 });
      return acc;
    }
    const acc = parseFuturesBalance(await client.get("futures", BINANCE_PATHS.futBalance));
    if (!acc) throw new ExchangeError("bad_response", "Binance hat kein Futures-Konto gemeldet.", { status: 502 });
    return acc;
  };

  /** Futures: symbols with realized P&L in the range (income history, paged by moving the start) + funding payments. */
  async function discoverFutures(from: number, to: number, deadline?: number): Promise<{ symbols: string[]; funding: FundingRow[] }> {
    const symbols = new Set<string>();
    const funding: FundingRow[] = [];
    const walk = async (type: "REALIZED_PNL" | "FUNDING_FEE", onRow: (r: ReturnType<typeof parseIncome>) => void) => {
      let start = from;
      const seen = new Set<string>();
      for (let page = 0; page < MAX_PAGES; page++) {
        if (deadline !== undefined && rt.now() >= deadline && page > 0) break;
        const data = await client.get("futures", BINANCE_PATHS.futIncome, { incomeType: type, startTime: start, endTime: to, limit: PAGE_LIMIT });
        const rows = Array.isArray(data) ? data.filter(isObj) : [];
        let fresh = 0;
        let last = start;
        for (const raw of rows) {
          const r = parseIncome(raw);
          if (!r) continue;
          const key = `${str(raw.tranId)}:${r.type}:${r.at}`;
          if (seen.has(key)) continue;
          seen.add(key);
          fresh++;
          last = Math.max(last, r.at);
          onRow(r);
        }
        if (rows.length < PAGE_LIMIT || fresh === 0) break;
        start = last; // same-millisecond rows are de-duplicated by `seen`
      }
    };
    await walk("REALIZED_PNL", (r) => {
      if (r && r.symbol) symbols.add(r.symbol);
    });
    await walk("FUNDING_FEE", (r) => {
      if (r && r.symbol && STABLE.has(r.asset)) funding.push({ symbol: r.symbol, amount: r.amount, at: r.at });
    });
    return { symbols: [...symbols].sort(), funding };
  }

  /** Spot: pairs that exist AND whose base coin is held now, plus the configured extras. One public price call finds the existing pairs. */
  async function discoverSpot(): Promise<string[]> {
    const [accountRaw, pricesRaw] = await Promise.all([client.get("spot", BINANCE_PATHS.spotAccount, { omitZeroBalances: true }), client.get("spot", BINANCE_PATHS.spotPrices)]);
    const exists = new Set((Array.isArray(pricesRaw) ? pricesRaw.filter(isObj) : []).map((p) => str(p.symbol).toUpperCase()));
    const held = (isObj(accountRaw) && Array.isArray(accountRaw.balances) ? accountRaw.balances.filter(isObj) : [])
      .filter((b) => num(b.free) + num(b.locked) > 0)
      .map((b) => str(b.asset).toUpperCase())
      .filter(Boolean);
    const out = new Set<string>();
    for (const asset of held) for (const q of SPOT_QUOTES) if (asset !== q && exists.has(`${asset}${q}`)) out.add(`${asset}${q}`);
    for (const s of cleanSymbols(opts.symbols)) if (exists.size === 0 || exists.has(s)) out.add(s);
    return [...out].sort();
  }

  /** Futures: fills of one symbol in [from, to] – 7-day slices (venue limit), a full page continues from its last time. A symbol is always read to the end (a half-read symbol would break its positions); the deadline is checked between symbols. */
  async function futuresFills(symbol: string, from: number, to: number): Promise<BnFill[]> {
    const out: BnFill[] = [];
    const seen = new Set<string>();
    for (let s = from; s <= to; s += 7 * DAY_MS) {
      let start = s;
      const end = Math.min(to, s + 7 * DAY_MS - 1);
      for (let page = 0; page < MAX_PAGES; page++) {
        const data = await client.get("futures", BINANCE_PATHS.futTrades, { symbol, startTime: start, endTime: end, limit: PAGE_LIMIT });
        const rows = Array.isArray(data) ? data.filter(isObj) : [];
        let fresh = 0;
        let last = start;
        for (const raw of rows) {
          const f = parseFuturesTrade(raw);
          if (!f || seen.has(f.id)) continue;
          seen.add(f.id);
          fresh++;
          last = Math.max(last, f.at);
          out.push(f);
        }
        if (rows.length < PAGE_LIMIT || fresh === 0) break;
        start = last;
      }
    }
    return out;
  }

  /** Spot: all fills of one pair since `from`, then `fromId` pages (the venue forbids mixing time and id). */
  async function spotFills(symbol: string, from: number): Promise<BnFill[]> {
    const out: BnFill[] = [];
    let q: Query = { symbol, startTime: from, limit: PAGE_LIMIT };
    for (let page = 0; page < MAX_PAGES; page++) {
      let data: unknown;
      try {
        data = await client.get("spot", BINANCE_PATHS.spotTrades, q);
      } catch (e) {
        if (e instanceof ExchangeError && e.code === `binance_${Math.abs(BINANCE_INVALID_SYMBOL)}`) return out;
        throw e;
      }
      const rows = Array.isArray(data) ? data.filter(isObj) : [];
      let maxId = 0;
      for (const raw of rows) {
        const f = parseSpotTrade(raw);
        if (!f) continue;
        out.push(f);
        maxId = Math.max(maxId, num(f.id));
      }
      if (rows.length < PAGE_LIMIT || maxId === 0) break;
      q = { symbol, fromId: maxId + 1, limit: PAGE_LIMIT };
    }
    return out;
  }

  const closedPositions = async (w: TimeWindow, o: ListOptions = {}): Promise<ListResult<VenueClosedPosition>> => {
    const before = client.stats.requests;
    const now = rt.now();
    const lowest = market === "futures" ? now - FUTURES_HISTORY_MS : 0;
    const from = Math.max(lowest, Math.floor(w.startTime) - FILL_LOOKBACK_MS);
    const to = Math.min(now, Math.floor(w.endTime));
    if (to < from) return { items: [], complete: true, nextSkip: 0, requests: 0 };
    const key = `${market}:${from}:${to}`;
    let symbols: string[];
    if (market === "futures") {
      if (discovered?.key !== key) discovered = { key, ...(await discoverFutures(from, to, o.deadline)) };
      symbols = discovered.symbols;
    } else {
      if (discovered?.key !== key) discovered = { key, symbols: await discoverSpot(), funding: [] };
      symbols = discovered.symbols;
    }
    notes.symbols = symbols.length;
    const start = Math.max(0, Math.floor(o.skip ?? 0));
    const fills: BnFill[] = [];
    let i = start;
    for (; i < symbols.length; i++) {
      if (o.deadline !== undefined && rt.now() >= o.deadline) break;
      fills.push(...(market === "futures" ? await futuresFills(symbols[i]!, from, to) : await spotFills(symbols[i]!, from)));
    }
    const grouped: GroupResult = market === "futures" ? groupFuturesFills(fills) : groupSpotFills(fills);
    notes.orphanFills += grouped.orphanFills;
    notes.unknownFees += grouped.unknownFees;
    if (market === "futures") allocateFunding(grouped.positions.map((g) => g.position), discovered?.funding ?? []);
    const items: VenueClosedPosition[] = [];
    for (const g of grouped.positions) {
      // a position belongs to the slice it CLOSED in; earlier slices re-read it only as lookback
      if (g.position.closedAt < w.startTime || g.position.closedAt > w.endTime) continue;
      fillsByPosition.set(g.position.positionId, g.fills);
      items.push(g.position);
    }
    const complete = i >= symbols.length;
    return { items, complete, nextSkip: i, resumeSkip: i, requests: client.stats.requests - before };
  };

  return {
    id: "binance",
    client,
    validate: fetchAccount,
    fetchAccount,
    fetchClosedPositions: closedPositions,
    fetchOrders: async () => ({ items: [], complete: true, nextSkip: 0, requests: 0 }),
    fetchFills: async (q: FillQuery) => {
      const items = "positionId" in q ? (fillsByPosition.get(q.positionId) ?? []) : [];
      return { items, complete: items.length > 0, nextSkip: items.length, requests: 0 };
    },
    // Binance offers no stop / target history without reading every order; the trader enters them (FILL fields stay empty)
    fetchTpSl: async () => ({ items: [], complete: true, nextSkip: 0, requests: 0 }),
    fetchOpenPositions: async () => {
      if (market === "spot") return [];
      const data = await client.get("futures", BINANCE_PATHS.futPositions);
      return (Array.isArray(data) ? data.filter(isObj) : []).map(parseFuturesPosition).filter((p): p is VenueOpenPosition => p !== null);
    },
    fetchTickers: async (symbols): Promise<VenueTicker[]> => {
      const want = new Set(symbols.filter((s) => SYMBOL_RE.test(s)));
      if (!want.size || market === "spot") return [];
      const data = await client.get("futures", BINANCE_PATHS.futPrices);
      return (Array.isArray(data) ? data.filter(isObj) : [])
        .filter((r) => want.has(str(r.symbol).toUpperCase()))
        .map((r) => ({ symbol: str(r.symbol).toUpperCase(), markPrice: null, lastPrice: num(r.price) > 0 ? num(r.price) : null }));
    },
    notes: () => ({ ...notes }),
  };
}

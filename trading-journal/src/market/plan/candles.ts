/**
 * Kerzen für den Handelsplan: Binance USDⓈ-M Klines (5m, 15m, 30m, 1h) für das Fenster einer Sitzung – über die REST-Clients der
 * Marktschicht (direkt, bei Sperre / CORS / Netzfehler der gleiche Weg über den EU-Proxy, nie in der Einzeldatei-Version).
 *
 * Zwischenspeicher zuerst: abgeschlossene Kerzen ändern sich nie. Pro Symbol und Zeitrahmen liegt EIN zusammenhängender Block
 * geschlossener Kerzen in IndexedDB (`storageKey("plan-klines")`, höchstens 1 500 Kerzen). Eine Anfrage liefert den Block sofort
 * (`onCache`), holt nur, was davor und danach fehlt, und schreibt den Block zurück. Liegt das Fenster ganz abseits des Blocks
 * (ein Tag vor drei Wochen), ersetzt es den Block – ein Block bleibt immer lückenlos. Die noch laufende Kerze kommt mit, wird
 * aber nie gespeichert. Ohne Netz zeigt die Seite, was im Zwischenspeicher liegt, mit dem Grund und ohne ihn als aktuell auszugeben.
 */
import { createStore, get, set, type UseStore } from "idb-keyval";
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";
import { storageKey } from "@/store/storage";
import { BINANCE_REST, klinesSchema, mapKline } from "../sources/binance";
import { fetchJson, toRestError, type FetchLike, type RestError } from "../sources/http";
import { PROXY_BASE } from "../sources/proxy";
import type { Candle, Source } from "../types";

export type PlanInterval = "5m" | "15m" | "30m" | "1h";
export const PLAN_INTERVAL_MS: Readonly<Record<PlanInterval, number>> = { "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000 };

export const PLAN_CACHE_KEY = storageKey("plan-klines");
export const PAGE_LIMIT = 1500;
export const BLOCK_MAX = 1500;

export interface LoadRequest {
  symbol: string;
  interval: PlanInterval;
  /** open time (ms) of the first / last candle wanted */
  from: number;
  to: number;
  signal?: AbortSignal;
  /** called with the cached candles before the network answers */
  onCache?: (r: PlanCandles) => void;
  /** ask the source again even if its cache is still fresh ("Neu laden"); the crypto loader needs no such thing */
  fresh?: boolean;
}

export interface PlanCandles {
  /** ascending, the last may still be running */
  candles: Candle[];
  /** who delivered the newest candles: the exchange, its proxy, the cache – or "yahoo" for the stock source */
  source: Source | "yahoo";
  /** when the network answered (ms), `null` = nothing was fetched */
  fetchedAt: number | null;
  fromCache: boolean;
  /** why the network part failed (German), `null` = fine */
  error: string | null;
  /**
   * Additive, for sources that are not the crypto exchange (the stock source): how the source names itself in "Quelle: …"
   * (default: the label of the source in `sources.ts`), what it says about itself, and the time of the last trade it reports.
   */
  sourceLabel?: string;
  notes?: readonly string[];
  marketTime?: number | null;
}

export type Row = [number, number, number, number, number, number];
interface Block {
  v: 1;
  rows: Row[];
}

export interface PlanCandleDeps {
  /** one page of klines from `startTime` (ascending); throws a `RestError` */
  fetchPage: (q: { symbol: string; interval: PlanInterval; startTime: number; endTime: number; limit: number; route: "direct" | "proxy"; signal?: AbortSignal }) => Promise<Candle[]>;
  /** the proxy exists (not in the single-file build) */
  proxy: () => boolean;
  read: (key: string) => Promise<Block | null>;
  write: (key: string, block: Block) => Promise<void>;
  now: () => number;
}

// ---------------------------------------------------------------------------------------------------- storage

let idb: UseStore | null = null;
let idbBroken = false;
function store(): UseStore | null {
  if (idbBroken || typeof indexedDB === "undefined") return null;
  try {
    idb ??= createStore(PLAN_CACHE_KEY, "blocks");
    return idb;
  } catch {
    idbBroken = true;
    return null;
  }
}

const isBlock = (v: unknown): v is Block => typeof v === "object" && v !== null && (v as Block).v === 1 && Array.isArray((v as Block).rows);

async function readBlock(key: string): Promise<Block | null> {
  const s = store();
  if (!s) return null;
  try {
    const raw = await get<unknown>(key, s);
    return isBlock(raw) ? { v: 1, rows: raw.rows.filter((r) => Array.isArray(r) && r.length === 6 && r.every((x) => Number.isFinite(x))) } : null;
  } catch {
    return null;
  }
}

async function writeBlock(key: string, block: Block): Promise<void> {
  const s = store();
  if (!s) return;
  try {
    await set(key, block, s);
  } catch {
    /* a full or blocked store only costs the next load a fetch */
  }
}

const rowOf = (c: Candle): Row => [c.time, c.open, c.high, c.low, c.close, c.volume];
const candleOf = (r: Row, iv: number): Candle => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5], closed: true, closeTime: r[0] + iv - 1 });

// ---------------------------------------------------------------------------------------------------- network

async function restPage(q: Parameters<PlanCandleDeps["fetchPage"]>[0], fetchImpl?: FetchLike): Promise<Candle[]> {
  const base = q.route === "proxy" ? PROXY_BASE : BINANCE_REST;
  const url = `${base}/fapi/v1/klines?symbol=${encodeURIComponent(q.symbol)}&interval=${q.interval}&startTime=${q.startTime}&endTime=${q.endTime}&limit=${q.limit}`;
  const rows = await fetchJson(url, klinesSchema, { fetch: fetchImpl, signal: q.signal, timeoutMs: 15_000 });
  const now = Date.now();
  return rows.map((r) => mapKline(r, now));
}

export const defaultDeps = (): PlanCandleDeps => ({
  fetchPage: (q) => restPage(q),
  proxy: () => !(IS_FILE_BUILD || isFileProtocol()),
  read: readBlock,
  write: writeBlock,
  now: () => Date.now(),
});

/** German reason of a failed request. */
export function loadErrorText(err: unknown): string {
  const e: RestError = toRestError(err);
  switch (e.kind) {
    case "bad_symbol":
      return "Die Börse kennt dieses Symbol nicht – prüfe die Schreibweise (zum Beispiel BTCUSDT).";
    case "bad_period":
      return "Die Börse kennt diesen Zeitrahmen nicht.";
    case "rate_limited":
      return "Die Börse hat die Anfragen gebremst – gleich noch einmal versuchen.";
    case "offline":
      return "Du bist offline.";
    case "blocked_451":
      return "Die Börse ist von hier aus gesperrt.";
    case "timeout":
      return "Die Börse antwortet zu langsam.";
    default:
      return "Die Börse ist gerade nicht erreichbar.";
  }
}

const SWITCH_TO_PROXY = new Set(["blocked_451", "network", "cors"]);

/** Pages through `[from, to]` (open times), switching to the proxy once when the direct route is blocked. */
async function fetchRange(d: PlanCandleDeps, q: { symbol: string; interval: PlanInterval; from: number; to: number; signal?: AbortSignal }, via: { proxy: boolean }): Promise<Candle[]> {
  const iv = PLAN_INTERVAL_MS[q.interval];
  const out = new Map<number, Candle>();
  let start = q.from;
  for (let guard = 0; guard < 8 && start <= q.to; guard++) {
    let page: Candle[];
    // ask for what is missing, not for the maximum: a short tail costs the exchange less request weight
    const limit = Math.min(PAGE_LIMIT, Math.max(1, Math.floor((q.to - start) / iv) + 1));
    try {
      page = await d.fetchPage({ symbol: q.symbol, interval: q.interval, startTime: start, endTime: q.to + iv - 1, limit, route: via.proxy ? "proxy" : "direct", signal: q.signal });
    } catch (err) {
      const e = toRestError(err);
      if (!via.proxy && SWITCH_TO_PROXY.has(e.kind) && d.proxy()) {
        via.proxy = true;
        guard--;
        continue;
      }
      throw e;
    }
    for (const c of page) if (c.time >= q.from && c.time <= q.to) out.set(c.time, c);
    const last = page[page.length - 1];
    if (!last || page.length < limit) break;
    start = last.time + iv;
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}

// ---------------------------------------------------------------------------------------------------- load

/** The candles of a window: cache first, then only what is missing. */
export async function loadPlanCandles(req: LoadRequest, deps: PlanCandleDeps = defaultDeps()): Promise<PlanCandles> {
  const iv = PLAN_INTERVAL_MS[req.interval];
  const now = deps.now();
  const key = `${req.symbol}|${req.interval}`;
  const from = Math.floor(req.from / iv) * iv;
  const to = Math.min(Math.floor(req.to / iv) * iv, Math.floor(now / iv) * iv);
  const empty: PlanCandles = { candles: [], source: "cache", fetchedAt: null, fromCache: true, error: null };
  if (to < from) return empty;
  const block = (await deps.read(key)) ?? { v: 1 as const, rows: [] };
  const rows = block.rows;
  const inWindow = (r: Row): boolean => r[0] >= from && r[0] <= to;
  const cached = rows.filter(inWindow).map((r) => candleOf(r, iv));
  if (cached.length) req.onCache?.({ candles: cached, source: "cache", fetchedAt: null, fromCache: true, error: null });

  // what is missing
  const segments: Array<[number, number]> = [];
  const first = rows[0]?.[0];
  const last = rows[rows.length - 1]?.[0];
  let keep: Row[] = rows;
  if (first == null || last == null || last < from - iv || first > to + iv) {
    keep = [];
    segments.push([from, to]);
  } else {
    if (first > from) segments.push([from, first - iv]);
    if (last + iv <= to) segments.push([last + iv, to]);
  }

  // everything is in the cache (a window of closed candles): nothing to ask the exchange
  if (!segments.length) return { candles: cached, source: "cache", fetchedAt: null, fromCache: true, error: null };

  const via = { proxy: false };
  const fetched: Candle[] = [];
  try {
    for (const [a, b] of segments) fetched.push(...(await fetchRange(deps, { symbol: req.symbol, interval: req.interval, from: a, to: b, signal: req.signal }, via)));
  } catch (err) {
    // the caller gave up (a newer request replaced this one): not an error to show
    if (req.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    return { candles: cached, source: "cache", fetchedAt: null, fromCache: true, error: loadErrorText(err) };
  }

  // merge: the cached block + the closed candles that arrived (the forming candle is shown, never stored)
  const byTime = new Map<number, Candle>();
  for (const r of keep) byTime.set(r[0], candleOf(r, iv));
  for (const c of fetched) byTime.set(c.time, c);
  const all = [...byTime.values()].sort((a, b) => a.time - b.time);
  const stored: Row[] = all.filter((c) => c.closed && c.closeTime != null && c.closeTime < now).map(rowOf);
  await deps.write(key, { v: 1, rows: stored.slice(-BLOCK_MAX) });
  const asked = all.filter((c) => c.time >= from && c.time <= to);
  return { candles: asked, source: via.proxy ? "proxy" : "binance", fetchedAt: now, fromCache: false, error: null };
}

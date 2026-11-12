/**
 * `settings.watchlist` – the user's list of stocks and crypto pairs to keep an eye on (F67/F68). Versioned passthrough
 * (`{ v: 1, items: [{ id, kind, symbol, name, addedAt, note }] }`), at most 50 entries, an id list so the cloud / two-tab
 * `merge3` works per entry. Reading is lenient (`watchlistCfgOf` sanitises anything); writing keeps every unknown key of the
 * root object and every entry this version cannot read (`rejected`), so a newer version's data survives a round trip
 * (the pattern of `settings.keyLevels`). The watchlist feeds the news monitor and is one of the scanner's universes.
 */
import { isStockSymbol } from "@/market/stocks/types";

export const WATCHLIST_VERSION = 1 as const;
export const MAX_WATCHLIST = 50;
export const MAX_NOTE = 140;

export type WatchKind = "stock" | "crypto";

export interface WatchItem {
  /** `stock:AAPL` / `crypto:BTCUSDT` */
  id: string;
  kind: WatchKind;
  symbol: string;
  name: string | null;
  addedAt: number;
  note: string;
}

export interface ParsedWatchlist {
  v: typeof WATCHLIST_VERSION;
  items: WatchItem[];
  /** stored entries this version could not read – written back untouched */
  rejected: unknown[];
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

export const watchId = (kind: WatchKind, symbol: string): string => `${kind}:${symbol}`;

const CRYPTO = /^[A-Z0-9]{2,15}USDT$/;

/** A ticker as the list stores it, or `null` when it is none: stocks `BRK.B`, crypto `BTCUSDT` (`BINANCE:BTCUSDT.P`, `btc` also read). */
export function normalizeSymbol(kind: WatchKind, input: string): string | null {
  const t = input.trim().toUpperCase();
  if (!t) return null;
  if (kind === "stock") {
    const s = t.replace(/-/g, ".");
    return isStockSymbol(s) ? s : null;
  }
  const bare = t.replace(/^[A-Z]+:/, "").replace(/\.P$/, "").replace(/[-/_]/g, "");
  const s = bare.endsWith("USDT") ? bare : /^[A-Z0-9]{2,12}$/.test(bare) ? `${bare}USDT` : bare;
  return CRYPTO.test(s) ? s : null;
}

export function normalizeItem(raw: unknown): WatchItem | null {
  if (!isObj(raw)) return null;
  if (raw.kind !== "stock" && raw.kind !== "crypto") return null;
  const symbol = typeof raw.symbol === "string" ? normalizeSymbol(raw.kind, raw.symbol) : null;
  if (!symbol) return null;
  const addedAt = typeof raw.addedAt === "number" && Number.isFinite(raw.addedAt) ? raw.addedAt : 0;
  return {
    id: watchId(raw.kind, symbol),
    kind: raw.kind,
    symbol,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 90) : null,
    addedAt,
    note: typeof raw.note === "string" ? raw.note.slice(0, MAX_NOTE) : "",
  };
}

export const EMPTY_WATCHLIST: ParsedWatchlist = Object.freeze({ v: WATCHLIST_VERSION, items: [], rejected: [] }) as ParsedWatchlist;

/** `settings.watchlist` (anything) → the list. Duplicated entries keep the first one; entries beyond 50 are dropped. */
export function watchlistCfgOf(raw: unknown): ParsedWatchlist {
  if (!isObj(raw)) return EMPTY_WATCHLIST;
  const items: WatchItem[] = [];
  const rejected: unknown[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    const it = normalizeItem(entry);
    if (!it) rejected.push(entry);
    else if (!seen.has(it.id) && items.length < MAX_WATCHLIST) {
      seen.add(it.id);
      items.push(it);
    }
  }
  return { v: WATCHLIST_VERSION, items, rejected };
}

export const watchlistOfSettings = (s: { watchlist?: unknown } | null | undefined): ParsedWatchlist => watchlistCfgOf(s?.watchlist);

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}

/** `settings.watchlist` with `items` written – unknown root keys and unreadable entries survive. Returns the SAME object when nothing changes. */
export function withWatchlist(raw: unknown, items: readonly WatchItem[]): Record<string, unknown> {
  const prev = isObj(raw) ? raw : {};
  const cur = watchlistCfgOf(raw);
  const next: Record<string, unknown> = { ...prev, v: WATCHLIST_VERSION, items: [...items.slice(0, MAX_WATCHLIST), ...cur.rejected] };
  return isObj(raw) && JSON.stringify(canon(prev)) === JSON.stringify(canon(next)) ? (raw as Record<string, unknown>) : next;
}

export type AddResult = { ok: true; items: WatchItem[]; item: WatchItem } | { ok: false; reason: "invalid" | "duplicate" | "limit" };

export function addToWatchlist(items: readonly WatchItem[], draft: { kind: WatchKind; symbol: string; name?: string | null }, now: number): AddResult {
  const symbol = normalizeSymbol(draft.kind, draft.symbol);
  if (!symbol) return { ok: false, reason: "invalid" };
  const id = watchId(draft.kind, symbol);
  if (items.some((i) => i.id === id)) return { ok: false, reason: "duplicate" };
  if (items.length >= MAX_WATCHLIST) return { ok: false, reason: "limit" };
  const item: WatchItem = { id, kind: draft.kind, symbol, name: draft.name?.trim() ? draft.name.trim().slice(0, 90) : null, addedAt: now, note: "" };
  return { ok: true, items: [...items, item], item };
}

export const removeFromWatchlist = (items: readonly WatchItem[], id: string): WatchItem[] => items.filter((i) => i.id !== id);

/** The stock tickers of the list (the news monitor asks for these). */
export const stockSymbols = (items: readonly WatchItem[]): string[] => items.filter((i) => i.kind === "stock").map((i) => i.symbol);

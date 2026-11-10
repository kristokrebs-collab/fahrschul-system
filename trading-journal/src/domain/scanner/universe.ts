/**
 * Which charts a run reads (pure). The scanner never pretends to read "the whole market": a run reads at most `cap`
 * charts (the user's choice, never above `HARD_CAP`), and the page says how many exist and which block of them this was.
 *
 * - Stocks: the user's watchlist, a block of the Nasdaq Trader directory (alphabetical, `cap` per block – "Block 3 von 41"),
 *   or tickers typed in.
 * - Crypto: the USDT perpetuals with the highest 24 h quote volume, top N.
 */
import { STOCK_SYMBOL, type SymbolEntry } from "@/market/stocks/types";
import { HARD_CAP, type ScanTarget } from "./run";
import { DEFAULT_PARAMS, type MarketKind, type ScanParams } from "./types";

export type StockSource = "watchlist" | "directory" | "custom";

export interface UniverseSpec {
  source: StockSource;
  /** charts per run */
  cap: number;
  /** directory: which block (1-based) */
  block: number;
  /** custom: the typed tickers */
  custom: string;
}

export interface Universe {
  targets: ScanTarget[];
  /** how many charts exist in the chosen source */
  available: number;
  /** directory: number of blocks of `cap` */
  blocks: number;
  /** typed tickers that are no US ticker */
  invalid: string[];
  /** typed / watchlist tickers the directory does not list (still scanned; Yahoo decides) */
  unlisted: string[];
}

export const DEFAULT_CAP = 100;
export const MIN_CAP = 10;

export const clampCap = (n: number): number => (Number.isFinite(n) ? Math.min(HARD_CAP, Math.max(MIN_CAP, Math.round(n))) : DEFAULT_CAP);

/** "AAPL, msft;NVDA\nTSLA" → upper-case tickers, de-duplicated; what is no ticker goes to `invalid`. */
export function parseTickers(text: string): { symbols: string[]; invalid: string[] } {
  const symbols: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const s = raw.trim().toUpperCase();
    if (!s) continue;
    if (!STOCK_SYMBOL.test(s)) {
      if (!invalid.includes(s)) invalid.push(s);
    } else if (!symbols.includes(s)) symbols.push(s);
  }
  return { symbols, invalid };
}

export function stockUniverse(spec: UniverseSpec, directory: readonly SymbolEntry[] | null, watchlist: readonly string[]): Universe {
  const cap = clampCap(spec.cap);
  const byRef = new Map((directory ?? []).map((e) => [e.symbol, e]));
  const target = (symbol: string): ScanTarget => {
    const e = byRef.get(symbol);
    return { symbol, name: e?.name ?? null, fin: e?.fin ?? null };
  };
  if (spec.source === "directory") {
    const all = directory ?? [];
    const blocks = Math.max(1, Math.ceil(all.length / cap));
    const block = Math.min(blocks, Math.max(1, Math.round(spec.block) || 1));
    return { targets: all.slice((block - 1) * cap, block * cap).map((e) => ({ symbol: e.symbol, name: e.name, fin: e.fin })), available: all.length, blocks, invalid: [], unlisted: [] };
  }
  const { symbols, invalid } = spec.source === "custom" ? parseTickers(spec.custom) : { symbols: [...new Set(watchlist)], invalid: [] as string[] };
  const picked = symbols.slice(0, cap);
  return {
    targets: picked.map(target),
    available: symbols.length,
    blocks: 1,
    invalid,
    unlisted: directory ? picked.filter((s) => !byRef.has(s)) : [],
  };
}

/** One 24 h ticker row of the exchange (only what the ranking needs). */
export interface CryptoTicker {
  symbol: string;
  quoteVolume: number;
}

/** USDT perpetuals ranked by 24 h quote volume, the top `n`. Delivery contracts (`BTCUSDT_250627`) and leveraged names are left out. */
export function cryptoTargets(tickers: readonly CryptoTicker[], n: number): ScanTarget[] {
  return tickers
    .filter((t) => /^[A-Z0-9]{2,15}USDT$/.test(t.symbol) && Number.isFinite(t.quoteVolume) && t.quoteVolume > 0)
    .sort((a, b) => b.quoteVolume - a.quoteVolume || (a.symbol < b.symbol ? -1 : 1))
    .slice(0, Math.min(HARD_CAP, Math.max(1, Math.round(n))))
    .map((t) => ({ symbol: t.symbol, name: t.symbol.replace(/USDT$/, "") }));
}

export type ScanMode = "daily" | "orb";

/** The starting thresholds of a market and mode (the user's own edits are stored per market and mode). */
export function defaultParamsFor(kind: MarketKind, mode: ScanMode): ScanParams {
  const d = DEFAULT_PARAMS;
  if (kind === "crypto") return { ...d, orb: { ...d.orb, orMinutes: 60, latestMinutes: null }, pre: { ...d.pre, minPrice: 0, minVolume: 0, normalStatusOnly: false, minBars: 30, maxAgeDays: 3 } };
  return mode === "orb" ? { ...d, pre: { ...d.pre, minVolume: 0 } } : d;
}

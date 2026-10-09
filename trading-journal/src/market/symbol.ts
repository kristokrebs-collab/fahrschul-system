/**
 * Symbol handling (Plan 4.1). `settings.market.symbol` is a TradingView symbol such as
 * `"BINANCE:BTCUSDT"`; every Binance stream name / REST parameter is derived from the bare symbol.
 */

export const DEFAULT_TV_SYMBOL = "BINANCE:BTCUSDT";
export const DEFAULT_SYMBOL = "BTCUSDT";
export const FALLBACK_ONLY_USDT = "Fallback nur für USDT-Perps";

/** Quote assets we know how to split off (longest first so `USDT` wins over `USD`). */
const QUOTES = ["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USD", "BTC", "ETH", "BNB"] as const;

export interface SymbolInfo {
  /** raw settings value */
  raw: string;
  /** TradingView exchange prefix, uppercase, or null when none was given */
  prefix: string | null;
  /** Binance REST symbol, e.g. `BTCUSDT` */
  binance: string;
  /** lowercase stream symbol, e.g. `btcusdt` */
  stream: string;
  base: string | null;
  quote: string | null;
  /** Bybit linear symbol, only for USDT perps */
  bybit: string | null;
  /** OKX swap instId, e.g. `BTC-USDT-SWAP`, only for USDT perps */
  okx: string | null;
  /** true when the string is syntactically a Binance symbol (existence still needs the REST probe) */
  valid: boolean;
  /** set when Bybit/OKX cannot serve this symbol */
  fallbackDetail?: string;
}

/**
 * `"BINANCE:BTCUSDT"` → `"BTCUSDT"`; other prefixes are stripped too (the symbol is adopted and validated later).
 * A USD-quoted chart symbol of another venue (`BITSTAMP:BTCUSD`, the other journal's default, `COINBASE:ETHUSD`)
 * or a bare `BTCUSD` has no USDⓈ-M perp: it maps to the USDT perp (`BTCUSDT`), otherwise every feed would die with
 * `bad_symbol`. The raw TradingView symbol stays in the settings (display, chart links).
 */
export function tvSymbolToBinance(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return DEFAULT_SYMBOL;
  const idx = s.lastIndexOf(":");
  // `.P` is TradingView's perpetual suffix (`BINANCE:BTCUSDT.P`)
  const bare = (idx >= 0 ? s.slice(idx + 1) : s)
    .replace(/\.P$/i, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  if (!bare) return DEFAULT_SYMBOL;
  const prefix = idx > 0 ? s.slice(0, idx).trim().toUpperCase() : null;
  // `BINANCE:BTCUSD` stays (COIN-M style, rejected later as bad_symbol like before); any other venue / no venue maps
  if (prefix !== "BINANCE" && /^[A-Z0-9]{2,15}USD$/.test(bare)) return `${bare}T`;
  return bare;
}

export function tvPrefix(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  const idx = s.indexOf(":");
  if (idx <= 0) return null;
  return s.slice(0, idx).toUpperCase();
}

export function isValidBinanceSymbol(sym: string): boolean {
  return /^[A-Z0-9]{5,20}$/.test(sym);
}

export function splitSymbol(sym: string): { base: string; quote: string } | null {
  for (const q of QUOTES) {
    if (sym.length > q.length && sym.endsWith(q)) return { base: sym.slice(0, -q.length), quote: q };
  }
  return null;
}

export function toBybitSymbol(sym: string): string | null {
  const parts = splitSymbol(sym);
  return parts && parts.quote === "USDT" ? sym : null;
}

export function toOkxSymbol(sym: string): string | null {
  const parts = splitSymbol(sym);
  return parts && parts.quote === "USDT" ? `${parts.base}-USDT-SWAP` : null;
}

export function resolveSymbol(raw: string | null | undefined): SymbolInfo {
  const binance = tvSymbolToBinance(raw);
  const parts = splitSymbol(binance);
  const bybit = toBybitSymbol(binance);
  const okx = toOkxSymbol(binance);
  const info: SymbolInfo = {
    raw: raw ?? "",
    prefix: tvPrefix(raw),
    binance,
    stream: binance.toLowerCase(),
    base: parts?.base ?? null,
    quote: parts?.quote ?? null,
    bybit,
    okx,
    valid: isValidBinanceSymbol(binance),
  };
  if (!bybit) info.fallbackDetail = FALLBACK_ONLY_USDT;
  return info;
}

/**
 * "In TradingView öffnen" (F14): only a LINK to the chart of the same market and interval – no login, no account access, no
 * data leaves the app. The lab runs on Binance USDⓈ-M perpetuals, which TradingView lists as `BINANCE:BTCUSDT.P`.
 */
import type { TfId } from "../rules/types";

/** TradingView's chart interval parameter. */
export const TV_INTERVAL: Readonly<Record<TfId, string>> = { "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240", "1d": "D" };

/** `BTCUSDT` → `BINANCE:BTCUSDT.P` (the USDⓈ-M perpetual); null when the symbol does not look like a Binance pair. */
export function tvSymbol(symbol: string): string | null {
  const s = symbol.trim().toUpperCase();
  return /^[A-Z0-9]{2,20}$/.test(s) ? `BINANCE:${s}.P` : null;
}

/** The chart link of a symbol and execution interval, or null when the symbol is not usable. */
export function tvChartUrl(symbol: string, interval: TfId): string | null {
  const sym = tvSymbol(symbol);
  return sym ? `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}&interval=${TV_INTERVAL[interval]}` : null;
}

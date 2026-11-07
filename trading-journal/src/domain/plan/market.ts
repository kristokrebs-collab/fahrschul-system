/**
 * Welcher Markt ein Kürzel ist – nach seiner Form (rein, ohne Netz): ein Paar mit USDT/USDC am Ende ist ein Krypto-Perpetual von
 * Binance, ein bis fünf Buchstaben (mit Klassenzusatz wie BRK.B oder BF-B) sind eine US-Aktie. Ob die Quelle das Kürzel kennt,
 * sagt erst der Kerzenabruf, mit Grund.
 */
import { STOCK_SYMBOL } from "@/market/stocks/types";
import { sessionDef, type MarketKind, type SessionId } from "./sessions";

/** A Binance USDⓈ-M perpetual: base asset + USDT / USDC. */
export const CRYPTO_PAIR = /^[A-Z0-9]{1,15}(USDT|USDC)$/;
/** What the form accepts as a crypto symbol (the exchange decides later whether it exists). */
const CRYPTO_ANY = /^[A-Z0-9]{3,20}$/;

/** The market a ticker looks like, `null` when it looks like neither. A crypto pair wins over a stock shape (`SUSDT`). */
export function symbolMarket(symbol: string): MarketKind | null {
  const s = symbol.trim().toUpperCase();
  if (CRYPTO_PAIR.test(s)) return "crypto";
  if (STOCK_SYMBOL.test(s)) return "stocks";
  return null;
}

/** May `symbol` stand in the form of this market? (Crypto accepts any 3–20 letters and digits, a stock needs the ticker shape.) */
export function symbolFits(symbol: string, market: MarketKind): boolean {
  return market === "stocks" ? STOCK_SYMBOL.test(symbol) : CRYPTO_ANY.test(symbol);
}

/** The market kind of a form or a session id (the session decides). */
export const formMarket = (form: { session: SessionId }): MarketKind => sessionDef(form.session).market;

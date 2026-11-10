/**
 * What the importers can and cannot read (F42) – in one place, so the code, the CSV sheet, the sync card and the
 * function register say the same.
 *
 * Contract kinds
 * - Supported: LINEAR perpetuals settled in USDT / USDC (quantity in the base coin, P&L in the quote currency): Binance
 *   USDⓈ-M, Bybit linear, OKX USDT swaps, Bitunix futures. One-way mode.
 * - Spot (Kraken, Coinbase, OKX spot): read as LONG round trips only (average cost; a sell without a known holding is
 *   skipped; no leverage, no funding). Not a margin product.
 * - NOT supported: Coin-M / inverse contracts (quantity in contracts of a fixed USD value, P&L in the coin: reading them
 *   as linear gives wrong sizes and wrong P&L) and the HEDGE mode of an export that books Long and Short of one symbol
 *   side by side (the fill importer nets buys and sells per symbol, which would mix both legs). Rows of both kinds are NOT
 *   imported; the sheet says how many were left out and why. Nothing is converted or guessed.
 */

export type ScopeVenue = "binance" | "bybit" | "okx" | "any";

/** Inverse (coin-margined) contract symbols as the exports spell them. */
const INVERSE: Readonly<Record<ScopeVenue, RegExp>> = {
  // Binance COIN-M: BTCUSD_PERP, ETHUSD_250328
  binance: /^[A-Z0-9]+USD_(PERP|\d{6})$/i,
  // Bybit inverse: BTCUSD, ETHUSD; inverse futures BTCUSDH25 (month letter + year) – BTCUSDT / BTCUSDC are linear and never match
  bybit: /^[A-Z0-9]{2,}USD([FGHJKMNQUVXZ]\d{2})?$/i,
  // OKX coin-margined: BTC-USD-SWAP, BTC-USD-250328 (USDT / USDC swaps are linear)
  okx: /^[A-Z0-9]+-USD-(SWAP|\d{6})$/i,
  // a file of unknown origin (column mapping): only the spellings that cannot be anything else
  any: /^(?:[A-Z0-9]+USD_(?:PERP|\d{6})|[A-Z0-9]+-USD-(?:SWAP|\d{6}))$/i,
};

/** True when the raw symbol of an export is a Coin-M / inverse contract. */
export function isInverseContract(venue: ScopeVenue, rawSymbol: string): boolean {
  return INVERSE[venue].test(rawSymbol.trim());
}

/** True when a „position side“ cell says the row belongs to one leg of the hedge mode. */
export const isHedgeLeg = (positionSide: string): boolean => /^(long|short)$/i.test(positionSide.trim());

export interface Rejections {
  inverse: number;
  hedge: number;
  /** a few raw symbols for the message (at most 3, unique) */
  examples: string[];
}

export const noRejections = (): Rejections => ({ inverse: 0, hedge: 0, examples: [] });

export function reject(r: Rejections, kind: "inverse" | "hedge", example: string): void {
  r[kind] += 1;
  if (example && !r.examples.includes(example) && r.examples.length < 3) r.examples.push(example);
}

/** The German warnings of the preview: how many rows were left out, and why. */
export function rejectionWarnings(r: Rejections): string[] {
  const out: string[] = [];
  if (r.inverse > 0) {
    out.push(`${r.inverse} ${r.inverse === 1 ? "Zeile" : "Zeilen"} mit Coin-M-/inversen Kontrakten nicht importiert${r.examples.length ? ` (${r.examples.join(", ")})` : ""}: Menge in Kontrakten und Gewinn in Coin würden als linear falsch gerechnet. Coin-M wird nicht unterstützt.`);
  }
  if (r.hedge > 0) {
    out.push(`${r.hedge} ${r.hedge === 1 ? "Zeile" : "Zeilen"} aus dem Hedge-Modus (Position Side LONG/SHORT) nicht importiert: der Import verrechnet Käufe und Verkäufe je Symbol und würde Long und Short vermischen. Der Hedge-Modus wird nicht unterstützt.`);
  }
  return out;
}

/** The standing statement (CSV sheet and sync card). */
export const SCOPE_TEXT = {
  csvSupported: "Unterstützt: lineare USDT-/USDC-Perps im Einweg-Modus (Binance USDⓈ-M, Bybit linear, OKX, Bitunix). Spot (Kraken, Coinbase, OKX Spot) nur als Long-Rundreisen ohne Hebel und Funding; ein Verkauf ohne bekannten Bestand wird übersprungen.",
  csvNot: "Nicht unterstützt: Coin-M / inverse Kontrakte (z. B. BTCUSD_PERP, BTC-USD-SWAP, Bybit BTCUSD) und der Hedge-Modus (Binance-Dateien mit „Position Side“ LONG/SHORT). Diese Zeilen werden nicht importiert – die Vorschau nennt, wie viele.",
  syncReads: "Der Sync liest nur die Futures-Schnittstelle von Bitunix und rechnet jede Position als linearen USDT-Kontrakt (Menge × Preis).",
  syncSpot: "Spot-Konto: wird nicht gelesen – Spot-Trades kommen nur per CSV.",
  syncCoinM: "Coin-M / inverse Kontrakte: nicht unterstützt.",
  syncHedge: "Hedge-Modus: Long und Short am selben Symbol kommen als getrennte Positionen (je eine Positions-ID) und werden als getrennte Trades übernommen. Das Exposure verrechnet sie; die Liquidationsnäherung rechnet jede Position für sich und kennt die Gegenposition nicht.",
} as const;

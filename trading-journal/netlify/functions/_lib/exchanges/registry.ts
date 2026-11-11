/**
 * Adapter per venue (P11). Bitunix and Binance (API-key route, spot and futures kept apart) are live; Bybit and OKX plug
 * into the same `ExchangeAdapter` interface later – until then connecting them answers an honest 501.
 */
import { HttpError } from "../http";
import { binanceAdapter, checkRights, cleanSymbols, type RightsVerdict } from "./binance";
import { bitunixAdapter, defaultRuntime } from "./bitunix";
import { isExchangeMarket, type AdapterRuntime, type ExchangeAdapter, type ExchangeCredentials, type ExchangeId, type ExchangeMarket } from "./types";

export const LIVE_EXCHANGES: readonly ExchangeId[] = ["bitunix", "binance"];

export const EXCHANGE_LABEL: Readonly<Record<ExchangeId, string>> = {
  bitunix: "Bitunix",
  binance: "Binance",
  bybit: "Bybit",
  okx: "OKX",
};

let runtimeOverride: AdapterRuntime | null = null;

/** Tests: route every adapter through a fake fetch / clock (`null` restores the real runtime). */
export function setAdapterRuntimeForTests(rt: AdapterRuntime | null): void {
  runtimeOverride = rt;
}

/** What a connection row tells the adapter beyond the key (`market`, `meta.symbols`). */
export interface AdapterOptions {
  market?: ExchangeMarket | null;
  symbols?: readonly string[];
}

/** Options from a connection row (`market` column or `meta.market`, `meta.symbols`). */
export function adapterOptionsOf(row: { market?: unknown; meta?: Record<string, unknown> | null }): AdapterOptions {
  const m = isExchangeMarket(row.market) ? row.market : isExchangeMarket(row.meta?.market) ? row.meta.market : null;
  return { market: m, symbols: cleanSymbols(row.meta?.symbols) };
}

export function adapterFor(exchange: ExchangeId, creds: ExchangeCredentials, opts: AdapterOptions = {}): ExchangeAdapter {
  const rt = runtimeOverride ?? defaultRuntime();
  switch (exchange) {
    case "bitunix":
      return bitunixAdapter(creds, rt);
    case "binance":
      return binanceAdapter(creds, rt, { market: opts.market ?? "futures", symbols: opts.symbols });
    default:
      throw new HttpError(501, "exchange_not_supported", `${EXCHANGE_LABEL[exchange]} folgt bald – im Moment geht der automatische Sync mit Bitunix. Für ${EXCHANGE_LABEL[exchange]} nutze den CSV-Import.`);
  }
}

/**
 * Rights of a key as the venue reports them. Binance answers (`/sapi/v1/account/apiRestrictions`); Bitunix has no such
 * endpoint, so `null` – the user's confirmation is all there is (review EX-01).
 */
export async function keyRights(exchange: ExchangeId, creds: ExchangeCredentials, market: ExchangeMarket | null): Promise<RightsVerdict | null> {
  if (exchange !== "binance") return null;
  return checkRights(creds, market ?? "futures", runtimeOverride ?? defaultRuntime());
}

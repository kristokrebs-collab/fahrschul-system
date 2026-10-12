/**
 * Adapter per venue (P11). Bitunix is live; Binance, Bybit and OKX plug into the same `ExchangeAdapter` interface in
 * phase 2 – until then connecting them answers an honest 501.
 */
import { HttpError } from "../http";
import { bitunixAdapter, defaultRuntime } from "./bitunix";
import type { AdapterRuntime, ExchangeAdapter, ExchangeCredentials, ExchangeId } from "./types";

export const LIVE_EXCHANGES: readonly ExchangeId[] = ["bitunix"];

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

export function adapterFor(exchange: ExchangeId, creds: ExchangeCredentials): ExchangeAdapter {
  const rt = runtimeOverride ?? defaultRuntime();
  switch (exchange) {
    case "bitunix":
      return bitunixAdapter(creds, rt);
    default:
      throw new HttpError(501, "exchange_not_supported", `${EXCHANGE_LABEL[exchange]} folgt bald – im Moment geht der automatische Sync mit Bitunix. Für ${EXCHANGE_LABEL[exchange]} nutze den CSV-Import.`);
  }
}

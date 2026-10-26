/**
 * Kerzenquellen des Handelsplans. Der Rechenkern (`src/domain/plan`) nimmt `Symbol + Kerzen`; woher die Kerzen kommen, sagt
 * diese Tabelle. Krypto: Binance USDⓈ-M (`candles.ts`). Aktien: der Aktien-Datenvertrag (`@/market/stocks`, Yahoo Finance über
 * die eigenen Server-Funktionen; `stockCandles.ts`), geladen erst, wenn eine US-Börse-Sitzung gewählt ist. Fällt eine Quelle
 * aus, sagt die Seite den Grund und erfindet keine Kerzen.
 */
import type { MarketKind } from "@/domain/plan/sessions";
import { loadPlanCandles, type LoadRequest, type PlanCandles } from "./candles";

export interface PlanCandleSource {
  id: string;
  kind: MarketKind;
  /** name of the data source for "Quelle: …" */
  label: string;
  ready: boolean;
  /** why it is not available (German) */
  notReady?: string;
  load?: (req: LoadRequest) => Promise<PlanCandles>;
}

export const PLAN_SOURCES: readonly PlanCandleSource[] = [
  { id: "binance", kind: "crypto", label: "Binance USDⓈ-M", ready: true, load: (req) => loadPlanCandles(req) },
  {
    id: "stocks",
    kind: "stocks",
    label: "Yahoo Finance (inoffiziell)",
    ready: true,
    // its own chunk: the stock client only loads when a US session is chosen
    load: async (req) => (await import("./stockCandles")).loadStockPlanCandles(req),
  },
];

export const sourceOf = (kind: MarketKind): PlanCandleSource => PLAN_SOURCES.find((s) => s.kind === kind)!;

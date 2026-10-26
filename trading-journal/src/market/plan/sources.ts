/**
 * Kerzenquellen des Handelsplans. Der Rechenkern (`src/domain/plan`) nimmt `Symbol + Kerzen`; woher die Kerzen kommen, sagt
 * diese Tabelle. Krypto: Binance USDⓈ-M (`candles.ts`). Aktien: der Platz ist vorbereitet – sobald der Datenvertrag der
 * Aktien-Module eine Quelle mit dieser Form liefert (`load(req) → PlanCandles`, derselbe `Candle`-Typ), wird sie hier
 * eingetragen und die US-Börse-Sitzung wird wählbar. Bis dahin sagt die Seite ehrlich, dass es keine Aktien-Kerzen gibt, und
 * erfindet keine.
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
    label: "Aktien-Kerzen",
    ready: false,
    notReady: "Aktien-Kerzen sind noch nicht angebunden – sie kommen mit dem Datenvertrag der Aktien-Module. Der Rechenkern kann sie schon: er nimmt Symbol und Kerzen, die Sitzung der US-Börse mit Feiertagen und Sommerzeit ist eingebaut.",
  },
];

export const sourceOf = (kind: MarketKind): PlanCandleSource => PLAN_SOURCES.find((s) => s.kind === kind)!;

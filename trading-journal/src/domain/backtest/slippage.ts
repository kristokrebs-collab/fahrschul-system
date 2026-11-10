/**
 * Slippage of the backtest (P07, pure). Applied AGAINST the trader on every market / stop fill (entries at the next
 * open, stops, time and signal exits); a take-profit is a resting limit order and fills at its price (or better on a
 * gap). Models:
 * - `fixed`  – a fixed share of the price (bps);
 * - `atr`    – a fraction of the ATR(14) of the fill bar's predecessor (volatile markets slip more);
 * - `spread` – half of an assumed bid/ask spread (bps);
 * - `none`   – fills at the bar price (only for comparisons; the UI warns).
 */
import type { SlippageModel } from "./types";

export const DEFAULT_SLIPPAGE: SlippageModel = { kind: "fixed", bps: 2 };

export const SLIPPAGE_LABEL: Readonly<Record<SlippageModel["kind"], string>> = {
  fixed: "Fix",
  atr: "ATR-Anteil",
  spread: "Spread",
  none: "Keine",
};

/** Price distance of the slippage for one fill at `price` (≥ 0). `atr` = ATR(14) known at the fill. */
export function slipDistance(model: SlippageModel, price: number, atr: number | null): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  switch (model.kind) {
    case "fixed":
      return (price * Math.max(0, model.bps)) / 10_000;
    case "spread":
      return (price * Math.max(0, model.bps)) / 2 / 10_000;
    case "atr":
      return atr != null && Number.isFinite(atr) && atr > 0 ? Math.max(0, model.frac) * atr : 0;
    case "none":
      return 0;
  }
}

/**
 * Fill price after slippage: a buy fills higher, a sell lower. `buy` = the order buys (long entry, short exit).
 */
export function slipped(model: SlippageModel, price: number, buy: boolean, atr: number | null): number {
  const d = slipDistance(model, price, atr);
  return buy ? price + d : Math.max(price - d, price * 0.5);
}

/** Short German description of the model for the assumptions card. */
export function slippageText(m: SlippageModel): string {
  switch (m.kind) {
    case "fixed":
      return `${String(m.bps).replace(".", ",")} bp pro Market-Fill`;
    case "spread":
      return `halber Spread von ${String(m.bps).replace(".", ",")} bp`;
    case "atr":
      return `${String(Math.round(m.frac * 100))} % der ATR(14) pro Fill`;
    case "none":
      return "keine Slippage (zu optimistisch)";
  }
}

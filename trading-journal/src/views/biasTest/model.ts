/**
 * Pure helpers of the surfaces under test (F62): which own-trade markers a frozen or blind chart may show. Nothing here
 * reads a price after the anchor.
 */
import type { TradeMarker } from "@/chart/markers";
import type { BiasBlind } from "@/domain/biasTest";

export interface MarkerRules {
  /** the "Eigene Trades" layer is on */
  layerOn: boolean;
  /** the picture is frozen at this bar's open time (ms), `null` = not frozen */
  anchorMs: number | null;
  /** bar length of the chart (ms) – a trade inside the anchor bar was already known */
  intervalMs: number;
  blind: BiasBlind;
}

/**
 * The markers a chart may draw.
 * - layer off or "Position verdecken": none;
 * - frozen: only trades entered up to the end of the anchor bar, and without their exit / result / P&L – a trade that
 *   closed after the anchor must not tell how the price went on;
 * - "P&L verdecken": entries stay, exits / results / P&L go.
 */
export function visibleMarkers(markers: readonly TradeMarker[], r: MarkerRules): TradeMarker[] {
  if (!r.layerOn || r.blind.hidePosition) return [];
  const strip = r.anchorMs != null || r.blind.hidePnl;
  return markers
    .filter((m) => r.anchorMs == null || m.time < r.anchorMs + r.intervalMs)
    .map((m) => (strip ? { ...m, exit: null, pnl: null, result: "open" as const } : m));
}

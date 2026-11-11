/**
 * Kerzen-Lücken prüfen (F27), on demand: loads the last days of 1h candles of a few markets through the lab's history source and
 * lists the holes (`findBarGaps`) – candles the exchange did not return for the checked range, or that could not be loaded. The
 * result is shown, not stored. Nothing runs until the trader asks; the source is imported lazily with the click.
 */
import { findBarGaps, type GapCheck } from "@/domain/missed/quality";

export const GAP_CHECK_DAYS = 14;
export const GAP_CHECK_MARKETS = 5;
const HOUR = 3_600_000;

/** Distinct markets for the check: the ones in `symbols`, empty names dropped, at most `GAP_CHECK_MARKETS`. */
export function gapCheckMarkets(symbols: readonly string[]): string[] {
  return [...new Set(symbols.filter(Boolean))].slice(0, GAP_CHECK_MARKETS);
}

/** Checks the candles of `symbols` (1h, the last `GAP_CHECK_DAYS` days). One market failing does not stop the others. */
export async function checkCandleGaps(symbols: readonly string[], now: number = Date.now()): Promise<GapCheck[]> {
  const markets = gapCheckMarkets(symbols);
  if (!markets.length) return [];
  const { loadLabData, loadErrorKind } = await import("@/views/labor/historySource");
  const to = Math.floor(now / HOUR) * HOUR - HOUR; // newest closed candle
  const from = to - GAP_CHECK_DAYS * 24 * HOUR;
  const out: GapCheck[] = [];
  for (const symbol of markets) {
    try {
      const res = await loadLabData({ symbol, intervals: ["1h"], from, to, funding: false });
      const times = (res.data["1h"] ?? []).map((b) => b.t * 1000).filter((t) => t >= from && t <= to);
      const gaps = findBarGaps(times, HOUR);
      // the newest closed candle is missing: the tail is a gap too
      const last = times[times.length - 1];
      if (last != null && last < to) gaps.push({ from: last + HOUR, to, missing: Math.round((to - last) / HOUR) });
      out.push({ symbol, intervalMs: HOUR, from, to, bars: times.length, gaps, missing: gaps.reduce((s, g) => s + g.missing, 0), error: times.length ? null : "Für den Zeitraum kamen keine Kerzen zurück." });
    } catch (err) {
      const kind = loadErrorKind(err);
      out.push({ symbol, intervalMs: HOUR, from, to, bars: 0, gaps: [], missing: 0, error: kind === "symbol" ? "Dieser Markt ist bei Binance (USDⓈ-M) nicht bekannt." : kind === "rate" ? "Das Abfrage-Budget ist erschöpft." : kind === "blocked" ? "Die Marktdaten sind nicht erreichbar." : "Die Kerzen konnten nicht geladen werden." });
    }
  }
  return out;
}

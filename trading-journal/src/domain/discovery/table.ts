/**
 * The feature table: one row per trade (chronological), one column per feature, plus the outcome R. This is where "what was
 * known at the entry" is enforced – see `features.ts` for the candle side; the two history-dependent columns are handled here:
 *   - `lossStreak` counts only trades that were ALREADY CLOSED at this entry (exit time ≤ entry time), newest first;
 *   - `hold` (the time in the trade) is only filled when `includePostEntry` is set – it is a description of the outcome.
 * A trade whose candle data does not reach its entry (the last closed candle is more than one candle older than the entry) gets
 * no candle features rather than stale ones.
 */
import { closedCount } from "../backtest/bars";
import { BAR_FEATURES, buildSeries, barFeatures, calendarFeatures, CALENDAR_FEATURES, emptyBarRow, FEATURES, FEATURE_IDS, streakLabel, type FeatureSeries } from "./features";
import { LIMITS, type DiscoveryInput, type DiscoveryTrade, type FeatureId, type FeatureValue } from "./types";

export interface FeatureTable {
  /** trades with a known R, oldest entry first */
  trades: DiscoveryTrade[];
  r: Float64Array;
  /** one column per feature that is part of this analysis (`includePostEntry` decides about `hold`) */
  cols: Partial<Record<FeatureId, FeatureValue[]>>;
  droppedNoR: number;
  droppedCap: number;
  /** features that cannot be used at all, with the reason */
  empty: { id: FeatureId; reason: string }[];
}

/** Losses in a row before each trade, from the trades closed by then. `null` for all when too many exit times are missing. */
export function lossStreaks(all: readonly DiscoveryTrade[]): (number | null)[] | null {
  const known = all.filter((t) => t.exitTime != null && Number.isFinite(t.exitTime) && t.r != null && Number.isFinite(t.r));
  if (all.length === 0 || known.length < 0.8 * all.length) return null;
  const closed = known.map((t) => ({ at: t.exitTime!, r: t.r!, id: t.id })).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return all.map((t) => {
    // trades closed at or before the entry: binary search for the count
    let lo = 0;
    let hi = closed.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (closed[mid]!.at <= t.entryTime) lo = mid + 1;
      else hi = mid;
    }
    let n = 0;
    for (let i = lo - 1; i >= 0 && closed[i]!.r < 0 && n < 3; i--) {
      if (closed[i]!.id === t.id) continue; // a trade is never its own predecessor
      n++;
    }
    return n;
  });
}

const sortTrades = (a: DiscoveryTrade, b: DiscoveryTrade): number => a.entryTime - b.entryTime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildTable(input: DiscoveryInput, maxTrades: number = LIMITS.maxTrades): FeatureTable {
  const valid = input.trades.filter((t) => Number.isFinite(t.entryTime) && (t.side === "long" || t.side === "short"));
  const withR = valid.filter((t) => t.r != null && Number.isFinite(t.r)).sort(sortTrades);
  const droppedNoR = input.trades.length - withR.length;
  const streakAll = lossStreaks(withR);
  const droppedCap = Math.max(0, withR.length - maxTrades);
  const trades = droppedCap ? withR.slice(droppedCap) : withR;
  const streak = streakAll ? (droppedCap ? streakAll.slice(droppedCap) : streakAll) : null;
  const n = trades.length;
  const post = input.includePostEntry === true;

  const ids = FEATURE_IDS.filter((id) => FEATURES[id].phase === "entry" || post);
  const cols: Partial<Record<FeatureId, FeatureValue[]>> = Object.fromEntries(ids.map((id) => [id, new Array<FeatureValue>(n).fill(null)]));
  const col = (id: FeatureId): FeatureValue[] => cols[id]!;

  const series = new Map<string, FeatureSeries | null>();
  const seriesOf = (key: string): FeatureSeries | null => {
    if (!series.has(key)) {
      const m = input.markets?.[key];
      series.set(key, m && m.bars.length && m.intervalSec > 0 ? buildSeries(m) : null);
    }
    return series.get(key)!;
  };

  let anyBars = false;
  for (let i = 0; i < n; i++) {
    const t = trades[i]!;
    col("side")[i] = t.side === "long" ? "Long" : "Short";
    const cal = calendarFeatures(t.entryTime);
    for (const id of CALENDAR_FEATURES) col(id)[i] = cal[id];
    col("setup")[i] = t.setup?.trim() ? t.setup.trim() : null;
    col("emotion")[i] = t.emotion?.trim() ? t.emotion.trim() : null;
    if (streak) col("lossStreak")[i] = streakLabel(streak[i]!);
    if (post && t.exitTime != null && t.exitTime >= t.entryTime) col("hold")[i] = (t.exitTime - t.entryTime) / 3_600_000;

    const s = seriesOf(t.market ?? "");
    let row = emptyBarRow();
    if (s) {
      anyBars = true;
      const atS = t.entryTime / 1000;
      const k = closedCount(s.bars, s.secLen, atS);
      // the last closed candle must be the one right before the entry – else the data does not reach this trade
      if (k > 0 && atS - (s.bars[k - 1]!.t + s.secLen) <= s.secLen) row = barFeatures(s, k, atS, t.side);
    }
    for (const id of BAR_FEATURES) col(id)[i] = row[id];
  }

  const empty: { id: FeatureId; reason: string }[] = [];
  for (const id of ids) {
    const c = col(id);
    if (c.some((v) => v != null)) continue;
    const d = FEATURES[id];
    const reason =
      id === "lossStreak"
        ? "Bei vielen Trades fehlt die Ausstiegszeit."
        : id === "hold"
          ? "Bei keinem Trade ist die Ausstiegszeit bekannt."
          : id === "relVolume"
            ? anyBars
              ? "Die Kerzen haben kein Volumen."
              : "Es wurden keine Kerzen übergeben."
            : id === "keyLevelDist"
              ? "Es sind keine Schlüsselmarken mit bekanntem Anlegezeitpunkt vorhanden."
              : d.needsBars
                ? anyBars
                  ? "Vor den Einstiegen gab es noch zu wenige Kerzen (Aufwärmzeit) oder die Kerzen reichen nicht bis zum Einstieg."
                  : "Es wurden keine Kerzen übergeben."
                : id === "setup" || id === "emotion"
                  ? "Bei keinem Trade eingetragen."
                  : "Keine Werte.";
    empty.push({ id, reason });
    delete cols[id];
  }
  return { trades, r: Float64Array.from(trades, (t) => t.r!), cols, droppedNoR, droppedCap, empty };
}

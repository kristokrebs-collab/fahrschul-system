/**
 * Sources of the search: the trades of a finished backtest (with the candles it ran on) and the journal's closed trades.
 * Pure conversions – nothing is invented: a trade without a known R is passed on with `r: null` and counted as left out.
 */
import type { BtTrade } from "../backtest/types";
import type { Bar } from "../signals/indicators";
import type { Trade } from "../types";
import type { DiscoveryInput, DiscoveryLevel, DiscoveryMarket, DiscoveryTrade } from "./types";

/** The trades of a backtest. `bars` are the run's execution bars (the index space of `entryIndex`), `intervalSec` their length. */
export function fromBacktest(
  trades: readonly BtTrade[],
  bars: readonly Bar[],
  intervalSec: number,
  opts: { label?: string; seed?: number; levels?: readonly DiscoveryLevel[]; includePostEntry?: boolean } = {},
): DiscoveryInput {
  const list: DiscoveryTrade[] = trades.map((t) => ({
    id: t.id,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    side: t.side,
    r: Number.isFinite(t.r) ? t.r : null,
    setup: t.tag || null,
  }));
  const market: DiscoveryMarket = { intervalSec, bars, ...(opts.levels ? { levels: opts.levels } : {}) };
  return {
    trades: list,
    markets: { "": market },
    source: "backtest",
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.seed != null ? { seed: opts.seed } : {}),
    ...(opts.includePostEntry ? { includePostEntry: true } : {}),
  };
}

const ms = (s: string | undefined | null): number | null => {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * The journal's closed trades with a known R. `setupName` maps a setup id to its name (the first setup of a trade is its label);
 * `markets` are candles for the trades' pairs when the caller has them (key = `trade.pair`) – without them only the clock, the
 * history (losses in a row) and the journal fields are available.
 */
export function fromJournal(
  trades: readonly Trade[],
  opts: { setupName?: (id: string) => string | null; markets?: Readonly<Record<string, DiscoveryMarket>>; label?: string; seed?: number; includePostEntry?: boolean } = {},
): DiscoveryInput {
  const list: DiscoveryTrade[] = [];
  for (const t of trades) {
    if (t.status !== "closed") continue;
    const entry = ms(t.date) ?? ms(t.createdAt);
    if (entry == null) continue;
    const exit = ms(t.exitDate);
    const setupId = t.setups?.[0];
    list.push({
      id: t.id,
      entryTime: entry,
      exitTime: exit != null && exit >= entry ? exit : null,
      side: t.side,
      r: t.r != null && Number.isFinite(t.r) ? t.r : null,
      market: t.pair,
      setup: setupId ? (opts.setupName?.(setupId) ?? null) : null,
      emotion: t.emotion?.trim() ? t.emotion.trim() : null,
    });
  }
  return {
    trades: list,
    ...(opts.markets ? { markets: opts.markets } : {}),
    source: "journal",
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.seed != null ? { seed: opts.seed } : {}),
    ...(opts.includePostEntry ? { includePostEntry: true } : {}),
  };
}

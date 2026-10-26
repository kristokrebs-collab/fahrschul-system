/**
 * Synthetic data of the Muster-Entdecker tests: seeded, so every run of the suite sees the same numbers.
 *  - `noiseTable` / `plantedTable`: ready feature tables (no candles) for the miner on its own;
 *  - `randomBars` + `tradesOnBars`: candles and trades whose outcome depends on a feature computed from those very candles
 *    (so the whole chain – features, table, miner – has to find a relationship that really sits in the candles).
 */
import { rng } from "@/domain/analytics/stats";
import { barFeatures, buildSeries } from "@/domain/discovery/features";
import type { FeatureTable } from "@/domain/discovery/table";
import type { DiscoveryTrade, FeatureId, FeatureValue } from "@/domain/discovery/types";
import type { Bar } from "@/domain/signals/indicators";

/** Candles of a random walk with volume; `t` in seconds. */
export function randomBars(n: number, seed: number, opts: { t0?: number; sec?: number; vol?: boolean; drift?: number } = {}): Bar[] {
  const r = rng(seed);
  const t0 = opts.t0 ?? 1_700_000_000 - (1_700_000_000 % 86_400);
  const sec = opts.sec ?? 3600;
  let c = 100;
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const o = c;
    const move = (r() - 0.5 + (opts.drift ?? 0)) * 2.4;
    c = Math.max(1, o + move);
    const h = Math.max(o, c) + r() * 0.8;
    const l = Math.min(o, c) - r() * 0.8;
    const bar: Bar = { t: t0 + i * sec, o, h, l, c };
    if (opts.vol !== false) bar.v = 100 + r() * 400;
    out.push(bar);
  }
  return out;
}

export const NOISE_NUM: readonly FeatureId[] = ["emaDist20", "emaDist50", "rsi", "rsiSlope", "volRegime", "candleSize", "bodyRatio", "relVolume", "roomAhead", "trendSlope", "efficiency", "bbPos"];
export const NOISE_CAT: readonly FeatureId[] = ["side", "session", "weekday", "setup", "emotion", "lossStreak"];
const LEVELS: Readonly<Partial<Record<FeatureId, readonly string[]>>> = {
  side: ["Long", "Short"],
  session: ["Asien", "London", "New York", "Spät"],
  weekday: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"],
  setup: ["A", "B", "C"],
  emotion: ["Ruhig", "FOMO", "Unsicher"],
  lossStreak: ["0", "1", "2", "3 oder mehr"],
};

/** A skewed, heavy-tailed result in R: mostly −1, sometimes a win of 0,5…3, rarely an outlier. */
export function noiseR(r: () => number): number {
  const u = r();
  if (u < 0.55) return -1;
  if (u < 0.97) return 0.5 + r() * 2.5;
  return 5 + r() * 3;
}

export interface PlantedEffect {
  /** the effect: where this holds, the trade wins with `pWin` (else with `pBase`) */
  where: (row: Partial<Record<FeatureId, FeatureValue>>, i: number, n: number) => boolean;
  pWin: number;
  pBase: number;
}

/** A feature table of `n` trades: independent noise columns; R follows `effect` when given, else pure noise. */
export function makeTable(n: number, seed: number, effect?: PlantedEffect, extra?: { num?: readonly FeatureId[]; cat?: readonly FeatureId[] }): FeatureTable {
  const r = rng(seed);
  const numIds = extra?.num ?? NOISE_NUM;
  const catIds = extra?.cat ?? NOISE_CAT;
  const cols: Partial<Record<FeatureId, FeatureValue[]>> = {};
  for (const f of numIds) cols[f] = [];
  for (const f of catIds) cols[f] = [];
  const trades: DiscoveryTrade[] = [];
  const rs: number[] = [];
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < n; i++) {
    const row: Partial<Record<FeatureId, FeatureValue>> = {};
    for (const f of numIds) row[f] = r() * 10;
    for (const f of catIds) {
      const lv = LEVELS[f] ?? ["x", "y", "z"];
      row[f] = lv[Math.floor(r() * lv.length)]!;
    }
    let rv: number;
    if (effect) {
      const p = effect.where(row, i, n) ? effect.pWin : effect.pBase;
      rv = r() < p ? 1 + r() * 1.5 : -1;
    } else rv = noiseR(r);
    for (const f of [...numIds, ...catIds]) cols[f]!.push(row[f]!);
    trades.push({ id: `s${i}`, entryTime: t0 + i * 3_600_000, exitTime: t0 + i * 3_600_000 + 1_800_000, side: row.side === "Short" ? "short" : "long", r: rv });
    rs.push(rv);
  }
  return { trades, r: Float64Array.from(rs), cols, droppedNoR: 0, droppedCap: 0, empty: [] };
}

/**
 * Trades on candles: one entry every `gap` candles (random side); the outcome follows `effect` evaluated on the REAL features
 * of the signal candle (`barFeatures`), or pure noise.
 */
export function tradesOnBars(bars: readonly Bar[], seed: number, opts: { gap?: number; effect?: PlantedEffect; sec?: number } = {}): DiscoveryTrade[] {
  const r = rng(seed);
  const sec = opts.sec ?? 3600;
  const series = buildSeries({ intervalSec: sec, bars });
  const gap = opts.gap ?? 5;
  const out: DiscoveryTrade[] = [];
  for (let k = 210; k < bars.length - gap; k += gap) {
    const side = r() < 0.5 ? "long" : "short";
    const atS = bars[k]!.t;
    const row = barFeatures(series, k, atS, side) as Partial<Record<FeatureId, FeatureValue>>;
    let rv: number;
    if (opts.effect) {
      const p = opts.effect.where(row, out.length, Infinity) ? opts.effect.pWin : opts.effect.pBase;
      rv = r() < p ? 1 + r() * 1.5 : -1;
    } else rv = noiseR(r);
    out.push({ id: `b${k}`, entryTime: atS * 1000, exitTime: (atS + gap * sec * 0.6) * 1000, side, r: rv });
  }
  return out;
}

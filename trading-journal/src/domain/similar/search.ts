/**
 * `findSimilar(candles, tf, now, cfg?)` – the situations of the loaded period that look like the current one, and what
 * happened after each. Pure and deterministic (same candles → same hits, ties broken by recency).
 *
 * - **Closed candles only.** The forming candle is not read at all: not as the current situation, not as a candidate, not
 *   in a course.
 * - **No look-ahead in the description.** A candle's feature values use candles up to itself (`features.ts`). The course
 *   after a hit is what is MEASURED, never part of what is matched.
 * - **Complete courses only.** A candidate needs `horizon` closed candles after it, so every hit has its full outcome; the
 *   newest `horizon` candles (the current situation's own neighbourhood) are never hits.
 * - **No overlapping hits.** Chosen nearest first; a candidate closer than `max(minGap, horizon)` candles to a chosen hit
 *   is skipped, so two hits never share a course (one move is not counted twice).
 */
import { closedCandles } from "../trendlines/analyze";
import { distance, featureBlockedReason, featureSeries, firstValidIndex, valuesAt, type FeatureTable } from "./features";
import { baselineOf, summarize } from "./stats";
import { DEFAULT_SIMILAR_CFG, FEATURE_IDS, MIN_HITS, type DroppedFeature, type FeatureId, type Outcome, type SimCandle, type SimUnit, type SimilarCfg, type SimilarHit, type SimilarResult, type SimilarTf } from "./types";

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** The config with every field in range (unknown features dropped and ordered, numbers clamped to sane limits). */
export function sanitizeCfg(raw?: Partial<SimilarCfg> | null): SimilarCfg {
  const d = DEFAULT_SIMILAR_CFG;
  const r = raw ?? {};
  const want = new Set(Array.isArray(r.features) ? r.features : d.features);
  const int = (v: unknown, lo: number, hi: number, fb: number): number => (fin(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fb);
  const horizon = int(r.horizon, 1, 200, d.horizon);
  return {
    features: FEATURE_IDS.filter((f) => want.has(f)),
    horizon,
    unit: r.unit === "pct" ? "pct" : "r",
    maxHits: int(r.maxHits, 1, 200, d.maxHits),
    maxDistance: fin(r.maxDistance) && r.maxDistance > 0 ? Math.min(5, r.maxDistance) : d.maxDistance,
    minGap: Math.max(horizon, int(r.minGap, 1, 400, d.minGap)),
    lens: { ...d.lens, ...(r.lens ?? {}) },
  };
}

/**
 * The real course after candle `j`: highest high / lowest low in the next `horizon` candles, the close after them, the
 * direction, and which of ±1 unit was touched first. Needs candles `j + 1 … j + horizon`; `null` if they are not there or
 * the unit cannot be formed (R without an ATR, % without a price).
 */
export function outcomeAt(closed: readonly SimCandle[], j: number, horizon: number, unit: SimUnit, atr: number | null): Outcome | null {
  const ref = closed[j]?.close;
  if (!fin(ref) || ref <= 0 || horizon < 1 || j < 0 || j + horizon > closed.length - 1) return null;
  const size = unit === "r" ? atr : ref / 100;
  if (!fin(size) || size <= 0) return null;
  let hi = -Infinity;
  let lo = Infinity;
  let first: Outcome["first"] = "none";
  let firstBars: number | null = null;
  for (let k = 1; k <= horizon; k++) {
    const c = closed[j + k]!;
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
    if (first === "none") {
      const up = c.high - ref >= size;
      const down = ref - c.low >= size;
      if (up && down) first = "both";
      else if (up || down) {
        first = up ? "up" : "down";
        firstBars = k;
      }
    }
  }
  const last = closed[j + horizon]!.close;
  const move = last - ref;
  return {
    up: Math.max(0, hi - ref) / size,
    down: Math.max(0, ref - lo) / size,
    change: move / size,
    dir: move > 0 ? "up" : move < 0 ? "down" : "flat",
    first,
    firstBars,
    ref,
    last,
    size,
  };
}

/**
 * The hits among the candidates: nearest first (ties: the more recent), a candidate beyond `maxDistance` ends the list, one
 * closer than `minGap` candles to an already chosen hit is skipped (no two hits share a course), at most `maxHits`.
 */
export function pickHits<T extends { j: number; d: number }>(cands: readonly T[], cfg: Pick<SimilarCfg, "maxHits" | "maxDistance" | "minGap">): T[] {
  const ordered = [...cands].sort((a, b) => a.d - b.d || b.j - a.j);
  const chosen: T[] = [];
  for (const c of ordered) {
    if (chosen.length >= cfg.maxHits || c.d > cfg.maxDistance) break;
    if (chosen.every((h) => Math.abs(h.j - c.j) >= cfg.minGap)) chosen.push(c);
  }
  return chosen;
}

/** Greatest first valid index over the active features (the earliest candle that can be described at all). */
function firstDescribable(ids: readonly FeatureId[], cfg: SimilarCfg): number {
  let m = 0;
  for (const id of ids) m = Math.max(m, firstValidIndex(id, cfg.lens));
  return m;
}

function emptyResult(tf: SimilarTf, cfg: SimilarCfg, status: SimilarResult["status"], bars: number, need: number, extra: Partial<SimilarResult> = {}): SimilarResult {
  return { status, tf, cfg, bars, need, asOf: null, features: [], dropped: [], query: null, candidates: 0, hits: [], summary: null, baseline: null, ...extra };
}

export function findSimilar(candles: readonly SimCandle[], tf: SimilarTf, now: number, rawCfg?: Partial<SimilarCfg> | null): SimilarResult {
  const cfg = sanitizeCfg(rawCfg);
  const closed = closedCandles(candles, tf, now);
  const dropped: DroppedFeature[] = [];
  const usable: FeatureId[] = [];
  for (const id of cfg.features) {
    const why = featureBlockedReason(id, tf);
    if (why) dropped.push({ id, reason: why });
    else usable.push(id);
  }
  const bars = closed.length;
  const q = bars - 1;
  if (!usable.length) return emptyResult(tf, cfg, "noFeatures", bars, 0, { dropped });
  const { table, atr } = featureSeries(closed, cfg.lens);
  // features the CURRENT candle cannot be described by are dropped – and named, not silently ignored
  const features: FeatureId[] = [];
  if (q >= 0) {
    for (const id of usable) {
      if (fin(table[id][q])) features.push(id);
      else dropped.push({ id, reason: q < firstValidIndex(id, cfg.lens) ? `Zu wenig Vorlauf (${q + 1} von ${firstValidIndex(id, cfg.lens) + 1} Kerzen).` : "Für die aktuelle Kerze nicht berechenbar (fehlende Werte)." });
    }
  }
  const need = firstDescribable(usable, cfg) + cfg.horizon + 2;
  if (!features.length || bars < 2) return emptyResult(tf, cfg, features.length ? "noCandles" : "noFeatures", bars, need, { dropped, asOf: bars ? closed[q]!.time : null });
  const query = { index: q, time: closed[q]!.time, close: closed[q]!.close, values: valuesAt(table, q, features) };
  const base = { asOf: query.time, features, dropped, query };
  const last = q - cfg.horizon;
  if (last < 0) return emptyResult(tf, cfg, "noCandles", bars, need, base);

  // candidates: complete course, every active feature known
  const eligible: { j: number; d: number; out: Outcome }[] = [];
  for (let j = firstDescribable(features, cfg); j <= last; j++) {
    const d = distance(valuesAt(table, j, features), query.values, features);
    const out = d == null ? null : outcomeAt(closed, j, cfg.horizon, cfg.unit, atr[j] ?? null);
    if (d != null && out) eligible.push({ j, d, out });
  }
  if (!eligible.length) return emptyResult(tf, cfg, "few", bars, need, { ...base, candidates: 0 });

  const chosen = pickHits(eligible, cfg);
  const hits: SimilarHit[] = chosen.map((c) => ({
    index: c.j,
    time: closed[c.j]!.time,
    distance: c.d,
    values: valuesAt(table, c.j, features),
    outcome: c.out,
  }));
  const baseline = baselineOf(eligible.map((c) => c.out));
  const judged = hits.length >= MIN_HITS;
  return {
    status: judged ? "ok" : "few",
    tf,
    cfg,
    bars,
    need,
    ...base,
    candidates: eligible.length,
    hits,
    summary: judged ? summarize(hits) : null,
    baseline,
  };
}

export type { FeatureTable };

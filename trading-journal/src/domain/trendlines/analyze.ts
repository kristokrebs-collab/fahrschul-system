/**
 * `analyzeTrendlines(candles, tf, now)` – the structure of ONE timeframe: the price lines (through pivot highs / lows) and
 * the RSI lines, each with approach, break and retest as separate facts. Pure and deterministic.
 *
 * - **Closed candles only.** A candle counts when the feed says it is closed AND its close time has passed `now`; the
 *   forming candle is not read at all (no pivot, no break, no ATR, no RSI from it).
 * - **Too few candles = no lines**, with the numbers (`status: "few"`, `bars` of `need`) – never a guessed line.
 * - **The timeframe's own candles.** The caller hands in the candles of `tf`; there is no fallback timeframe.
 */
import { rsi as wilderRsi } from "../signals/indicators";
import { atrSeries, type EvalCandle } from "../keylevels/evaluate";
import { KEY_TF_MS } from "../keylevels/types";
import { findLines, lineAt, pickActive, retestOf, sideOf, sortBroken, type EngineCfg, type SeriesInput } from "./engine";
import { DEFAULT_TRENDLINE_CFG, EMPTY_SERIES, type TrendKind, type TrendLine, type TrendLineView, type TrendSeries, type TrendSeriesResult, type TrendSlot, type TrendTf, type TrendlineAnalysis, type TrendlineCfg } from "./types";

const finite = (c: EvalCandle): boolean => Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close);

/** The closed candles of `tf` at `now`, ascending, one per open time. */
export function closedCandles<T extends EvalCandle>(candles: readonly T[], tf: TrendTf, now: number): T[] {
  const ms = KEY_TF_MS[tf];
  const out = candles.filter((c) => finite(c) && c.closed && (c.closeTime ?? c.time + ms - 1) <= now);
  for (let i = 1; i < out.length; i++) {
    if (out[i]!.time <= out[i - 1]!.time) {
      out.sort((a, b) => a.time - b.time);
      return out.filter((c, k) => k === 0 || c.time !== out[k - 1]!.time);
    }
  }
  return out;
}

export const engineCfg = (cfg: TrendlineCfg): EngineCfg => ({ pivotL: cfg.pivotL, pivotR: cfg.pivotR, lookback: cfg.lookback, minGap: cfg.minGap, maxPivots: cfg.maxPivots, retestBars: cfg.retestBars });

export function priceSeries(closed: readonly EvalCandle[], atr: readonly (number | null)[], cfg: TrendlineCfg): SeriesInput {
  const at = (i: number): number => atr[i] ?? 0;
  const k = cfg.price;
  return {
    hi: closed.map((c) => c.high),
    lo: closed.map((c) => c.low),
    close: closed.map((c) => c.close),
    // the ATR is defined from `atrLen + 1` candles: nothing before is paired (no tolerance borrowed from later bars)
    first: cfg.atrLen + 1,
    inner: (i) => k.inner * at(i),
    brk: (i) => k.brk * at(i),
    touch: (i) => k.touch * at(i),
    retest: (i) => k.retest * at(i),
    minSlope: (i) => k.minSlope * at(i),
    scale: (i) => Math.max(1e-9, 2 * at(i)),
    plausible: (v) => Number.isFinite(v) && v > 0,
  };
}

export function rsiSeries(r: readonly number[], cfg: TrendlineCfg): SeriesInput {
  const k = cfg.rsi;
  return {
    hi: r,
    lo: r,
    close: r,
    first: 0,
    inner: () => k.inner,
    brk: () => k.brk,
    touch: () => k.touch,
    retest: () => k.retest,
    minSlope: () => k.minSlope,
    scale: () => 10,
    plausible: (v) => Number.isFinite(v) && v >= 3 && v <= 97,
  };
}

interface Ctx {
  tf: TrendTf;
  series: TrendSeries;
  closed: readonly EvalCandle[];
  inp: SeriesInput;
  cfg: TrendlineCfg;
  atr: number | null;
}

function view(c: Ctx, line: TrendLine, broken: boolean): TrendLineView {
  const n = c.inp.close.length;
  const last = c.inp.close[n - 1]!;
  const sgn = sideOf(line.kind);
  const value = lineAt(line, n - 1);
  const dist = sgn * (value - last);
  const price = c.series === "price";
  const near = price ? c.cfg.price.approach * (c.atr ?? 0) : c.cfg.rsi.approach;
  const age = line.brokeAt == null ? 0 : n - 1 - line.brokeAt;
  return {
    series: c.series,
    kind: line.kind,
    tf: c.tf,
    a: line.a,
    b: line.b,
    aTime: c.closed[line.a.i]!.time,
    bTime: c.closed[line.b.i]!.time,
    confirmedTime: c.closed[line.confirmedAt]!.time,
    brokeTime: line.brokeAt == null ? null : c.closed[line.brokeAt]!.time,
    slope: line.slope,
    touches: line.touches,
    value,
    last,
    dist,
    distPct: price && last > 0 ? (dist / last) * 100 : null,
    distAtr: price && c.atr != null && c.atr > 0 ? dist / c.atr : null,
    approach: !broken && dist <= near,
    brk: broken && line.brokeAt != null ? { at: line.brokeAt, age, fresh: age <= c.cfg.maxAge } : null,
    retest: broken ? retestOf(c.inp, line, engineCfg(c.cfg)) : null,
    lastIndex: n - 1,
  };
}

function slotOf(c: Ctx, kind: TrendKind): TrendSlot {
  const lines = findLines(c.inp, kind, engineCfg(c.cfg));
  const n = c.inp.close.length;
  const active = pickActive(lines, c.inp);
  const recent = sortBroken(lines, c.inp).find((l) => n - 1 - (l.brokeAt as number) <= c.cfg.keepBars) ?? null;
  return { active: active ? view(c, active, false) : null, broken: recent ? view(c, recent, true) : null };
}

function seriesOf(c: Ctx): TrendSeriesResult {
  return { down: slotOf(c, "down"), up: slotOf(c, "up") };
}

/** Price and RSI lines of the closed candles of `tf` as of `now`. */
export function analyzeTrendlines(candles: readonly EvalCandle[], tf: TrendTf, now: number, cfg: TrendlineCfg = DEFAULT_TRENDLINE_CFG): TrendlineAnalysis {
  const closed = closedCandles(candles, tf, now);
  const n = closed.length;
  const need = Math.max(cfg.minBars, cfg.atrLen + cfg.pivotL + cfg.pivotR + cfg.minGap);
  const newest = closed[n - 1] ?? null;
  const base = { tf, bars: n, need, asOf: newest ? newest.time : null, close: newest ? newest.close : null };
  if (n < need) return { ...base, status: "few", atr: null, rsiLast: null, price: EMPTY_SERIES, rsi: EMPTY_SERIES };
  const atrs = atrSeries(closed, cfg.atrLen);
  const atr = atrs[n - 1] ?? null;
  const r = wilderRsi(
    closed.map((c) => c.close),
    cfg.rsi.len,
  );
  const rsiLast = Number.isFinite(r[n - 1]) ? r[n - 1]! : null;
  const price = seriesOf({ tf, series: "price", closed, inp: priceSeries(closed, atrs, cfg), cfg, atr });
  const rsi = rsiLast == null ? EMPTY_SERIES : seriesOf({ tf, series: "rsi", closed, inp: rsiSeries(r, cfg), cfg, atr });
  return { ...base, status: "ok", atr, rsiLast, price, rsi };
}

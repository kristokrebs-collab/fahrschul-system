/**
 * Divergences (ours, decision 10, 2026-10-08; reworked after the TradingView check of 2026-10-08 13:30 UTC, decision 17):
 * regular and hidden, bullish and bearish, of RSI 14 and WaveTrend wt1 against price, per ladder timeframe — read the way
 * a trader reads them on the chart, plus the RSI trendline break.
 *
 * - Pivot (fractal) on the oscillator: lower (higher) than the `left` bars before it and not above (below) the `right`
 *   bars after it; it is confirmed `right` bars later (the confirmation bar). Default 5 / 2: the 5 bars on the left
 *   drop the minor wiggles (the 2 / 2 fractal found pivots every few bars and compared the wrong pair), the 2 on the
 *   right keep the confirmation short.
 * - The new pivot is compared with EVERY earlier pivot of the same kind `rangeMin` … `rangeMax` bars before it (that
 *   passed the same `midline` filter — bullish pivots below the midline, wt1 < 0 / RSI < 50, bearish above), not only
 *   with the previous one; the oscillator line between the two must be clean (no value between them under the line for
 *   a bullish pair, over it for a bearish one), and the most significant partner wins: regular → the lowest (bearish:
 *   highest) oscillator value, hidden → the lowest (highest) price. One divergence per pivot, regular before hidden.
 *   - regular bullish: price lower low (bar low), oscillator higher low → reversal up;
 *   - hidden bullish: price higher low, oscillator lower low → continuation up;
 *   - regular bearish: price higher high, oscillator lower high; hidden bearish: price lower high, oscillator higher high.
 * - Live tail (the last bar is the forming candle): a pivot whose `right` bars are not all there yet — down to the
 *   newest bar itself (right 0: its value is the lowest of the last `left` bars and nothing after it is lower) — is a
 *   candidate already: state `provisional` (counts ½), confirmed once `right` bars after it have closed.
 * - State: `provisional` while the confirmation bar is the forming candle (or not there yet), `confirmed` after its close,
 *   `strong` after `strongCloses` closes (counting the confirmation bar's own close) with the pivot held (bullish: no later
 *   close below the pivot bar's low; bearish: none above its high).
 * - Active (counts in the check) = "until invalidated": held, and confirmed at most `maxAge` bars ago — `maxAge` 0 (the
 *   default) = no own limit, only the cap of `rangeMax` bars. A broken pivot ends the divergence at that close.
 *
 * RSI trendline break (`trendline`, user decision 17): the falling RSI trendline through the last two RSI pivot highs
 * (the newer one lower, the line clean in between) broken when the RSI closes ABOVE it → bullish; the rising line through
 * the last two pivot lows broken downward → bearish. A break on the forming candle is `provisional`; it stays active for
 * `TREND_BREAK_BARS` bars unless the RSI closes back across the line.
 *
 * Pure; the chart draws `from` → `to` on price (`price`) and in the oscillator pane (`osc`).
 */
import type { DivCfg } from "./config";
import type { Bar } from "./indicators";
import type { SignalState } from "./state";

export type DivOsc = "rsi" | "wt";
export type DivKind = "regular" | "hidden";

export interface DivPivot {
  /** bar index in the evaluated series */
  index: number;
  /** open time of the bar, unix SECONDS */
  t: number;
  /** bar low (bullish) / high (bearish) */
  price: number;
  /** oscillator value at the pivot */
  osc: number;
}

export interface Divergence {
  osc: DivOsc;
  kind: DivKind;
  /** 1 bullish, −1 bearish */
  dir: 1 | -1;
  /** the earlier and the newer pivot (chart line) */
  from: DivPivot;
  to: DivPivot;
  /** index of the confirmation bar (`to.index + right`; the newest bar for a live candidate whose bars are not all there yet) */
  at: number;
  /** bars since the confirmation bar (0 = the newest bar) */
  barsAgo: number;
  state: SignalState;
  /** the pivot held since (bullish: no close below its low) */
  held: boolean;
  /** counts in the check: held and confirmed at most `maxAge` (0: `rangeMax`) bars ago */
  active: boolean;
}

/** RSI trendline break of one direction (`dir` 1 = the falling line broken upward). */
export interface TrendBreak {
  osc: "rsi";
  dir: 1 | -1;
  /** the two RSI pivots the line runs through (bar high for the falling line, bar low for the rising one) */
  from: DivPivot;
  to: DivPivot;
  /** bar that crossed the line (its close, or the live value on the forming candle) */
  index: number;
  /** open time of that bar, unix SECONDS */
  t: number;
  /** RSI there and the line's value there */
  value: number;
  line: number;
  /** bar from which the break is known (`max(index, to.index + right)`) */
  at: number;
  barsAgo: number;
  /** `provisional` while only the forming candle is across the line, else `confirmed` */
  state: SignalState;
  /** recent (≤ `TREND_BREAK_BARS`) and the RSI did not close back across the line */
  active: boolean;
}

export interface TfDivergences {
  /** every divergence of the evaluated window, oldest first (chart lines) */
  all: Divergence[];
  /** active bullish / bearish ones, newest first */
  long: Divergence[];
  short: Divergence[];
  /** active RSI trendline breaks per direction (when `trendline` is on); absent on hand-built input */
  trend?: { long: TrendBreak | null; short: TrendBreak | null };
}

/** Oscillator midline per kind (the `midline` filter). */
export const DIV_MIDLINE: Readonly<Record<DivOsc, number>> = { rsi: 50, wt: 0 };

/** A trendline break counts this many bars after it is known (unless the RSI closes back across the line). */
export const TREND_BREAK_BARS = 10;

/** Bars a held divergence stays active after its confirmation: `maxAge`, or `rangeMax` for 0 ("bis zum Bruch"). */
export const divActiveBars = (cfg: Pick<DivCfg, "maxAge" | "rangeMax">): number => (cfg.maxAge > 0 ? Math.min(cfg.maxAge, cfg.rangeMax) : cfg.rangeMax);

/** Is `x[i]` a pivot with `left` bars before and the `right` bars after it (fewer at the end of the series)? */
function isPivot(x: readonly number[], i: number, left: number, right: number, low: boolean): boolean {
  const v = x[i]!;
  if (!Number.isFinite(v) || i - left < 0) return false;
  for (let k = i - left; k < i; k++) {
    const y = x[k]!;
    if (!Number.isFinite(y) || (low ? !(v < y) : !(v > y))) return false;
  }
  for (let k = i + 1; k <= i + right; k++) {
    const y = x[k]!;
    if (!Number.isFinite(y) || (low ? !(v <= y) : !(v >= y))) return false;
  }
  return true;
}

/** No value strictly between `a` and `b` on the wrong side of the line `a → b` (below it for lows, above for highs). */
function cleanLine(x: readonly number[], a: number, b: number, low: boolean): boolean {
  const xa = x[a]!;
  const slope = (x[b]! - xa) / (b - a);
  for (let k = a + 1; k < b; k++) {
    const y = x[k]!;
    const line = xa + slope * (k - a);
    if (!Number.isFinite(y) || (low ? y < line - 1e-9 : y > line + 1e-9)) return false;
  }
  return true;
}

/**
 * Best earlier partner of pivot `p` among `pivots` (oldest first): regular before hidden; regular → the most extreme
 * oscillator value (lowest for lows), hidden → the most extreme price; nearest on a tie. `null` = no divergence.
 */
function partnerOf(bars: readonly Bar[], x: readonly number[], pivots: readonly number[], p: number, low: boolean, cfg: Pick<DivCfg, "rangeMin" | "rangeMax" | "hidden">): { q: number; kind: DivKind } | null {
  const pb = low ? bars[p]!.l : bars[p]!.h;
  const v = x[p]!;
  let reg = -1;
  let hid = -1;
  for (let j = pivots.length - 1; j >= 0; j--) {
    const q = pivots[j]!;
    const gap = p - q;
    if (gap < cfg.rangeMin) continue;
    if (gap > cfg.rangeMax) break;
    const pa = low ? bars[q]!.l : bars[q]!.h;
    const oa = x[q]!;
    const regular = low ? pb < pa && v > oa : pb > pa && v < oa;
    const hidden = cfg.hidden && (low ? pb > pa && v < oa : pb < pa && v > oa);
    if (regular) {
      const better = reg < 0 || (low ? oa < x[reg]! : oa > x[reg]!);
      if (better && cleanLine(x, q, p, low)) reg = q;
    } else if (hidden && reg < 0) {
      const ph = hid < 0 ? NaN : low ? bars[hid]!.l : bars[hid]!.h;
      const better = hid < 0 || (low ? pa < ph : pa > ph);
      if (better && cleanLine(x, q, p, low)) hid = q;
    }
  }
  if (reg >= 0) return { q: reg, kind: "regular" };
  if (hid >= 0) return { q: hid, kind: "hidden" };
  return null;
}

/**
 * Divergences of one oscillator against price. `forming` = the last bar is the running candle (then the newest pivots
 * are candidates before their `right` bars are there); `strongCloses` as in `state.ts`. Oldest first.
 */
export function findDivergences(bars: readonly Bar[], x: readonly number[], osc: DivOsc, cfg: DivCfg, forming: boolean, strongCloses: number): Divergence[] {
  const n = Math.min(bars.length, x.length);
  const out: Divergence[] = [];
  const { left, right } = cfg;
  if (n < left + 2) return out;
  const mid = DIV_MIDLINE[osc];
  const lastClosed = forming ? n - 2 : n - 1;
  const cap = divActiveBars(cfg);
  // suffix extremes of the closed closes (pivot held)
  const minAfter = new Float64Array(n + 1).fill(Infinity);
  const maxAfter = new Float64Array(n + 1).fill(-Infinity);
  for (let i = lastClosed; i >= 0; i--) {
    minAfter[i] = Math.min(minAfter[i + 1]!, bars[i]!.c);
    maxAfter[i] = Math.max(maxAfter[i + 1]!, bars[i]!.c);
  }
  const lows: number[] = [];
  const highs: number[] = [];
  // confirmed pivots up to n − 1 − right; on the live series also the newer candidates (right shrinks to the bars known)
  const lastP = forming ? n - 1 : n - 1 - right;
  for (let p = left; p <= lastP; p++) {
    const r = Math.min(right, n - 1 - p);
    const tail = r < right;
    for (const low of [true, false]) {
      if (!isPivot(x, p, left, r, low)) continue;
      const v = x[p]!;
      if (cfg.midline && (low ? !(v < mid) : !(v > mid))) continue;
      const list = low ? lows : highs;
      const hit = partnerOf(bars, x, list, p, low, cfg);
      if (!tail) list.push(p);
      if (!hit) continue;
      const { q, kind } = hit;
      const pa = low ? bars[q]!.l : bars[q]!.h;
      const pb = low ? bars[p]!.l : bars[p]!.h;
      const at = tail ? n - 1 : p + right;
      const barsAgo = n - 1 - at;
      const provisional = forming && at >= n - 1;
      const held = low ? minAfter[p + 1]! >= pb : maxAfter[p + 1]! <= pb;
      const closes = provisional ? 0 : lastClosed - at + 1;
      const state: SignalState = provisional ? "provisional" : held && closes >= strongCloses ? "strong" : "confirmed";
      out.push({
        osc,
        kind,
        dir: low ? 1 : -1,
        from: { index: q, t: bars[q]!.t, price: pa, osc: x[q]! },
        to: { index: p, t: bars[p]!.t, price: pb, osc: v },
        at,
        barsAgo,
        state,
        held,
        active: held && barsAgo <= cap,
      });
    }
  }
  return out;
}

/**
 * The RSI trendline break of one direction (`dir` 1: the falling line through the last two pivot highs, broken upward;
 * −1: the rising line through the last two pivot lows, broken downward), `null` without a line or a break. The line runs
 * through the newest pair of consecutive confirmed pivots that falls (rises) — a newer higher high after it is the break
 * itself, not a new line — at most `rangeMax` bars apart, with no value between them across the line.
 */
export function rsiTrendBreak(bars: readonly Bar[], x: readonly number[], cfg: Pick<DivCfg, "left" | "right" | "rangeMax">, forming: boolean, dir: 1 | -1): TrendBreak | null {
  const n = Math.min(bars.length, x.length);
  const { left, right } = cfg;
  const high = dir === 1;
  if (n < left + right + 3) return null;
  // confirmed pivots (on every bar known, the forming one included), newest first, back to the line's possible reach
  const piv: number[] = [];
  const from = Math.max(left, n - 1 - right - 3 * cfg.rangeMax);
  for (let p = n - 1 - right; p >= from; p--) if (isPivot(x, p, left, right, !high)) piv.push(p);
  let a = -1;
  let b = -1;
  for (let k = 0; k + 1 < piv.length; k++) {
    const nb = piv[k]!;
    const na = piv[k + 1]!;
    if (nb - na > cfg.rangeMax) break;
    if ((high ? x[na]! > x[nb]! : x[na]! < x[nb]!) && cleanLine(x, na, nb, !high)) {
      a = na;
      b = nb;
      break;
    }
  }
  if (a < 0) return null;
  const slope = (x[b]! - x[a]!) / (b - a);
  const lineAt = (k: number): number => x[b]! + slope * (k - b);
  let j = -1;
  for (let k = b + 1; k < n; k++) {
    const y = x[k]!;
    if (Number.isFinite(y) && (high ? y > lineAt(k) : y < lineAt(k))) {
      j = k;
      break;
    }
  }
  if (j < 0) return null;
  const at = Math.max(j, b + right);
  const barsAgo = n - 1 - at;
  const provisional = forming && j === n - 1;
  // back across the line on a later CLOSE → the break failed
  const lastClosed = forming ? n - 2 : n - 1;
  let failed = false;
  for (let k = j + 1; k <= lastClosed; k++) {
    const y = x[k]!;
    if (Number.isFinite(y) && (high ? y < lineAt(k) : y > lineAt(k))) {
      failed = true;
      break;
    }
  }
  const pv = (i: number): DivPivot => ({ index: i, t: bars[i]!.t, price: high ? bars[i]!.h : bars[i]!.l, osc: x[i]! });
  return {
    osc: "rsi",
    dir,
    from: pv(a),
    to: pv(b),
    index: j,
    t: bars[j]!.t,
    value: x[j]!,
    line: lineAt(j),
    at,
    barsAgo,
    state: provisional ? "provisional" : "confirmed",
    active: !failed && barsAgo <= TREND_BREAK_BARS,
  };
}

/**
 * Both oscillators of one timeframe (per `cfg.rsi` / `cfg.wt`), merged oldest first; active lists newest first; the
 * active RSI trendline breaks (`cfg.trendline`).
 */
export function tfDivergences(bars: readonly Bar[], rsi: readonly number[], wt1: readonly number[], cfg: DivCfg, forming: boolean, strongCloses: number): TfDivergences {
  const all: Divergence[] = [];
  if (cfg.rsi) all.push(...findDivergences(bars, rsi, "rsi", cfg, forming, strongCloses));
  if (cfg.wt) all.push(...findDivergences(bars, wt1, "wt", cfg, forming, strongCloses));
  all.sort((a, b) => a.at - b.at || a.to.index - b.to.index || (a.osc < b.osc ? -1 : a.osc > b.osc ? 1 : 0));
  const act = all.filter((d) => d.active).reverse();
  const out: TfDivergences = { all, long: act.filter((d) => d.dir === 1), short: act.filter((d) => d.dir === -1) };
  if (cfg.trendline !== false) {
    const up = rsiTrendBreak(bars, rsi, cfg, forming, 1);
    const dn = rsiTrendBreak(bars, rsi, cfg, forming, -1);
    out.trend = { long: up?.active ? up : null, short: dn?.active ? dn : null };
  }
  return out;
}

/** Grade of a kind: regular 0.8, hidden 0.5 (× ½ while provisional). */
const hitGrade = (d: Divergence): number => (d.kind === "regular" ? 0.8 : 0.5) * (d.state === "provisional" ? 0.5 : 1);

/** Grade bonus of an active RSI trendline break (× ½ while provisional); alone it is a partial grade. */
export const TREND_BREAK_GRADE = 0.2;

/**
 * Grade 0 … 1 of one timeframe's active divergences of a direction: the best oscillator (regular 0.8, hidden 0.5,
 * provisional ½) + 0.2 when the other oscillator shows one too (regular on RSI and wt1 = 1) + 0.2 for an active RSI
 * trendline break (provisional 0.1; a break alone = 0.2).
 */
export function divGrade(hits: readonly Divergence[], trend?: TrendBreak | null): number {
  let rsi = 0;
  let wt = 0;
  for (const d of hits) {
    const g = hitGrade(d);
    if (d.osc === "rsi") rsi = Math.max(rsi, g);
    else wt = Math.max(wt, g);
  }
  const tl = trend?.active ? TREND_BREAK_GRADE * (trend.state === "provisional" ? 0.5 : 1) : 0;
  return Math.min(1, Math.max(rsi, wt) + (rsi > 0 && wt > 0 ? 0.2 : 0) + tl);
}

/** A closed regular divergence (the divergence part holds fully: +1 strength when weighted). */
export const isFirmRegular = (d: Divergence): boolean => d.kind === "regular" && d.state !== "provisional";

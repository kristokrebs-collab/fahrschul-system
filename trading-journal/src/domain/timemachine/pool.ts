/**
 * The pool of real candles a session is rebuilt from (pure, deterministic).
 *
 * Every candle becomes four RATIOS to the candle before it – open, high, low and close over the previous close (after a hole
 * in the data, or for the first candle, over its own open: a gap is not carried into a simulated session). A simulated
 * candle is the current price times those ratios, so it has the real shape of a real candle at the real size of the price.
 *
 * Volatility by time of day: every candle has a slot (its place inside the UTC day, `floor((t mod 24 h) ÷ candle length)`). A
 * simulated candle at slot s draws from the real candles whose slot lies within ± `radius` of s; the radius grows until the
 * pool holds `MIN_SLOT_BARS` candles (or the whole day). Daily candles have one slot – the pool is simply everything.
 *
 * Volatility now vs. then (`vol: "now"`): a market is calm for weeks and wild for weeks. Every real candle is scaled to TODAY's
 * level – its log-ratios are multiplied by regime(now) ÷ regime(just before that candle), where the regime is the mean candle
 * range over the last full day (so the time-of-day pattern averages out and stays in the pool). A plan whose stop was set in
 * ATR terms is then judged at today's ATR, not at the average of the history. Factors are clamped to ¼ … 4; `history` keeps the
 * candles as they were.
 *
 * The drift of the history: the mean log return per candle. `drift: "zero"` multiplies every ratio by exp(−drift) so a rising
 * (or falling) history does not tilt the odds; `keep` leaves the history as it was.
 */
import { atrSeries, cleanBars } from "../backtest/bars";
import { MIN_SLOT_BARS, TM_SEC, type Bar, type TmInterval } from "./types";

export interface Pool {
  secLen: number;
  slots: number;
  n: number;
  /** ratios to the previous close (own open after a hole) */
  ro: Float64Array;
  rh: Float64Array;
  rl: Float64Array;
  rc: Float64Array;
  /** consecutive candles available from i on, i itself included (≥ 1) */
  run: Int32Array;
  /** candle indices a simulated candle of slot s may copy */
  win: Int32Array[];
  radius: Uint8Array;
  /** mean ln(close ÷ previous close) over consecutive candles – the history's drift per candle */
  drift: number;
  /** the cleaned bars the pool rests on */
  bars: Bar[];
  /** candles dropped as unusable (non-finite, ≤ 0, high < low …) */
  dropped: number;
  /** ATR(14) ÷ close: now (last candle) and the median of the history */
  atrPct: { now: number | null; median: number | null };
  /** `vol: "now"`: the geometric mean and the range of the factors the candles were scaled by; null = not scaled */
  scale: { mean: number; min: number; max: number } | null;
}

/** Candles in the "regime" window: one full day, at least 14. */
const regimeLen = (slots: number): number => Math.max(14, slots);
const SCALE_MIN = 0.25;
const SCALE_MAX = 4;

/** Slot of an open time in seconds. */
export const slotOf = (tSec: number, secLen: number, slots: number): number => (slots <= 1 ? 0 : Math.floor((((tSec % 86_400) + 86_400) % 86_400) / secLen) % slots);

export function slotsPerDay(secLen: number): number {
  return secLen >= 86_400 ? 1 : Math.max(1, Math.round(86_400 / secLen));
}

const usable = (b: Bar): boolean => b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0 && b.h >= Math.max(b.o, b.c) - 1e-12 * b.h && b.l <= Math.min(b.o, b.c) + 1e-12 * b.h;

export function buildPool(input: readonly Bar[], interval: TmInterval, drift: "keep" | "zero", vol: "now" | "history" = "history"): Pool {
  const secLen = TM_SEC[interval];
  const cleaned = cleanBars(input);
  const bars = cleaned.filter(usable);
  const n = bars.length;
  const slots = slotsPerDay(secLen);
  const ro = new Float64Array(n);
  const rh = new Float64Array(n);
  const rl = new Float64Array(n);
  const rc = new Float64Array(n);
  const contiguous = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    const prev = i > 0 ? bars[i - 1]! : null;
    const joined = prev != null && b.t - prev.t === secLen;
    contiguous[i] = joined ? 1 : 0;
    const base = joined ? prev!.c : b.o;
    ro[i] = b.o / base;
    rh[i] = b.h / base;
    rl[i] = b.l / base;
    rc[i] = b.c / base;
  }
  // today's volatility: every candle's log-ratios times regime(now) ÷ regime(before it)
  let scale: Pool["scale"] = null;
  if (vol === "now" && n > 2) {
    const L = regimeLen(slots);
    const rg = bars.map((b) => (b.h - b.l) / b.c);
    const regime = new Float64Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += rg[i]!;
      if (i >= L) acc -= rg[i - L]!;
      regime[i] = acc / Math.min(i + 1, L);
    }
    const now = regime[n - 1]!;
    if (now > 0) {
      let sumLog = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < n; i++) {
        const before = regime[Math.max(Math.min(L, n) - 1, i - 1)]!;
        const f = before > 0 ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, now / before)) : 1;
        ro[i] = Math.exp(f * Math.log(ro[i]!));
        rh[i] = Math.exp(f * Math.log(rh[i]!));
        rl[i] = Math.exp(f * Math.log(rl[i]!));
        rc[i] = Math.exp(f * Math.log(rc[i]!));
        sumLog += Math.log(f);
        lo = Math.min(lo, f);
        hi = Math.max(hi, f);
      }
      scale = { mean: Math.exp(sumLog / n), min: lo, max: hi };
    }
  }
  let sumLn = 0;
  let nLn = 0;
  for (let i = 0; i < n; i++) {
    if (contiguous[i]) {
      sumLn += Math.log(rc[i]!);
      nLn++;
    }
  }
  const mu = nLn ? sumLn / nLn : 0;
  if (drift === "zero" && mu !== 0) {
    const f = Math.exp(-mu);
    for (let i = 0; i < n; i++) {
      ro[i] = ro[i]! * f;
      rh[i] = rh[i]! * f;
      rl[i] = rl[i]! * f;
      rc[i] = rc[i]! * f;
    }
  }
  const run = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) run[i] = i + 1 < n && contiguous[i + 1] ? run[i + 1]! + 1 : 1;
  // time-of-day pools
  const bySlot: number[][] = Array.from({ length: slots }, () => []);
  for (let i = 0; i < n; i++) bySlot[slotOf(bars[i]!.t, secLen, slots)]!.push(i);
  const maxR = Math.floor(slots / 2);
  const startR = slots >= 24 ? 2 : 0;
  const win: Int32Array[] = [];
  const radius = new Uint8Array(slots);
  const everything = Int32Array.from(bars, (_, i) => i);
  for (let s = 0; s < slots; s++) {
    let r = Math.min(startR, maxR);
    let idx: number[] = [];
    // widen the window until it holds enough candles; a window that spans the whole day is simply every candle (and must not
    // count a slot twice)
    while (2 * r + 1 < slots) {
      idx = [];
      for (let d = -r; d <= r; d++) idx.push(...bySlot[(((s + d) % slots) + slots) % slots]!);
      if (idx.length >= MIN_SLOT_BARS || r >= maxR) break;
      r++;
    }
    const whole = 2 * r + 1 >= slots;
    win.push(whole ? everything : Int32Array.from(idx.sort((a, b) => a - b)));
    radius[s] = Math.min(r, 255);
  }
  // volatility now vs. the history (ATR% of the last candle against the median ATR% of the pool)
  const atr = atrSeries(bars);
  const pcts: number[] = [];
  for (let i = 14; i < n; i++) if (atr[i]! > 0) pcts.push(atr[i]! / bars[i]!.c);
  pcts.sort((a, b) => a - b);
  const median = pcts.length ? pcts[(pcts.length - 1) >> 1]! : null;
  const now = n > 14 && atr[n - 1]! > 0 ? atr[n - 1]! / bars[n - 1]!.c : null;
  return { secLen, slots, n, ro, rh, rl, rc, run, win, radius, drift: mu, bars, dropped: input.length - n, atrPct: { now, median }, scale };
}

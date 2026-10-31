/**
 * The signal of ONE industry – a port of `signal_pass` of the lab script (`megatest.py`), line by line:
 *
 *   price      = running product of (1 + return); a missing return counts as 0 in the price
 *   upper      = max( highest price of the last `up` days , EMA(price, up)   + kelt × mean |Δprice| of the last `up` days )
 *   lower      = min( lowest  price of the last `down` days, EMA(price, down) − kelt × mean |Δprice| of the last `down` days )
 *   in         when price ≥ YESTERDAY's upper channel (and yesterday's upper is above yesterday's lower)  → grün
 *   stop       = the lower channel at entry, then only ever raised (max of the stop and today's lower)
 *   out        when price ≤ stop  → rot (cash)
 *   a missing return, the first day, or an undefined channel yesterday → no position
 *
 * The weight of a position that is in is `1 / (σ × √252)` of the last `up` daily returns (population σ), times the target
 * volatility, and all weights are scaled down together when they sum to more than the leverage cap (`weights`).
 *
 * Pure. A rule-based look BACK at past prices: no forecast, and the entry is taken from the CLOSE of the day the channel broke.
 */
import { TRADING_DAYS, type TrendParams } from "./config";
import { ema, rollExtreme, rollMeanChange, rollStd0 } from "./indicators";

const SQ = Math.sqrt(TRADING_DAYS);

export interface SignalRun {
  /** 1 = long (grün), 0 = cash (rot), per day */
  exposure: Uint8Array;
  /** `1 / (σ × √252)` on the last day when the industry is in and σ > 0, else 0 */
  unitLast: number;
}

/**
 * @param returns daily returns as fractions (`0.0056`), `NaN` where the library has no value
 */
export function runSignal(returns: ArrayLike<number>, p: Pick<TrendParams, "up" | "down" | "kelt">): SignalRun {
  const T = returns.length;
  const exposure = new Uint8Array(T);
  if (T === 0) return { exposure, unitLast: 0 };

  const clean = new Float64Array(T);
  const price = new Float64Array(T);
  let acc = 1;
  for (let t = 0; t < T; t++) {
    const r = returns[t]!;
    clean[t] = Number.isNaN(r) ? 0 : r;
    acc *= 1 + clean[t]!;
    price[t] = acc;
  }
  const chg = new Float64Array(T);
  chg[0] = NaN;
  for (let t = 1; t < T; t++) chg[t] = Math.abs(price[t]! - price[t - 1]!);

  const eu = ema(price, p.up);
  const mu = rollMeanChange(chg, p.up);
  const dmax = rollExtreme(price, p.up, true);
  const vol = rollStd0(clean, p.up);
  const ed = ema(price, p.down);
  const md = rollMeanChange(chg, p.down);
  const dmin = rollExtreme(price, p.down, false);

  let on = 0;
  let stop = NaN;
  let prevUp = NaN;
  let prevLo = NaN;
  for (let t = 0; t < T; t++) {
    const upper = Number.isNaN(dmax[t]!) || Number.isNaN(mu[t]!) ? NaN : Math.max(dmax[t]!, eu[t]! + p.kelt * mu[t]!);
    const lower = Number.isNaN(dmin[t]!) || Number.isNaN(md[t]!) ? NaN : Math.min(dmin[t]!, ed[t]! - p.kelt * md[t]!);
    if (Number.isNaN(returns[t]!) || t === 0 || Number.isNaN(prevUp) || Number.isNaN(prevLo)) {
      on = 0;
    } else if (on === 1) {
      if (!Number.isNaN(lower)) stop = Number.isNaN(stop) ? lower : Math.max(stop, lower);
      if (price[t]! <= stop) on = 0;
    } else if (price[t]! >= prevUp && prevUp > prevLo) {
      on = 1;
      stop = lower;
    }
    exposure[t] = on;
    prevUp = upper;
    prevLo = lower;
  }
  const last = T - 1;
  const unitLast = exposure[last] === 1 && vol[last]! > 0 ? 1 / (vol[last]! * SQ) : 0;
  return { exposure, unitLast };
}

/** Index of the last day on which `exposure` differs from the day before, `null` when it never changed. */
export function lastChangeIndex(exposure: ArrayLike<number>): number | null {
  for (let t = exposure.length - 1; t >= 1; t--) if (exposure[t] !== exposure[t - 1]) return t;
  return null;
}

/**
 * Target weights of the industries that are in: `tv × unit`, all scaled by the same factor when their sum is above the
 * leverage cap (the cap of `portfolio()` in the script).
 */
export function weights(units: readonly number[], tv: number, lev: number): { w: number[]; sum: number; capped: boolean } {
  const raw = units.map((u) => (u > 0 ? tv * u : 0));
  const total = raw.reduce((a, b) => a + b, 0);
  if (total > lev) {
    const f = lev / total;
    return { w: raw.map((x) => x * f), sum: lev, capped: true };
  }
  return { w: raw, sum: total, capped: false };
}

/**
 * Deterministic synthetic market for e2e specs that need a KNOWN Einstiegs-Check result (pure, no Playwright).
 *
 * - `synthPrice(t, anchor)`: one continuous BTC price path over absolute time. Long history oscillates around
 *   ~96k, the last three days fall steadily to a fresh low ~83.2k 45 min before `anchor`, then the price turns up to
 *   ~84.2k (the WS fixtures' live price) and stays flat after `anchor`. Every interval is built from this one path,
 *   so 15m / 1h / 4h klines agree with each other the way real exchange candles do and the 30m / 45m resampling sees
 *   aligned buckets (open times are multiples of the interval, like Binance).
 * - `synthKlines(interval, q, anchor)`: Binance `/fapi/v1/klines` rows for a request (`limit`, `startTime`, `endTime`).
 * - `synthRatios(kind, period, q)`: Binance `/futures/data/*LongShort*Ratio` rows aligned to period boundaries. The
 *   `whale-long` script makes the top traders BUY (position long % up) while retail is RED (all-accounts long % down)
 *   over the last four closed periods of every period — "Top-Trader kaufen · Retail rot" holds with a run of 4.
 */
export const SYNTH_INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Price at the end of the decline (the fresh low) and at the anchor (after the turn). */
export const SYNTH_LOW = 82_900;
export const SYNTH_LAST = 84_200;
const HIGH = 96_500;
const FALL_MS = 3 * DAY;
const TURN_MS = 12 * MIN;
const DROP_MS = 8 * HOUR;
/** relative height of the capitulation above the low */
const DROP = 0.05;

/** Small deterministic wiggle (sum of incommensurate sines), relative amplitude ≈ ±0.25 %. */
function wiggle(t: number): number {
  const h = t / HOUR;
  return 0.0012 * Math.sin(h * 1.7) + 0.0008 * Math.sin(h * 0.53 + 1.3) + 0.0005 * Math.sin(h * 4.1 + 0.4);
}

/** The price at absolute time `t` (ms) for a market anchored at `anchor` (ms, "now" of the mock). */
export function synthPrice(t: number, anchor: number): number {
  const before = anchor - t;
  if (before <= 0) return SYNTH_LAST;
  if (before <= TURN_MS) {
    // the turn: from the low back up to the live price (eased out: the newest minutes are flat at the live price)
    const k = 1 - before / TURN_MS;
    return SYNTH_LOW + (SYNTH_LAST - SYNTH_LOW) * (1 - (1 - k) * (1 - k));
  }
  if (before <= TURN_MS + DROP_MS) {
    // the capitulation: the last hours fall faster and faster into the low (every timeframe deeply oversold)
    const k = (before - TURN_MS) / DROP_MS; // 1 at the start of the drop, 0 at the low
    return SYNTH_LOW * (1 + DROP * (2 * k - k * k));
  }
  if (before <= TURN_MS + DROP_MS + FALL_MS) {
    // the fall: a steady decline over days (monotone, so the RSI sits near its floor)
    const k = (before - TURN_MS - DROP_MS) / FALL_MS;
    return SYNTH_LOW * (1 + DROP) + (HIGH - SYNTH_LOW * (1 + DROP)) * k;
  }
  // history: a slow swing around the high (weeks), plus a small wiggle
  const d = (before - TURN_MS - DROP_MS - FALL_MS) / DAY;
  return HIGH * (1 + 0.04 * Math.sin(d / 9) - 0.02 * Math.sin(d / 23 + 0.7) + wiggle(t));
}

export interface RangeQuery {
  limit?: number;
  startTime?: number;
  endTime?: number;
}

type KlineRow = [number, string, string, string, string, string, number, string, number, string, string, string];

/** One kline of `[open, open + step)` sampled at 1-min resolution (≤ 240 samples), cut at `now`. */
function kline(open: number, step: number, anchor: number, now: number): KlineRow {
  const end = Math.min(open + step, Math.max(open + 1, now));
  const n = Math.min(240, Math.max(2, Math.round((end - open) / MIN)));
  const o = synthPrice(open, anchor);
  let h = o;
  let l = o;
  let c = o;
  for (let i = 1; i <= n; i++) {
    const p = synthPrice(open + ((end - open) * i) / n - 1, anchor);
    if (p > h) h = p;
    if (p < l) l = p;
    c = p;
  }
  const v = 800 + 400 * Math.abs(Math.sin(open / HOUR));
  return [open, o.toFixed(1), h.toFixed(1), l.toFixed(1), c.toFixed(1), v.toFixed(3), open + step - 1, (v * c).toFixed(2), Math.round(v * 12), (v / 2).toFixed(3), ((v / 2) * c).toFixed(2), "0"];
}

/** Binance kline rows for `interval` (open times aligned to the interval, the newest one running at `now`). */
export function synthKlines(interval: string, q: RangeQuery, anchor: number, now: number = Date.now()): KlineRow[] {
  const step = SYNTH_INTERVAL_MS[interval];
  if (!step) return [];
  const limit = Math.max(1, Math.min(1500, q.limit ?? 500));
  const last = Math.floor(Math.min(q.endTime ?? now, now) / step) * step;
  let first = last - (limit - 1) * step;
  if (q.startTime !== undefined && q.endTime === undefined) first = Math.ceil(q.startTime / step) * step;
  else if (q.startTime !== undefined) first = Math.max(first, Math.ceil(q.startTime / step) * step);
  const rows: KlineRow[] = [];
  for (let t = first; t <= last && rows.length < limit; t += step) rows.push(kline(t, step, anchor, now));
  return rows;
}

export type RatioKind = "top-position" | "top-account" | "global";
export type RatioScript = "whale-long" | "flat";

/**
 * Long % (0–100) of `kind` at the snapshot `i` periods before the newest one. `whale-long`: over the last four
 * periods the top traders' position long % rises (55 → 58.9) while the all-accounts long % falls (51 → 46.6); the
 * period before breaks both runs, so the run is exactly 4. Older snapshots swing gently.
 */
export function ratioLongPct(kind: RatioKind, i: number, script: RatioScript): number {
  if (script === "whale-long") {
    const top = [58.9, 57.5, 56.2, 55.0, 54.0, 55.0];
    const ret = [46.6, 47.9, 49.1, 50.2, 51.0, 50.0];
    if (kind === "top-position" && i < top.length) return top[i]!;
    if (kind === "global" && i < ret.length) return ret[i]!;
  }
  const base = kind === "global" ? 50 : kind === "top-account" ? 53 : 55;
  return base + 1.5 * Math.sin(i * 0.9) + 0.5 * Math.sin(i * 2.3);
}

/** Binance `/futures/data/*` ratio rows for `period`, timestamps on period boundaries (newest = last boundary ≤ end). */
export function synthRatios(kind: RatioKind, period: string, q: RangeQuery, script: RatioScript, now: number = Date.now()): Record<string, string>[] {
  const step = SYNTH_INTERVAL_MS[period] ?? HOUR;
  const newest = Math.floor(now / step) * step;
  const end = Math.floor(Math.min(q.endTime ?? now, now) / step) * step;
  const limit = Math.max(1, Math.min(500, q.limit ?? 30));
  const out: Record<string, string>[] = [];
  for (let k = limit - 1; k >= 0; k--) {
    const t = end - k * step;
    if (q.startTime !== undefined && t < q.startTime) continue;
    const i = Math.round((newest - t) / step);
    const long = ratioLongPct(kind, i, script) / 100;
    out.push({ symbol: "BTCUSDT", longShortRatio: (long / (1 - long)).toFixed(4), longAccount: long.toFixed(4), shortAccount: (1 - long).toFixed(4), timestamp: String(t) });
  }
  return out;
}

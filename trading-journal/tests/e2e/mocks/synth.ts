/**
 * Deterministic synthetic market for e2e specs that need a KNOWN Einstiegs-Check result (pure, no Playwright).
 *
 * - `synthPrice(t, anchor)`: one continuous BTC price path over absolute time. Long history oscillates around
 *   ~96k, the last three days fall steadily to a fresh low ~83.2k 45 min before `anchor`, then the price turns up to
 *   ~84.2k (the WS fixtures' live price) and stays flat after `anchor`. Every interval is built from this one path,
 *   so 15m / 1h / 4h klines agree with each other the way real exchange candles do and the 30m / 45m resampling sees
 *   aligned buckets (open times are multiples of the interval, like Binance).
 * - `synthKlines(interval, q, anchor)`: Binance `/fapi/v1/klines` rows for a request (`limit`, `startTime`, `endTime`).
 * - `synthRatios(kind, period, q)`: Binance `/futures/data/*LongShort*Ratio` rows aligned to period boundaries (the
 *   Einstiegs-Check reads the 5-minute ones). `whale-long`: top traders > 64 % long by POSITIONS (66,0 %) and by ACCOUNTS
 *   (65,4 %) while all accounts are MORE long (69,1 %, rising toward now): the Whale–Retail-Delta (top accounts − all
 *   accounts) is −3,7 pp and fell 2,7 pp over the last hour (retail red by both rules) — with the setup's Discount the
 *   Top-Trader-Kombi holds 4 of 4 on the long side. `whale-short` mirrors it (34,0 % / 34,6 % long = > 64 % short,
 *   delta +3,7 pp, rising = retail green) for the mirrored market. `flat`: gentle swings around 55 / 53 / 54 % (delta
 *   ≈ −1 pp: retail red for a long, nothing else met).
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
/**
 * The ONE live price of the synthetic market (`mockMarket` with `synth`): every trade, the book mid, the ticker's last
 * price (Binance and Bybit) — so the engine completes the running candles with the same price whichever source it
 * reads first (it keeps the price of its minute frame), and the oracles pass the same number.
 */
export const SYNTH_LIVE_PRICE = 84_199;
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

/**
 * Price shapes: `capitulation` (default: the fall into a fresh low 12 min before the anchor, then the turn — the long
 * entry) or `divergence` (the same fall ends 10 h before the anchor at L1, a bounce, a SLOW decline to a slightly lower
 * low L2 3 h before the anchor — lower low in price, higher low in RSI = a regular bullish divergence — then a rally
 * through the bounce high (a bullish break on 1h) up to the live price, flat for the last hour).
 */
export type SynthShape = "capitulation" | "divergence";

/** Levels of the `divergence` shape: the end price, the bounce high H (broken by the rally), the lows L1 > L2. */
export const DIV_LEVELS = (() => {
  const end = SYNTH_LAST;
  const high = end / 1.006;
  const low1 = high / 1.02;
  return { end, high, low1, low2: low1 * 0.997 };
})();

function divergencePrice(t: number, anchor: number): number {
  const before = anchor - t;
  const { end, high, low1, low2 } = DIV_LEVELS;
  if (before <= 60 * MIN) return end;
  if (before <= 180 * MIN) {
    // the rally: low2 → end, smooth (through the bounce high ~75 min before the anchor)
    const k = (180 * MIN - before) / (120 * MIN);
    return low2 + (end - low2) * (k * k * (3 - 2 * k));
  }
  if (before <= 420 * MIN) return high + (low2 - high) * ((420 * MIN - before) / (240 * MIN)); // the slow decline
  if (before <= 600 * MIN) {
    const k = (600 * MIN - before) / (180 * MIN); // the bounce from low1 to the high (eased out)
    return low1 + (high - low1) * (1 - (1 - k) * (1 - k));
  }
  // before low1: the capitulation path, shifted so its low lands 10 h before the anchor at low1
  return capitulationPrice(t, anchor - 600 * MIN + TURN_MS) * (low1 / SYNTH_LOW);
}

/** The price at absolute time `t` (ms) for a market anchored at `anchor` (ms, "now" of the mock). */
export function synthPrice(t: number, anchor: number, shape: SynthShape = "capitulation"): number {
  return shape === "divergence" ? divergencePrice(t, anchor) : capitulationPrice(t, anchor);
}

function capitulationPrice(t: number, anchor: number): number {
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
function kline(open: number, step: number, anchor: number, now: number, shape: SynthShape): KlineRow {
  const end = Math.min(open + step, Math.max(open + 1, now));
  const n = Math.min(240, Math.max(2, Math.round((end - open) / MIN)));
  const o = synthPrice(open, anchor, shape);
  let h = o;
  let l = o;
  let c = o;
  for (let i = 1; i <= n; i++) {
    const p = synthPrice(open + ((end - open) * i) / n - 1, anchor, shape);
    if (p > h) h = p;
    if (p < l) l = p;
    c = p;
  }
  const v = 800 + 400 * Math.abs(Math.sin(open / HOUR));
  return [open, o.toFixed(1), h.toFixed(1), l.toFixed(1), c.toFixed(1), v.toFixed(3), open + step - 1, (v * c).toFixed(2), Math.round(v * 12), (v / 2).toFixed(3), ((v / 2) * c).toFixed(2), "0"];
}

/** Binance kline rows for `interval` (open times aligned to the interval, the newest one running at `now`). */
export function synthKlines(interval: string, q: RangeQuery, anchor: number, now: number = Date.now(), shape: SynthShape = "capitulation"): KlineRow[] {
  const step = SYNTH_INTERVAL_MS[interval];
  if (!step) return [];
  const limit = Math.max(1, Math.min(1500, q.limit ?? 500));
  const last = Math.floor(Math.min(q.endTime ?? now, now) / step) * step;
  let first = last - (limit - 1) * step;
  if (q.startTime !== undefined && q.endTime === undefined) first = Math.ceil(q.startTime / step) * step;
  else if (q.startTime !== undefined) first = Math.max(first, Math.ceil(q.startTime / step) * step);
  const rows: KlineRow[] = [];
  for (let t = first; t <= last && rows.length < limit; t += step) rows.push(kline(t, step, anchor, now, shape));
  return rows;
}

export type RatioKind = "top-position" | "top-account" | "global";
export type RatioScript = "whale-long" | "whale-short" | "flat";

/** Newest snapshots the scripts shape (1 h of 5-min points); older ones swing gently like `flat`. */
const SCRIPT_POINTS = 12;

/**
 * Long % (0–100) of `kind` at the snapshot `i` periods before the newest one. `whale-long`: top traders 66,0 % long by
 * position and 65,4 % by account (−0,1 pp per older point, so every point of the last hour is > 64 %), all accounts
 * 69,1 % long and −0,3 pp per older point (all accounts grow MORE long toward now than the top accounts): the
 * Whale–Retail-Delta (top accounts − all accounts) is −3,7 pp now and fell 2,7 pp over 1 h (−1,3 pp at the oldest
 * scripted point) — "Retail rot" by the level (< 0) and by the fall (≥ 1 pp) rule. `whale-short` = the mirror image
 * (100 − x): top traders > 64 % short, delta +3,7 pp and rising 4,7 pp over 1 h (Retail grün).
 */
export function ratioLongPct(kind: RatioKind, i: number, script: RatioScript): number {
  if (script !== "flat" && i < SCRIPT_POINTS) {
    const long = kind === "top-position" ? 66 - 0.1 * i : kind === "top-account" ? 65.4 - 0.1 * i : 69.1 - 0.3 * i;
    return script === "whale-long" ? long : 100 - long;
  }
  // older points / `flat`: top accounts 53 %, all accounts 54 % → delta ≈ −1 pp (below 0 = retail red for a long only)
  const base = kind === "global" ? 54 : kind === "top-account" ? 53 : 55;
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

/**
 * Excursion (Journal v3, P06): MAE / MFE, ATR at entry, the time in the market and the running excursion of a replay –
 * pure, no I/O (`src/market/excursion.ts` loads the candles and stores the result on the trade).
 *
 * - MAE = maximum adverse excursion, MFE = maximum favourable excursion: the largest move against / with the position
 *   between entry and exit, as a NON-NEGATIVE price distance from the (Ø) entry, and in R (distance ÷ |entry − stop|).
 * - Candles are whole bars: the bar the entry falls into and the one the exit falls into count completely, so with
 *   15-min bars an excursion can be overstated by at most one bar's range at each end (documented approximation).
 */

/** OHLC bar in milliseconds (the market `Candle` shape fits). */
export interface ExcursionBar {
  /** open time, ms UTC */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ExcursionInput {
  side: "long" | "short";
  /** (Ø) entry price */
  entry: number;
  stop?: number | null;
  /** entry / exit time, ms */
  from: number;
  to: number;
  /** bar length, ms */
  intervalMs: number;
}

export interface Excursion {
  mae: number;
  mfe: number;
  maeR: number | null;
  mfeR: number | null;
  /** Price at the worst / best point. */
  maePrice: number;
  mfePrice: number;
  /** Open time of the bar with the worst / best point. */
  maeAt: number;
  mfeAt: number;
  /** Bars inside the window. */
  bars: number;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Bars overlapping [from, to] (a bar `[time, time + intervalMs)`). */
export function barsInWindow<B extends ExcursionBar>(bars: readonly B[], from: number, to: number, intervalMs: number): B[] {
  return bars.filter((b) => b.time + intervalMs > from && b.time <= to);
}

/** MAE / MFE of a position over its bars; `null` without an entry, a window or bars inside it. */
export function excursion(bars: readonly ExcursionBar[], x: ExcursionInput): Excursion | null {
  if (!(fin(x.entry) && x.entry > 0) || !(x.to >= x.from)) return null;
  const inside = barsInWindow(bars, x.from, x.to, x.intervalMs);
  if (!inside.length) return null;
  const long = x.side !== "short";
  let lo = inside[0]!;
  let hi = inside[0]!;
  for (const b of inside) {
    if (b.low < lo.low) lo = b;
    if (b.high > hi.high) hi = b;
  }
  const adverse = long ? lo : hi;
  const favour = long ? hi : lo;
  const maePrice = long ? lo.low : hi.high;
  const mfePrice = long ? hi.high : lo.low;
  const mae = Math.max(0, long ? x.entry - maePrice : maePrice - x.entry);
  const mfe = Math.max(0, long ? mfePrice - x.entry : x.entry - mfePrice);
  const riskDist = fin(x.stop) && x.stop > 0 ? Math.abs(x.entry - x.stop) : 0;
  return {
    mae,
    mfe,
    maeR: riskDist > 0 ? mae / riskDist : null,
    mfeR: riskDist > 0 ? mfe / riskDist : null,
    maePrice,
    mfePrice,
    maeAt: adverse.time,
    mfeAt: favour.time,
    bars: inside.length,
  };
}

/**
 * ATR(len) (Wilder true range, simple mean of the last `len` true ranges) of the bars CLOSED before `at`, in % of the
 * last close. `null` with fewer than `len + 1` bars.
 */
export function atrPctAt(bars: readonly ExcursionBar[], at: number, intervalMs: number, len = 14): number | null {
  const closed = bars.filter((b) => b.time + intervalMs <= at);
  if (closed.length < len + 1) return null;
  const tail = closed.slice(-(len + 1));
  let sum = 0;
  for (let i = 1; i < tail.length; i++) {
    const b = tail[i]!;
    const prev = tail[i - 1]!.close;
    sum += Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev));
  }
  const last = tail[tail.length - 1]!.close;
  return last > 0 ? (sum / len / last) * 100 : null;
}

/** Holding time in ms (`exitDate − date`), `null` when the exit time is unknown or before the entry. */
export function holdMs(t: { date: string; exitDate?: string; createdAt?: string }): number | null {
  if (!t.exitDate) return null;
  const a = new Date(t.date || t.createdAt || 0).getTime();
  const b = new Date(t.exitDate).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
}

/** "45 Min", "3 Std 20 Min", "2 T 4 Std" – compact German duration. */
export function holdLabel(ms: number | null): string {
  if (ms == null) return "–";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} Min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h} Std ${m} Min` : `${h} Std`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} T ${rh} Std` : `${d} T`;
}

/**
 * How much of the best move the exit captured: realised move ÷ MFE (0–1+, negative for a loss). `null` without an MFE.
 */
export function captureRatio(side: "long" | "short", entry: number, exit: number | null | undefined, mfe: number | null | undefined): number | null {
  if (!fin(exit) || !fin(mfe) || mfe <= 0 || !(entry > 0)) return null;
  const moved = side === "short" ? entry - exit : exit - entry;
  return moved / mfe;
}

/** The candle interval used to measure a window: 15-min bars up to 3 days, else 1-hour bars. */
export function excursionInterval(windowMs: number): "15m" | "1h" {
  return windowMs <= 3 * 86_400_000 ? "15m" : "1h";
}

/** The stored excursion keys of a trade (`src/market/excursion.ts` writes them, an edit of the inputs clears them). */
export const EXCURSION_KEYS = ["mae", "mfe", "maeR", "mfeR", "atrPct"] as const;

type ExcursionSource = { side?: string; date?: string; exitDate?: string; entry?: number | null; stop?: number | null; status?: string; pair?: string; fills?: unknown };

/** True when an edit changed what the stored MAE / MFE were measured from (they must be measured again). */
export function excursionStale(before: ExcursionSource, after: ExcursionSource): boolean {
  return (
    before.side !== after.side ||
    before.date !== after.date ||
    (before.exitDate ?? "") !== (after.exitDate ?? "") ||
    (before.entry ?? null) !== (after.entry ?? null) ||
    (before.stop ?? null) !== (after.stop ?? null) ||
    before.status !== after.status ||
    (before.pair ?? "") !== (after.pair ?? "") ||
    JSON.stringify(before.fills ?? null) !== JSON.stringify(after.fills ?? null)
  );
}

/** One step of a replay: the running excursion up to bar `i` and the unrealised R at its close. */
export interface ReplayStep {
  /** Running MAE / MFE (price distance ≥ 0) from the entry bar through this bar; 0 before the entry. */
  mae: number;
  mfe: number;
  /** Unrealised R at the close (`null` without a stop), 0 before the entry. */
  r: number | null;
  /** Unrealised move at the close in % of the entry. */
  movePct: number;
  /** 0 before the entry, 1 in the trade, 2 after the exit. */
  phase: 0 | 1 | 2;
}

/**
 * Replay steps for every bar: before the entry nothing runs, inside the window MAE / MFE accumulate, after the exit the
 * values freeze at the exit (R = the realised R when `exit` is given).
 */
export function replaySteps(bars: readonly ExcursionBar[], x: ExcursionInput & { exit?: number | null }): ReplayStep[] {
  const long = x.side !== "short";
  const dir = long ? 1 : -1;
  const riskDist = fin(x.stop) && x.stop > 0 ? Math.abs(x.entry - x.stop) : 0;
  let mae = 0;
  let mfe = 0;
  let frozen: ReplayStep | null = null;
  return bars.map((b) => {
    if (b.time + x.intervalMs <= x.from) return { mae: 0, mfe: 0, r: riskDist ? 0 : null, movePct: 0, phase: 0 };
    if (b.time > x.to) {
      if (!frozen) {
        const px = fin(x.exit) && x.exit > 0 ? x.exit : b.open;
        const move = (px - x.entry) * dir;
        frozen = { mae, mfe, r: riskDist ? move / riskDist : null, movePct: (move / x.entry) * 100, phase: 2 };
      }
      return frozen;
    }
    mae = Math.max(mae, long ? x.entry - b.low : b.high - x.entry);
    mfe = Math.max(mfe, long ? b.high - x.entry : x.entry - b.low);
    const move = (b.close - x.entry) * dir;
    return { mae: Math.max(0, mae), mfe: Math.max(0, mfe), r: riskDist ? move / riskDist : null, movePct: (move / x.entry) * 100, phase: 1 };
  });
}

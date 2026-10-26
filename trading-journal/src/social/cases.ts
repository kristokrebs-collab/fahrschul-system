/**
 * Chartfälle (F47) – the reading side. PURE and alias-free: the outcome of a case is never stored anywhere, every reader
 * (and the tests) works it out from the public candles with the functions below – so nobody can set it.
 *
 * The question of a case: "Where does the price stand `horizon` candles after the anchor candle?" - up, down or sideways,
 * measured on the CLOSE of the anchor candle and the close of the `horizon`-th candle after it. "Sideways" has a fixed,
 * visible width: ½ × the typical candle range (ATR of the last 14 candles, in % of the anchor close) × √horizon - the
 * zone the price would reach after `horizon` candles if every candle moved a random half-range up or down. It is a
 * convention to make "sideways" answerable, not a statement about the market.
 */
import { CASE_INTERVAL_MS, type CaseDirection, type CaseInfo, type HypothesisInfo } from "./contract";

/** One candle: open time in ms (UTC). */
export interface CaseBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Candles shown up to and including the anchor candle. */
export const CASE_LOOKBACK = 90;
/** Candles of the ATR that sets the width of "sideways". */
export const ATR_BARS = 14;
/** The "sideways" zone is this share of the typical move after `horizon` candles. */
export const FLAT_SHARE = 0.5;
/** Fewest hypotheses before a hit rate is quoted as a percentage. */
export const MIN_HIT_SAMPLE = 5;

type Frame = Pick<CaseInfo, "interval" | "anchorMs" | "horizon">;

/** The candles to load: `CASE_LOOKBACK` + the ATR warm-up before the anchor, the horizon after it (open times, ms). */
export function caseWindow(c: Frame, lookback = CASE_LOOKBACK): { from: number; to: number } {
  const iv = CASE_INTERVAL_MS[c.interval];
  return { from: c.anchorMs - (lookback + ATR_BARS) * iv, to: c.anchorMs + c.horizon * iv };
}

/** When the last candle of the question closes (ms) – the outcome exists from then on. */
export const outcomeAt = (c: Frame): number => c.anchorMs + (c.horizon + 1) * CASE_INTERVAL_MS[c.interval];

/** The candles a reader may see before the outcome: up to and including the anchor, at most `CASE_LOOKBACK`. */
export function visibleBars(bars: readonly CaseBar[], c: Frame, lookback = CASE_LOOKBACK): CaseBar[] {
  return bars.filter((b) => b.time <= c.anchorMs).slice(-lookback);
}

/** The candles after the anchor up to the horizon (what the outcome is made of). */
export function futureBars(bars: readonly CaseBar[], c: Frame): CaseBar[] {
  const end = c.anchorMs + c.horizon * CASE_INTERVAL_MS[c.interval];
  return bars.filter((b) => b.time > c.anchorMs && b.time <= end);
}

/** Mean true range of the `n` candles ending at index `at`, in % of that candle's close; null without enough candles. */
export function atrPct(bars: readonly CaseBar[], at: number, n = ATR_BARS): number | null {
  if (at < n || !(bars[at]!.close > 0)) return null;
  let sum = 0;
  for (let i = at - n + 1; i <= at; i++) {
    const b = bars[i]!;
    const pc = bars[i - 1]!.close;
    sum += Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  }
  return (sum / n / bars[at]!.close) * 100;
}

export type CaseOutcome =
  | { status: "unavailable"; reason: "noAnchor" | "noAtr" | "gap" }
  | { status: "pending"; readyAt: number }
  | {
      status: "ready";
      /** Close of the anchor candle and of the last candle of the question. */
      ref: number;
      end: number;
      /** Move in %, the half-width of the "sideways" zone in %, the typical candle range in %. */
      movePct: number;
      bandPct: number;
      atrPct: number;
      direction: CaseDirection;
      /** Highest / lowest point on the way, in % of the anchor close. */
      maxUpPct: number;
      maxDownPct: number;
    };

/**
 * The outcome of a case from candles that contain the anchor, its history and (as far as they exist) the candles after it.
 * `pending` until the last candle of the question has closed; `unavailable` when the anchor, the warm-up or the end
 * candle is missing (never guessed).
 */
export function caseOutcome(bars: readonly CaseBar[], c: Frame, now: number): CaseOutcome {
  const iv = CASE_INTERVAL_MS[c.interval];
  const sorted = [...bars].sort((a, b) => a.time - b.time);
  const at = sorted.findIndex((b) => b.time === c.anchorMs);
  if (at < 0) return { status: "unavailable", reason: "noAnchor" };
  const atr = atrPct(sorted, at);
  if (atr == null) return { status: "unavailable", reason: "noAtr" };
  const readyAt = outcomeAt(c);
  if (now < readyAt) return { status: "pending", readyAt };
  const endBar = sorted.find((b) => b.time === c.anchorMs + c.horizon * iv);
  if (!endBar) return { status: "unavailable", reason: "gap" };
  const ref = sorted[at]!.close;
  const path = futureBars(sorted, c);
  const movePct = ((endBar.close - ref) / ref) * 100;
  const bandPct = FLAT_SHARE * atr * Math.sqrt(c.horizon);
  const direction: CaseDirection = movePct > bandPct ? "up" : movePct < -bandPct ? "down" : "flat";
  return {
    status: "ready",
    ref,
    end: endBar.close,
    movePct,
    bandPct,
    atrPct: atr,
    direction,
    maxUpPct: path.length ? ((Math.max(...path.map((b) => b.high)) - ref) / ref) * 100 : 0,
    maxDownPct: path.length ? ((Math.min(...path.map((b) => b.low)) - ref) / ref) * 100 : 0,
  };
}

/** `true` / `false` when the outcome is known, else `null`. */
export function hitOf(h: Pick<HypothesisInfo, "direction">, o: CaseOutcome): boolean | null {
  return o.status === "ready" ? h.direction === o.direction : null;
}

/**
 * How many full candles had passed since the anchor candle closed when the server stored the hypothesis: 0 = before
 * the first candle after the anchor was over (a real forecast), n = the chart already showed n more candles on the
 * exchange - the label next to every hypothesis says so.
 */
export function delayCandles(h: Pick<HypothesisInfo, "createdAt">, c: Pick<CaseInfo, "interval" | "anchorMs">): number {
  const iv = CASE_INTERVAL_MS[c.interval];
  const closedAt = c.anchorMs + iv;
  return Math.max(0, Math.floor((Date.parse(h.createdAt) - closedAt) / iv));
}

export interface CaseTally {
  n: number;
  up: number;
  down: number;
  flat: number;
  /** Hypotheses that matched / could be judged (outcome ready). */
  hits: number;
  judged: number;
  /** 0–100, only from `MIN_HIT_SAMPLE` judged hypotheses on. */
  hitRate: number | null;
}

/** Counts of all hypotheses of a case (mine + the revealed ones) and how many matched the outcome. */
export function tally(hyps: readonly Pick<HypothesisInfo, "direction">[], o: CaseOutcome): CaseTally {
  const count = (d: CaseDirection) => hyps.filter((h) => h.direction === d).length;
  const judged = o.status === "ready" ? hyps.length : 0;
  const hits = o.status === "ready" ? hyps.filter((h) => h.direction === o.direction).length : 0;
  return { n: hyps.length, up: count("up"), down: count("down"), flat: count("flat"), hits, judged, hitRate: judged >= MIN_HIT_SAMPLE ? Math.round((hits / judged) * 100) : null };
}

/** The anchor candle for "the newest candle that is already closed" at `now` (ms, UTC grid). */
export function latestClosedAnchor(interval: CaseInfo["interval"], now: number): number {
  const iv = CASE_INTERVAL_MS[interval];
  return Math.floor(now / iv) * iv - iv;
}

/** Snaps any instant (ms) to the open time of the candle that contains it. */
export function snapToCandle(interval: CaseInfo["interval"], t: number): number {
  const iv = CASE_INTERVAL_MS[interval];
  return Math.floor(t / iv) * iv;
}

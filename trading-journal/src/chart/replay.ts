/**
 * Pure math of the equity replay scrubber (pulse `agent-trace`): the whole replay state is a function of one time
 * `t` in trade units (0 = start capital, n = after the last closed trade), so dragging, keys and the return-to-live
 * glide all render through the same `replayAt(t)`.
 */

export interface ReplaySeries {
  /** balance after trade i (index 0 = start) */
  values: readonly number[];
  /** cumulative winners after trade i (`pnl > 0`, same rule as `aggregate`) */
  wins: readonly number[];
  /** P&L of trade i (index 0 = null) */
  pnl: readonly (number | null)[];
}

export interface ReplayFrame {
  /** clamped time */
  t: number;
  /** trades completed at `t` (the trade whose point the playhead has reached or passed) */
  k: number;
  /** balance, linearly interpolated between the two neighbouring trades */
  balance: number;
  /** win rate over the first `k` trades (`null` before the first) */
  winRate: number | null;
}

/** Keyboard steps of the slider, in trades. */
export const REPLAY_STEP = 1;
export const REPLAY_STEP_BIG = 5;
/** `t` within this of a whole trade counts as having reached it (float noise of drags and glides). */
const EPS = 1e-6;

export function buildReplaySeries(points: readonly { v: number; t: { pnl?: number | null } | null }[]): ReplaySeries {
  const values: number[] = [];
  const wins: number[] = [];
  const pnl: (number | null)[] = [];
  let w = 0;
  for (const p of points) {
    const v = p.t?.pnl ?? null;
    if (p.t && (v ?? 0) > 0) w++;
    values.push(p.v);
    wins.push(w);
    pnl.push(p.t ? v : null);
  }
  return { values, wins, pnl };
}

export function replayAt(s: ReplaySeries, t: number): ReplayFrame {
  const n = Math.max(0, s.values.length - 1);
  const c = Math.max(0, Math.min(n, Number.isFinite(t) ? t : n));
  const k = Math.min(n, Math.floor(c + EPS));
  const a = s.values[k] ?? 0;
  const b = s.values[Math.min(n, k + 1)] ?? a;
  const f = Math.max(0, c - k);
  return { t: c, k, balance: a + (b - a) * f, winRate: k > 0 ? (s.wins[k] ?? 0) / k : null };
}

/** Piecewise-linear x of time `t` over the plotted point xs (ascending). */
export function xAtTime(xs: readonly number[], t: number): number {
  const n = xs.length - 1;
  if (n < 0) return 0;
  const c = Math.max(0, Math.min(n, t));
  const k = Math.min(n - 1, Math.floor(c));
  if (k < 0) return xs[0] as number;
  const a = xs[k] as number;
  const b = xs[k + 1] ?? a;
  return a + (b - a) * (c - k);
}

/** Inverse of `xAtTime` for a pointer x (clamped to the first/last point). */
export function timeAtX(xs: readonly number[], x: number): number {
  const n = xs.length - 1;
  if (n <= 0) return 0;
  if (x <= (xs[0] as number)) return 0;
  if (x >= (xs[n] as number)) return n;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] as number) <= x) lo = mid;
    else hi = mid;
  }
  const a = xs[lo] as number;
  const b = xs[hi] as number;
  return lo + (b > a ? (x - a) / (b - a) : 0);
}

/** Slider key → new time (whole trades; `null` = key not handled). */
export function replayKey(key: string, shift: boolean, t: number, n: number): number | null {
  const step = shift ? REPLAY_STEP_BIG : REPLAY_STEP;
  const whole = Math.round(t);
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return Math.max(0, (Math.abs(t - whole) < EPS ? whole : Math.ceil(t)) - step);
    case "ArrowRight":
    case "ArrowUp":
      return Math.min(n, (Math.abs(t - whole) < EPS ? whole : Math.floor(t)) + step);
    case "PageDown":
      return Math.max(0, whole - REPLAY_STEP_BIG);
    case "PageUp":
      return Math.min(n, whole + REPLAY_STEP_BIG);
    case "Home":
      return 0;
    case "End":
      return n;
    default:
      return null;
  }
}

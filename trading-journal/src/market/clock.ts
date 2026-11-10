/**
 * Device clock vs. Binance server clock. Every data time in the market layer (`asOf`, `lastDataAt`, the ratio points)
 * is EXCHANGE time, every timer is LOCAL time. A tablet whose clock is a few minutes off would otherwise mark live
 * feeds "veraltet" (clock ahead), poll aligned series before Binance published the point (clock behind) or leave a
 * hole after a WebSocket gap (the gap fill counts the missing bars with the local clock).
 *
 * Estimate: `server − local` per sample (WS `markPrice@1s` event time, REST `premiumIndex.time`, the `fapi/v1/time`
 * probe). Network latency only makes the server time look OLDER, so the MAX over a sliding window is the best
 * estimate (≈ true offset − smallest latency). It is applied only when it is large (≥ 2 s), consistent (the window's
 * samples agree within 5 s – replayed fixtures or a stalled feed never yield a "skew") and plausible (≤ 6 h).
 */

/** Offsets below this are ignored (latency and jitter, not a wrong clock). */
export const SKEW_APPLY_MS = 2_000;
/** The applied offset moves only when the estimate changed by at least this much (no health churn). */
export const SKEW_STEP_MS = 1_000;
/** Samples kept (the WS mark price delivers one per second: ≈ 30 s of history). */
export const SKEW_WINDOW = 30;
/** Samples needed before any offset is applied. */
export const SKEW_MIN_SAMPLES = 5;
/** The window's samples must agree within this spread, else the estimate is not trusted. */
export const SKEW_MAX_SPREAD_MS = 5_000;
/** Larger offsets are not a clock problem (replayed data, a stuck feed): ignored. */
export const SKEW_MAX_MS = 6 * 60 * 60_000;

export class ClockSkew {
  private samples: number[] = [];
  private applied = 0;

  /** Applied offset `server − local` in ms (0 while the clocks agree within `SKEW_APPLY_MS`). */
  get offsetMs(): number {
    return this.applied;
  }

  /** Raw current estimate (diagnostics), `null` before enough consistent samples. */
  estimate(): number | null {
    if (this.samples.length < SKEW_MIN_SAMPLES) return null;
    let max = -Infinity;
    let min = Infinity;
    for (const s of this.samples) {
      if (s > max) max = s;
      if (s < min) min = s;
    }
    if (max - min > SKEW_MAX_SPREAD_MS) return null;
    return max;
  }

  /**
   * One observation: `serverTime` (exchange clock, ms) seen at local time `localReceive`. Returns true when the
   * applied offset changed (the provider then re-publishes it in the health snapshot).
   */
  sample(serverTime: number, localReceive: number): boolean {
    if (!Number.isFinite(serverTime) || !Number.isFinite(localReceive) || serverTime <= 0) return false;
    const s = serverTime - localReceive;
    if (Math.abs(s) > SKEW_MAX_MS) return false;
    this.samples.push(s);
    if (this.samples.length > SKEW_WINDOW) this.samples.shift();
    const est = this.estimate();
    if (est === null) return false;
    const next = Math.abs(est) < SKEW_APPLY_MS ? 0 : Math.round(est);
    if (next === this.applied) return false;
    if (next !== 0 && this.applied !== 0 && Math.abs(next - this.applied) < SKEW_STEP_MS) return false;
    this.applied = next;
    return true;
  }

  reset(): void {
    this.samples = [];
    this.applied = 0;
  }
}

/**
 * German line for the Live-Daten card from the applied offset (`server − local`): a NEGATIVE offset means the device
 * clock is ahead (`Geräteuhr geht 2:10 min vor`), a positive one that it is behind (`… nach`). Empty at 0.
 */
export function skewText(offsetMs: number): string {
  if (!offsetMs) return "";
  const total = Math.round(Math.abs(offsetMs) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `Geräteuhr geht ${m}:${String(s).padStart(2, "0")} min ${offsetMs < 0 ? "vor" : "nach"} · Zeiten nach Binance-Uhr`;
}

/**
 * Basic indicators, ported 1:1 from the other journal (`signals.ts:54-115`). Same operation order, so the
 * floating-point results are bit-identical (tests compare against a verbatim copy).
 */
import type { SignalCfg } from "./config";

/** Bar: open time in unix SECONDS (TradingView convention), OHLC, optional volume. */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

/** EMA seeded with the first finite value (not the Pine SMA seed); a non-finite input repeats the previous value. */
export function ema(src: readonly number[], len: number): number[] {
  const out: number[] = new Array(src.length);
  const a = 2 / (len + 1);
  let prev = NaN;
  for (let i = 0; i < src.length; i++) {
    const x = src[i]!;
    if (!isFinite(x)) {
      out[i] = prev;
      continue;
    }
    prev = isFinite(prev) ? a * x + (1 - a) * prev : x;
    out[i] = prev;
  }
  return out;
}

/** Rolling mean; `NaN` until the window is full and every value in it is finite. */
export function sma(src: readonly number[], len: number): number[] {
  const out: number[] = new Array(src.length);
  let sum = 0;
  let n = 0;
  // ring of the last `len` inputs (same arithmetic as the original queue: add, then drop the oldest)
  const q: number[] = [];
  let head = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i]!;
    q.push(x);
    if (isFinite(x)) {
      sum += x;
      n++;
    }
    if (q.length - head > len) {
      const y = q[head++]!;
      if (isFinite(y)) {
        sum -= y;
        n--;
      }
    }
    out[i] = q.length - head === len && n === len ? sum / len : NaN;
  }
  return out;
}

/** Wilder RMA like Pine `ta.rma`: seeded with the SMA of the first `len` finite values. */
export function rma(src: readonly number[], len: number): number[] {
  const out: number[] = new Array(src.length);
  let prev = NaN;
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i]!;
    if (!isFinite(prev)) {
      if (isFinite(x)) {
        sum += x;
        cnt++;
      }
      prev = cnt === len ? sum / len : NaN;
      out[i] = prev;
    } else {
      prev = (prev * (len - 1) + x) / len;
      out[i] = prev;
    }
  }
  return out;
}

/** RSI like TradingView `ta.rsi` (RMA of gains/losses). `d === 0 → 100`, `u === 0 → 0`. */
export function rsi(close: readonly number[], len = 14): number[] {
  const n = close.length;
  const up: number[] = new Array(Math.max(0, n - 1));
  const dn: number[] = new Array(Math.max(0, n - 1));
  for (let i = 1; i < n; i++) {
    const d = close[i]! - close[i - 1]!;
    up[i - 1] = Math.max(d, 0);
    dn[i - 1] = Math.max(-d, 0);
  }
  const ru = rma(up, len);
  const rd = rma(dn, len);
  const out: number[] = new Array(ru.length + 1);
  out[0] = NaN;
  for (let i = 0; i < ru.length; i++) {
    const u = ru[i]!;
    const d = rd[i]!;
    out[i + 1] = !isFinite(u) || !isFinite(d) ? NaN : d === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / d);
  }
  return out;
}

/** WaveTrend (LazyBear / VuManChu Cipher B). */
export function waveTrend(bars: readonly Bar[], cfg: Pick<SignalCfg, "wtSource" | "wtChannel" | "wtAverage" | "wtSignal">): { wt1: number[]; wt2: number[] } {
  const src = bars.map((b) => (cfg.wtSource === "hlc3" ? (b.h + b.l + b.c) / 3 : b.c));
  const esa = ema(src, cfg.wtChannel);
  const de = ema(
    src.map((x, i) => Math.abs(x - esa[i]!)),
    cfg.wtChannel,
  );
  const ci = src.map((x, i) => (de[i] ? (x - esa[i]!) / (0.015 * de[i]!) : 0));
  const wt1 = ema(ci, cfg.wtAverage);
  const wt2 = sma(wt1, cfg.wtSignal);
  return { wt1, wt2 };
}

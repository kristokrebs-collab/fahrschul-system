/** Deterministic synthetic candles for the signal-engine tests (no network). */
import type { Bar } from "@/domain/signals";

/** LCG in [0, 1). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Random walk with regime switches (trend up/down, chop) and occasional V-reversals, so every MCB kind,
 * LuxAlgo pivots and BOS/CHoCH breaks occur. `t0` and `sec` in SECONDS.
 */
export function synthBars(n: number, seed: number, opts: { t0?: number; sec?: number; start?: number; vol?: number } = {}): Bar[] {
  const rnd = lcg(seed);
  const sec = opts.sec ?? 900;
  const t0 = opts.t0 ?? Math.floor(1_760_000_000 / sec) * sec;
  const vol = opts.vol ?? 0.004;
  let p = opts.start ?? 62_000;
  let drift = 0;
  let left = 0;
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    if (left <= 0) {
      const r = rnd();
      drift = r < 0.33 ? vol * 0.35 : r < 0.66 ? -vol * 0.35 : 0;
      left = 20 + Math.floor(rnd() * 80);
    }
    left--;
    // occasional shock (V-reversal material)
    const shock = rnd() < 0.02 ? (rnd() - 0.5) * vol * 12 : 0;
    const o = p;
    const c = o * (1 + drift + (rnd() - 0.5) * vol * 2 + shock);
    const h = Math.max(o, c) * (1 + rnd() * vol * 0.6);
    const l = Math.min(o, c) * (1 - rnd() * vol * 0.6);
    out.push({ t: t0 + i * sec, o, h, l, c, v: 10 + rnd() * 90 });
    p = c;
  }
  return out;
}

/** The bench's aggregation (other journal's research script): epoch buckets, leading partial bucket dropped. */
export function benchAgg(src: readonly Bar[], sec: number): Bar[] {
  const out: Bar[] = [];
  for (const b of src) {
    const k = Math.floor(b.t / sec) * sec;
    const last = out[out.length - 1];
    if (last && last.t === k) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
    } else out.push({ t: k, o: b.o, h: b.h, l: b.l, c: b.c });
  }
  if (out.length && out[0]!.t < src[0]!.t) out.shift();
  return out;
}

/** Ladder bars from one 15m series, like the live engine builds them. */
export function ladderBars(b15: readonly Bar[]): Record<string, Bar[]> {
  return { "15m": [...b15], "30m": benchAgg(b15, 1800), "45m": benchAgg(b15, 2700), "1h": benchAgg(b15, 3600), "2h": benchAgg(b15, 7200), "3h": benchAgg(b15, 10800), "4h": benchAgg(b15, 14400) };
}

/** `Object.is` per element (NaN equals NaN, bit-identical floats). */
export function sameArray(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

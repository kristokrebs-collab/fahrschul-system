/** Shared fixtures of the lab tests (F73): a deterministic random walk with volume – test data only. */
import type { Bar } from "@/domain/backtest/index";

/** Deterministic random walk (LCG) with volume, `sec` apart, from 2026-01-01 00:00 UTC. */
export function walk(n: number, sec: number, seed = 7, p0 = 100): Bar[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const t0 = Date.UTC(2026, 0, 1) / 1000;
  let px = p0;
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const o = px;
    const c = Math.max(1, o * (1 + (rnd() - 0.5) * 0.03));
    out.push({ t: t0 + i * sec, o, h: Math.max(o, c) * (1 + rnd() * 0.01), l: Math.min(o, c) * (1 - rnd() * 0.01), c, v: 100 + rnd() * 100 });
    px = c;
  }
  return out;
}

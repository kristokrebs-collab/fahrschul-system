/**
 * MCB ladder on history (P07): the REAL entry check (`signalsAt` from `@/domain/signals` – the same code the
 * Einstiegs-Check runs live and back-dates trades with) evaluated at every close of the check interval (default 4h,
 * optionally 1h – more thorough, slower) with the trader's own `settings.signals` ladder. Every ladder / zone timeframe
 * is built from the exchange interval the live engine uses (30m / 45m from 15m, 1h / 2h / 3h from 1h, 4h, 1D from the
 * 4h bars' complete UTC days), and each evaluation sees only the buckets that had CLOSED at that moment, capped at the
 * live window of `SIGNAL_BARS` bars per timeframe.
 *
 * Differences to live, named in the assumptions: the top-trader part and the Lage-Ampel have no history here (Binance
 * keeps ~30 days of ratios) → the check runs without them (its core: MCB, RSI, premium / discount, divergences and S/R).
 *
 * Entries are edge-triggered (a NEW valid entry: valid now, not valid at the previous check), stop = close ∓ k × ATR(14),
 * target = a multiple of that risk, optional time stop.
 */
import { MIN_SIGNAL_BARS, resampleBars, signalsAt, SIGNAL_BARS, tfSeconds, type Bar, type SignalCfg } from "../../signals";
import { atrSeries, closedCount, toDaily } from "../bars";
import type { BarsBy, EntrySignal, HistInterval } from "../types";
import { loopStepper, type LabStrategy, type ParamSpec, type Params, type Prepared } from "./types";

export type McbStep = "4h" | "1h";
export interface McbCfgIn {
  signal: SignalCfg;
  /** check interval = execution interval */
  step: McbStep;
}

/** Per check: the strength / validity / score of both sides (null side = no verdict). */
export interface McbFact {
  long: { strength: number; valid: boolean; score: number } | null;
  short: { strength: number; valid: boolean; score: number } | null;
}
export type McbFacts = (McbFact | null)[];

/** Exchange interval a ladder timeframe is built from (`@/market/signals/bars` SRC table, pure copy). */
export function sourceOf(tf: string): { interval: HistInterval | "4h1d"; srcSec: number } | null {
  if (tf === "15m" || tf === "30m" || tf === "45m") return { interval: "15m", srcSec: 900 };
  if (tf === "1h" || tf === "2h" || tf === "3h") return { interval: "1h", srcSec: 3600 };
  if (tf === "4h") return { interval: "4h", srcSec: 14_400 };
  if (tf === "1D") return { interval: "4h1d", srcSec: 86_400 };
  return null;
}

/** Timeframes the check evaluates (ladder + zone timeframe), unique. */
export const neededTfs = (cfg: Pick<SignalCfg, "ladder" | "zoneTf">): string[] => [...new Set([...cfg.ladder, cfg.zoneTf])];

/** Warm-up bars per timeframe (RSI / WaveTrend settle; live uses up to 500). */
export const MCB_WARMUP_BARS = 300;

export const mcbLadder: LabStrategy<McbFacts, McbCfgIn> = {
  id: "mcb",
  intervals(cfg) {
    const out = new Set<HistInterval>([cfg.step]);
    for (const tf of neededTfs(cfg.signal)) {
      const s = sourceOf(tf);
      if (!s) continue;
      out.add(s.interval === "4h1d" ? "4h" : s.interval);
    }
    return [cfg.step, ...[...out].filter((i) => i !== cfg.step)];
  },
  warmupMs(cfg) {
    let sec = tfSeconds(cfg.step);
    for (const tf of neededTfs(cfg.signal)) sec = Math.max(sec, tfSeconds(tf));
    return MCB_WARMUP_BARS * sec * 1000;
  },
  prepare(data: BarsBy, cfg: McbCfgIn, startMs: number) {
    const exec = (data[cfg.step] ?? []) as readonly Bar[];
    const execSec = tfSeconds(cfg.step);
    // every needed timeframe once over the whole history (buckets; the newest may be partial – cut by closedCount)
    const series: { tf: string; sec: number; bars: Bar[] }[] = [];
    let ok = true;
    for (const tf of neededTfs(cfg.signal)) {
      const s = sourceOf(tf);
      const sec = tfSeconds(tf);
      if (!s || !sec) {
        ok = false;
        continue;
      }
      const src = s.interval === "4h1d" ? toDaily((data["4h"] ?? []) as readonly Bar[]) : ((data[s.interval] ?? []) as readonly Bar[]);
      series.push({ tf, sec, bars: s.interval === "4h1d" ? [...src] : resampleBars(src, s.srcSec, sec) });
    }
    const facts: McbFacts = new Array<McbFact | null>(exec.length).fill(null);
    let start = 0;
    while (start < exec.length && exec[start]!.t * 1000 < startMs) start++;
    const n = ok ? Math.max(0, exec.length - start) : 0;
    const farFuture = Number.MAX_SAFE_INTEGER;
    return loopStepper(
      n,
      (k) => {
        const i = start + k;
        const atS = exec[i]!.t + execSec;
        const win: Record<string, Bar[]> = {};
        for (const s of series) {
          const c = closedCount(s.bars, s.sec, atS);
          if (c < MIN_SIGNAL_BARS) return;
          win[s.tf] = s.bars.slice(Math.max(0, c - SIGNAL_BARS), c);
        }
        const sig = signalsAt(win, cfg.signal, atS * 1000, farFuture);
        if (!sig) return;
        const side = (v: typeof sig.long) => (v ? { strength: v.strength, valid: v.valid && v.state !== "provisional", score: v.score } : null);
        facts[i] = { long: side(sig.long), short: side(sig.short) };
      },
      (): Prepared<McbFacts> => ({ interval: cfg.step, bars: exec, start, facts, atr: atrSeries(exec) }),
    );
  },
  specs(cfg): ParamSpec[] {
    const max = cfg.signal.ladder.length;
    const strengths = [2, 3, 4].filter((v) => v <= Math.max(2, max));
    return [
      { key: "targetR", label: "Ziel", options: [1.5, 2, 3], format: (v) => `${String(v).replace(".", ",")} R`, grid: true },
      { key: "stopAtr", label: "Stop", options: [1, 1.5, 2], format: (v) => `${String(v).replace(".", ",")} × ATR`, grid: true },
      { key: "minStrength", label: "Mindest-Stärke", options: strengths, format: (v) => `≥ ${v}`, grid: true },
      { key: "maxBars", label: "Zeit-Stop", options: cfg.step === "4h" ? [12, 30, 60] : [24, 72, 168], format: (v) => `${v} Kerzen`, grid: false },
    ];
  },
  build(prep, params: Params) {
    const targetR = Number(params.targetR ?? 2);
    const stopAtr = Number(params.stopAtr ?? 1.5);
    const minStrength = Number(params.minStrength ?? 3);
    const maxBars = Number(params.maxBars ?? 30);
    const pass = (v: McbFact["long"]) => !!v && v.valid && v.strength >= minStrength;
    return {
      start: prep.start,
      signalAt(i: number): EntrySignal | null {
        const f = prep.facts[i];
        if (!f) return null;
        const prev = prep.facts[i - 1] ?? null;
        const close = prep.bars[i]!.c;
        const atr = prep.atr[i] ?? 0;
        if (!(atr > 0)) return null;
        for (const side of ["long", "short"] as const) {
          const v = f[side];
          if (!pass(v) || pass(prev?.[side] ?? null)) continue; // edge-triggered: a NEW entry only
          const d = stopAtr * atr;
          const dir = side === "long" ? 1 : -1;
          return { side, stop: close - dir * d, target: close + dir * d * targetR, maxBars, tag: `MCB ${side === "long" ? "Long" : "Short"}`, grade: `Stärke ${v!.strength}`, score: v!.score };
        }
        return null;
      },
    };
  },
};

/**
 * Box-zu-Box on history (P07): the REAL engine (`analyzeBoxes` from `@/domain/boxes`, the same code the Markt page and
 * the alerts run live) evaluated bar by bar on the bars that were CLOSED at that moment – a window of the last 760
 * closed bars, exactly what the live store feeds it. The higher timeframe (1D for 4h, 1W for 1D) is aggregated from
 * the same bars and only from buckets that were complete at that close. No look-ahead: bar i never sees bar i + 1.
 *
 * Differences to live, named in the lab's assumptions: the Binance top-trader bias is not available historically (Binance
 * keeps ~30 days) → it counts as "no data" (the reason weight stays unmet, so grades are, if anything, stricter); a
 * "pre" setup (breakout prepared, close pending) is never traded – the lab waits for the close like the rule says.
 *
 * Parameters: minimum grade (A+ only, or A and A+ – "trade the best"), target T1 / T2, time stop, setup kinds.
 * One trade per box setup (box start × kind × side): a stop-out does not re-enter the same idea.
 */
import { analyzeBoxes, boxState, DEFAULT_BOX_CFG, type BoxState, type Grade, type SetupKind } from "../../boxes";
import { atrSeries, closedCount, toDaily, toWeekly } from "../bars";
import type { Bar, BarsBy, EntrySignal } from "../types";
import { loopStepper, type LabStrategy, type ParamSpec, type Params, type Prepared } from "./types";

export type BoxTfChoice = "4h" | "1d";
export interface BoxCfgIn {
  tf: BoxTfChoice;
}

/** Bars the live store feeds the engine (box lookback 700 + ATR warm-up). */
export const BOX_WINDOW = 760;
/** Warm-up before the first tradable bar: enough history for boxes and the RSI lines. */
export const BOX_WARMUP = 300;

export interface BoxCandidate {
  side: "long" | "short";
  kind: SetupKind;
  grade: Grade;
  score: number;
  stop: number;
  targets: number[];
  rr: number | null;
  /** box start (s) – one trade per box idea */
  box: number;
}

export type BoxFacts = (readonly BoxCandidate[] | null)[];

const KIND_SETS: Readonly<Record<string, readonly SetupKind[]>> = {
  alle: ["range", "breakout", "retest", "fakeout"],
  ausbruch: ["breakout", "retest"],
  range: ["range", "fakeout"],
};

const SEC: Readonly<Record<BoxTfChoice, number>> = { "4h": 14_400, "1d": 86_400 };

export const boxToBox: LabStrategy<BoxFacts, BoxCfgIn> = {
  id: "box",
  intervals: (cfg) => [cfg.tf],
  warmupMs: (cfg) => BOX_WARMUP * SEC[cfg.tf] * 1000,
  prepare(data: BarsBy, cfg: BoxCfgIn, startMs: number) {
    const bars = (data[cfg.tf] ?? []) as readonly Bar[];
    const sec = SEC[cfg.tf];
    const htf = cfg.tf === "4h" ? toDaily(bars) : toWeekly(bars);
    const htfSec = cfg.tf === "4h" ? 86_400 : 7 * 86_400;
    const htfTf = cfg.tf === "4h" ? "1d" : "1w";
    const facts: BoxFacts = new Array<readonly BoxCandidate[] | null>(bars.length).fill(null);
    let start = 0;
    while (start < bars.length && bars[start]!.t * 1000 < startMs) start++;
    start = Math.max(start, Math.min(BOX_WARMUP, bars.length));
    let htfCount = -1;
    let htfState: BoxState | null = null;
    const n = Math.max(0, bars.length - start);
    return loopStepper(
      n,
      (k) => {
        const i = start + k;
        const closeS = bars[i]!.t + sec;
        const hc = closedCount(htf, htfSec, closeS);
        if (hc !== htfCount) {
          htfCount = hc;
          const hb = htf.slice(Math.max(0, hc - BOX_WINDOW), hc);
          htfState = hb.length >= 60 ? boxState(hb, DEFAULT_BOX_CFG) : null;
        }
        const win = bars.slice(Math.max(0, i + 1 - BOX_WINDOW), i + 1);
        const a = analyzeBoxes({ tf: cfg.tf, bars: win, bias: null, htf: htfState ? { tf: htfTf, state: htfState } : null });
        if (!a || !a.setups.length) return;
        facts[i] = a.setups
          .filter((s) => s.kind !== "pre")
          .map((s) => ({
            side: s.side,
            kind: s.kind,
            grade: s.grade,
            score: s.score,
            stop: s.stop,
            targets: s.targets.map((t) => t.price).filter((p) => Number.isFinite(p)),
            rr: s.rr,
            box: a.box.box?.t0 ?? 0,
          }));
      },
      (): Prepared<BoxFacts> => ({ interval: cfg.tf, bars, start, facts, atr: atrSeries(bars) }),
    );
  },
  specs(cfg): ParamSpec[] {
    const time = cfg.tf === "4h" ? [18, 42, 90] : [5, 12, 25];
    return [
      { key: "target", label: "Ziel", options: [1, 2], format: (v) => `T${v}`, grid: true },
      { key: "maxBars", label: "Zeit-Stop", options: time, format: (v) => `${v} Kerzen`, grid: true },
      { key: "minGrade", label: "Mindest-Note", options: ["A+", "A"], format: (v) => (v === "A+" ? "nur A+" : "A und A+"), grid: true },
      { key: "kinds", label: "Setup-Arten", options: ["alle", "ausbruch", "range"], format: (v) => (v === "alle" ? "Alle" : v === "ausbruch" ? "Ausbruch + Retest" : "Range + Fehlausbruch"), grid: true },
    ];
  },
  build(prep, params: Params) {
    const minGrade = params.minGrade === "A+" ? "A+" : "A";
    const kinds = KIND_SETS[String(params.kinds)] ?? KIND_SETS.alle!;
    const tIdx = Math.max(0, Number(params.target ?? 1) - 1);
    const maxBars = Number(params.maxBars ?? 42);
    const used = new Set<string>();
    const ok = (g: Grade) => (minGrade === "A+" ? g === "A+" : g === "A+" || g === "A");
    return {
      start: prep.start,
      signalAt(i: number): EntrySignal | null {
        const cands = prep.facts[i];
        if (!cands) return null;
        const close = prep.bars[i]!.c;
        for (const c of cands) {
          if (!ok(c.grade) || !kinds.includes(c.kind)) continue;
          const key = `${c.box}:${c.kind}:${c.side}`;
          if (used.has(key)) continue;
          const long = c.side === "long";
          const tgt = c.targets[Math.min(tIdx, c.targets.length - 1)] ?? null;
          if (tgt == null || (long ? tgt <= close : tgt >= close)) continue;
          if (long ? c.stop >= close : c.stop <= close) continue;
          used.add(key);
          return { side: c.side, stop: c.stop, target: tgt, maxBars, tag: `${KIND_TAG[c.kind]} ${long ? "Long" : "Short"}`, grade: c.grade, score: c.score };
        }
        return null;
      },
    };
  },
};

export const KIND_TAG: Readonly<Record<SetupKind, string>> = { range: "Range", breakout: "Ausbruch", retest: "Retest", fakeout: "Fehlausbruch", pre: "Vorbereitet" };

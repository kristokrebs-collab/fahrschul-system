/**
 * Rule builder (Regel-Baukasten, P07): a long or short entry when ALL conditions hold at a close – and did not all hold
 * at the previous close (a new signal, no re-entry while the condition simply stays true). Conditions on closed bars:
 * RSI(14) below / above a level, EMA cross up / down, close above / below an EMA, a close above the highest high /
 * below the lowest low of the previous N bars. Stop = close ∓ k × ATR(14), target = a multiple of that risk.
 * Indicator series are computed once over the whole history (they only use past values at every index).
 */
import { ema, rsi } from "../../signals";
import { atrSeries } from "../bars";
import type { Bar, BarsBy, BtSide, EntrySignal, HistInterval } from "../types";
import { loopStepper, type LabStrategy, type ParamSpec, type Params, type Prepared } from "./types";

export type RuleKind = "rsiBelow" | "rsiAbove" | "emaCrossUp" | "emaCrossDown" | "closeAboveEma" | "closeBelowEma" | "breakoutHigh" | "breakdownLow";

export interface RuleCond {
  kind: RuleKind;
  /** RSI level, or the EMA length (close vs EMA), or the look-back of a breakout */
  a: number;
  /** slow EMA length of a cross */
  b?: number;
}

export interface RulesCfgIn {
  interval: Extract<HistInterval, "1h" | "4h" | "1d">;
  side: BtSide;
  conds: readonly RuleCond[];
}

export const RULE_LABEL: Readonly<Record<RuleKind, string>> = {
  rsiBelow: "RSI unter",
  rsiAbove: "RSI über",
  emaCrossUp: "EMA kreuzt nach oben",
  emaCrossDown: "EMA kreuzt nach unten",
  closeAboveEma: "Schluss über EMA",
  closeBelowEma: "Schluss unter EMA",
  breakoutHigh: "Schluss über Hoch der letzten",
  breakdownLow: "Schluss unter Tief der letzten",
};

/** Defaults for a new condition of each kind. */
export const RULE_DEFAULTS: Readonly<Record<RuleKind, RuleCond>> = {
  rsiBelow: { kind: "rsiBelow", a: 30 },
  rsiAbove: { kind: "rsiAbove", a: 70 },
  emaCrossUp: { kind: "emaCrossUp", a: 21, b: 55 },
  emaCrossDown: { kind: "emaCrossDown", a: 21, b: 55 },
  closeAboveEma: { kind: "closeAboveEma", a: 200 },
  closeBelowEma: { kind: "closeBelowEma", a: 200 },
  breakoutHigh: { kind: "breakoutHigh", a: 20 },
  breakdownLow: { kind: "breakdownLow", a: 20 },
};

/** Clamps a condition to sane ranges (UI input is free). */
export function sanitizeCond(c: RuleCond): RuleCond {
  const int = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)));
  switch (c.kind) {
    case "rsiBelow":
    case "rsiAbove":
      return { kind: c.kind, a: Math.max(1, Math.min(99, Number.isFinite(c.a) ? c.a : 50)) };
    case "emaCrossUp":
    case "emaCrossDown": {
      const x = int(c.a, 2, 400);
      const y = int(c.b ?? x * 2, 2, 400);
      const lo = Math.min(x, y);
      const hi = Math.max(x, y);
      return { kind: c.kind, a: lo, b: hi > lo ? hi : lo + 1 };
    }
    case "closeAboveEma":
    case "closeBelowEma":
      return { kind: c.kind, a: int(c.a, 2, 400) };
    case "breakoutHigh":
    case "breakdownLow":
      return { kind: c.kind, a: int(c.a, 2, 400) };
  }
}

/** Human text of a condition ("RSI unter 30", "EMA 21 kreuzt EMA 55 nach oben"). */
export function condText(c: RuleCond): string {
  const n = (v: number) => String(v).replace(".", ",");
  switch (c.kind) {
    case "rsiBelow":
    case "rsiAbove":
      return `${RULE_LABEL[c.kind]} ${n(c.a)}`;
    case "emaCrossUp":
      return `EMA ${c.a} kreuzt EMA ${c.b} nach oben`;
    case "emaCrossDown":
      return `EMA ${c.a} kreuzt EMA ${c.b} nach unten`;
    case "closeAboveEma":
    case "closeBelowEma":
      return `${RULE_LABEL[c.kind]} ${c.a}`;
    case "breakoutHigh":
    case "breakdownLow":
      return `${RULE_LABEL[c.kind]} ${c.a} Kerzen`;
  }
}

/** Longest look-back of the conditions (warm-up). */
export function rulesLookback(conds: readonly RuleCond[]): number {
  let m = 30;
  for (const c of conds) m = Math.max(m, c.kind.startsWith("ema") ? (c.b ?? c.a) * 3 : c.kind.endsWith("Ema") ? c.a * 3 : c.kind.startsWith("rsi") ? 150 : c.a + 1);
  return m;
}

const SEC: Readonly<Record<RulesCfgIn["interval"], number>> = { "1h": 3600, "4h": 14_400, "1d": 86_400 };

/** Per bar: did all conditions hold at this close? Plus the side the rules trade. */
export interface RuleFacts {
  hit: Uint8Array;
  side: BtSide;
}

export function evalConds(bars: readonly Bar[], conds: readonly RuleCond[]): Uint8Array {
  const n = bars.length;
  const out = new Uint8Array(n);
  if (!conds.length || !n) return out;
  const close = bars.map((b) => b.c);
  const emaCache = new Map<number, number[]>();
  const emaOf = (len: number) => {
    let e = emaCache.get(len);
    if (!e) emaCache.set(len, (e = ema(close, len)));
    return e;
  };
  const r = conds.some((c) => c.kind.startsWith("rsi")) ? rsi(close, 14) : [];
  const checks = conds.map((raw) => {
    const c = sanitizeCond(raw);
    switch (c.kind) {
      case "rsiBelow":
        return (i: number) => Number.isFinite(r[i]!) && r[i]! < c.a;
      case "rsiAbove":
        return (i: number) => Number.isFinite(r[i]!) && r[i]! > c.a;
      case "emaCrossUp":
      case "emaCrossDown": {
        const f = emaOf(c.a);
        const s = emaOf(c.b!);
        const up = c.kind === "emaCrossUp";
        return (i: number) => i > 0 && (up ? f[i - 1]! <= s[i - 1]! && f[i]! > s[i]! : f[i - 1]! >= s[i - 1]! && f[i]! < s[i]!);
      }
      case "closeAboveEma":
      case "closeBelowEma": {
        const e = emaOf(c.a);
        const above = c.kind === "closeAboveEma";
        return (i: number) => i >= c.a && (above ? close[i]! > e[i]! : close[i]! < e[i]!);
      }
      case "breakoutHigh":
      case "breakdownLow": {
        const hi = c.kind === "breakoutHigh";
        return (i: number) => {
          if (i < c.a) return false;
          let ext = hi ? -Infinity : Infinity;
          for (let k = i - c.a; k < i; k++) ext = hi ? Math.max(ext, bars[k]!.h) : Math.min(ext, bars[k]!.l);
          return hi ? close[i]! > ext : close[i]! < ext;
        };
      }
    }
  });
  for (let i = 0; i < n; i++) out[i] = checks.every((f) => f(i)) ? 1 : 0;
  return out;
}

export const ruleBuilder: LabStrategy<RuleFacts, RulesCfgIn> = {
  id: "rules",
  intervals: (cfg) => [cfg.interval],
  warmupMs: (cfg) => rulesLookback(cfg.conds) * SEC[cfg.interval] * 1000,
  prepare(data: BarsBy, cfg: RulesCfgIn, startMs: number) {
    const bars = (data[cfg.interval] ?? []) as readonly Bar[];
    let start = 0;
    while (start < bars.length && bars[start]!.t * 1000 < startMs) start++;
    const facts: RuleFacts = { hit: new Uint8Array(0), side: cfg.side === "short" ? "short" : "long" };
    return loopStepper(
      1,
      () => {
        facts.hit = evalConds(bars, cfg.conds);
      },
      (): Prepared<RuleFacts> => ({ interval: cfg.interval, bars, start, facts, atr: atrSeries(bars) }),
    );
  },
  specs(cfg): ParamSpec[] {
    return [
      { key: "targetR", label: "Ziel", options: [1.5, 2, 3], format: (v) => `${String(v).replace(".", ",")} R`, grid: true },
      { key: "stopAtr", label: "Stop", options: [1, 1.5, 2], format: (v) => `${String(v).replace(".", ",")} × ATR`, grid: true },
      { key: "maxBars", label: "Zeit-Stop", options: cfg.interval === "1d" ? [5, 10, 20] : cfg.interval === "4h" ? [12, 30, 60] : [24, 72, 168], format: (v) => `${v} Kerzen`, grid: true },
    ];
  },
  build(prep, params: Params) {
    const targetR = Number(params.targetR ?? 2);
    const stopAtr = Number(params.stopAtr ?? 1.5);
    const maxBars = Number(params.maxBars ?? 30);
    const { hit, side } = prep.facts;
    return {
      start: prep.start,
      signalAt(i: number): EntrySignal | null {
        if (!hit[i] || (i > 0 && hit[i - 1])) return null;
        const close = prep.bars[i]!.c;
        const atr = prep.atr[i] ?? 0;
        if (!(atr > 0)) return null;
        const d = stopAtr * atr;
        const dir = side === "long" ? 1 : -1;
        return { side, stop: close - dir * d, target: close + dir * d * targetR, maxBars, tag: `Regel ${side === "long" ? "Long" : "Short"}` };
      },
    };
  },
};

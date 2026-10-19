/**
 * Shared kit of the rule blocks (F73 / F06): the evaluation context, the block definition type and the small helpers every
 * block file uses (relations / crossings, "within the last n bars", German phrases). Pure.
 */
import { DEFAULT_SIGNAL_CFG, type SignalCfg } from "../../signals/config";
import { ema, sma, type Bar } from "../../signals/indicators";
import type { McbFacts } from "../../backtest/strategies/mcbLadder";
import type { FundingPoint } from "../../backtest/types";
import type { Stepper } from "../../backtest/strategies/types";
import { triFrom, withinBars } from "./indicators";
import type { BlockId, Family, LeafParams, ParamDef } from "./types";

/** What a block evaluates on. */
export interface EvalCtx {
  bars: readonly Bar[];
  n: number;
  /** the app's MCB / signal setting (WaveTrend parameters, RSI MA length, swing size …) */
  signal: SignalCfg;
  /** prepared MCB ladder verdicts per execution bar (only on the execution series) */
  ladder: McbFacts | null;
  /** length of one bar of this series in seconds (inferred from the bars when not given) */
  tfSec: number;
  /** the funding history of the run (settlements, ascending, `t` in ms) – null when the run has none */
  funding: readonly FundingPoint[] | null;
  /** per-series cache of shared indicator series */
  memo<T>(key: string, make: () => T): T;
}

/** Bar length in seconds: the smallest positive step between the first bars (a gap does not fool it). */
export function inferTfSec(bars: readonly Bar[]): number {
  let best = Infinity;
  for (let i = 1; i < Math.min(bars.length, 40); i++) {
    const d = bars[i]!.t - bars[i - 1]!.t;
    if (d > 0 && d < best) best = d;
  }
  return Number.isFinite(best) ? best : 0;
}

export interface CtxExtra {
  tfSec?: number;
  funding?: readonly FundingPoint[] | null;
}

export function makeCtx(bars: readonly Bar[], signal: SignalCfg = DEFAULT_SIGNAL_CFG, ladder: McbFacts | null = null, extra: CtxExtra = {}): EvalCtx {
  const cache = new Map<string, unknown>();
  return {
    bars,
    n: bars.length,
    signal,
    ladder,
    tfSec: extra.tfSec ?? inferTfSec(bars),
    funding: extra.funding ?? null,
    memo<T>(key: string, make: () => T): T {
      if (!cache.has(key)) cache.set(key, make());
      return cache.get(key) as T;
    },
  };
}

export interface BlockDef {
  id: BlockId;
  label: string;
  family: Family;
  /** one sentence: what it checks */
  help: string;
  params: readonly ParamDef[];
  /** bars of its own timeframe before the first valid value */
  warmup(p: LeafParams): number;
  /** cross-parameter repairs after clamping (fast < slow …) */
  fix?(p: LeafParams): LeafParams;
  /** the block cannot use another timeframe; the text says why */
  execOnly?: string;
  /** a problem of THESE parameters on a timeframe of `tfSec` seconds (an error text), or null – e.g. a 15-minute range on 1h bars */
  check?(p: LeafParams, tfSec: number): string | null;
  /** the block needs data of the run itself (funding history); the text says what, for the lock reason in the UI */
  needsRunData?: "funding";
  /** the block is expensive (the UI says so) */
  heavy?: string;
  needsVolume?: boolean;
  eval(ctx: EvalCtx, p: LeafParams): Uint8Array | Stepper<Uint8Array>;
  /** plain-language phrase ("RSI(14) unter 30") */
  text(p: LeafParams): string;
  /** the same idea for the other side ("RSI(14) über 70") */
  mirror(p: LeafParams): LeafParams;
}

export const num = (p: LeafParams, k: string): number => Number(p[k]);
export const str = (p: LeafParams, k: string): string => String(p[k]);
export const de = (v: number): string => String(Math.round(v * 10_000) / 10_000).replace(".", ",");
export const swap = (p: LeafParams, key: string, pairs: Record<string, string>): LeafParams => ({ ...p, [key]: pairs[str(p, key)] ?? p[key]! });
export const within = (n: number): string => (n > 1 ? ` (innerhalb der letzten ${n} Kerzen)` : "");

export type Rel = "above" | "below" | "crossUp" | "crossDown";
export const REL_OPTIONS = [
  { v: "above", label: "darüber" },
  { v: "below", label: "darunter" },
  { v: "crossUp", label: "kreuzt nach oben" },
  { v: "crossDown", label: "kreuzt nach unten" },
] as const;
export const REL_MIRROR: Record<string, string> = { above: "below", below: "above", crossUp: "crossDown", crossDown: "crossUp" };
export const REL_WORD: Record<Rel, string> = { above: "über", below: "unter", crossUp: "kreuzt nach oben", crossDown: "kreuzt nach unten" };
export const isCross = (m: string): boolean => m === "crossUp" || m === "crossDown";
export const WITHIN: ParamDef = { key: "within", label: "Innerhalb der letzten", kind: "int", def: 1, min: 1, max: 50, unit: "Kerzen", hint: "Das Ereignis darf so viele Kerzen zurückliegen." };
export const whenCross: ParamDef["when"] = (p) => isCross(str(p, "mode"));

/** value series vs a level or another series: state or cross; NaN on either side = unknown. */
export function relate(n: number, v: ArrayLike<number>, ref: number | ArrayLike<number>, mode: Rel, win: number, warm = 0): Uint8Array {
  const at = (i: number): number => (typeof ref === "number" ? ref : ref[i]!);
  const out = triFrom(n, (i) => {
    if (i < warm) return null;
    const a = v[i]!;
    const b = at(i);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (mode === "above") return a > b;
    if (mode === "below") return a < b;
    if (i < 1) return null;
    const pa = v[i - 1]!;
    const pb = at(i - 1);
    if (!Number.isFinite(pa) || !Number.isFinite(pb)) return null;
    return mode === "crossUp" ? pa <= pb && a > b : pa >= pb && a < b;
  });
  return isCross(mode) ? withinBars(out, win) : out;
}

export const closeOf = (c: EvalCtx): number[] => c.memo("close", () => c.bars.map((b) => b.c));
export const highOf = (c: EvalCtx): number[] => c.memo("high", () => c.bars.map((b) => b.h));
export const lowOf = (c: EvalCtx): number[] => c.memo("low", () => c.bars.map((b) => b.l));
export const maOf = (c: EvalCtx, type: string, len: number): number[] => c.memo(`${type}${len}`, () => (type === "sma" ? sma(closeOf(c), len) : ema(closeOf(c), len)));
export const maWarm = (type: string, len: number): number => (type === "sma" ? len : len * 3);

export const MA_TYPE: ParamDef = {
  key: "type",
  label: "Art",
  kind: "select",
  def: "ema",
  options: [
    { v: "ema", label: "EMA" },
    { v: "sma", label: "SMA" },
  ],
};

/** Session key of a UTC instant given in seconds: Sa / So = weekend, else Asien < 07, London < 13, New York < 21, Spät. */
export function sessionOfSec(t: number): string {
  const d = new Date(t * 1000);
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return "weekend";
  const h = d.getUTCHours();
  return h < 7 ? "asia" : h < 13 ? "london" : h < 21 ? "ny" : "late";
}


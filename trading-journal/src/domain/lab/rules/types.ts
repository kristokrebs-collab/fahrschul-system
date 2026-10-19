/**
 * "Eigene Idee" (F73): the serialisable, versioned rule tree of the custom lab strategy. Pure data – the tree is what the
 * builder UI edits, what the lab store persists (named drafts) and what `Diagnosis` describes in plain language.
 *
 * - A group combines its children with AND / OR; a leaf is one building block (`BlockId`) with its own parameters and its
 *   own timeframe (`"exec"` = the execution interval, or a HIGHER interval whose bars only count once they have CLOSED).
 * - Every leaf evaluates to a tri-state per bar: 0 = false, 1 = true, 2 = UNKNOWN (not enough data, a gap, no volume …).
 *   Unknown never satisfies a required leaf; the combination is Kleene logic (AND: one false → false, else one unknown →
 *   unknown; OR: one true → true, else one unknown → unknown). Only a final `1` is a signal.
 */
import type { HistInterval } from "../../backtest/types";

/** Version of the stored configuration. Bump with a migration in `parseCustom`. */
export const CUSTOM_VERSION = 1 as const;

export type TfId = HistInterval;
/** All timeframes a leaf can use, small → large. */
export const TF_IDS: readonly TfId[] = ["15m", "30m", "1h", "2h", "4h", "1d"];
export const TF_LABEL: Readonly<Record<TfId, string>> = { "15m": "15m", "30m": "30m", "1h": "1h", "2h": "2h", "4h": "4h", "1d": "1D" };
export const TF_SEC: Readonly<Record<TfId, number>> = { "15m": 900, "30m": 1800, "1h": 3600, "2h": 7200, "4h": 14_400, "1d": 86_400 };

/** Execution intervals the strategy can run on. */
export const EXEC_TFS: readonly TfId[] = ["15m", "30m", "1h", "2h", "4h", "1d"];

/** tri-state: 0 false · 1 true · 2 unknown */
export const FALSE = 0 as const;
export const TRUE = 1 as const;
export const UNKNOWN = 2 as const;
export type Tri = 0 | 1 | 2;

export type BlockId =
  | "rsi"
  | "rsiMa"
  | "wtEvent"
  | "wtState"
  | "mcbLadder"
  | "zone"
  | "maCross"
  | "maPrice"
  | "macd"
  | "bollinger"
  | "atrPct"
  | "breakout"
  | "keyLevel"
  | "volume"
  | "rsiLine"
  | "timeWindow"
  // F06: more known indicators
  | "donchian"
  | "adx"
  | "stoch"
  | "keltner"
  | "ichimoku"
  | "cci"
  | "willr"
  | "obv"
  | "vwap"
  | "orb"
  | "insideBar"
  | "heikin"
  | "pivotBreak"
  | "fib"
  | "funding"
  | "supertrend"
  | "chandelier";

export type LeafParams = Record<string, number | string>;

export interface Leaf {
  type: "leaf";
  /** unique inside the configuration (`n1`, `n2` …) */
  id: string;
  block: BlockId;
  /** `"exec"` follows the execution interval; else a higher interval */
  tf: "exec" | TfId;
  params: LeafParams;
  /** the opposite of the block's result (unknown stays unknown) */
  not?: boolean;
}

export interface Group {
  type: "group";
  id: string;
  op: "and" | "or";
  children: Node[];
}

export type Node = Leaf | Group;

export type StopKind = "atr" | "percent" | "swing";
export interface StopCfg {
  kind: StopKind;
  /** ATR(14) multiple */
  atr: number;
  /** percent of the close */
  pct: number;
  /** bars for the swing low / high (the signal bar included) */
  swing: number;
  /** extra distance beyond the swing in ATR(14) */
  buffer: number;
}

export interface TargetCfg {
  kind: "r" | "none";
  r: number;
}

export interface ExitsCfg {
  breakEven: { on: boolean; trigger: "r" | "pct"; value: number; to: "entry" | "net" };
  trail: { on: boolean; kind: "atr" | "pct"; value: number; activateR: number };
  partial: { on: boolean; atR: number; fracPct: number; thenBreakEven: boolean };
  /** time stop in bars after the fill, 0 = none */
  maxBars: number;
  /** leave at the next open when the opposite side's rules produce a NEW signal */
  exitOnOpposite: boolean;
}

export type SidesCfg = "long" | "short" | "both";

export interface CustomConfig {
  version: typeof CUSTOM_VERSION;
  /** name of the idea (drafts) */
  name: string;
  /** execution interval: the engine walks these bars */
  interval: TfId;
  sides: SidesCfg;
  long: Group;
  short: Group;
  stop: StopCfg;
  target: TargetCfg;
  exits: ExitsCfg;
}

/** A finding about the configuration. Errors block the run; warnings are shown and let it run. */
export interface Issue {
  level: "error" | "warn";
  /** node the message is about (leaf / group id), if any */
  node?: string;
  text: string;
}

export interface ParamDef {
  key: string;
  label: string;
  kind: "int" | "float" | "select";
  def: number | string;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly { v: string; label: string }[];
  unit?: string;
  hint?: string;
  /** the parameter only matters when this holds for the leaf's other parameters */
  when?: (p: LeafParams) => boolean;
}

export type Family = "momentum" | "mcb" | "trend" | "volatility" | "structure" | "price" | "time";
export const FAMILY_LABEL: Readonly<Record<Family, string>> = {
  momentum: "Momentum",
  mcb: "MCB / WaveTrend",
  trend: "Trend",
  volatility: "Volatilität",
  structure: "Struktur & Zonen",
  price: "Preis & Volumen",
  time: "Zeit",
};

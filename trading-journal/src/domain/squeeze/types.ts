/** Squeeze observation (F07) – the shapes. Pure. */

/** Which side of the market is crowded: `long` = longs (funding > 0, long accounts), `short` = shorts. */
export type SqueezeSide = "long" | "short";

export interface PremiumPt {
  t: number;
  mark: number | null;
  /** last settled funding rate as a fraction (0.0001 = 0,01 %) */
  rate: number | null;
}
export interface OiPt {
  t: number;
  oi: number;
}
/** Long share of an account / position split in percent (0 … 100). */
export interface LsPt {
  t: number;
  long: number;
}

/** The archive series the observation reads, each ascending by time. */
export interface SqueezeData {
  premium: readonly PremiumPt[];
  oi: readonly OiPt[];
  /** all accounts */
  ls: readonly LsPt[];
  /** top-trader positions – shown beside the reading, not part of the rule */
  top?: readonly LsPt[];
}

export type SignalKey = "funding" | "oi" | "accounts";

export interface Signal {
  key: SignalKey;
  label: string;
  /** the number behind the text; `null` = no data */
  value: number | null;
  text: string;
  /** the threshold in words */
  threshold: string;
  /** `null` = no data (never counted as met) */
  met: boolean | null;
  /** the side a met reading points to (open interest has none) */
  side: SqueezeSide | null;
  /** time of the point the reading rests on */
  at: number | null;
  /** why there is no data */
  note: string | null;
}

/** `watch` = the observation holds · `calm` = it does not · `conflict` = funding and accounts point to opposite sides · `nodata` = nothing to read. */
export type SqueezeState = "watch" | "calm" | "conflict" | "nodata";

export interface SqueezeReading {
  /** time of the newest point (ms), `null` without any */
  at: number | null;
  state: SqueezeState;
  side: SqueezeSide | null;
  /** readings that hold, counting funding and accounts only when they point to `side`, plus the open-interest rise */
  met: number;
  /** readings with data (0 … 3) */
  known: number;
  signals: Signal[];
  mark: number | null;
  /** top-trader long share beside the reading */
  topLong: { pct: number; at: number } | null;
  /** the archive is not being written right now (the newest point is too old) */
  stale: boolean;
}

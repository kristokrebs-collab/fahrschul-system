/**
 * Signal-check configuration (`settings.signals`). Names, shape and defaults are the other journal's
 * `SignalCfg` / `DEFAULT_SIGNAL_CFG` 1:1 (origin/claude/dreamy-dirac-uwi1be `signals.ts:10-36`), so the same
 * `tj2-settings` value works in both apps. Additive here: `notify` (system notification on a new valid entry).
 */

export type Side = "long" | "short";

export interface SignalCfg {
  /** Timeframes from small to large, e.g. `['30m','45m','1h','4h']`. */
  ladder: string[];
  /** Rungs that must confirm (base + next higher). */
  required: number;
  wtSource: "hlc3" | "close";
  /** n1 (ESA/DE EMA length) */
  wtChannel: number;
  /** n2 (wt1 EMA length) */
  wtAverage: number;
  /** SMA length for wt2 */
  wtSignal: number;
  wtOb: number;
  wtObStrong: number;
  wtOs: number;
  wtOsStrong: number;
  /** How many candles an event stays lit (includes the running candle). */
  signalLookback: number;
  /** MCB "Potential Reversal Range" for Bottom/Top. */
  revRange: number;
  rsiLen: number;
  rsiMaLen: number;
  rsiOb: number;
  rsiOs: number;
  /** "Near" = within this many RSI points (long ≤ rsiOs + rsiNear, short ≥ rsiOb − rsiNear). */
  rsiNear: number;
  /** LuxAlgo swing size. */
  swingLookback: number;
  /** Timeframe used for Premium/Discount. */
  zoneTf: string;
  /** Additive (ours): also show a system notification (Notification API) on a new valid entry. Default off. */
  notify?: boolean;
}

export const DEFAULT_SIGNAL_CFG: SignalCfg = {
  ladder: ["30m", "45m", "1h", "4h"],
  required: 2,
  // MCB {WeloTrades} laut Status-Zeile im Chart: close 9 21, Levels 60/53 und −60/−53, Reversal Range 28
  wtSource: "close",
  wtChannel: 9,
  wtAverage: 21,
  wtSignal: 2,
  wtOb: 53,
  wtObStrong: 60,
  wtOs: -53,
  wtOsStrong: -60,
  signalLookback: 3,
  revRange: 28,
  rsiLen: 14,
  rsiMaLen: 14,
  rsiOb: 70,
  rsiOs: 30,
  rsiNear: 10,
  swingLookback: 50,
  zoneTf: "1h",
};

const TF_SEC: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "45m": 2700,
  "1h": 3600,
  "2h": 7200,
  "3h": 10800,
  "4h": 14400,
  "1D": 86400,
  "1W": 604800,
};

/** Bar length in SECONDS (`0` for an unknown timeframe), like the other journal's `tfSeconds`. */
export const tfSeconds = (tf: string): number => TF_SEC[tf] || 0;

/** The choices offered in the settings (ladder rungs and zone timeframe). */
export const SIGNAL_TFS: readonly string[] = ["30m", "45m", "1h", "2h", "3h", "4h", "1D"];

export const STRENGTH_LABEL: readonly string[] = ["Kein Signal", "Einstieg", "Stark", "Sehr stark", "Maximal"];

/** Number of bars per timeframe the engine evaluates (the other journal asked TradingView for `count: 500`). */
export const SIGNAL_BARS = 500;
/** Fewer bars → the timeframe is "Zu wenig Kerzen" (`checkTf` returns null). */
export const MIN_SIGNAL_BARS = 150;

const NUM_KEYS = [
  "required",
  "wtChannel",
  "wtAverage",
  "wtSignal",
  "wtOb",
  "wtObStrong",
  "wtOs",
  "wtOsStrong",
  "signalLookback",
  "revRange",
  "rsiLen",
  "rsiMaLen",
  "rsiOb",
  "rsiOs",
  "rsiNear",
  "swingLookback",
] as const;

/** Lower bounds for the integer lengths (the settings card enforces the same). */
const MIN: Partial<Record<(typeof NUM_KEYS)[number], number>> = {
  wtChannel: 2,
  wtAverage: 2,
  wtSignal: 1,
  signalLookback: 1,
  revRange: 2,
  rsiLen: 2,
  rsiMaLen: 1,
  swingLookback: 20,
};

/**
 * Settings value → a config the engine can run with. Fixes the other journal's ladder defects (§1.12):
 * unknown / duplicate rungs are dropped, the ladder is sorted ascending, rungs below 30m are removed,
 * `required` is clamped to `1..ladder.length`. Missing or non-finite numbers fall back to the defaults.
 * Unknown keys are KEPT (zero data loss: the result is meant for the engine; never write it back blindly).
 */
export function sanitizeSignalCfg(raw: unknown): SignalCfg {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: SignalCfg = { ...DEFAULT_SIGNAL_CFG, ...(r as Partial<SignalCfg>) };
  for (const k of NUM_KEYS) {
    const v = r[k];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    let x = Number.isFinite(n) ? n : DEFAULT_SIGNAL_CFG[k];
    const lo = MIN[k];
    if (lo !== undefined) x = Math.max(lo, Math.round(x));
    out[k] = x;
  }
  out.wtSource = r.wtSource === "hlc3" ? "hlc3" : "close";
  const min = tfSeconds("30m");
  const ladder = Array.isArray(r.ladder) ? r.ladder.filter((t): t is string => typeof t === "string" && SIGNAL_TFS.includes(t) && tfSeconds(t) >= min) : [];
  const uniq = [...new Set(ladder)].sort((a, b) => tfSeconds(a) - tfSeconds(b));
  out.ladder = uniq.length >= 1 ? uniq : [...DEFAULT_SIGNAL_CFG.ladder];
  out.required = Math.min(out.ladder.length, Math.max(1, Math.round(out.required)));
  out.zoneTf = typeof r.zoneTf === "string" && SIGNAL_TFS.includes(r.zoneTf) ? r.zoneTf : DEFAULT_SIGNAL_CFG.zoneTf;
  out.notify = r.notify === true;
  return out;
}

/** Stable key of the parts of a config that change the evaluation (cache key for retro checks). */
export function signalCfgKey(cfg: SignalCfg): string {
  return [cfg.ladder.join(","), cfg.zoneTf, cfg.wtSource, ...NUM_KEYS.map((k) => cfg[k])].join("|");
}

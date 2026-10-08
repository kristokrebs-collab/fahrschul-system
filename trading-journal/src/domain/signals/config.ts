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
  /**
   * Additive (ours): "Top-Trader kaufen · Retail rot" — Binance top traders buy (top-trader position long % rising)
   * while retail is red (all-accounts long % falling) over the last closed periods; short mirrored. Absent = the
   * defaults (`DEFAULT_WHALE_CFG`, on); `sanitizeSignalCfg` always fills it. See `whale.ts`.
   */
  whale?: WhaleCfg;
  /**
   * Additive (ours, decision 9): closes after which a confirmed signal is "stark bestätigt", counted from the signal
   * candle's own close (1 … 6, default 2 = the signal candle and the next one closed with the signal holding).
   * Absent = `DEFAULT_STRONG_CLOSES`; `sanitizeSignalCfg` always fills it. See `state.ts`.
   */
  strongCloses?: number;
  /** Additive (ours, decision 10): divergences RSI 14 / wt1 vs price pivots. Absent = `DEFAULT_DIV_CFG`. */
  div?: DivCfg;
  /** Additive (ours, decision 10): market structure + support/resistance (LuxAlgo SMC). Absent = `DEFAULT_SR_CFG`. */
  sr?: SrCfg;
}

/**
 * Settings of the Top-Trader condition (`settings.signals.whale`). Since decision 5 (2026-10-08) a GRADED combo of four
 * parts (top traders > `topPct` % long on positions, on accounts, retail long share falling, price in discount; short
 * mirrored), read from Binance's 5-min ratio data. `periods` / `minRun` belong to the former run rule ("Top-Trader kaufen
 * · Retail rot", n periods in a row) — kept so stored values and the legacy helpers (`whale.ts`) keep working; the
 * engine no longer grades with them.
 */
export interface WhaleCfg {
  /** evaluate and show the condition */
  on: boolean;
  /** legacy run rule: Binance futures-data periods (sorted small → large), e.g. `['30m', '1h']` */
  periods: string[];
  /** legacy run rule: consecutive closed periods, 1 … 6 */
  minRun: number;
  /** score points of the full combo (partial credit: weight × met / 4; 0 = shown only, never counted) */
  weight: number;
  /** top-trader long share threshold in % (long: > topPct on positions and on accounts; short: ≤ 100 − topPct), 50 … 90 */
  topPct: number;
  /** retail comparison: long share of all accounts now vs one `retailPeriod` earlier (5-min data): 5m · 15m · 30m · 1h */
  retailPeriod: string;
  /** parts (of 4) that give a valid entry +1 strength, 1 … 4 (with `weight` > 0) */
  bonusParts: number;
}

/** Divergence settings (`settings.signals.div`). */
export interface DivCfg {
  on: boolean;
  /** oscillators: RSI (`rsiLen`) and WaveTrend wt1 */
  rsi: boolean;
  wt: boolean;
  /** also hidden divergences (trend continuation) */
  hidden: boolean;
  /** pivot lookbacks: bars left / right of a pivot (MCB fractal = 2 / 2); right = confirmation delay */
  left: number;
  right: number;
  /** bars between the two pivots: min … max */
  rangeMin: number;
  rangeMax: number;
  /** a divergence counts in the check while its confirmation bar is at most this many bars old */
  maxAge: number;
  /** bullish pivots only below the midline (wt1 < 0, RSI < 50), bearish above */
  midline: boolean;
  /** score points of the part (0 = shown only) */
  weight: number;
}

/** Market structure / support-resistance settings (`settings.signals.sr`). Swing length = `swingLookback`. */
export interface SrCfg {
  on: boolean;
  /** LuxAlgo internal structure length (5) */
  internal: number;
  /** EQH/EQL: pivot length (3) and threshold × ATR 200 (0.1) */
  eqLen: number;
  eqThreshold: number;
  /** "near" support / resistance: within this many ATR 14 */
  nearAtr: number;
  /** "room": reward/risk to the next opposite level at least this R multiple */
  minR: number;
  /** score points of the part (0 = shown only) */
  weight: number;
}

/** Periods offered for the condition (Binance `/futures/data/*` periods that fit the ladder). */
export const WHALE_PERIODS: readonly string[] = ["15m", "30m", "1h", "2h", "4h"];
export const WHALE_MIN_RUN_MAX = 6;
export const WHALE_WEIGHT_MAX = 30;

export const DEFAULT_WHALE_CFG: Readonly<WhaleCfg> = Object.freeze({ on: true, periods: ["30m", "1h"], minRun: 2, weight: 10, topPct: 64, retailPeriod: "5m", bonusParts: 3 });
/** Retail comparison periods (all derivable from the 5-min series: the long share now vs one period earlier). */
export const WHALE_RETAIL_PERIODS: readonly string[] = ["5m", "15m", "30m", "1h"];

export const DEFAULT_STRONG_CLOSES = 2;
export const STRONG_CLOSES_MAX = 6;
export const PART_WEIGHT_MAX = 30;

export const DEFAULT_DIV_CFG: Readonly<DivCfg> = Object.freeze({ on: true, rsi: true, wt: true, hidden: true, left: 2, right: 2, rangeMin: 3, rangeMax: 60, maxAge: 5, midline: true, weight: 10 });
export const DEFAULT_SR_CFG: Readonly<SrCfg> = Object.freeze({ on: true, internal: 5, eqLen: 3, eqThreshold: 0.1, nearAtr: 1, minR: 2, weight: 10 });

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
  out.whale = sanitizeWhaleCfg(r.whale);
  out.strongCloses = intIn(r.strongCloses, DEFAULT_STRONG_CLOSES, 1, STRONG_CLOSES_MAX);
  out.div = sanitizeDivCfg(r.div);
  out.sr = sanitizeSrCfg(r.sr);
  return out;
}

const toNum = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const numIn = (v: unknown, d: number, lo: number, hi: number): number => {
  const n = toNum(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const intIn = (v: unknown, d: number, lo: number, hi: number): number => Math.round(numIn(v, d, lo, hi));
const boolOr = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const recOf = (raw: unknown): Record<string, unknown> => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});

/** `settings.signals.div` (raw) → usable divergence settings; unknown keys kept, numbers clamped, `rangeMax ≥ rangeMin`. */
export function sanitizeDivCfg(raw: unknown): DivCfg {
  const r = recOf(raw);
  const d = DEFAULT_DIV_CFG;
  const rangeMin = intIn(r.rangeMin, d.rangeMin, 1, 200);
  return {
    ...(r as Partial<DivCfg>),
    on: boolOr(r.on, d.on),
    rsi: boolOr(r.rsi, d.rsi),
    wt: boolOr(r.wt, d.wt),
    hidden: boolOr(r.hidden, d.hidden),
    left: intIn(r.left, d.left, 1, 20),
    right: intIn(r.right, d.right, 1, 20),
    rangeMin,
    rangeMax: Math.max(rangeMin, intIn(r.rangeMax, d.rangeMax, 1, 300)),
    maxAge: intIn(r.maxAge, d.maxAge, 0, 50),
    midline: boolOr(r.midline, d.midline),
    weight: intIn(r.weight, d.weight, 0, PART_WEIGHT_MAX),
  };
}

/** `settings.signals.sr` (raw) → usable structure / S-R settings; unknown keys kept. */
export function sanitizeSrCfg(raw: unknown): SrCfg {
  const r = recOf(raw);
  const d = DEFAULT_SR_CFG;
  return {
    ...(r as Partial<SrCfg>),
    on: boolOr(r.on, d.on),
    internal: intIn(r.internal, d.internal, 2, 20),
    eqLen: intIn(r.eqLen, d.eqLen, 2, 20),
    eqThreshold: numIn(r.eqThreshold, d.eqThreshold, 0, 2),
    nearAtr: numIn(r.nearAtr, d.nearAtr, 0.1, 10),
    minR: numIn(r.minR, d.minR, 0.5, 10),
    weight: intIn(r.weight, d.weight, 0, PART_WEIGHT_MAX),
  };
}

/** The divergence / structure settings a config runs with (defaults for a config without the key). */
export const divCfgOf = (cfg: Pick<SignalCfg, "div">): DivCfg => cfg.div ?? sanitizeDivCfg(undefined);
export const srCfgOf = (cfg: Pick<SignalCfg, "sr">): SrCfg => cfg.sr ?? sanitizeSrCfg(undefined);
export const strongClosesOf = (cfg: Pick<SignalCfg, "strongCloses">): number => cfg.strongCloses ?? DEFAULT_STRONG_CLOSES;

/**
 * `settings.signals.whale` (raw) → a usable `WhaleCfg`: unknown periods dropped, sorted and de-duplicated (none left →
 * the defaults), `minRun` 1 … 6, `weight` 0 … 30, non-finite → default. Unknown keys of the stored object are kept.
 */
export function sanitizeWhaleCfg(raw: unknown): WhaleCfg {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number): number => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : d;
  };
  const periods = Array.isArray(r.periods) ? [...new Set(r.periods.filter((p): p is string => typeof p === "string" && WHALE_PERIODS.includes(p)))].sort((a, b) => tfSeconds(a) - tfSeconds(b)) : [];
  return {
    ...(r as Partial<WhaleCfg>),
    on: typeof r.on === "boolean" ? r.on : DEFAULT_WHALE_CFG.on,
    periods: periods.length ? periods : [...DEFAULT_WHALE_CFG.periods],
    minRun: Math.min(WHALE_MIN_RUN_MAX, Math.max(1, Math.round(num(r.minRun, DEFAULT_WHALE_CFG.minRun)))),
    weight: Math.min(WHALE_WEIGHT_MAX, Math.max(0, Math.round(num(r.weight, DEFAULT_WHALE_CFG.weight)))),
    topPct: Math.min(90, Math.max(50, num(r.topPct, DEFAULT_WHALE_CFG.topPct))),
    retailPeriod: typeof r.retailPeriod === "string" && WHALE_RETAIL_PERIODS.includes(r.retailPeriod) ? r.retailPeriod : DEFAULT_WHALE_CFG.retailPeriod,
    bonusParts: Math.min(4, Math.max(1, Math.round(num(r.bonusParts, DEFAULT_WHALE_CFG.bonusParts)))),
  };
}

/** The whale settings a config runs with (the defaults for a config without the key, e.g. `DEFAULT_SIGNAL_CFG`). */
export const whaleCfgOf = (cfg: Pick<SignalCfg, "whale">): WhaleCfg => cfg.whale ?? sanitizeWhaleCfg(undefined);

/** Stable key of the parts of a config that change the evaluation (cache key for retro checks). */
export function signalCfgKey(cfg: SignalCfg): string {
  const w = whaleCfgOf(cfg);
  const d = divCfgOf(cfg);
  const r = srCfgOf(cfg);
  return [
    cfg.ladder.join(","),
    cfg.zoneTf,
    cfg.wtSource,
    ...NUM_KEYS.map((k) => cfg[k]),
    `w${w.on ? 1 : 0}:${w.periods.join(",")}:${w.minRun}:${w.weight}:${w.topPct}:${w.retailPeriod}:${w.bonusParts}`,
    `s${strongClosesOf(cfg)}`,
    `d${d.on ? 1 : 0}:${d.rsi ? 1 : 0}${d.wt ? 1 : 0}${d.hidden ? 1 : 0}:${d.left}:${d.right}:${d.rangeMin}:${d.rangeMax}:${d.maxAge}:${d.midline ? 1 : 0}:${d.weight}`,
    `r${r.on ? 1 : 0}:${r.internal}:${r.eqLen}:${r.eqThreshold}:${r.nearAtr}:${r.minR}:${r.weight}`,
  ].join("|");
}

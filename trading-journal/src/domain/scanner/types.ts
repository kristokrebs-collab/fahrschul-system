/**
 * Chart scanner (F67) – types. The kernel is market-neutral: it reads candles (`ScanCandle`: open time in ms, OHLC,
 * optional volume), never a venue. US stocks and crypto run through the same rules; the caller says what a session is
 * (New York 9:30–16:00 for stocks, the UTC day for crypto) and how to read the volume.
 *
 * A scan lists charts that MATCH A RULE. It says "matched a rule", never "buy", and it never prints a profit.
 */

/** One candle as the scanner reads it. `closed: false` marks the forming bar – rules use complete bars only. */
export interface ScanCandle {
  /** open time, ms UTC */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  closed?: boolean;
}

export type SetupId = "orb" | "flag" | "rsi";
export type Side = "long" | "short";
export type MarketKind = "stock" | "crypto";

export const SETUP_NAME: Readonly<Record<SetupId, string>> = {
  orb: "Eröffnungsspanne (Opening Range Breakout)",
  flag: "Flagge",
  rsi: "Überverkaufte Erholung (RSI)",
};

export const SETUP_SHORT: Readonly<Record<SetupId, string>> = { orb: "Spannen-Ausbruch", flag: "Flagge", rsi: "RSI-Erholung" };

/** Opening-range breakout. */
export interface OrbParams {
  /** length of the opening range in minutes (a multiple of the bar length) */
  orMinutes: number;
  sides: "long" | "short" | "both";
  /** minimum distance of the breakout close beyond the range edge, as a fraction (0.001 = 0.1 %) */
  minBreak: number;
  /** minutes after the session open after which a breakout no longer counts (`null` = until the session ends) */
  latestMinutes: number | null;
  /** the last complete bar must still be beyond the range edge */
  stillBeyond: boolean;
  /** breakout bar volume divided by the mean volume of the range bars must reach this (0 = off) */
  minRelVolume: number;
}

/** Bull flag: a strong run (the pole), then a tight pause (the flag). All on closes. */
export interface FlagParams {
  /** bars of the run, before the flag */
  poleBars: number;
  /** the run must gain MORE than this (fraction) */
  poleMinGain: number;
  /** closes in the flag */
  flagBars: number;
  /** the flag's closes (high − low) / last close must stay UNDER this (fraction) */
  flagMaxRange: number;
}

/** Oversold recovery: RSI (Wilder) under a level, optionally with an up-close after it. */
export interface RsiParams {
  length: number;
  /** oversold below this */
  level: number;
  /** RSI was under the level on the bar before AND the last bar closed higher (a bounce); off = RSI is under the level now */
  requireBounce: boolean;
}

/** What a chart needs to be worth looking at before any rule runs. */
export interface PrefilterParams {
  /** last close at least this (0 = off) */
  minPrice: number;
  /** volume of the last complete daily bar / the session so far at least this (0 = off) */
  minVolume: number;
  /** only listings with a normal financial status (Nasdaq `N`; no deficiency, delinquency or bankruptcy flag) */
  normalStatusOnly: boolean;
  /** daily rules need this many complete bars */
  minBars: number;
  /** the newest complete daily bar may be at most this many days old (a halted or delisted name drops out) */
  maxAgeDays: number;
}

export interface ScanParams {
  orb: OrbParams;
  flag: FlagParams;
  rsi: RsiParams;
  pre: PrefilterParams;
}

export const DEFAULT_PARAMS: ScanParams = {
  orb: { orMinutes: 15, sides: "long", minBreak: 0, latestMinutes: 360, stillBeyond: false, minRelVolume: 0 },
  flag: { poleBars: 10, poleMinGain: 0.1, flagBars: 5, flagMaxRange: 0.05 },
  rsi: { length: 14, level: 30, requireBounce: true },
  pre: { minPrice: 5, minVolume: 1_000_000, normalStatusOnly: true, minBars: 30, maxAgeDays: 7 },
};

/** Bounds the UI and `sanitizeParams` hold the numbers to. */
export const PARAM_LIMITS = {
  orMinutes: [5, 120],
  minBreak: [0, 0.05],
  latestMinutes: [15, 390],
  minRelVolume: [0, 10],
  poleBars: [3, 40],
  poleMinGain: [0.02, 1],
  flagBars: [2, 20],
  flagMaxRange: [0.005, 0.2],
  rsiLength: [2, 50],
  rsiLevel: [5, 50],
  minPrice: [0, 100_000],
  minVolume: [0, 1_000_000_000],
  minBars: [20, 250],
  maxAgeDays: [1, 30],
} as const;

/** What to say when a chart is left out before / without a rule running. */
export type SkipReason = "price" | "volume" | "status" | "few-bars" | "stale" | "gaps" | "range-open" | "no-session" | "bad-params";

export const SKIP_TEXT: Readonly<Record<SkipReason, string>> = {
  price: "Kurs unter dem Mindestpreis",
  volume: "Volumen unter der Untergrenze",
  status: "Nasdaq-Finanzstatus nicht normal",
  "few-bars": "zu wenige Kerzen",
  stale: "letzte Kerze zu alt (ausgesetzt oder nicht gehandelt)",
  gaps: "Kerzen fehlen (Handelsstopp oder dünn gehandelt)",
  "range-open": "Eröffnungsspanne noch nicht abgeschlossen",
  "no-session": "keine Handelssitzung erkannt",
  "bad-params": "Einstellung passt nicht zur Kerzenlänge",
};

export interface Level {
  label: string;
  price: number;
}

export interface Mark {
  time: number;
  label: string;
}

/** Where the data of a hit's row comes from and how old it is ("Datenstand je Zeile"). */
export interface Stand {
  source: string;
  /** time of the newest complete candle that was used (ms) */
  lastBar: number | null;
  receivedAt: number;
  fetchedAt?: number;
  /** the refresh failed and the row rests on cached candles: why */
  stale?: { reason: string; message: string };
}

export interface Hit {
  id: string;
  symbol: string;
  name: string | null;
  setup: SetupId;
  side: Side;
  /** last complete close */
  price: number;
  /** close time of the bar that matched (ms) */
  at: number;
  /** the number the setup is about (+0,55 % beyond the range, +12,4 % run, RSI 27,4) */
  metric: { label: string; value: number; text: string };
  /** one sentence: why the chart is on the list, with its numbers */
  reason: string;
  /** each check that held, in words with its numbers and the threshold */
  checks: string[];
  levels: Level[];
  marks: Mark[];
  /** price × volume of the last daily bar / the session so far; `null` = no volume */
  turnover: number | null;
  /** the bars of the preview chart (the most recent complete ones) */
  preview: ScanCandle[];
  interval: string;
  stand: Stand;
}

export interface SymbolScan {
  symbol: string;
  hits: Hit[];
  skipped: SkipReason | null;
  detail?: string;
}

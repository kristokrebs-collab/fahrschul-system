/**
 * Period / interval validation and exchange mapping (Plan 4.2).
 * `settings.hyblock.timeframe` is free text; Binance `/futures/data/*` only accepts the periods below.
 */

export const BINANCE_PERIODS = ["5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"] as const;
export type Period = (typeof BINANCE_PERIODS)[number];
export const DEFAULT_PERIOD: Period = "1h";

export const KLINE_INTERVALS = ["1m", "1h", "4h", "1w"] as const;
export type KlineInterval = (typeof KLINE_INTERVALS)[number];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const PERIOD_MS: Record<Period, number> = {
  "5m": 5 * MIN,
  "15m": 15 * MIN,
  "30m": 30 * MIN,
  "1h": HOUR,
  "2h": 2 * HOUR,
  "4h": 4 * HOUR,
  "6h": 6 * HOUR,
  "12h": 12 * HOUR,
  "1d": DAY,
};

export const INTERVAL_MS: Record<KlineInterval, number> = {
  "1m": MIN,
  "1h": HOUR,
  "4h": 4 * HOUR,
  "1w": 7 * DAY,
};

export function periodMs(p: Period): number {
  return PERIOD_MS[p];
}
export function intervalMs(i: KlineInterval): number {
  return INTERVAL_MS[i];
}

const ALIASES: Record<string, Period> = {
  "5m": "5m",
  "5min": "5m",
  "15m": "15m",
  "15min": "15m",
  "30m": "30m",
  "30min": "30m",
  "1h": "1h",
  "60m": "1h",
  "60min": "1h",
  h: "1h",
  "1hour": "1h",
  "2h": "2h",
  "120m": "2h",
  "4h": "4h",
  "240m": "4h",
  "6h": "6h",
  "12h": "12h",
  "1d": "1d",
  d: "1d",
  "1day": "1d",
  "24h": "1d",
};

export interface PeriodResult {
  period: Period;
  /** false when `raw` could not be mapped and the default was used */
  ok: boolean;
  raw: string;
  /** German tooltip text for the ratio cards when `ok === false` */
  detail?: string;
}

export function badPeriodDetail(raw: string): string {
  return `Timeframe ${raw} wird von Binance nicht unterstützt, Ratios nutzen 1h`;
}

/** Free text → Binance period. Unmappable (`1m`, `3m`, `1w`, `1M`, garbage) → `1h` + `ok:false`. */
export function normalizePeriod(raw: string | null | undefined): PeriodResult {
  const original = (raw ?? "").trim();
  const key = original.toLowerCase();
  const mapped = key ? ALIASES[key] : undefined;
  if (mapped) return { period: mapped, ok: true, raw: original };
  const shown = original || "leer";
  return { period: DEFAULT_PERIOD, ok: false, raw: original, detail: badPeriodDetail(shown) };
}

export function isPeriod(x: string): x is Period {
  return (BINANCE_PERIODS as readonly string[]).includes(x);
}

// ---------------------------------------------------------------- Bybit

export const BYBIT_PERIODS = ["5min", "15min", "30min", "1h", "4h", "1d"] as const;
export type BybitPeriod = (typeof BYBIT_PERIODS)[number];

export interface BybitPeriodMap {
  /** value for `period` (account-ratio) / `intervalTime` (open-interest) */
  value: BybitPeriod;
  /** the Binance period the Bybit value actually represents */
  period: Period;
  /** true when Bybit supports the period 1:1 */
  exact: boolean;
  /** e.g. "Bybit: 2h → 1h" */
  detail?: string;
}

const BYBIT_EXACT: Partial<Record<Period, BybitPeriod>> = {
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

/** Unsupported periods fall to the next smaller supported one (2h → 1h, 6h/12h → 4h). */
export function toBybitPeriod(p: Period): BybitPeriodMap {
  const exact = BYBIT_EXACT[p];
  if (exact) return { value: exact, period: p, exact: true };
  const smaller = [...BINANCE_PERIODS].reverse().find((c) => PERIOD_MS[c] < PERIOD_MS[p] && BYBIT_EXACT[c]);
  const target = smaller ?? "1h";
  return { value: BYBIT_EXACT[target] as BybitPeriod, period: target, exact: false, detail: `Bybit: ${p} → ${target}` };
}

export const BYBIT_KLINE_INTERVAL: Record<KlineInterval, string> = { "1m": "1", "1h": "60", "4h": "240", "1w": "W" };

// ---------------------------------------------------------------- OKX

export const OKX_PERIOD: Record<Period, string> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "2h": "2H",
  "4h": "4H",
  "6h": "6H",
  "12h": "12H",
  "1d": "1D",
};
export function toOkxPeriod(p: Period): string {
  return OKX_PERIOD[p];
}

/** `1Wutc` keeps weekly candles UTC-aligned like Binance (plain `1W` is Hong Kong time). */
export const OKX_KLINE_BAR: Record<KlineInterval, string> = { "1m": "1m", "1h": "1H", "4h": "4H", "1w": "1Wutc" };

// ---------------------------------------------------------------- cadence text

/** Point cadence → German label fragment used by `statusLabel` ("Live · {cadence}"). */
export function cadenceLabel(ms: number): string {
  if (ms < 1000) return "Echtzeit";
  if (ms === 1000) return "1 s";
  if (ms < MIN) return `alle ${Math.round(ms / 1000)} s`;
  if (ms === MIN) return "jede Minute";
  if (ms < HOUR) return `alle ${Math.round(ms / MIN)} min`;
  if (ms === HOUR) return "stündlich";
  if (ms < DAY) return `alle ${Math.round(ms / HOUR)} h`;
  if (ms === DAY) return "täglich";
  if (ms === 7 * DAY) return "wöchentlich";
  return `alle ${Math.round(ms / DAY)} Tage`;
}

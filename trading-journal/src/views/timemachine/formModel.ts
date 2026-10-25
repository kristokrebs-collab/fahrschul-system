/**
 * The hand-entered plan of the Labor section „Zeitmaschine“ (pure): the form's state (strings the way they are typed), its
 * defaults, a defensive reader for what was remembered in the browser (a convenience, versioned), and the translation into the
 * card's props. Nothing is invented here: an empty or unreadable field stays empty and the card says what is missing.
 */
import { DEFAULT_TM_COSTS, defaultOptions, parseCount, parsePrice, TM_SEED, type TmInterval, type TmOptions, type TmTrigger } from "@/domain/timemachine";
import type { CostModel } from "@/domain/backtest/types";
import { DEFAULT_FUNDING_RATE, feePreset } from "@/domain/backtest/fees";
import type { SlippageModel } from "@/domain/backtest/types";

export const FORM_INTERVALS = ["15m", "1h", "4h", "1d"] as const satisfies readonly TmInterval[];
export type FormInterval = (typeof FORM_INTERVALS)[number];
/** Days of history per choice (the lab's periods, shorter ones first). */
export const FORM_PERIODS = { "3m": 91, "6m": 182, "1y": 365, "2y": 730 } as const;
export type FormPeriod = keyof typeof FORM_PERIODS;

export interface FormState {
  v: 1;
  symbol: string;
  side: "long" | "short";
  entry: string;
  stop: string;
  target: string;
  interval: FormInterval;
  period: FormPeriod;
  /** time stop in candles, typed; "" = the default of the interval */
  horizon: string;
  trigger: "close" | "range" | "level";
  lookback: string;
  validBars: string;
  runs: "2000" | "10000" | "20000";
  seed: string;
  method: "block" | "single";
  vol: "now" | "history";
  drift: "keep" | "zero";
  breakEven: boolean;
  breakEvenR: string;
  trail: boolean;
  trailAtr: string;
  trailFromR: string;
}

export const DEFAULT_FORM: FormState = {
  v: 1,
  symbol: "BTCUSDT",
  side: "long",
  entry: "",
  stop: "",
  target: "",
  interval: "4h",
  period: "1y",
  horizon: "",
  trigger: "close",
  lookback: "20",
  validBars: "4",
  runs: "10000",
  seed: String(TM_SEED),
  method: "block",
  vol: "now",
  drift: "keep",
  breakEven: false,
  breakEvenR: "1",
  trail: false,
  trailAtr: "2",
  trailFromR: "1",
};

const pick = <T,>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
const str = (v: unknown, d: string, max = 24): string => (typeof v === "string" ? v.slice(0, max) : d);

/** What the browser remembered, merged over the defaults (unknown or broken values fall back). */
export function sanitizeForm(raw: unknown): FormState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof FormState, unknown>>;
  const d = DEFAULT_FORM;
  return {
    v: 1,
    symbol: typeof r.symbol === "string" && /^[A-Z0-9]{2,24}$/.test(r.symbol) ? r.symbol : d.symbol,
    side: pick(r.side, ["long", "short"] as const, d.side),
    entry: str(r.entry, d.entry),
    stop: str(r.stop, d.stop),
    target: str(r.target, d.target),
    interval: pick(r.interval, FORM_INTERVALS, d.interval),
    period: pick(r.period, Object.keys(FORM_PERIODS) as FormPeriod[], d.period),
    horizon: str(r.horizon, d.horizon, 6),
    trigger: pick(r.trigger, ["close", "range", "level"] as const, d.trigger),
    lookback: str(r.lookback, d.lookback, 4),
    validBars: str(r.validBars, d.validBars, 4),
    runs: pick(r.runs, ["2000", "10000", "20000"] as const, d.runs),
    seed: str(r.seed, d.seed, 10),
    method: pick(r.method, ["block", "single"] as const, d.method),
    vol: pick(r.vol, ["now", "history"] as const, d.vol),
    drift: pick(r.drift, ["keep", "zero"] as const, d.drift),
    breakEven: r.breakEven === true,
    breakEvenR: str(r.breakEvenR, d.breakEvenR, 6),
    trail: r.trail === true,
    trailAtr: str(r.trailAtr, d.trailAtr, 6),
    trailFromR: str(r.trailFromR, d.trailFromR, 6),
  };
}

export interface FormReading {
  entry: number | null;
  stop: number | null;
  target: number | null;
}

/** The three prices as numbers (a reference makes "85.900" read as eighty-five thousand next to prices of that size). */
export function readPrices(f: FormState): FormReading {
  const first = [f.entry, f.stop, f.target].map((t) => parsePrice(t)).find((v) => v != null && v > 0) ?? null;
  const at = (t: string): number | null => {
    const v = parsePrice(t, first);
    return v != null && v > 0 ? v : null;
  };
  return { entry: at(f.entry), stop: at(f.stop), target: at(f.target) };
}

/** What is missing to run, in words – null when the three prices are there. */
export function missingPrices(f: FormState): string | null {
  const p = readPrices(f);
  const miss = [p.entry == null && "Einstieg", p.stop == null && "Stop", p.target == null && "Ziel"].filter(Boolean) as string[];
  return miss.length ? `Es fehlt: ${miss.join(", ")} (eine Zahl größer 0).` : null;
}

/** The run's options from the form (anything unreadable falls back to the default of the interval). */
export function optionsOfForm(f: FormState): Partial<TmOptions> {
  const d = defaultOptions(f.interval);
  const int = (t: string, lo: number, hi: number, dflt: number): number => {
    const v = parseCount(t);
    return v != null && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : dflt;
  };
  const num = (t: string, lo: number, hi: number, dflt: number): number => {
    const v = parseCount(t);
    return v != null && Number.isFinite(v) && v >= lo && v <= hi ? v : dflt;
  };
  const trigger: TmTrigger = f.trigger === "range" ? { kind: "range", lookback: int(f.lookback, 5, 100, 20) } : { kind: f.trigger };
  return {
    runs: Number(f.runs),
    seed: int(f.seed, 0, 2_147_483_647, TM_SEED),
    horizon: f.horizon.trim() ? int(f.horizon, 2, 400, d.horizon) : d.horizon,
    method: f.method,
    drift: f.drift,
    vol: f.vol,
    trigger,
    validBars: int(f.validBars, 1, 24, d.validBars),
    manage: {
      breakEvenR: f.breakEven ? num(f.breakEvenR, 0.1, 10, 1) : null,
      trailAtr: f.trail ? num(f.trailAtr, 0.2, 20, 2) : null,
      trailFromR: num(f.trailFromR, 0, 10, 1),
    },
  };
}

/** Candle intervals of the lab the loader serves (`HistInterval`): all four form choices are among them. */
export const dataKey = (f: FormState): string => `${f.symbol}|${f.interval}|${f.period}`;

/** The lab's cost set-up as the engine's cost model: fee preset, slippage, and funding as a flat assumption (the lab's „Historie“ needs the exchange's rate list, which this section does not load). */
export function costsOfLab(cfg: { exchange: string; slippage: SlippageModel; funding: "history" | "flat" | "none" }): CostModel {
  const fee = feePreset(cfg.exchange);
  return {
    ...DEFAULT_TM_COSTS,
    fees: { exchange: fee.exchange, makerBps: fee.makerBps, takerBps: fee.takerBps },
    slippage: cfg.slippage,
    funding: cfg.funding === "none" ? { kind: "none" } : { kind: "flat", ratePer8h: DEFAULT_FUNDING_RATE },
  };
}

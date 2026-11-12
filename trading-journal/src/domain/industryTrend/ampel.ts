/**
 * The Ampel of the 48 industries: the base strategy's signal on the last day of the data, the day of the last change and
 * the signal changes of the last days (what the protocol takes over). Pure; the heavy loop can yield to the browser between
 * industries (`opts.yieldEvery` + `opts.pause`), so no single task runs long.
 */
import { BASE_PARAMS, EVENT_DAYS, industryName, type TrendParams } from "./config";
import { lastChangeIndex, runSignal, weights } from "./signal";

/** Marks a day without a value in `IndustryDataset.returns` (the library writes -99.99 / -999). */
export const MISSING = -32768;

/** The library's daily returns in hundredths of a percent (basis points), industry after industry. */
export interface IndustryDataset {
  /** the library's short names (`Agric`, `Food` …) */
  names: string[];
  /** trading days as `YYYYMMDD`, ascending */
  dates: Int32Array;
  /** `names.length × dates.length` values, industry-major: industry `i` is `returns[i * days .. (i + 1) * days)`; `MISSING` = no value */
  returns: Int16Array;
}

export const datasetDays = (d: IndustryDataset): number => d.dates.length;

/** Daily returns of industry `i` as fractions (`56` → `0.0056`; `NaN` where missing). Dividing twice by 100 gives the same doubles as parsing "0.56" and dividing by 100 (the script's way). */
export function industryReturns(d: IndustryDataset, i: number): Float64Array {
  const T = d.dates.length;
  const out = new Float64Array(T);
  const base = i * T;
  for (let t = 0; t < T; t++) {
    const v = d.returns[base + t]!;
    out[t] = v === MISSING ? NaN : v / 100 / 100;
  }
  return out;
}

export type AmpelState = "kauf" | "cash";

export interface AmpelRow {
  /** position in the file */
  index: number;
  code: string;
  name: string;
  state: AmpelState;
  /** the day the state began (`YYYYMMDD`), `null` = it never changed since the data begins */
  since: number | null;
  /** trading days from that change to the last day (0 = changed today) */
  daysSince: number | null;
  /** target weight of the capital (0 for cash) */
  weight: number;
}

export interface AmpelEvent {
  datum: string;
  branche: string;
  signal: "KAUF" | "VERKAUF";
  punkt: "gruen" | "rot";
}

export interface AmpelResult {
  /** the last day of the data (`YYYYMMDD`) */
  asOf: number;
  days: number;
  params: TrendParams;
  rows: AmpelRow[];
  /** changes of the last `EVENT_DAYS` trading days, oldest first (same order as the lab script) */
  events: AmpelEvent[];
  kauf: number;
  cash: number;
  /** sum of the target weights (after the cap) */
  grossWeight: number;
  /** the leverage cap had to shrink the weights */
  capped: boolean;
}

export interface AmpelOptions {
  params?: TrendParams;
  eventDays?: number;
  /** after how many industries `pause` is awaited (default: never) */
  yieldEvery?: number;
  pause?: () => Promise<void>;
  signal?: AbortSignal;
}

export class AmpelAborted extends Error {
  constructor() {
    super("aborted");
    this.name = "AmpelAborted";
  }
}

export async function computeAmpel(data: IndustryDataset, opts: AmpelOptions = {}): Promise<AmpelResult> {
  const params = opts.params ?? { ...BASE_PARAMS };
  const eventDays = opts.eventDays ?? EVENT_DAYS;
  const N = data.names.length;
  const T = data.dates.length;
  if (T < 2 || N === 0) throw new Error("Zu wenige Daten für die Berechnung.");
  const units: number[] = [];
  const changes: (number | null)[] = [];
  const states: AmpelState[] = [];
  const events: AmpelEvent[] = [];
  for (let i = 0; i < N; i++) {
    if (opts.signal?.aborted) throw new AmpelAborted();
    if (opts.pause && opts.yieldEvery && i > 0 && i % opts.yieldEvery === 0) await opts.pause();
    const run = runSignal(industryReturns(data, i), params);
    const ex = run.exposure;
    units.push(run.unitLast);
    changes.push(lastChangeIndex(ex));
    states.push(ex[T - 1] === 1 ? "kauf" : "cash");
    for (let t = Math.max(1, T - eventDays); t < T; t++) {
      if (ex[t] !== ex[t - 1]) {
        const on = ex[t] === 1;
        events.push({ datum: String(data.dates[t]), branche: data.names[i]!, signal: on ? "KAUF" : "VERKAUF", punkt: on ? "gruen" : "rot" });
      }
    }
  }
  const w = weights(units, params.tv, params.lev);
  const rows: AmpelRow[] = data.names.map((code, i) => {
    const c = changes[i]!;
    return {
      index: i,
      code,
      name: industryName(code),
      state: states[i]!,
      since: c === null ? null : data.dates[c]!,
      daysSince: c === null ? null : T - 1 - c,
      weight: states[i] === "kauf" ? w.w[i]! : 0,
    };
  });
  // oldest first, then by name – the order of the lab script's events
  events.sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.branche < b.branche ? -1 : a.branche > b.branche ? 1 : 0));
  const kauf = rows.filter((r) => r.state === "kauf").length;
  return { asOf: data.dates[T - 1]!, days: T, params, rows, events, kauf, cash: N - kauf, grossWeight: w.sum, capped: w.capped };
}

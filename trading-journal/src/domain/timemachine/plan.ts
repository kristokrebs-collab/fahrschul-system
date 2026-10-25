/**
 * The plan of the Zeitmaschine (pure): validation with German reasons, the planned R of the target, the distances the
 * history search keeps (in ATR(14) units, or as a place inside the range), and the reading of typed numbers.
 */
import { parseNumber } from "@/lib/parse";
import { atrSeries } from "../backtest/bars";
import { MIN_POOL_BARS, MAX_HORIZON, MIN_STOP_FRAC, isTmInterval, type Bar, type TmInput, type TmPlan, type TmRefusal, type TmResult, type TmTrigger } from "./types";

export const fmtPx = (v: number): string => v.toLocaleString("de-DE", { maximumFractionDigits: v >= 1000 ? 2 : v >= 1 ? 4 : 8 });

/**
 * A price typed by hand: "64.250,5" and "64250.5" both work. `parseNumber` reads "85.900" as 85,9 (a dot without a comma is a
 * decimal point); for a price "85.900" nearly always means eighty-five thousand nine hundred. When both readings exist the one
 * closer to the reference price `ref` wins (the plan's other prices); without a reference the thousands reading wins.
 */
export function parsePrice(text: string, ref?: number | null): number | null {
  const t = text.trim().replace(/\s/g, "");
  const plain = parseNumber(t);
  if (!/^\d{1,3}(\.\d{3})+$/.test(t)) return plain;
  const thousands = Number(t.replace(/\./g, ""));
  if (plain == null || !(plain > 0)) return thousands;
  if (ref != null && ref > 0) return Math.abs(Math.log(thousands / ref)) <= Math.abs(Math.log(plain / ref)) ? thousands : plain;
  return thousands;
}

/** A typed count or a plain number ("96", "1,5"); anything else → null. */
export const parseCount = (text: string): number | null => parseNumber(text.trim());

/** Risk (entry → stop) as a price distance. */
export const riskOf = (p: TmPlan): number => Math.abs(p.entry - p.stop);

/** The target in R of the planned risk (before costs). */
export const targetROf = (p: TmPlan): number => (riskOf(p) > 0 ? Math.abs(p.target - p.entry) / riskOf(p) : 0);

/** Does the plan make sense? German reason when not. */
export function checkPlan(p: TmPlan): TmRefusal | null {
  if (![p.entry, p.stop, p.target].every((v) => Number.isFinite(v) && v > 0)) return { ok: false, why: "Einstieg, Stop und Ziel müssen Zahlen größer 0 sein." };
  if (p.side === "long") {
    if (!(p.stop < p.entry)) return { ok: false, why: "Bei Long muss der Stop unter dem Einstieg liegen." };
    if (!(p.target > p.entry)) return { ok: false, why: "Bei Long muss das Ziel über dem Einstieg liegen." };
  } else if (p.side === "short") {
    if (!(p.stop > p.entry)) return { ok: false, why: "Bei Short muss der Stop über dem Einstieg liegen." };
    if (!(p.target < p.entry)) return { ok: false, why: "Bei Short muss das Ziel unter dem Einstieg liegen." };
  } else return { ok: false, why: "Die Richtung muss Long oder Short sein." };
  if (riskOf(p) / p.entry < MIN_STOP_FRAC) return { ok: false, why: `Der Stop liegt zu nah am Einstieg (unter ${(MIN_STOP_FRAC * 100).toLocaleString("de-DE", { maximumFractionDigits: 2 })} %) – so enge Stops rechnet die Engine nicht.` };
  if (Math.abs(p.target - p.entry) / p.entry < MIN_STOP_FRAC) return { ok: false, why: "Das Ziel liegt zu nah am Einstieg." };
  return null;
}

/** The first thing that stops a run, or null. Checks the plan, the interval, the options and the number of candles. */
export function checkInput(input: TmInput): TmRefusal | null {
  const plan = checkPlan(input.plan);
  if (plan) return plan;
  if (!isTmInterval(input.interval)) return { ok: false, why: `Der Zeitrahmen „${String(input.interval)}“ wird nicht unterstützt.` };
  if (!(input.runs >= 100 && input.runs <= 50_000)) return { ok: false, why: "Die Zahl der Sitzungen muss zwischen 100 und 50 000 liegen." };
  if (!(Number.isInteger(input.horizon) && input.horizon >= 2 && input.horizon <= MAX_HORIZON)) return { ok: false, why: `Der Zeitstopp muss zwischen 2 und ${MAX_HORIZON} Kerzen liegen.` };
  if (!Number.isFinite(input.seed)) return { ok: false, why: "Der Seed muss eine Zahl sein." };
  const n = input.bars.length;
  if (n < MIN_POOL_BARS) return { ok: false, why: n === 0 ? "Keine Kerzen – ohne echte Kerzen gibt es nichts durchzuspielen." : `Nur ${n} Kerzen – mindestens ${MIN_POOL_BARS} sind nötig, damit jede Tageszeit genug Vorbilder hat.` };
  return null;
}

/** Where the plan's entry lies against the last close: a market order, a limit order (pullback) or a stop order (breakout). */
export type OrderKind = "market" | "limit" | "stop";
/** Entry within this many ATR of the last close counts as "now". */
export const MARKET_BAND_ATR = 0.05;
/** Range trigger with an entry "now": the close counts as "in the same place" within this share of the range's height. */
export const RANGE_TOL = 0.1;

export function orderKind(side: TmPlan["side"], entry: number, last: number, atr: number): OrderKind {
  const off = (entry - last) / atr;
  if (Math.abs(off) <= MARKET_BAND_ATR) return "market";
  // long: entry below the price waits for a dip (limit), above it for a breakout (stop); short: the other way round
  return (side === "long" ? off < 0 : off > 0) ? "limit" : "stop";
}

export interface Relative {
  /** ATR(14) at the last candle (the plan's moment) */
  atr: number;
  last: number;
  stopAtr: number;
  targetAtr: number;
  /** (entry − last close) ÷ ATR, signed */
  entryOffsetAtr: number;
  kind: OrderKind;
  /** place of the entry inside the range of the last `lookback` candles (0 = low, 1 = high), range trigger only */
  rangePos: number | null;
}

/** Highest high / lowest low of the candles `from … to` (inclusive). */
export function rangeOf(bars: readonly Bar[], from: number, to: number): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = Math.max(0, from); i <= to; i++) {
    const b = bars[i]!;
    if (b.l < lo) lo = b.l;
    if (b.h > hi) hi = b.h;
  }
  return { lo, hi };
}

/** The plan in the terms the history search applies to every candle, or the reason it cannot be put that way. */
export function relativeOf(plan: TmPlan, bars: readonly Bar[], trigger: TmTrigger, atr: readonly number[] = atrSeries(bars)): Relative | TmRefusal {
  const n = bars.length;
  const last = bars[n - 1]?.c;
  const a = atr[n - 1];
  if (!(last && last > 0) || !(a != null && a > 0)) return { ok: false, why: "Die Schwankung (ATR) der letzten Kerzen ist nicht berechenbar." };
  let rangePos: number | null = null;
  if (trigger.kind === "range") {
    const { lo, hi } = rangeOf(bars, n - trigger.lookback, n - 1);
    if (!(hi > lo)) return { ok: false, why: "Die Spanne der letzten Kerzen hat keine Höhe – die Lage in der Range ist nicht bestimmbar." };
    rangePos = (plan.entry - lo) / (hi - lo);
  }
  return {
    atr: a,
    last,
    stopAtr: riskOf(plan) / a,
    targetAtr: Math.abs(plan.target - plan.entry) / a,
    entryOffsetAtr: (plan.entry - last) / a,
    kind: orderKind(plan.side, plan.entry, last, a),
    rangePos,
  };
}

export const isRefusal = (x: unknown): x is TmRefusal => typeof x === "object" && x != null && (x as TmRefusal).ok === false;

/** Short German name of the trigger ("gleiche Abstände zum Schlusskurs"). */
export function triggerText(t: TmTrigger, kind?: OrderKind): string {
  if (t.kind === "close") return "gleiche Abstände (in ATR) zum Schlusskurs jeder Kerze, eine Position nach der anderen";
  if (t.kind === "range") return kind === "market" ? `der Schlusskurs kommt in dieselbe Zone der Spanne der letzten ${t.lookback} Kerzen (± ${Math.round(RANGE_TOL * 100)} % der Höhe)` : `Einstieg an derselben Stelle der Spanne der letzten ${t.lookback} Kerzen`;
  return "dieses Preisniveau (jedes Mal, wenn der Kurs es von derselben Seite erreichte)";
}

/** Result of a finished run: is it for this plan (guards a stale result against a changed form)? */
export function sameRun(a: Pick<TmResult, "symbol" | "plan" | "interval" | "seed">, b: Pick<TmResult, "symbol" | "plan" | "interval" | "seed">): boolean {
  return a.symbol === b.symbol && a.interval === b.interval && a.seed === b.seed && a.plan.side === b.plan.side && a.plan.entry === b.plan.entry && a.plan.stop === b.plan.stop && a.plan.target === b.plan.target;
}

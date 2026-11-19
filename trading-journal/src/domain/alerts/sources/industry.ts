/**
 * Source "Branchen-Trend": the rule of the base strategy (`src/domain/industryTrend`) read for the industries the user picked.
 * Pure. `held` is the rule's state (green = in, red = out/cash); `approach` is the distance in percent of the price to the line
 * that would turn it – the stop while the industry is in, the entry line (upper channel) while it is out.
 *
 * Honest limits: the data is the Ken French library, which ends one to two months behind – the reading says which day it
 * is from, and an alert is about THAT day's state, not a live price. A day without a return is no reading (never "out").
 */
import { BASE_PARAMS, fmtDay, industryName, type TrendParams } from "../../industryTrend/config";
import { industryReturns, type IndustryDataset } from "../../industryTrend/ampel";
import { runSignal } from "../../industryTrend/signal";
import type { AlertReading } from "../types";

/** `YYYYMMDD` → ms (UTC midnight). */
export function dayToMs(d: number): number {
  const y = Math.floor(d / 10_000);
  const m = Math.floor((d % 10_000) / 100);
  return Date.UTC(y, m - 1, d % 100);
}

const pct = (v: number): string => v.toLocaleString("de-DE", { maximumFractionDigits: 1 });

export function industryReadings(data: IndustryDataset, codes: readonly string[], trend: Pick<TrendParams, "up" | "down" | "kelt"> = BASE_PARAMS): AlertReading[] {
  const T = data.dates.length;
  if (T < 2) return [];
  const out: AlertReading[] = [];
  const day = data.dates[T - 1]!;
  for (const code of codes) {
    const i = data.names.indexOf(code);
    if (i < 0) continue;
    const returns = industryReturns(data, i);
    if (Number.isNaN(returns[T - 1]!)) continue; // no value on the last day: not "out", just unknown
    const run = runSignal(returns, trend);
    const held = run.exposure[T - 1] === 1 ? "green" : "red";
    let approach: AlertReading["approach"] = null;
    const e = run.edge;
    if (e && e.price > 0) {
      if (held === "green" && Number.isFinite(e.stop)) approach = { side: "red", distance: Math.max(0, ((e.price - e.stop) / e.price) * 100) };
      if (held === "red" && Number.isFinite(e.upper)) approach = { side: "green", distance: Math.max(0, ((e.upper - e.price) / e.price) * 100) };
    }
    out.push({
      key: `industry:${code}`,
      source: "industry",
      market: industryName(code),
      held,
      margin: Infinity,
      approach,
      asOf: dayToMs(day),
      detail: `Datenstand ${fmtDay(day)} · Regel: ${held === "green" ? "drin" : "draußen (Cash)"}${approach ? ` · Abstand zur ${approach.side === "red" ? "Ausstiegs" : "Einstiegs"}grenze ${pct(approach.distance)} %` : ""}`,
    });
  }
  return out;
}

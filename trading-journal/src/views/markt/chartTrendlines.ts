/**
 * Price trendlines of the structure view as chart lines (`ChartTrendline`, drawn by `TrendlinePrimitive`). Pure.
 *
 * - Only the PRICE lines, only of timeframes at least as long as the chart's interval (a 1h line on a 1D chart would be a
 *   scribble inside one candle); a 1D or 1W line also reads on the 4h chart, because the line lives in time and price.
 * - A line from a longer timeframe than the chart is anchored at the middle of its candles (the extreme of a 1D candle is
 *   on average in the middle of the day, not at its open): shift = (tf − chart interval) / 2; on the chart's own timeframe
 *   the shift is 0, the line goes through the candles' open times like the bars.
 * - Unbroken line: solid up to the newest closed candle, dotted four candles into the future; a broken line: solid up to
 *   the break candle, no extension. The caption says timeframe, direction and phase (`4H ↘ nah`, `1D ↗ Bruch ↓`).
 */
import type { ChartTrendline, TrendTone } from "@/chart/primitives/TrendlinePrimitive";
import { KEY_TF_MS, tfLabel } from "@/domain/keylevels";
import { describeLine, type TrendLineView, type TrendPhase, type TrendSlot } from "@/domain/trendlines";
import type { TrendTfItem } from "@/market/trendlines/store";

/** Candles of the line's own timeframe the dotted extension reaches into the future. */
export const EXTEND_BARS = 4;

const PHASE_SUFFIX: Record<TrendPhase, (v: TrendLineView) => string> = {
  intact: () => "",
  approach: () => " nah",
  break: (v) => ` Bruch ${v.kind === "down" ? "↑" : "↓"}`,
  "retest-open": () => " Retest",
  "retest-held": () => " Retest ok",
  "retest-failed": () => " zurück",
  "no-retest": (v) => ` Bruch ${v.kind === "down" ? "↑" : "↓"}`,
};

function toneOf(v: TrendLineView, phase: TrendPhase): TrendTone {
  if (phase === "intact") return "mute";
  if (phase === "approach") return "fg";
  if (phase === "retest-failed" || phase === "no-retest") return "mute";
  // a falling line broken upward is the win tone, a rising line broken downward the loss tone (as the RSI break dot)
  return v.kind === "down" ? "win" : "loss";
}

function lineOf(v: TrendLineView, broken: boolean, shift: number, asOf: number): ChartTrendline {
  const ms = KEY_TF_MS[v.tf];
  const text = describeLine(v);
  const arrow = v.kind === "down" ? "↘" : "↗";
  const solidTo = broken && v.brokeTime != null ? v.brokeTime + ms : asOf;
  return {
    id: `${v.tf}:${v.kind}:${broken ? "b" : "a"}:${v.aTime}-${v.bTime}`,
    t1: v.aTime + shift,
    p1: v.a.v,
    t2: v.bTime + shift,
    p2: v.b.v,
    solidTo: solidTo + shift,
    extendTo: broken ? null : asOf + EXTEND_BARS * ms + shift,
    tone: toneOf(v, text.phase),
    label: `${tfLabel(v.tf)} ${arrow}${PHASE_SUFFIX[text.phase](v)}`,
    captionAbove: v.kind === "down",
    strong: text.phase === "approach" || (v.brk?.fresh ?? false),
  };
}

/** The chart lines of every available, analysed timeframe at least as long as `chartMs`. */
export function toChartTrendlines(items: readonly TrendTfItem[], chartMs: number): ChartTrendline[] {
  const out: ChartTrendline[] = [];
  for (const it of items) {
    const a = it.analysis;
    if (!a || a.status !== "ok" || a.asOf == null) continue;
    const ms = KEY_TF_MS[it.tf];
    if (ms < chartMs) continue;
    const shift = (ms - chartMs) / 2;
    for (const slot of [a.price.down, a.price.up] as TrendSlot[]) {
      if (slot.broken) out.push(lineOf(slot.broken, true, shift, a.asOf));
      if (slot.active) out.push(lineOf(slot.active, false, shift, a.asOf));
    }
  }
  return out;
}

/** Identity per content: the chart re-sets the lines only when something drawn changed. */
export const chartTrendlinesKey = (lines: readonly ChartTrendline[]): string => JSON.stringify(lines);

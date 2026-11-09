/**
 * From a confirmed finding to a backtest filter ("Mit diesem Filter testen"). Nothing here changes anything by itself: the
 * result is a plain description of the pattern (`PatternFilterSpec`) that the Labor's filter comparison can run next to the same
 * strategy without it – the user decides, the app never adopts a rule on its own.
 *
 * A filter is a yes / no on a signal AT the close of its candle: the very features of the miner are recomputed for the signal
 * candle `i` (`k = i + 1` closed candles, the entry moment = the open of candle `i + 1`), so the filter sees exactly what the
 * miner saw at an entry – no more (the look-ahead test covers it). Patterns that need what candles and the clock cannot give
 * (losses in a row, journal fields, hold time, key levels) are refused WITH the reason instead of being faked.
 */
import { PASS, FAIL, UNKNOWN_MASK, type SideMask } from "../lab/filters/masks";
import type { Bar } from "../signals/indicators";
import { condHolds } from "./cond";
import { barFeatures, buildSeries, calendarFeatures, FEATURES, type BarFeatureId } from "./features";
import { filterBlockReason, PATTERN_VERSION, type PatternFilterSpec } from "./spec";
import { condsText } from "./text";
import type { DiscoverySide, Finding } from "./types";

export { filterBlockReason, PATTERN_VERSION, patternKey, sanitizePatternSpec, type PatternFilterSpec } from "./spec";

export type FilterConversion = { ok: true; spec: PatternFilterSpec } | { ok: false; reason: string };

const CAL_IDS: readonly string[] = ["session", "weekday", "dayPart"];

/** Converts a finding into a filter description – only confirmed findings, only conditions the backtest can evaluate. */
export function findingToFilter(f: Finding): FilterConversion {
  if (f.tier !== "confirmed") return { ok: false, reason: "Nur bestätigte Befunde lassen sich als Filter testen. Ein Hinweis oder ein verworfenes Muster wäre Zufallsfund." };
  for (const c of f.conds) {
    const why = filterBlockReason(c.f);
    if (why) return { ok: false, reason: why };
  }
  return { ok: true, spec: { v: PATTERN_VERSION, label: condsText(f.conds), conds: f.conds.map((c) => ({ ...c })) } };
}

/**
 * Per signal candle yes / no / unknown for the long and the short signal: the pattern holds at the entry that follows the close
 * of candle `i`. A condition the data cannot judge (warm-up, no volume) makes the answer unknown – unless another condition
 * already fails. Unknown never lets a signal through.
 */
export function patternMask(bars: readonly Bar[], secLen: number, spec: PatternFilterSpec): SideMask {
  const n = bars.length;
  const long = new Uint8Array(n).fill(UNKNOWN_MASK);
  const short = new Uint8Array(n).fill(UNKNOWN_MASK);
  if (n === 0 || secLen <= 0) return { long, short };
  const series = buildSeries({ intervalSec: secLen, bars });
  const needsBars = spec.conds.some((c) => FEATURES[c.f].needsBars);
  for (let i = 0; i < n; i++) {
    const atS = bars[i]!.t + secLen;
    const cal = calendarFeatures(atS * 1000);
    for (const side of ["long", "short"] as const satisfies readonly DiscoverySide[]) {
      const row = needsBars ? barFeatures(series, i + 1, atS, side) : null;
      let verdict: 0 | 1 | 2 = PASS;
      for (const c of spec.conds) {
        const v = c.f === "side" ? (side === "long" ? "Long" : "Short") : CAL_IDS.includes(c.f) ? cal[c.f as "session" | "weekday" | "dayPart"] : (row?.[c.f as BarFeatureId] ?? null);
        if (v == null) {
          if (verdict === PASS) verdict = UNKNOWN_MASK;
        } else if (!condHolds(c, v)) {
          verdict = FAIL;
          break;
        }
      }
      (side === "long" ? long : short)[i] = verdict;
    }
  }
  return { long, short };
}

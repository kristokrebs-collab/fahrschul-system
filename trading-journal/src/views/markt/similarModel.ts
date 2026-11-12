/**
 * Pure model of the mini chart of one hit (F19): the candles before the hit (the situation), the hit's own candle and the
 * `horizon` candles after it (the course), as the replay chart wants them, with the timeline spans, the marker and the
 * reference lines (the hit's close and ±1 unit). No clock, no I/O.
 */
import type { ReplayBar, ReplayLine } from "@/chart/ReplayChart";
import type { SimCandle, SimilarHit, SimUnit } from "@/domain/similar";
import type { ScrubMarker, ScrubSpan } from "@/motion/pulse/ScrubTimeline";

/** Candles of the situation shown before the hit. */
export const LOOKBACK = 48;

export interface HitModel {
  bars: ReplayBar[];
  /** shown bars when only the situation is visible (the hit's own candle is the last of them) */
  situation: number;
  total: number;
  spans: ScrubSpan[];
  markers: ScrubMarker[];
  lines: ReplayLine[];
}

export function hitModel(closed: readonly SimCandle[], hit: SimilarHit, horizon: number, unit: SimUnit, refLabel: string): HitModel | null {
  const from = Math.max(0, hit.index - LOOKBACK);
  const to = hit.index + horizon;
  if (hit.index < 0 || to > closed.length - 1) return null;
  const bars: ReplayBar[] = closed.slice(from, to + 1).map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
  const situation = hit.index - from + 1;
  const o = hit.outcome;
  const u = unit === "r" ? "R" : "%";
  return {
    bars,
    situation,
    total: bars.length,
    spans: [
      { id: "situation", label: "Situation", start: 0, duration: situation, tone: "mute" },
      { id: "after", label: "Danach", start: situation, duration: horizon, tone: o.dir === "up" ? "win" : o.dir === "down" ? "loss" : "fg" },
    ],
    markers: [{ at: situation, label: refLabel, tone: "fg" }],
    lines: [
      { price: o.ref, label: refLabel, tone: "fg", dashed: false },
      { price: o.ref + o.size, label: `+1 ${u}`, tone: "mute", dashed: true },
      { price: o.ref - o.size, label: `−1 ${u}`, tone: "mute", dashed: true },
    ],
  };
}

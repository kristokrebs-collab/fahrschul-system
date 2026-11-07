/**
 * The alert rules, replayed over a history (C3 – Wal-Karte): "when would the Top-Trader-Umschlag alarm have spoken?".
 *
 * It uses the SAME pieces as the live alarm – the reading of the source (`whaleReading`: Long-Anteil gegen 50 %, Richtung der
 * letzten Stunde) and the engine (`stepAlerts`: Schwelle, Hysterese, ein Ereignis je Sprung, erster Blick still, Wiederholungssperre)
 * – and feeds them point by point. Nothing here is a second rule set. Pure: the clock is the time of each point.
 *
 * Two honest edges:
 *  - the first reading of a run is the baseline and fires nothing (switching an alert on never speaks about what already is);
 *  - a GAP in the history ends a run: what happened inside it was never seen, so the engine starts again after it (its first
 *    look is silent) instead of dating an event inside the gap.
 *
 * A mark is where the rule WOULD have fired with the given thresholds. It says nothing about what the price did next.
 */
import { stepAlerts } from "./engine";
import { COOLDOWN_MIN, PARAM_RANGE } from "./config";
import { whaleReading, WHALE_LOOKBACK_MS } from "./sources/whale";
import { ALERT_EVENT_LABEL, levelOf, sideOf, type AlertEvent, type AlertMemoryMap, type AlertSide, type SourceParams } from "./types";

/** The engine's default thresholds of the Top-Trader source (Vorwarnung 3 Pkt., Bestätigung 2 Pkt., Hysterese 1 Pkt.). */
export const DEFAULT_WHALE_PARAMS: SourceParams = { warn: PARAM_RANGE.whale.warn.def, confirm: PARAM_RANGE.whale.confirm.def, hyst: PARAM_RANGE.whale.hyst.def };
/** The default repeat block (minutes) of the alert settings. */
export const DEFAULT_COOLDOWN_MIN: number = COOLDOWN_MIN.def;

export interface ReplayPoint {
  /** ms */
  t: number;
  /** long share, percent */
  longPct: number;
}

export interface WhaleMark {
  /** the time of the point the rule fired on (ms) */
  t: number;
  event: AlertEvent;
  side: AlertSide;
  level: "warn" | "confirm";
  /** the distance (warning) or margin (confirmation) in percentage points */
  value: number | null;
  /** held back by the repeat block – the alarm would NOT have been delivered */
  suppressed: boolean;
  /** `Rot-Vorwarnung` … */
  label: string;
}

export interface ReplayOptions {
  /** market name for the reading (`BTCUSDT`) */
  symbol: string;
  params?: SourceParams;
  cooldownMin?: number;
  /** indexes `i` such that a gap lies between point `i - 1` and point `i` (a new run starts at `i`) */
  breaks?: readonly number[];
}

/** Marks of the whole history, oldest first. */
export function replayWhale(points: readonly ReplayPoint[], opts: ReplayOptions): WhaleMark[] {
  const params = opts.params ?? DEFAULT_WHALE_PARAMS;
  const cooldownMs = (opts.cooldownMin ?? DEFAULT_COOLDOWN_MIN) * 60_000;
  const breaks = new Set(opts.breaks ?? []);
  const out: WhaleMark[] = [];
  // the reading of the live source takes `time`
  const series = points.map((p) => ({ time: p.t, longPct: p.longPct }));
  let memory: AlertMemoryMap = {};
  let runStart = 0;
  let lo = 0;
  for (let i = 0; i < points.length; i++) {
    if (breaks.has(i)) {
      memory = {};
      runStart = i;
      lo = i;
    }
    const last = points[i]!;
    // the window of the reading: from the newest point at or before one hour back (never across a gap)
    const target = last.t - WHALE_LOOKBACK_MS;
    while (lo + 1 <= i && points[lo + 1]!.t <= target) lo++;
    const reading = whaleReading(opts.symbol, series.slice(Math.max(lo, runStart), i + 1), params.confirm);
    if (!reading) continue;
    const step = stepAlerts(memory, [reading], {
      now: last.t,
      userId: "replay",
      params: { whale: params },
      cooldownMs,
      maxAgeMs: { whale: Number.POSITIVE_INFINITY },
      quiet: () => false,
    });
    memory = step.memory;
    for (const f of step.fires) out.push({ t: last.t, event: f.event, side: sideOf(f.event), level: levelOf(f.event), value: f.value, suppressed: f.suppressed !== null, label: ALERT_EVENT_LABEL.de[f.event] });
  }
  return out;
}

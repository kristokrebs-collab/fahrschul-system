/**
 * Trigger lines, zone and invalidation (Plan 5.4). Grey ramp only – the single red accent is the
 * hard invalidation line. Existing lines are updated via `applyOptions({ price })`, never rebuilt.
 */
import { LineStyle, type IPriceLine, type ISeriesApi, type LineWidth, type Time } from "lightweight-charts";
import type { MarketLevels } from "@/domain/types";
import { ink } from "./theme";
import { ZonePrimitive } from "./primitives/ZonePrimitive";

export type LevelKey = "longTrigger" | "longStop" | "shortTrigger" | "invalidation" | "lowerHigh";
export const LEVEL_KEYS: readonly LevelKey[] = ["longTrigger", "longStop", "shortTrigger", "invalidation", "lowerHigh"];

export interface LevelStyle {
  color: string;
  lineStyle: LineStyle;
  /** short on-canvas title (Plan 5.4) */
  title: string;
  /** full German label (settings card `Live-Status · Trigger-Level`) for legends/tooltips */
  label: string;
  axisLabelColor: string;
  axisLabelTextColor: string;
}

export const LEVEL_STYLES: Record<LevelKey, LevelStyle> = {
  longTrigger: {
    color: ink.fg,
    lineStyle: LineStyle.Dotted,
    title: "LONG",
    label: "Long-Trigger (4H über)",
    axisLabelColor: ink.fg,
    axisLabelTextColor: ink.bg,
  },
  longStop: {
    color: ink.mute,
    lineStyle: LineStyle.SparseDotted,
    title: "INVAL",
    label: "Long-Invalidierung",
    axisLabelColor: ink.mute,
    axisLabelTextColor: ink.bg,
  },
  shortTrigger: {
    color: ink.fg,
    lineStyle: LineStyle.Dotted,
    title: "SHORT",
    label: "Short-Trigger (4H unter)",
    axisLabelColor: ink.fg,
    axisLabelTextColor: ink.bg,
  },
  invalidation: {
    color: ink.signal,
    lineStyle: LineStyle.Dashed,
    title: "HART",
    label: "Harte Invalidierung",
    axisLabelColor: ink.signal,
    axisLabelTextColor: ink.fg,
  },
  lowerHigh: {
    color: ink.tick,
    lineStyle: LineStyle.Dotted,
    title: "LH W",
    label: "Lower High (Weekly)",
    axisLabelColor: ink.tick,
    axisLabelTextColor: ink.fg,
  },
};

export const levelColor = (key: LevelKey): string => LEVEL_STYLES[key].color;

export type ActiveScenario = "long" | "short" | null;

/** Which line the active scenario highlights (`lineWidth 2`). */
export function levelWidth(key: LevelKey, active: ActiveScenario): LineWidth {
  if (active === "long" && key === "longTrigger") return 2;
  if (active === "short" && key === "shortTrigger") return 2;
  return 1;
}

export interface LevelLines {
  lines: Record<LevelKey, IPriceLine>;
  zone: ZonePrimitive;
}

export interface SetLevelsOptions {
  active?: ActiveScenario;
  /** left edge of the zone band (first loaded candle); `null` → pane border */
  from?: Time | null;
  /** first creation fades the zone in (skipped under reduced motion) */
  reducedMotion?: boolean;
  /** show/hide the zone band */
  zoneVisible?: boolean;
}

function isFinitePrice(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Creates or updates the five price lines and the zone primitive on `series`.
 * Pass the previous `LevelLines` to update in place; returns the (same or new) handle.
 */
export function setLevels(
  series: ISeriesApi<"Candlestick">,
  levels: MarketLevels,
  prev: LevelLines | null,
  opts: SetLevelsOptions = {},
): LevelLines {
  const active = opts.active ?? null;
  const lo = Math.min(levels.zoneLow, levels.zoneHigh);
  const hi = Math.max(levels.zoneLow, levels.zoneHigh);

  if (prev) {
    for (const key of LEVEL_KEYS) {
      const price = levels[key];
      const line = prev.lines[key];
      line.applyOptions({
        price: isFinitePrice(price) ? price : 0,
        lineVisible: isFinitePrice(price),
        axisLabelVisible: isFinitePrice(price),
        lineWidth: levelWidth(key, active),
      });
    }
    prev.zone.setRange({ low: lo, high: hi, from: opts.from ?? null, to: null });
    if (opts.zoneVisible === false) prev.zone.applyOptions({ opacity: 0 });
    else if (prev.zone.options.opacity === 0) prev.zone.applyOptions({ opacity: 1 });
    return prev;
  }

  const lines = {} as Record<LevelKey, IPriceLine>;
  for (const key of LEVEL_KEYS) {
    const s = LEVEL_STYLES[key];
    const price = levels[key];
    lines[key] = series.createPriceLine({
      id: key,
      price: isFinitePrice(price) ? price : 0,
      color: s.color,
      lineWidth: levelWidth(key, active),
      lineStyle: s.lineStyle,
      lineVisible: isFinitePrice(price),
      axisLabelVisible: isFinitePrice(price),
      title: s.title,
      axisLabelColor: s.axisLabelColor,
      axisLabelTextColor: s.axisLabelTextColor,
    });
  }
  const zone = new ZonePrimitive({ low: lo, high: hi, from: opts.from ?? null, to: null });
  series.attachPrimitive(zone);
  if (opts.zoneVisible === false) zone.applyOptions({ opacity: 0 });
  else zone.fadeIn(320, opts.reducedMotion ?? false);
  return { lines, zone };
}

/** Removes all lines and detaches the zone. Safe to call on a series that is about to be removed. */
export function clearLevels(series: ISeriesApi<"Candlestick">, handle: LevelLines | null): void {
  if (!handle) return;
  for (const key of LEVEL_KEYS) {
    try {
      series.removePriceLine(handle.lines[key]);
    } catch {
      /* series already disposed */
    }
  }
  try {
    series.detachPrimitive(handle.zone);
  } catch {
    /* series already disposed */
  }
}

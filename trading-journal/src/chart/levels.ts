/**
 * Trigger lines, zone and invalidation (Plan 5.4). Grey ramp only – the single red accent is the
 * hard invalidation line. Existing lines are updated via `applyOptions({ price })`, never rebuilt. A level of `0` (or
 * any non-positive / non-finite value) counts as "not set": its line and axis label are hidden, and the zone band
 * hides unless both edges are set.
 */
import { LineStyle, type IPriceLine, type ISeriesApi, type LineWidth, type Time } from "lightweight-charts";
import type { MarketLevels } from "@/domain/types";
import { ink } from "./theme";
import { ZONE_DEFAULTS, ZonePrimitive } from "./primitives/ZonePrimitive";

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

/** Level line styles; the colours come from the live palette (read when a line is created or re-synced). */
export const LEVEL_STYLES: Record<LevelKey, LevelStyle> = {
  longTrigger: {
    get color() {
      return ink.fg;
    },
    lineStyle: LineStyle.Dotted,
    title: "LONG",
    label: "Long-Trigger (4H über)",
    get axisLabelColor() {
      return ink.fg;
    },
    get axisLabelTextColor() {
      return ink.bg;
    },
  },
  longStop: {
    get color() {
      return ink.mute;
    },
    lineStyle: LineStyle.SparseDotted,
    title: "INVAL",
    label: "Long-Invalidierung",
    get axisLabelColor() {
      return ink.mute;
    },
    get axisLabelTextColor() {
      return ink.bg;
    },
  },
  shortTrigger: {
    get color() {
      return ink.fg;
    },
    lineStyle: LineStyle.Dotted,
    title: "SHORT",
    label: "Short-Trigger (4H unter)",
    get axisLabelColor() {
      return ink.fg;
    },
    get axisLabelTextColor() {
      return ink.bg;
    },
  },
  invalidation: {
    get color() {
      return ink.signal;
    },
    lineStyle: LineStyle.Dashed,
    title: "HART",
    label: "Harte Invalidierung",
    get axisLabelColor() {
      return ink.signal;
    },
    get axisLabelTextColor() {
      return ink.onFill;
    },
  },
  lowerHigh: {
    get color() {
      return ink.tick;
    },
    lineStyle: LineStyle.Dotted,
    title: "LH W",
    label: "Lower High (Weekly)",
    get axisLabelColor() {
      return ink.tick;
    },
    get axisLabelTextColor() {
      return ink.onFill;
    },
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
  /** show/hide the zone band (default: shown when both edges are set, `zoneIsSet`) */
  zoneVisible?: boolean;
}

function isFinitePrice(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** A level is set when it is a positive price (`0` = not set: share edition / fresh journal). */
function isSetPrice(v: unknown): v is number {
  return isFinitePrice(v) && v > 0;
}

/** The zone band shows only with both edges set (else its autoscale would pull the price axis down to 0). */
export function zoneIsSet(levels: Pick<MarketLevels, "zoneLow" | "zoneHigh">): boolean {
  return isSetPrice(levels.zoneLow) && isSetPrice(levels.zoneHigh);
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

  const zoneOn = opts.zoneVisible ?? zoneIsSet(levels);

  if (prev) {
    for (const key of LEVEL_KEYS) {
      const price = levels[key];
      const line = prev.lines[key];
      const st = LEVEL_STYLES[key];
      line.applyOptions({
        price: isSetPrice(price) ? price : 0,
        lineVisible: isSetPrice(price),
        axisLabelVisible: isSetPrice(price),
        lineWidth: levelWidth(key, active),
        // the palette may have changed since the line was created (light mode)
        color: st.color,
        axisLabelColor: st.axisLabelColor,
        axisLabelTextColor: st.axisLabelTextColor,
      });
    }
    prev.zone.applyOptions({ fill: ZONE_DEFAULTS.fill, stroke: ZONE_DEFAULTS.stroke, labelBackground: ZONE_DEFAULTS.labelBackground, labelText: ZONE_DEFAULTS.labelText });
    prev.zone.setRange({ low: lo, high: hi, from: opts.from ?? null, to: null });
    if (!zoneOn) prev.zone.applyOptions({ opacity: 0 });
    else if (prev.zone.options.opacity === 0) prev.zone.applyOptions({ opacity: 1 });
    return prev;
  }

  const lines = {} as Record<LevelKey, IPriceLine>;
  for (const key of LEVEL_KEYS) {
    const s = LEVEL_STYLES[key];
    const price = levels[key];
    lines[key] = series.createPriceLine({
      id: key,
      price: isSetPrice(price) ? price : 0,
      color: s.color,
      lineWidth: levelWidth(key, active),
      lineStyle: s.lineStyle,
      lineVisible: isSetPrice(price),
      axisLabelVisible: isSetPrice(price),
      title: s.title,
      axisLabelColor: s.axisLabelColor,
      axisLabelTextColor: s.axisLabelTextColor,
    });
  }
  const zone = new ZonePrimitive({ low: lo, high: hi, from: opts.from ?? null, to: null });
  series.attachPrimitive(zone);
  if (!zoneOn) zone.applyOptions({ opacity: 0 });
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

/* ------------------------------------------------------------------------------------ own key levels (F09) */

/** Status of an own key level as the line shows it (mirrors `LevelStatus` of the key-level domain). */
export type KeyLineStatus = "waiting" | "provisional" | "confirmed" | "invalidated" | "unknown";

/** One own key level as a chart line (the five fixed levels keep their own lines above). */
export interface KeyLine {
  id: string;
  price: number;
  /** short on-canvas title (name + status glyph), already shortened by the caller */
  title: string;
  status: KeyLineStatus;
}

/** The created lines by level id. */
export type KeyLineHandle = Map<string, IPriceLine>;

function keyLineOptions(l: KeyLine) {
  // grey ramp only (the red accent stays the hard invalidation): the state reads from weight and dash
  const color = l.status === "confirmed" ? ink.fg : l.status === "provisional" ? ink.mute : ink.tick;
  const lineStyle = l.status === "confirmed" ? LineStyle.Solid : l.status === "provisional" ? LineStyle.Dashed : l.status === "waiting" ? LineStyle.Dotted : LineStyle.SparseDotted;
  return {
    price: l.price,
    color,
    lineWidth: (l.status === "confirmed" ? 2 : 1) as LineWidth,
    lineStyle,
    lineVisible: true,
    axisLabelVisible: true,
    title: l.title,
    axisLabelColor: color,
    axisLabelTextColor: l.status === "confirmed" || l.status === "provisional" ? ink.bg : ink.onFill,
  };
}

/** Creates, updates (in place) and removes the lines of the own key levels; returns the new handle. */
export function syncKeyLines(series: ISeriesApi<"Candlestick">, lines: readonly KeyLine[], prev: KeyLineHandle | null): KeyLineHandle {
  const next: KeyLineHandle = new Map();
  const want = new Set(lines.filter((l) => isSetPrice(l.price)).map((l) => l.id));
  for (const [id, line] of prev ?? []) {
    if (want.has(id)) continue;
    try {
      series.removePriceLine(line);
    } catch {
      /* series already disposed */
    }
  }
  for (const l of lines) {
    if (!want.has(l.id)) continue;
    const opts = keyLineOptions(l);
    const old = prev?.get(l.id);
    if (old) {
      old.applyOptions(opts);
      next.set(l.id, old);
    } else next.set(l.id, series.createPriceLine({ id: `kl-${l.id}`, ...opts }));
  }
  return next;
}

/** Removes the own-level lines. Safe on a series that is about to be removed. */
export function clearKeyLines(series: ISeriesApi<"Candlestick">, handle: KeyLineHandle | null): void {
  for (const line of handle?.values() ?? []) {
    try {
      series.removePriceLine(line);
    } catch {
      /* series already disposed */
    }
  }
}

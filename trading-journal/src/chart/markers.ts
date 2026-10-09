/**
 * Trade markers (Plan 5.5). Entry ▲/▼ per side (journal colours – declared exception to the
 * one-accent rule), exit ● toned by result. Marker ids are `e:{tradeId}` / `x:{tradeId}`.
 * Trades outside the loaded history are dropped silently and counted (`outside`).
 */
import type { ISeriesApi, MismatchDirection, SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import type { EnrichedTrade, Side, TradeResult } from "@/domain/types";
import { fmt, tradeTime } from "./format";
import { ink } from "./ink";

/** `MismatchDirection.NearestLeft` as a literal: type-only import keeps `lightweight-charts` out of the main chunk. */
const NEAREST_LEFT: MismatchDirection = -1;

export interface TradeMarker {
  id: string;
  /** trade time, ms (bundle `tt`) */
  time: number;
  side: Side;
  entry: number | null;
  exit: number | null;
  pnl: number | null;
  result: TradeResult;
}

export const MARKER_COLORS = {
  long: ink.win,
  short: ink.loss,
  win: ink.win,
  loss: ink.loss,
  be: ink.mute,
  open: ink.fg,
} as const;

export function toTradeMarkers(
  trades: readonly Pick<EnrichedTrade, "id" | "side" | "entry" | "exit" | "pnl" | "result" | "date" | "createdAt">[],
): TradeMarker[] {
  return trades.map((t) => ({
    id: t.id,
    time: tradeTime(t),
    side: t.side,
    entry: t.entry,
    exit: t.exit,
    pnl: t.pnl,
    result: t.result,
  }));
}

/** Minimal surface of `ITimeScaleApi` + `ISeriesApi` used for snapping (mockable). */
export interface SnapSource {
  timeToIndex(time: Time, findNearest?: boolean): number | null;
  dataByIndex(index: number, mismatchDirection?: MismatchDirection): { time: Time } | null;
}

/** Snaps a UTC second to the time of the nearest-left candle; `null` when not resolvable. */
export function snapTime(src: SnapSource, timeSec: number): UTCTimestamp | null {
  const idx = src.timeToIndex(timeSec as UTCTimestamp, true);
  if (idx == null) return null;
  const item = src.dataByIndex(idx, NEAREST_LEFT);
  const t = item?.time;
  return typeof t === "number" ? (t as UTCTimestamp) : null;
}

export interface HistoryBounds {
  /** first candle open, seconds */
  first: number;
  /** last candle open, seconds */
  last: number;
  /** bar length, seconds */
  intervalSec: number;
}

export function boundsOf(candles: readonly { time: Time }[], intervalSec: number): HistoryBounds | null {
  const f = candles[0]?.time;
  const l = candles[candles.length - 1]?.time;
  if (typeof f !== "number" || typeof l !== "number") return null;
  return { first: f, last: l, intervalSec };
}

export function isInsideHistory(timeSec: number, b: HistoryBounds): boolean {
  return timeSec >= b.first && timeSec < b.last + b.intervalSec;
}

export interface BuiltMarkers {
  markers: SeriesMarker<Time>[];
  /** trades outside the loaded history (silently omitted) */
  outside: number;
  /** marker id → trade id */
  byId: Map<string, string>;
}

export const MARKER_ENTRY_PREFIX = "e:";
export const MARKER_EXIT_PREFIX = "x:";

/** `hoveredInfo.objectId` → trade id (`null` when it is not one of ours). */
export function markerTradeId(objectId: unknown): string | null {
  if (typeof objectId !== "string") return null;
  if (objectId.startsWith(MARKER_ENTRY_PREFIX) || objectId.startsWith(MARKER_EXIT_PREFIX)) return objectId.slice(2);
  return null;
}

export function exitTone(result: TradeResult): string {
  return result === "win" ? MARKER_COLORS.win : result === "loss" ? MARKER_COLORS.loss : result === "be" ? MARKER_COLORS.be : MARKER_COLORS.open;
}

export function buildMarkers(
  trades: readonly TradeMarker[],
  snap: (timeSec: number) => UTCTimestamp | null,
  bounds: HistoryBounds | null,
): BuiltMarkers {
  const markers: SeriesMarker<Time>[] = [];
  const byId = new Map<string, string>();
  let outside = 0;
  for (const t of trades) {
    const sec = Math.floor(t.time / 1000);
    if (!Number.isFinite(sec) || !bounds || !isInsideHistory(sec, bounds)) {
      outside += 1;
      continue;
    }
    const time = snap(sec);
    if (time == null) {
      outside += 1;
      continue;
    }
    const short = t.side === "short";
    if (t.entry != null && Number.isFinite(t.entry)) {
      const id = MARKER_ENTRY_PREFIX + t.id;
      markers.push({
        id,
        time,
        position: "atPriceMiddle",
        price: t.entry,
        shape: short ? "arrowDown" : "arrowUp",
        color: short ? MARKER_COLORS.short : MARKER_COLORS.long,
        size: 1,
        text: short ? "▼ Short" : "▲ Long",
      });
      byId.set(id, t.id);
    }
    if (t.exit != null && Number.isFinite(t.exit)) {
      const id = MARKER_EXIT_PREFIX + t.id;
      markers.push({
        id,
        time,
        position: "atPriceMiddle",
        price: t.exit,
        shape: "circle",
        color: exitTone(t.result),
        size: 1,
        text: t.pnl == null ? undefined : fmt.signed(t.pnl),
      });
      byId.set(id, t.id);
    }
  }
  // lightweight-charts expects markers sorted by time
  markers.sort((a, b) => (a.time as number) - (b.time as number));
  return { markers, outside, byId };
}

export interface MarkerHitOptions {
  /** CSS px radius around a marker centre that counts as a hit (default 12) */
  radius?: number;
}

/**
 * Fallback hit-test for clicks that miss the library's own marker hover (e.g. touch):
 * returns the trade id of the closest marker within `radius` of `(x, y)`.
 */
export function hitMarker(
  markers: readonly SeriesMarker<Time>[],
  point: { x: number; y: number },
  toX: (time: Time) => number | null,
  toY: (price: number) => number | null,
  opts: MarkerHitOptions = {},
): string | null {
  const r = opts.radius ?? 12;
  let best: { id: string; d: number } | null = null;
  for (const m of markers) {
    if (!m.id || m.price == null) continue;
    const x = toX(m.time);
    const y = toY(m.price);
    if (x == null || y == null) continue;
    const d = Math.hypot(x - point.x, y - point.y);
    if (d <= r && (!best || d < best.d)) best = { id: m.id, d };
  }
  return best ? markerTradeId(best.id) : null;
}

/** Convenience: snap source from a candlestick series and its chart's time scale. */
export function snapSourceOf(series: ISeriesApi<"Candlestick">, timeScale: { timeToIndex: SnapSource["timeToIndex"] }): SnapSource {
  return {
    timeToIndex: (t, n) => timeScale.timeToIndex(t, n),
    dataByIndex: (i, d) => series.dataByIndex(i, d),
  };
}

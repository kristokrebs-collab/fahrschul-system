/**
 * MCB (Market Cipher B / WaveTrend) events of the "Einstiegs-Check" as chart markers: long kinds (Bottom, Kaufsignal)
 * as a win-green dot BELOW the bar, short kinds (Top, Verkaufssignal) as a loss-red dot ABOVE it – the same journal
 * semantics as the trade markers (declared exception to the one-accent rule, Plan 5.5). Bottom/Top are the larger
 * dots; an event on the running (repainting) bar is drawn translucent. Marker ids are `m:{time}:{kind}`, so a click
 * on one is never mistaken for a trade marker.
 */
import type { SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import { ink } from "./ink";

export type SignalKind = "bottom" | "buy" | "bull" | "top" | "sell" | "bear";

export interface SignalMarker {
  /** open time of the bar, ms UTC */
  time: number;
  kind: SignalKind;
  /** on the running bar (may still repaint) */
  live?: boolean;
}

export const SIGNAL_MARKER_PREFIX = "m:";
const LONG_KINDS: ReadonlySet<SignalKind> = new Set(["bottom", "buy", "bull"]);
/** size multiplier per kind (lightweight-charts marker `size`) */
const SIZE: Record<SignalKind, number> = { bottom: 1, top: 1, buy: 0.7, sell: 0.7, bull: 0.45, bear: 0.45 };
const TITLE: Record<SignalKind, string> = { bottom: "Bottom", top: "Top", buy: "Kauf", sell: "Verkauf", bull: "", bear: "" };
/** translucent tone for the repainting bar (≈ 55 % alpha) */
const LIVE_ALPHA = "8c";

/**
 * Series markers for `signals`, keeping only bars the chart holds (`times`, UTC seconds) – lightweight-charts expects
 * marker times on existing bars, sorted ascending. `labels` adds the short word (`Bottom` / `Top`) to the strong dots.
 */
export function buildSignalMarkers(signals: readonly SignalMarker[], times: ReadonlySet<number>, opts: { labels?: boolean } = {}): SeriesMarker<Time>[] {
  const out: SeriesMarker<Time>[] = [];
  for (const s of signals) {
    const t = Math.floor(s.time / 1000);
    if (!times.has(t)) continue;
    const long = LONG_KINDS.has(s.kind);
    const base = long ? ink.win : ink.loss;
    const text = opts.labels ? TITLE[s.kind] : "";
    out.push({
      id: `${SIGNAL_MARKER_PREFIX}${t}:${s.kind}`,
      time: t as UTCTimestamp,
      position: long ? "belowBar" : "aboveBar",
      shape: "circle",
      color: s.live ? `${base}${LIVE_ALPHA}` : base,
      size: SIZE[s.kind],
      ...(text ? { text } : {}),
    });
  }
  out.sort((a, b) => (a.time as number) - (b.time as number));
  return out;
}

/** Stable key of a marker list (the chart re-sets markers only when it changes). */
export const signalMarkersKey = (signals: readonly SignalMarker[]): string => signals.map((s) => `${s.time}${s.kind}${s.live ? "~" : ""}`).join(",");

/**
 * MCB (Market Cipher B / WaveTrend) events of the "Einstiegs-Check" as chart dots: long kinds (Bottom, Kaufsignal)
 * in win green BELOW the bar, short kinds (Top, Verkaufssignal) in loss red ABOVE it – the same journal semantics as
 * the trade markers (declared exception to the one-accent rule, Plan 5.5). Bottom/Top are the larger dots.
 *
 * Candle-close state (decisions 6 + 9): an event on the forming candle is `provisional` – an outlined ring in the
 * ~50 % saturated tone; after its candle closed with the event it is `confirmed` – a filled dot at full saturation;
 * still lit after `strongCloses` closes with the move held it is `strong` – the filled dot plus a thin halo ring.
 * Drawn by `primitives/SignalOverlay.ts` (lightweight-charts series markers cannot outline). Dot ids are
 * `m:{time}:{kind}`, so a dot is never mistaken for a trade marker.
 */
import type { SignalState } from "@/domain/signals/state";
import { ink } from "./ink";
import { barIndex, DOT_RADIUS, stackDots } from "./overlayLayout";

export type SignalKind = "bottom" | "buy" | "bull" | "top" | "sell" | "bear";

export interface SignalMarker {
  /** open time of the bar, ms UTC */
  time: number;
  kind: SignalKind;
  /** on the running bar (may still repaint) */
  live?: boolean;
  /** candle-close state (`@/market` `getMcbSeries`); absent → `live` decides (provisional) or confirmed */
  state?: SignalState;
}

export const SIGNAL_MARKER_PREFIX = "m:";
const LONG_KINDS: ReadonlySet<SignalKind> = new Set(["bottom", "buy", "bull"]);
export const isLongSignal = (k: SignalKind): boolean => LONG_KINDS.has(k);

export type DotStyle = "provisional" | "confirmed" | "strong";

/** Look of a marker: provisional (forming candle) → ring, confirmed → dot, strong → dot + halo. */
export function dotStyle(s: Pick<SignalMarker, "live" | "state">): DotStyle {
  if (s.state === "provisional" || (s.state === undefined && s.live)) return "provisional";
  return s.state === "strong" ? "strong" : "confirmed";
}

/** Colour of a dot: full win / loss once confirmed, the desaturated tone while provisional. */
export function dotColor(long: boolean, style: DotStyle): string {
  if (style === "provisional") return long ? ink.winSoft : ink.lossSoft;
  return long ? ink.win : ink.loss;
}

/** One dot as the overlay draws it. */
export interface SignalDot {
  id: string;
  /** index of the bar in the chart's data */
  index: number;
  long: boolean;
  kind: SignalKind;
  /** radius, CSS px */
  r: number;
  /** centre distance from the wick tip (CSS px, away from the bar; stacked dots of one bar grow outwards) */
  offset: number;
  style: DotStyle;
  color: string;
}

/**
 * Dots for `signals` on the chart's bars (`bars[i].time` in UTC seconds, ascending). Events on bars the chart does not
 * hold are dropped; several events on one bar side stack outwards (strongest kind next to the bar).
 */
export function signalDots(signals: readonly SignalMarker[], bars: { readonly length: number; readonly [i: number]: { time: number } }): SignalDot[] {
  const bySide = new Map<string, SignalMarker[]>();
  const order: string[] = [];
  for (const s of signals) {
    const t = Math.floor(s.time / 1000);
    const index = barIndex(bars, t);
    if (index < 0) continue;
    const key = `${index}:${isLongSignal(s.kind) ? "L" : "S"}`;
    const list = bySide.get(key);
    if (list) list.push(s);
    else {
      bySide.set(key, [s]);
      order.push(key);
    }
  }
  const out: SignalDot[] = [];
  for (const key of order) {
    const list = bySide.get(key)!.slice().sort((a, b) => (DOT_RADIUS[b.kind] ?? 0) - (DOT_RADIUS[a.kind] ?? 0));
    const index = Number(key.slice(0, key.indexOf(":")));
    const radii = list.map((s) => DOT_RADIUS[s.kind] ?? 2.5);
    const offsets = stackDots(radii);
    list.forEach((s, k) => {
      const long = isLongSignal(s.kind);
      const style = dotStyle(s);
      out.push({ id: `${SIGNAL_MARKER_PREFIX}${Math.floor(s.time / 1000)}:${s.kind}`, index, long, kind: s.kind, r: radii[k]!, offset: offsets[k]!, style, color: dotColor(long, style) });
    });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

/** Stable key of a marker list (the chart re-sets its dots only when it changes). */
export const signalMarkersKey = (signals: readonly SignalMarker[]): string => signals.map((s) => `${s.time}${s.kind}${s.live ? "~" : ""}${s.state ? s.state[0] : ""}`).join(",");

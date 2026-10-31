/**
 * Geometry and texts of the "Top-Trader netto" chart (pure, CSS pixels): the net curve around the zero line with its own
 * symmetric scale, the price as a thin line on its own scale (no axis – the numbers are in the readout), the time axis,
 * the nearest point for the crosshair and the readout. The canvas component only paints what this returns.
 */
import { netText, type NetPoint, type TraderNetView } from "@/domain/signals";
import { n0, n1 } from "@/lib/format";

export const NET_CHART_H = 176;
const PAD = { l: 34, r: 8, t: 10, b: 20 } as const;

export interface NetGeometry {
  w: number;
  h: number;
  /** plot box */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** half range of the net axis (pp), a nice number */
  max: number;
  tMin: number;
  tMax: number;
  pMin: number | null;
  pMax: number | null;
  x(t: number): number;
  y(net: number): number;
  /** price → y (own scale, top 8 % … bottom 8 % of the plot); `NaN` without a price range */
  yPrice(price: number): number;
  zeroY: number;
}

/** 5 · 10 · 20 · 25 · 40 · 50 · 100 … : the smallest nice number ≥ `v` (at least 5). */
export function niceMax(v: number): number {
  if (!(v > 5)) return 5;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 4, 5, 10]) if (m * e >= v) return m * e;
  return 10 * e;
}

export function netGeometry(points: readonly NetPoint[], w: number, h: number = NET_CHART_H): NetGeometry | null {
  if (points.length < 2 || !(w > PAD.l + PAD.r + 20)) return null;
  const tMin = points[0]!.t;
  const tMax = points[points.length - 1]!.t;
  if (!(tMax > tMin)) return null;
  const max = niceMax(Math.max(...points.map((p) => Math.abs(p.net))) * 1.12);
  const prices = points.map((p) => p.price).filter((p): p is number => p !== null && Number.isFinite(p));
  const pMin = prices.length ? Math.min(...prices) : null;
  const pMax = prices.length ? Math.max(...prices) : null;
  const left = PAD.l;
  const right = w - PAD.r;
  const top = PAD.t;
  const bottom = h - PAD.b;
  const ph = bottom - top;
  const zeroY = top + ph / 2;
  return {
    w,
    h,
    left,
    right,
    top,
    bottom,
    max,
    tMin,
    tMax,
    pMin,
    pMax,
    x: (t) => left + ((t - tMin) / (tMax - tMin)) * (right - left),
    y: (net) => zeroY - (net / max) * (ph / 2),
    yPrice: (price) => (pMin === null || pMax === null ? NaN : pMax === pMin ? zeroY : bottom - ph * 0.08 - ((price - pMin) / (pMax - pMin)) * ph * 0.84),
    zeroY,
  };
}

/** Index of the point nearest to the x position `px` (CSS px in the chart box). */
export function nearestIndex(points: readonly NetPoint[], geo: NetGeometry, px: number): number {
  if (!points.length) return -1;
  const t = geo.tMin + ((Math.min(Math.max(px, geo.left), geo.right) - geo.left) / (geo.right - geo.left)) * (geo.tMax - geo.tMin);
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(points[lo - 1]!.t - t) <= Math.abs(points[lo]!.t - t) ? lo - 1 : lo;
}

const dayFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hourCycle: "h23" });

/** `28.10.` (UTC day, the axis) */
export const dayLabel = (t: number): string => dayFmt.format(new Date(t));
/** `28.10., 14:00 UTC` (the readout) */
export const stampLabel = (t: number): string => `${dateTimeFmt.format(new Date(t))} UTC`;

export interface NetReadout {
  stamp: string;
  /** `Netto +8,2 Pkt. · Long 54,1 %` */
  net: string;
  /** `Preis 74.100` / `Preis –` (no candle for this time) */
  price: string;
  /** one sentence for a screen reader */
  speak: string;
}

export function readoutOf(p: NetPoint): NetReadout {
  const price = p.price !== null ? `Preis ${n0(p.price)}` : "Preis –";
  const net = `Netto ${netText(p.net)} · Long ${n1(p.longPct)} %`;
  const stamp = stampLabel(p.t);
  return { stamp, net, price, speak: `${stamp}: ${net}, ${price}` };
}

/** Accessible name of the chart: what it shows and the headline numbers. */
export function chartLabel(v: TraderNetView): string {
  if (v.status !== "ok" || !v.last) return "Top-Trader netto: keine Daten";
  const flip = v.flip ? `, letzter Wechsel nach ${v.flip.to === "long" ? "Long" : "Short"} am ${dayLabel(v.flip.at)}` : ", kein Wechsel im geladenen Verlauf";
  return `Top-Trader (Binance) netto, ${v.count} Punkte von ${dayLabel(v.points[0]!.t)} bis ${dayLabel(v.last.t)}: zuletzt ${netText(v.last.net)}${flip}.`;
}

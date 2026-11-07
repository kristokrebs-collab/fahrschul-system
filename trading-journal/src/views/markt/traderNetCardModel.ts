/**
 * Pure model of the big "Top-Trader: Netto Long/Short" card on the Markt page (no React, no canvas): the choice of time
 * ranges from the REAL length of the loaded history, the slice for a range, the plot padding of the big chart (a price axis on
 * the right), the ticks of the three axes, where the flip label sits, the key figures under the headline and the texts.
 * The geometry itself is the one of the small chart on the Übersicht (`netGeometry`); the data and the net/flip logic come from
 * `@/domain/signals/traderNet` – nothing is calculated twice.
 */
import { durationText, gapText, netDayText, netText, pctText, type NetFlip, type NetGap, type NetPoint, type TraderNetView } from "@/domain/signals";
import { n0, n1, price } from "@/lib/format";
import type { NetGeometry, NetPad } from "@/views/overview/traderNetChart";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Room around the plot box of the big chart (CSS px): net axis left, price axis right, time axis below. */
export function plotPad(width: number): NetPad {
  return width < 480 ? { l: 36, r: 46, t: 18, b: 26 } : { l: 42, r: 58, t: 20, b: 28 };
}

/* ------------------------------------------------------------------------------------------------ time ranges */

export interface RangeChoice {
  id: string;
  /** `null` = the whole loaded history */
  days: number | null;
  /** for the switch, in words (`7 Tage`, `Alles · 20 Tage`) */
  label: string;
  /** the history is not that long (yet): the choice is shown but cannot be taken */
  disabled?: boolean;
}

/** The ranges of the card. */
export const RANGE_DAYS = [7, 30, 90] as const;

/** `20 Tage` / `36 Std.` – the real length of the loaded history (rounded down, never longer than it is). */
export function lengthLabel(spanMs: number): string {
  return durationText(spanMs) ?? "unter 5 Min.";
}

/**
 * The ranges to offer: 7, 30 and 90 days and always "Alles" with the real length. A range the history does not fill (clearly
 * more than the range is needed: 15 % more) is shown but disabled – the stored history grows with every visit, and the switch
 * says what is still to come instead of hiding it. Nothing is promised that is not there; a range as long as the whole history
 * is not taken twice.
 */
export function rangeChoices(spanMs: number): RangeChoice[] {
  const out: RangeChoice[] = [];
  for (const days of RANGE_DAYS) out.push({ id: String(days), days, label: `${days} Tage`, disabled: !(spanMs > days * DAY * 1.15) });
  out.push({ id: "all", days: null, label: `Alles · ${lengthLabel(spanMs)}` });
  return out;
}

/** The points of a range: the newest `days` days (all of them for `null`; never fewer than two points). */
export function windowPoints(points: readonly NetPoint[], days: number | null): NetPoint[] {
  if (days === null || points.length < 3) return points.slice();
  const from = points[points.length - 1]!.t - days * DAY;
  const slice = points.filter((p) => p.t >= from);
  return slice.length >= 2 ? slice : points.slice(-2);
}

/** A flip counts for a chart only when its crossing lies inside the shown range. */
export function flipIn(points: readonly NetPoint[], flip: NetFlip | null): NetFlip | null {
  if (!flip || points.length < 2) return null;
  return flip.at >= points[0]!.t && flip.at <= points[points.length - 1]!.t ? flip : null;
}

/* ------------------------------------------------------------------------------------------------ gaps in the plot */

/** The gaps that lie inside the shown points (both ends are shown points). */
export function gapsInWindow(gaps: readonly NetGap[], points: readonly NetPoint[]): NetGap[] {
  if (points.length < 2) return [];
  const a = points[0]!.t;
  const b = points[points.length - 1]!.t;
  return gaps.filter((g) => g.from >= a && g.to <= b);
}

/** The points split into runs at the gaps (a run ends with the point a gap starts at). One run when there is no gap. */
export function splitRuns(points: readonly NetPoint[], gaps: readonly NetGap[]): NetPoint[][] {
  if (!gaps.length) return [points as NetPoint[]];
  const ends = new Set(gaps.map((g) => g.from));
  const out: NetPoint[][] = [];
  let cur: NetPoint[] = [];
  for (const p of points) {
    cur.push(p);
    if (ends.has(p.t)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** What the crosshair and the arrow keys stop at: every point, and every gap between two points. */
export type PlotStop = { kind: "point"; i: number } | { kind: "gap"; gap: NetGap };

export function plotStops(points: readonly NetPoint[], gaps: readonly NetGap[]): PlotStop[] {
  const at = new Map(gaps.map((g) => [g.from, g] as const));
  const out: PlotStop[] = [];
  points.forEach((p, i) => {
    out.push({ kind: "point", i });
    const g = at.get(p.t);
    if (g) out.push({ kind: "gap", gap: g });
  });
  return out;
}

/** The gap a time lies inside of (between two points of it), else `null`. */
export const gapAt = (gaps: readonly NetGap[], t: number): NetGap | null => gaps.find((g) => t > g.from && t < g.to) ?? null;

/** The readout lines of a gap (the tooltip and the screen reader): there is NO value inside, and none is made up. */
export function gapReadout(g: NetGap): { stamp: string; net: string; price: string; speak: string } {
  const text = gapText(g);
  return { stamp: "Lücke", net: text.replace(/^Lücke /, ""), price: "nichts ergänzt", speak: `${text}. Nichts ergänzt.` };
}

/* ------------------------------------------------------------------------------------------------ axis ticks */

/** 1 · 2 · 2,5 · 5 · 10 × 10ⁿ: the smallest nice step ≥ `raw`. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= raw) return m * e;
  return 10 * e;
}

export interface NetTick {
  v: number;
  y: number;
  label: string;
}

/** `+20` / `0` / `−20` – the left (net) axis: the symmetric range in halves and the zero line. */
export function netTicks(g: Pick<NetGeometry, "max" | "y">): NetTick[] {
  const half = g.max / 2;
  const text = (v: number): string => (v === 0 ? "0" : `${v > 0 ? "+" : "−"}${n0(Math.abs(v))}`);
  // the halves only when they are whole numbers (a range of 25 shows ±25 and 0, not ±12,5)
  const vs = Number.isInteger(half) ? [g.max, half, 0, -half, -g.max] : [g.max, 0, -g.max];
  return vs.map((v) => ({ v, y: g.y(v), label: text(v) }));
}

/** `74.100` – a price tick. */
export const priceTickText = (v: number): string => (Math.abs(v) >= 1000 ? n0(v) : price(v));

/** The right (price) axis: up to `count` nice values inside the drawn range of the price line. */
export function priceTicks(g: Pick<NetGeometry, "pMin" | "pMax" | "yPrice">, count = 3): NetTick[] {
  if (g.pMin === null || g.pMax === null || !(g.pMax > g.pMin)) return [];
  const step = niceStep((g.pMax - g.pMin) / count);
  const out: NetTick[] = [];
  for (let v = Math.ceil(g.pMin / step) * step; v <= g.pMax + step * 1e-9; v += step) out.push({ v, y: g.yPrice(v), label: priceTickText(v) });
  return out.slice(0, count + 1);
}

export interface TimeTick {
  t: number;
  x: number;
  label: string;
}

const TIME_STEPS = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 3 * DAY, 5 * DAY, 7 * DAY, 14 * DAY] as const;
const hourFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hourCycle: "h23" });

/**
 * The time axis: ticks on the UTC clock (days `28.10.`, below a day `14:00`), the smallest step that keeps `minGapPx` between
 * two labels. Only ticks inside the plot and far enough from both ends for their label to fit.
 */
export function timeTicks(g: Pick<NetGeometry, "tMin" | "tMax" | "left" | "right" | "x">, minGapPx = 56): TimeTick[] {
  const width = g.right - g.left;
  const span = g.tMax - g.tMin;
  if (!(width > 0) || !(span > 0)) return [];
  const pxPerMs = width / span;
  const step = TIME_STEPS.find((s) => s * pxPerMs >= minGapPx) ?? TIME_STEPS[TIME_STEPS.length - 1]!;
  const out: TimeTick[] = [];
  for (let t = Math.ceil(g.tMin / step) * step; t <= g.tMax; t += step) {
    const x = g.x(t);
    if (x < g.left + 14 || x > g.right - 14) continue;
    out.push({ t, x, label: step >= DAY || t % DAY === 0 ? netDayText(t) : hourFmt.format(new Date(t)) });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ flip label */

/**
 * Where the flip label (the pill at the top with the arrow down to the crossing) sits: centred on the crossing, else left or
 * right of it – whichever hides fewer points of the net curve (a point whose y is inside the label's band) – and always inside
 * the plot box. Returns the pill's left edge.
 */
export function pillPlacement(g: Pick<NetGeometry, "left" | "right" | "top" | "x" | "y">, points: readonly NetPoint[], fx: number, pillW: number, band = 18): number {
  const clamp = (x: number): number => Math.max(g.left, Math.min(g.right - pillW, x));
  const candidates = [clamp(fx - pillW / 2), clamp(fx - pillW + 12), clamp(fx - 12)];
  const limit = g.top + band;
  let best = candidates[0]!;
  let bestHidden = Infinity;
  for (const left of candidates) {
    let hidden = 0;
    for (const p of points) {
      const x = g.x(p.t);
      if (x >= left && x <= left + pillW && g.y(p.net) < limit) hidden++;
    }
    if (hidden < bestHidden) {
      best = left;
      bestHidden = hidden;
    }
  }
  return best;
}

/* ------------------------------------------------------------------------------------------------ key figures */

export type KpiTone = "win" | "loss" | "mute" | "fg";

export interface Kpi {
  id: "net" | "since" | "price";
  label: string;
  value: string;
  /** the line under the value */
  sub: string;
  tone: KpiTone;
}

const toneOf = (x: number | null | undefined): KpiTone => (x === null || x === undefined || x === 0 ? "fg" : x > 0 ? "win" : "loss");

/**
 * The three key figures under the headline: the current net, the days since the flip and the price change since the flip.
 * Without a number the value is `–` and the line says why (a missing candle, no flip in the history) – nothing is guessed.
 */
export function kpisOf(v: TraderNetView | null): Kpi[] {
  const ok = !!v && v.status === "ok" && !!v.last;
  const last = ok ? v.last : null;
  const flip = ok ? v.flip : null;
  const net: Kpi = last
    ? { id: "net", label: "Aktuelles Netto", value: netText(last.net), sub: `Long ${n1(last.longPct)} % der Positionen`, tone: v!.side === "neutral" ? "fg" : v!.side === "long" ? "win" : "loss" }
    : { id: "net", label: "Aktuelles Netto", value: "–", sub: "keine Daten", tone: "mute" };
  const age = flip ? durationText(flip.ageMs) : null;
  const since: Kpi = flip
    ? { id: "since", label: "Seit dem Umschlag", value: age ?? "gerade eben", sub: `Umschlag zu ${flip.to === "long" ? "Long" : "Short"} am ${netDayText(flip.at)}`, tone: "fg" }
    : { id: "since", label: "Seit dem Umschlag", value: "–", sub: ok ? "kein Umschlag im Verlauf" : "keine Daten", tone: "mute" };
  const change = flip?.priceChangePct ?? null;
  const pr: Kpi =
    flip && change !== null
      ? { id: "price", label: "Preis seit dem Umschlag", value: pctText(change), sub: flip.priceAt !== null && v!.priceNow !== null ? `${priceTickText(flip.priceAt)} → ${priceTickText(v!.priceNow)}` : "", tone: toneOf(change) }
      : { id: "price", label: "Preis seit dem Umschlag", value: "–", sub: flip ? "kein Kurs zum Umschlag" : ok ? "kein Umschlag im Verlauf" : "keine Daten", tone: "mute" };
  return [net, since, pr];
}

/* ------------------------------------------------------------------------------------------------ texts */

/** Accessible name of the plot: what it shows for the chosen range and where the last flip lies relative to it. */
export function plotLabel(v: TraderNetView, points: readonly NetPoint[], flipShown: NetFlip | null): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (v.status !== "ok" || !first || !last) return "Top-Trader (Binance) netto: keine Daten";
  const side = (f: NetFlip): string => (f.to === "long" ? "Long" : "Short");
  const flip = flipShown ? `, letzter Umschlag zu ${side(flipShown)} am ${netDayText(flipShown.at)}` : v.flip ? `, letzter Umschlag zu ${side(v.flip)} am ${netDayText(v.flip.at)}, vor dem gezeigten Zeitraum` : ", kein Umschlag im geladenen Verlauf";
  return `Top-Trader (Binance) netto, ${points.length} Punkte von ${netDayText(first.t)} bis ${netDayText(last.t)}: zuletzt ${netText(last.net)}${flip}.`;
}

/** The line under the headline: what was loaded (length, number of points, spacing) – or the reason there is nothing. */
export function loadedLine(v: TraderNetView | null, stepMs: number | null, reason?: string): string {
  if (!v || v.status === "none") return reason ?? "Keine Daten von Binance.";
  const gap = stepMs ? durationText(stepMs) : null;
  // an abbreviation's own dot ends the sentence (no "Std.."): the closing words never follow a bare full stop
  if (v.status === "short") return gap ? `Binance lieferte erst ${v.count} Punkte (Abstand ${gap})` : `Binance lieferte erst ${v.count} Punkte`;
  return `Geladener Verlauf: ${durationText(v.spanMs) ?? "unter 5 Min."} (${v.count} Punkte${gap ? `, Abstand ${gap}` : ""}) · Zeiten in UTC`;
}

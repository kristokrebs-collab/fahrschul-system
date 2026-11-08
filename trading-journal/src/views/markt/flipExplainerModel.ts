/**
 * Pure model of the "Was ist ein Flip?" explainer (no React, no DOM): what the REAL chart of the explainer shows from the data of
 * the Top-Trader card (the last `FLIP_WINDOW_DAYS` days of the series in use, the flip inside them, the gaps), the sentence that
 * says it – only what the history gives – the honest empty states, the numbers of the three-step SCHEMA (invented, labelled so),
 * and the note beside the alert button (what the plan really has).
 *
 * Nothing is calculated twice: the points, gaps and the flip come from the card (`traderNetWal`, `traderNet`); the window and the
 * "flip inside the range" rule are the card's (`traderNetCardModel`). Gaps are never bridged.
 */
import { durationText, netDayText, netText, pctText, type NetFlip, type NetPoint, type TraderNetView } from "@/domain/signals";
import type { NetGap } from "@/domain/signals/netSeries";
import { flipIn, gapsInWindow, lengthLabel, windowPoints } from "./traderNetCardModel";
import { FLIP, FLIP_WHO } from "./flipExplainerStrings";
import type { WalState } from "./traderNetWal";

export const FLIP_WINDOW_DAYS = 14;
const DAY = 86_400_000;

export type FlipKind = "flip" | "flip-before" | "no-flip" | "balanced" | "loading" | "empty";

export interface FlipInput {
  state: WalState;
  /** every point of the card (stored history + live), oldest first; empty unless the card has data */
  points: readonly NetPoint[];
  gaps: readonly NetGap[];
  /** the card's view of the newest gap-free run (`null` without data) */
  view: TraderNetView | null;
  /** why there is no series (the card's own reason line) */
  reason?: string;
}

export interface FlipModel {
  kind: FlipKind;
  /** the points of the window (oldest first); empty for `loading` / `empty` */
  points: NetPoint[];
  gaps: NetGap[];
  /** the last flip, only when its crossing lies inside the window */
  flip: NetFlip | null;
  /** the side the net is on now (`null` = balanced / no data) */
  side: "long" | "short" | null;
  /** `letzte 14 Tage` / `geladener Verlauf: 9 Tage` */
  windowLabel: string;
  /** the label at the crossing: `Flip 28.10. · netto Short` */
  pill: string | null;
  /** the sentence under the chart */
  caption: string;
  /** `−12,4 Pkt.` – the newest net, with its sign */
  netNow: string | null;
  /** the accessible name of the chart */
  label: string;
}

const sideWord = (s: "long" | "short"): string => (s === "long" ? "Long" : "Short");
/** `20 Tagen` – a length inside a sentence. */
const lengthText = (ms: number): string => (durationText(ms) ?? "wenigen Minuten").replace(/ Tage$/, " Tagen");

/** The sentence for an empty state: the card's own reason when it has one. */
export function emptyCaption(state: WalState, reason?: string): string {
  if (state === "loading") return FLIP.loading;
  if (state === "short") return reason ?? "Zu wenig Verlauf von Binance – die Grafik aus echten Daten folgt, sobald genug Punkte da sind.";
  return reason ?? "Keine Top-Trader-Daten von Binance – darum zeigt dieser Bereich nur das Schema.";
}

const EMPTY = (kind: "loading" | "empty", state: WalState, reason?: string): FlipModel => ({
  kind,
  points: [],
  gaps: [],
  flip: null,
  side: null,
  windowLabel: "",
  pill: null,
  caption: emptyCaption(state, reason),
  netNow: null,
  label: kind === "loading" ? "Top-Trader-Netto: Daten werden geladen" : `Top-Trader-Netto: keine Grafik. ${emptyCaption(state, reason)}`,
});

/** The window of the explainer: the newest days (all of the points when the history is shorter). */
export function windowOf(points: readonly NetPoint[]): { points: NetPoint[]; spanMs: number; windowLabel: string } {
  const win = windowPoints(points, FLIP_WINDOW_DAYS);
  const spanMs = win.length > 1 ? win[win.length - 1]!.t - win[0]!.t : 0;
  const full = spanMs >= (FLIP_WINDOW_DAYS - 0.5) * DAY;
  return { points: win, spanMs, windowLabel: full ? `letzte ${FLIP_WINDOW_DAYS} Tage` : `geladener Verlauf: ${lengthLabel(spanMs)}` };
}

export function flipModel(i: FlipInput): FlipModel {
  const ok = (i.state === "ok" || i.state === "stale" || i.state === "archive") && !!i.view && i.view.status === "ok" && !!i.view.last && i.points.length >= 2;
  if (!ok) return EMPTY(i.state === "loading" ? "loading" : "empty", i.state, i.reason);
  const v = i.view!;
  const w = windowOf(i.points);
  const gaps = gapsInWindow(i.gaps, w.points);
  const flip = flipIn(w.points, v.flip);
  const netNow = netText(v.last!.net);
  const side = v.side === "long" || v.side === "short" ? v.side : null;
  const priceChange = v.flip && v.flip.priceChangePct !== null ? ` Preis seit dem Flip: ${pctText(v.flip.priceChangePct)}.` : "";
  let kind: FlipKind;
  let caption: string;
  let pill: string | null = null;
  if (side === null) {
    kind = "balanced";
    caption = `${FLIP_WHO} sind gerade ausgeglichen (${netNow}) – nahe der Nulllinie, weder netto Long noch netto Short.`;
  } else if (flip && v.flip) {
    kind = "flip";
    const when = v.previousFlip ? `erstmals seit ${netDayText(v.previousFlip.at)}` : `im geladenen Verlauf von ${lengthText(v.spanMs)} erstmals`;
    caption = `Flip am ${netDayText(flip.at)}: ${FLIP_WHO} sind ${when} netto ${sideWord(flip.to)}.${priceChange}`;
    pill = `Flip ${netDayText(flip.at)} · netto ${sideWord(flip.to)}`;
  } else if (v.flip) {
    kind = "flip-before";
    caption = `Kein Flip in den gezeigten Tagen: ${FLIP_WHO} sind seit ${netDayText(v.flip.at)} netto ${sideWord(side)}.${priceChange}`;
  } else {
    kind = "no-flip";
    caption = `Kein Flip im geladenen Verlauf von ${lengthText(v.spanMs)}: ${FLIP_WHO} sind durchgehend netto ${sideWord(side)}.`;
  }
  const first = w.points[0]!;
  const last = w.points[w.points.length - 1]!;
  const gapText = gaps.length ? ` ${gaps.length} ${gaps.length === 1 ? "Lücke" : "Lücken"} ohne Messwerte.` : "";
  const label = `Top-Trader-Netto, ${w.points.length} Punkte von ${netDayText(first.t)} bis ${netDayText(last.t)}: zuletzt ${netNow} ${caption}${gapText}`;
  return { kind, points: w.points, gaps, flip, side, windowLabel: w.windowLabel, pill, caption, netNow, label };
}

/* ------------------------------------------------------------------------------------------------ pill */

/** Width of the pill for a text in the 10.5 px mono face of the chart (≈ 6.4 px a character, 16 px of room). */
export const pillWidth = (text: string): number => Math.ceil(text.length * 6.4) + 16;

/* ------------------------------------------------------------------------------------------------ schema */

/** The three panels of the schema share one box and one zero line. */
export const SCHEMA_BOX = { w: 120, h: 72, zero: 36 } as const;

/** Invented curves (x, y in the box; the zero line is at y = 36, smaller y = more long). Step 2 crosses the line at x = 62. */
export const SCHEMA_CURVES: Readonly<Record<1 | 2 | 3, readonly (readonly [number, number])[]>> = {
  1: [[6, 24], [28, 15], [52, 21], [76, 11], [98, 17], [114, 12]],
  2: [[6, 15], [26, 19], [46, 27], [62, 36], [80, 47], [100, 51], [114, 49]],
  3: [[6, 49], [28, 58], [52, 52], [76, 60], [98, 54], [114, 58]],
};
/** Where the schema's flip sits (step 2). */
export const SCHEMA_FLIP = { x: 62, y: 36 } as const;

/** A smooth path through the points (Catmull-Rom → cubic Béziers, tension 0.5): the same polyline every time, no randomness. */
export function smoothPath(pts: readonly (readonly [number, number])[]): string {
  if (pts.length < 2) return "";
  const f = (n: number): string => (Math.round(n * 10) / 10).toString();
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** The filled area between a smooth curve and the zero line. */
export function schemaArea(step: 1 | 2 | 3): string {
  const pts = SCHEMA_CURVES[step];
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  return `${smoothPath(pts)} L${last[0]} ${SCHEMA_BOX.zero} L${first[0]} ${SCHEMA_BOX.zero} Z`;
}

/* ------------------------------------------------------------------------------------------------ alert note */

export interface AlarmNoteInput {
  /** this build has accounts at all */
  cloud: boolean;
  signedIn: boolean;
  /** the plan's limits; `Infinity` = nothing is gated (billing off) – then no number is named */
  channels: number;
  phoneCalls: number;
  /** plan name for the sentence (`Free`, `Pro` …) */
  planLabel: string;
}

/**
 * One sentence about what the alarm needs and what the plan really has (`PLAN_LIMITS`, `docs/TARIFE.md`) – only facts the register
 * and the limits hold, no promise. Empty when there is nothing to say.
 */
export function alarmNote(i: AlarmNoteInput): string {
  if (!i.cloud) return "In dieser Version ohne Konto gibt es die Alarme nicht.";
  if (!i.signedIn) return "Alarme brauchen ein Konto – die Einstellung führt dich zur Anmeldung.";
  if (!Number.isFinite(i.channels)) return "";
  const ch = `${i.channels} ${i.channels === 1 ? "Alarm-Kanal" : "Alarm-Kanäle"}`;
  const phone = i.phoneCalls > 0 ? `Anrufe bis ${i.phoneCalls} im Monat` : "Anrufe ab Premium";
  return `Dein Tarif ${i.planLabel}: ${ch}, ${phone}.`;
}

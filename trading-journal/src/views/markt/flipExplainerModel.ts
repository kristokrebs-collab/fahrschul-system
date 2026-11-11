/**
 * Pure model of the "Was ist ein Flip?" explainer (no React, no DOM): from the data of the Top-Trader card (the last
 * `FLIP_WINDOW_DAYS` days of the series in use, the flip inside them, the gaps) the sentence that says it – only what the history
 * gives – the honest empty states, and the note beside the alert button (what the plan really has).
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
  /** the flip sentence */
  caption: string;
  /** `−12,4 Pkt.` – the newest net, with its sign */
  netNow: string | null;
}

const sideWord = (s: "long" | "short"): string => (s === "long" ? "Long" : "Short");
/** `20 Tagen` – a length inside a sentence. */
const lengthText = (ms: number): string => (durationText(ms) ?? "wenigen Minuten").replace(/ Tage$/, " Tagen");

/** The sentence for an empty state: the card's own reason when it has one. */
export function emptyCaption(state: WalState, reason?: string): string {
  if (state === "loading") return FLIP.loading;
  if (state === "short") return reason ?? "Zu wenig Verlauf von Binance – der Satz zum Flip folgt, sobald genug Punkte da sind.";
  return reason ?? "Keine Top-Trader-Daten von Binance – darum steht hier kein Satz zum Flip.";
}

const EMPTY = (kind: "loading" | "empty", state: WalState, reason?: string): FlipModel => ({
  kind,
  points: [],
  gaps: [],
  flip: null,
  side: null,
  windowLabel: "",
  caption: emptyCaption(state, reason),
  netNow: null,
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
  if (side === null) {
    kind = "balanced";
    caption = `${FLIP_WHO} sind gerade ausgeglichen (${netNow}) – nahe der Nulllinie, weder netto Long noch netto Short.`;
  } else if (flip && v.flip) {
    kind = "flip";
    const when = v.previousFlip ? `erstmals seit ${netDayText(v.previousFlip.at)}` : `im geladenen Verlauf von ${lengthText(v.spanMs)} erstmals`;
    caption = `Flip am ${netDayText(flip.at)}: ${FLIP_WHO} sind ${when} netto ${sideWord(flip.to)}.${priceChange}`;
  } else if (v.flip) {
    kind = "flip-before";
    caption = `Kein Flip in den gezeigten Tagen: ${FLIP_WHO} sind seit ${netDayText(v.flip.at)} netto ${sideWord(side)}.${priceChange}`;
  } else {
    kind = "no-flip";
    caption = `Kein Flip im geladenen Verlauf von ${lengthText(v.spanMs)}: ${FLIP_WHO} sind durchgehend netto ${sideWord(side)}.`;
  }
  return { kind, points: w.points, gaps, flip, side, windowLabel: w.windowLabel, caption, netNow };
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

/**
 * Pure model behind the Top-Trader card of the Markt page (C3 – Wal-Karte): what the card shows once the live series, the stored
 * history and the alert rules are put together – the points (stored history + live), the gaps between them, the view (headline,
 * flip, key figures) of the newest gap-free run, the alert marks, the three lines of provenance (Quelle · Kohorte · Messzeit) and
 * the archive line. No React, no I/O, no clock (`now` is a parameter).
 *
 * Honest by construction:
 *  - nothing is invented: the stored history holds what the card once showed, a stretch without points is a GAP (never filled);
 *  - the headline and the key figures come from the newest run WITHOUT a gap – a flip between two points with a gap in between was
 *    never observed and is not dated;
 *  - the marks are the alert engine's own rules (`replayWhale`) with the default thresholds; they look back, they do not predict.
 */
import { DEFAULT_WHALE_PARAMS, replayWhale, type WhaleMark } from "@/domain/alerts/replay";
import {
  buildTraderNetFromPoints,
  durationText,
  findNetGaps,
  latestRun,
  mergeNetPoints,
  NET_SERIES,
  netDayText,
  netStampText,
  type ArchivedNetPoint,
  type NetGap,
  type NetPoint,
  type NetSeriesId,
  type TraderNetView,
} from "@/domain/signals";
import type { LiveTraderNet } from "@/market/traderNet";

const HOUR = 3_600_000;

export type WalState = "ok" | "stale" | "archive" | "short" | "loading" | "none";

export interface WalModel {
  state: WalState;
  /** every point shown: the stored history in front of the live series, oldest first */
  points: NetPoint[];
  gaps: NetGap[];
  /** headline / flip / key figures: the live view itself when nothing was added, else the view of the newest gap-free run */
  view: TraderNetView | null;
  marks: WhaleMark[];
  /** the first live point (ms), `null` = no live series */
  liveFrom: number | null;
  /** the newest point (ms), `null` = none */
  measuredAt: number | null;
  /** points that came from the stored history */
  storedCount: number;
}

export interface WalInput {
  live: LiveTraderNet;
  archive: readonly ArchivedNetPoint[];
  /** market symbol for the alert reading (`BTCUSDT`) */
  symbol: string;
  now: number;
}

export function buildWal({ live, archive, symbol, now }: WalInput): WalModel {
  const lv = live.view;
  const liveOk = lv !== null && lv.status === "ok" && lv.last !== null;
  const livePts = liveOk ? lv.points : [];
  const step = live.stepMs ?? HOUR;
  const points = mergeNetPoints(archive, livePts, step);
  const gaps = findNetGaps(points, step);
  const storedCount = points.length - livePts.length;
  let view: TraderNetView | null = lv;
  if (storedCount > 0 || gaps.length > 0) {
    const run = latestRun(points, gaps);
    const priceNow = liveOk ? lv.priceNow : (run[run.length - 1]?.price ?? null);
    view = run.length ? buildTraderNetFromPoints(run, now, priceNow) : lv;
  }
  const viewOk = view !== null && view.status === "ok" && view.last !== null;
  let state: WalState;
  if (liveOk && viewOk) state = live.status === "stale" ? "stale" : "ok";
  else if (live.status === "loading") state = "loading";
  else if (!liveOk && storedCount > 0 && viewOk) state = "archive";
  else if (view?.status === "short") state = "short";
  else state = "none";
  const marks =
    state === "ok" || state === "stale" || state === "archive"
      ? replayWhale(
          points.map((p) => ({ t: p.t, longPct: p.longPct })),
          { symbol, breaks: gaps.map((g) => g.index + 1) },
        )
      : [];
  return {
    state,
    points: state === "ok" || state === "stale" || state === "archive" ? points : [],
    gaps: state === "ok" || state === "stale" || state === "archive" ? gaps : [],
    view,
    marks,
    liveFrom: livePts.length ? livePts[0]!.t : null,
    measuredAt: points.length ? points[points.length - 1]!.t : null,
    storedCount,
  };
}

/* ------------------------------------------------------------------------------------------------ marks */

/** The marks that lie inside `[a, b]`. */
export const marksIn = (marks: readonly WhaleMark[], a: number, b: number): WhaleMark[] => marks.filter((m) => m.t >= a && m.t <= b);

/** `Rot-Vorwarnung 30.10. 14:00` – one mark for a readout. */
export function markText(m: WhaleMark): string {
  return `${m.label} ${netStampText(m.t)}${m.suppressed ? " (Wiederholungssperre)" : ""}`;
}

/** The marks by the time of their point (a point can carry two: a warning that ends in a confirmation is two events). */
export function marksByTime(marks: readonly WhaleMark[]): Map<number, WhaleMark[]> {
  const map = new Map<number, WhaleMark[]>();
  for (const m of marks) {
    const list = map.get(m.t);
    if (list) list.push(m);
    else map.set(m.t, [m]);
  }
  return map;
}

/** The marks in one place for the plot's accessible name and the help: `2 Marken (Rot-Vorwarnung 30.10., Rot-Bestätigung 31.10.)`. */
export function marksSummary(marks: readonly WhaleMark[]): string {
  if (!marks.length) return "keine Marken";
  const shown = marks.slice(-3).map((m) => `${m.label} ${netDayText(m.t)}`);
  return `${marks.length} ${marks.length === 1 ? "Marke" : "Marken"} (${marks.length > shown.length ? "zuletzt " : ""}${shown.join(", ")})`;
}

/** The thresholds the marks are made with, in words (they come from the engine's defaults, not from a copy). */
export function marksRuleText(): string {
  const p = DEFAULT_WHALE_PARAMS;
  const n = (v: number): string => v.toLocaleString("de-DE");
  return `Vorwarnung: der Long-Anteil läuft auf die Linie 50 % ± ${n(p.confirm)} Punkte zu und ist höchstens ${n(p.warn)} Punkte davon entfernt. Bestätigung: er liegt mindestens ${n(p.confirm)} Punkte jenseits der 50 %-Linie.`;
}

/* ------------------------------------------------------------------------------------------------ provenance */

export interface ProvenanceLine {
  id: "source" | "cohort" | "time";
  label: string;
  value: string;
}

const clock = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hourCycle: "h23" });

/** `vor 12 Min.` / `vor 3 Std.` / `vor 2 Tagen` / `gerade eben`. */
export function agoText(ms: number): string {
  const d = durationText(Math.max(0, ms));
  return d === null ? "gerade eben" : `vor ${d.replace(/ Tage$/, " Tagen")}`;
}

export interface ProvenanceInput {
  series: NetSeriesId;
  state: WalState;
  /** `proxy` = EU proxy, `binance` = direct, `null` = no live data */
  source: LiveTraderNet["source"];
  measuredAt: number | null;
  now: number;
  /** spacing of the live points (ms) */
  stepMs: number | null;
}

/**
 * The three lines under the key figures: where the numbers come from, who is counted, and when the newest one was measured.
 * They stay three lines in every state (a state without data says `–`).
 */
export function provenanceOf(i: ProvenanceInput): ProvenanceLine[] {
  const s = NET_SERIES[i.series];
  const has = i.state === "ok" || i.state === "stale" || i.state === "archive";
  const route = i.source === "proxy" ? "über den EU-Proxy der App" : "direkt";
  const source =
    i.state === "archive"
      ? "Gespeicherter Verlauf auf diesem Gerät – Binance liefert gerade nichts"
      : has
        ? `Binance Futures, öffentliche Statistik (${s.endpoint}), ${route}`
        : "–";
  const cohort = `${s.cohort[0]!.toUpperCase()}${s.cohort.slice(1)} · ${s.measure}`;
  const gap = i.stepMs ? durationText(i.stepMs) : null;
  const time =
    has && i.measuredAt !== null
      ? `${netDayText(i.measuredAt)} ${clock.format(new Date(i.measuredAt))} UTC (${agoText(i.now - i.measuredAt)})${gap && i.state !== "archive" ? ` · neuer Wert alle ${gap}` : ""}`
      : "–";
  return [
    { id: "source", label: "Quelle", value: source },
    { id: "cohort", label: "Kohorte", value: cohort },
    { id: "time", label: "Messzeit", value: time },
  ];
}

/* ------------------------------------------------------------------------------------------------ archive line */

export interface ArchiveLineInput {
  status: "off" | "loading" | "ready" | "unavailable" | "error";
  recording: boolean;
  /** stored rows (all of them, also those the live series covers) */
  storedCount: number;
  firstT: number | null;
  lastT: number | null;
  gaps: number;
}

/** One line about the stored history: how much is there, how many gaps, and whether it is growing. */
export function archiveLine(a: ArchiveLineInput): string {
  if (a.status === "unavailable") return "Verlauf speichern geht in diesem Browser nicht (privates Fenster oder gesperrter Speicher).";
  if (a.status === "error") return "Der gespeicherte Verlauf ließ sich nicht lesen oder schreiben.";
  if (a.status === "loading") return "Gespeicherter Verlauf wird gelesen …";
  const span = a.firstT !== null && a.lastT !== null ? durationText(a.lastT - a.firstT) : null;
  const gaps = a.gaps === 0 ? "keine Lücke" : a.gaps === 1 ? "1 Lücke" : `${a.gaps} Lücken`;
  if (!a.storedCount) return a.recording ? "Gespeichert: noch nichts – der Verlauf wächst mit jedem Besuch." : "Speichern ist aus – nichts gespeichert.";
  const stored = `Gespeichert auf diesem Gerät: ${span ?? "unter 5 Min."} (${a.storedCount} Punkte), ${gaps}`;
  return a.recording ? `${stored} · wächst mit jedem Besuch.` : `${stored} · Speichern ist aus.`;
}

/** The loaded-history line when the stored history is part of it. */
export function walLine(m: Pick<WalModel, "points" | "gaps" | "storedCount">, liveStepMs: number | null): string {
  const first = m.points[0];
  const last = m.points[m.points.length - 1];
  const span = first && last ? (durationText(last.t - first.t) ?? "unter 5 Min.") : "–";
  const gaps = m.gaps.length === 0 ? "ohne Lücke" : m.gaps.length === 1 ? "1 Lücke" : `${m.gaps.length} Lücken`;
  const gap = liveStepMs ? durationText(liveStepMs) : null;
  return `Verlauf: ${span} (${m.points.length} Punkte, davon ${m.storedCount} aus dem Speicher), ${gaps}${gap ? ` · neue Werte im Abstand ${gap}` : ""} · Zeiten in UTC`;
}

/** German wording of a line's state (pure). Observations with numbers – no forecast, no recommendation. */
import { DEFAULT_TRENDLINE_CFG, type TrendKind, type TrendLineView, type TrendSeries, type TrendlineAnalysis } from "./types";

export type TrendPhase = "intact" | "approach" | "break" | "retest-open" | "retest-held" | "retest-failed" | "no-retest";
export type TrendTone = "win" | "loss" | "warn" | "mute";

export interface TrendText {
  phase: TrendPhase;
  tone: TrendTone;
  title: string;
  detail: string;
}

export const KIND_LABEL: Readonly<Record<TrendKind, string>> = { down: "Abwärtstrendlinie", up: "Aufwärtstrendlinie" };
export const KIND_HINT: Readonly<Record<TrendKind, string>> = { down: "fallende Hochs", up: "steigende Tiefs" };
export const SERIES_LABEL: Readonly<Record<TrendSeries, string>> = { price: "Preis", rsi: "RSI" };

const de = (x: number, d: number): string => Math.abs(x).toFixed(d).replace(".", ",");
const ago = (k: number): string => (k <= 0 ? "auf der letzten Kerze" : `vor ${k} Kerze${k === 1 ? "" : "n"}`);

/** `0,8 % (0,6 ATR)` for the price, `2,1 Punkte` for the RSI. */
export function distText(v: Pick<TrendLineView, "series" | "dist" | "distPct" | "distAtr">): string {
  if (v.series === "rsi") return `${de(v.dist, 1)} Punkte`;
  if (v.distPct == null) return "–";
  return v.distAtr == null ? `${de(v.distPct, 2)} %` : `${de(v.distPct, 2)} % (${de(v.distAtr, 1)} ATR)`;
}

/** State of one line: intact / approach for an unbroken line; break, retest (open / held / failed) or no retest for a broken one. */
export function describeLine(v: TrendLineView): TrendText {
  const name = KIND_LABEL[v.kind];
  const side = v.kind === "down" ? "unter" : "über";
  const beyond = v.kind === "down" ? "über" : "unter";
  const dir = v.kind === "down" ? "oben" : "unten";
  const touches = `${v.touches} Berührungen`;
  if (!v.brk || !v.retest) {
    if (v.approach) return { phase: "approach", tone: "warn", title: `Annäherung an die ${name}`, detail: `Schluss ${distText(v)} ${side} der Linie · ${touches}. Ein Bruch zählt erst mit dem Kerzenschluss.` };
    return { phase: "intact", tone: "mute", title: `${name} intakt`, detail: `Schluss ${distText(v)} ${side} der Linie · ${touches}.` };
  }
  const tone = v.kind === "down" ? "win" : "loss";
  const r = v.retest;
  const last = v.lastIndex;
  switch (r.state) {
    case "failed":
      return { phase: "retest-failed", tone: "warn", title: "Bruch zurückgenommen", detail: `Schluss ${ago(last - (r.failedAt ?? last))} wieder ${side} der Linie – der Ausbruch hat nicht gehalten.` };
    case "held":
      return { phase: "retest-held", tone, title: "Retest bestätigt", detail: `Kurs kam zur gebrochenen ${name} zurück und schloss ${ago(last - (r.heldAt ?? last))} wieder ${beyond} ihr · Bruch ${ago(v.brk.age)}.` };
    case "pending":
      return { phase: "retest-open", tone: "warn", title: "Retest läuft", detail: `Kurs an der gebrochenen ${name}; der Schluss ${beyond} der Linie steht aus · Bruch ${ago(v.brk.age)}.` };
    case "expired":
      return { phase: "no-retest", tone: "mute", title: "Bruch ohne Retest", detail: `Kein Rücklauf zur Linie innerhalb von ${DEFAULT_TRENDLINE_CFG.retestBars} Kerzen · Bruch ${ago(v.brk.age)}.` };
    default:
      return { phase: "break", tone, title: `${name} nach ${dir} gebrochen`, detail: `Schluss ${ago(v.brk.age)} ${beyond} der Linie · ${touches}. Retest steht aus.` };
  }
}

/** One line for a timeframe that has no lines (or none worth a row). */
export function emptyText(a: TrendlineAnalysis, series: TrendSeries): string {
  if (a.status === "few") return `Zu wenig Kerzen (${a.bars} von ${a.need}).`;
  if (series === "rsi" && a.rsiLast == null) return "RSI noch nicht berechenbar.";
  return series === "price" ? "Keine diagonale Preislinie." : "Keine diagonale RSI-Linie.";
}

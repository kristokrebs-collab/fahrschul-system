/**
 * „Börsenhistorie nachladen“ (F26/F07), the pure part of its section in the Datenarchiv card: German texts, the preview
 * sentence, the progress line and the result lines. No React, no I/O.
 */
import { BACKFILL_SERIES_NAME, BACKFILL_SERIES_ORDER, FAIL_LABEL, type BackfillPlan, type BackfillRun } from "@/domain/archive";
import { n0 } from "@/lib/format";
import { ddmmHHmm } from "@/market/format";
import type { BackfillProgress } from "@/market/archive/backfill";
import { bytesText, rangeText } from "./archiveModel";

export const BACKFILL_STRINGS = {
  title: "Börsenhistorie nachladen",
  lead: "Lädt einmalig, auf deinen Klick, die öffentliche Historie von Binance (USDⓈ-M-Futures) für die gewählten Symbole: Open Interest und die drei Long/Short-Verhältnisse in 5-Minuten-Schritten, die Funding-Abrechnungen und den Markpreis. Danach hat die Squeeze-Beobachtung sofort eine Stichprobe, statt erst nach Wochen Laufzeit.",
  separate: "Gespeichert wird getrennt von dem, was die App selbst gesammelt hat: als eigene Reihen, überall als „nachgeladen“ gekennzeichnet – nie vermischt, nie geglättet. Wo Binance keinen Wert liefert, bleibt eine Lücke.",
  window: "Binance hält diese Werte nur etwa 30 Tage vor. Was älter ist, lässt sich nicht nachladen, und das selbst gesammelte Archiv bleibt unberührt.",
  noServer: "Kein Konto, kein Schlüssel: die Abrufe sind öffentliche Anfragen, die dein Gerät direkt an Binance schickt (bei Sperre über den EU-Proxy dieser App, der sie nur weiterreicht). Es wird nichts hochgeladen.",
  days: "Zeitraum",
  symbols: "Symbole",
  symbolsHelp: "Standard: die Symbole des Archivs. Höchstens 8.",
  start: "Historie nachladen",
  starting: "Startet …",
  cancel: "Abbrechen",
  cancelling: "Bricht ab …",
  none: "Wähle mindestens ein Symbol.",
  lastRun: "Zuletzt nachgeladen",
  clearLog: "Protokoll löschen",
  noLog: "Noch nie nachgeladen.",
  runningLabel: "Börsenhistorie wird geladen",
  doneText: "Fertig. Die nachgeladenen Reihen stehen unten in der Übersicht, als „nachgeladen“ gekennzeichnet.",
  cancelledText: "Abgebrochen. Was bis dahin geladen war, bleibt gespeichert und ist als nachgeladen gekennzeichnet; der Rest fehlt (Lücke).",
  viaProxy: "über den EU-Proxy der App",
  direct: "direkt von Binance",
} as const;

const SKIP_LABEL: Readonly<Record<string, string>> = { skipped: "nicht abgefragt", cancelled: "abgebrochen", quota: "Speicher voll", offline: "Gerät offline" };

/** German reason of a failure code of the run (`blocked_451` → „Binance sperrt den Standort (451)“). */
export function reasonText(code: string): string {
  return FAIL_LABEL[code] ?? SKIP_LABEL[code] ?? code;
}

/** `ok` → „vollständig“; `partial:network` → „teilweise – Netzwerk- oder CORS-Fehler“; a reason → the reason. */
export function resultText(v: string): string {
  if (v === "ok") return "vollständig";
  if (v.startsWith("partial:")) return `teilweise – ${reasonText(v.slice(8))}`;
  return reasonText(v);
}

/** Preview before the start: how many requests, how many entries, how big, how long. */
export function previewText(p: BackfillPlan): string {
  if (!p.symbols.length) return BACKFILL_STRINGS.none;
  const secs = p.seconds < 90 ? `grob ${n0(p.seconds)} Sekunden` : `grob ${n0(Math.round(p.seconds / 60))} Minuten`;
  return `${n0(p.requests)} Abrufe für ${p.symbols.length} ${p.symbols.length === 1 ? "Symbol" : "Symbole"} (${n0(p.perSymbol)} je Symbol), rund ${n0(Math.round(p.points / 1000) * 1000)} Einträge, ca. ${bytesText(p.bytes)} (geschätzt), dauert ${secs}. Zeitraum: ${ddmmHHmm(p.from)} bis ${ddmmHHmm(p.to)}.`;
}

/** The line under the progress bar: what is read right now. */
export function progressText(p: BackfillProgress | null): string {
  if (!p) return BACKFILL_STRINGS.starting;
  const what = p.symbol && p.series ? `${p.symbol} · ${BACKFILL_SERIES_NAME[p.series]} · ` : "";
  return `${what}${n0(p.requestsDone)} von ${n0(p.requestsTotal)} Abrufen · ${n0(p.points)} Einträge gespeichert · ${p.route === "proxy" ? BACKFILL_STRINGS.viaProxy : BACKFILL_STRINGS.direct}`;
}

export function progressFraction(p: BackfillProgress | null): number {
  return p && p.requestsTotal > 0 ? Math.min(1, p.requestsDone / p.requestsTotal) : 0;
}

/** Per symbol the datasets that are not complete, as „Open Interest: Binance sperrt den Standort (451)“ lines. `[]` = all fine. */
export function problemLines(res: BackfillRun["res"]): Array<{ symbol: string; text: string }> {
  const out: Array<{ symbol: string; text: string }> = [];
  for (const [symbol, per] of Object.entries(res)) {
    const bad = BACKFILL_SERIES_ORDER.filter((s) => (per[s] ?? "skipped") !== "ok");
    if (bad.length) out.push({ symbol, text: bad.map((s) => `${BACKFILL_SERIES_NAME[s]}: ${resultText(per[s] ?? "skipped")}`).join(" · ") });
  }
  return out;
}

/** `26.10. 12:00 · 5 Symbole · 19.10. 12:05 bis 26.10. 12:00 · 12.345 Einträge · direkt von Binance` (what the log of the last run says). */
export function runSummary(r: BackfillRun): string {
  const end = r.end === "done" ? "" : r.end === "cancelled" ? " · abgebrochen" : " · vorzeitig beendet";
  return `${ddmmHHmm(r.t)} · ${r.symbols.length} ${r.symbols.length === 1 ? "Symbol" : "Symbole"} · ${rangeText(r.from, r.to)} · ${n0(r.points)} Einträge · ${r.route === "proxy" ? BACKFILL_STRINGS.viaProxy : BACKFILL_STRINGS.direct}${end}`;
}

export const DAYS_LABEL = (d: number): string => (d >= 30 ? "bis 30 Tage" : `${d} Tage`);

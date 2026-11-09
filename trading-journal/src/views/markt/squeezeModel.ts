/**
 * Squeeze card (F07) – the pure part: German texts and the sentences built from the reading, the sample and the context.
 * No React, no I/O.
 */
import { PHASE_LABEL } from "@/domain/boxes";
import { crowdedText, type BoxCtx, type Episode, type HorizonStats, type SqueezeReading, type SqueezeSide } from "@/domain/squeeze";

export const SQUEEZE_STRINGS = {
  title: "Squeeze-Beobachtung",
  note: "Funding, Open Interest und Positionierung aus dem Datenarchiv – vor und nach einem Ausbruch",
  lead: "Beobachtet, ob der Markt auf einer Seite überfüllt ist: extremes Funding, stark steigendes Open Interest, einseitig positionierte Konten. Das ist eine Beobachtung mit Zahlen und Schwellen – kein Handelssignal und keine Prognose.",
  noAdvice: "Keine professionelle Finanzberatung.",
  startValues: "Die Schwellen sind Startwerte; sie sind an keiner Stichprobe abgestimmt. Ändere sie unten und sieh, wie oft die Beobachtung dann im Archiv vorkam.",
  archiveOff: "Der Squeeze-Monitor liest das Datenarchiv, und das ist aus. Schalte es in den Einstellungen ein; danach braucht es Zeit (mindestens die Fensterlänge des Open Interest), bis alle drei Messwerte da sind.",
  archiveOn: "Das Archiv ist an, hat für diese Auswahl aber noch keinen Eintrag. Der erste Abruf kommt nach etwa 15 Sekunden.",
  archiveBtn: "Zum Datenarchiv",
  historyLabel: "Stichprobe aus der nachgeladenen Börsenhistorie",
  historyLead: "Getrennt vom Archiv oben: diese Zahlen stammen aus der öffentlichen Historie von Binance, die du in den Einstellungen nachgeladen hast (5-Minuten-Werte, Funding je Abrechnung). Beide Stichproben können denselben Zeitraum betreffen und werden nicht zusammengezählt.",
  historyNone: "Für dieses Symbol ist keine Börsenhistorie nachgeladen. Unter Einstellungen › Datenarchiv holt „Börsenhistorie nachladen“ die letzten Tage von Binance – dann gibt es diese Stichprobe sofort, statt erst nach Wochen Laufzeit.",
  historyNoneAny: "Oder lade die Historie nach: Unter Einstellungen › Datenarchiv holt „Börsenhistorie nachladen“ die letzten Tage von Binance, getrennt gespeichert und als nachgeladen gekennzeichnet – dann gibt es die Stichprobe sofort.",
  historyBtn: "Börsenhistorie nachladen",
  historySource: "Binance USDⓈ-M, öffentliche Historie (nachgeladen)",
  historyNoCollected: "Für dieses Symbol hat das Archiv noch nichts selbst gesammelt; die Messwerte oben haben deshalb keine Daten. Die nachgeladene Historie steht unten.",
  historyMissing: (names: readonly string[]) => `In der nachgeladenen Historie fehlt: ${names.join(", ")}. Ohne diese Reihe zählt der jeweilige Messwert als „keine Daten“.`,  unavailable: "Dieser Browser kann das Archiv hier nicht lesen (IndexedDB nicht verfügbar).",
  loading: "Lese das Archiv …",
  source: "Datenarchiv dieses Geräts (Binance USDⓈ-M, öffentlich)",
  boxOnlyLive: (sym: string) => `Den Box-Kontext gibt es nur für das Markt-Symbol (${sym}).`,
  boxNone: "Für das Markt-Symbol liegt noch keine Box-Auswertung vor.",
  thresholds: "Schwellen einstellen",
  thresholdsHide: "Schwellen ausblenden",
  fundingLabel: "Funding ab (% je Abrechnung)",
  oiLabel: "Open-Interest-Anstieg ab (%)",
  oiWindow: "Zeitfenster",
  longLabel: "Long-Anteil der Konten ab (%)",
  longHelp: "Gespiegelt gilt dasselbe für Short.",
  minLabel: "Mindestens so viele der drei Messwerte",
  reset: "Auf Startwerte",
  alertLabel: "Alarm bei neuer Beobachtung",
  alertOff: "Aus (Standard). Wenn an: ein Hinweis wie bei den Box-Alarmen, sobald die Beobachtung für ein archiviertes Symbol beginnt – nur bei offener App und laufendem Archiv, höchstens einmal je Symbol und Seite in sechs Stunden.",
  alertNeedsArchive: "Der Alarm braucht das laufende Datenarchiv.",
  saveFailed: "Einstellung konnte nicht gespeichert werden",
  topTrader: (long: number) => `Zum Vergleich, nicht Teil der Regel: Top-Trader-Positionen Long ${fmt1(long)} %.`,
  coverage: (hours: number) => `Das Archiv deckt ${fmt1(hours)} Stunden ab.`,
} as const;

export const fmt1 = (v: number): string => v.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace("-", "−");
const pct = (v: number): string => `${v >= 0 ? "+" : ""}${fmt1(v * 100)} %`.replace("-", "−");

/** One line for the headline: what the reading says. */
export function headline(r: SqueezeReading, need: number): { text: string; tone: "warn" | "mute" } {
  if (r.state === "watch" && r.side) return { text: `${crowdedText(r.side)} · ${r.met} von 3 Messwerten`, tone: "warn" };
  if (r.state === "conflict") {
    const f = r.signals.find((s) => s.key === "funding")?.side;
    const a = r.signals.find((s) => s.key === "accounts")?.side;
    return { text: `Gegensätzliche Signale: Funding zeigt ${f === "long" ? "Long" : "Short"}, die Konten ${a === "long" ? "Long" : "Short"}`, tone: "mute" };
  }
  if (r.state === "nodata") {
    return { text: r.stale ? "Das Archiv wird gerade nicht geschrieben – es gibt keinen aktuellen Wert" : "Keine Daten", tone: "mute" };
  }
  return { text: r.side ? `Ruhig – ${r.met} von ${need} nötigen Messwerten (Neigung zur ${r.side === "long" ? "Long" : "Short"}-Seite)` : "Ruhig – keine einseitige Überhitzung nach deinen Schwellen", tone: "mute" };
}

/** `Phase · Richtung` of the box timeframes of the live symbol, for the context list. */
export function boxLine(c: BoxCtx): string {
  const arrow = c.dir > 0 ? " ↑" : c.dir < 0 ? " ↓" : "";
  return `${PHASE_LABEL[c.phase]}${c.phase === "failed" || c.phase === "inside" || c.phase === "none" ? "" : arrow}`;
}

/** The sample sentence for one horizon: counts, counter-examples, spread and the sample word. */
export function sampleLine(s: HorizonStats, side: SqueezeSide | null): string {
  const who = side ? `die ${side === "long" ? "Long" : "Short"}-Seite` : "die überfüllte Seite";
  if (s.n === 0) return `Nach ${s.hours} h: kein früherer Fall mit Preis am Ende im Archiv (Stichprobe: ${s.word}).`;
  const spread = s.min !== null && s.max !== null && s.median !== null ? ` · Median ${pct(s.median)}, Spanne ${pct(s.min)} bis ${pct(s.max)}` : "";
  return `Nach ${s.hours} h: von ${s.n} ${s.n === 1 ? "Fall" : "Fällen"} lief der Preis in ${s.against} gegen ${who}, in ${s.withCrowd} mit ihr${spread} (Stichprobe: ${s.word}).`;
}

export const episodesLine = (eps: readonly Episode[], hours: number, side: SqueezeSide | null): string => {
  const n = eps.filter((e) => (side ? e.side === side : true)).length;
  return `Im Archiv (${fmt1(hours)} Stunden) kam dieselbe Beobachtung ${side ? `für die ${side === "long" ? "Long" : "Short"}-Seite ` : ""}in ${n} ${n === 1 ? "früheren Fall" : "früheren Fällen"} vor.`;
};

/** The same sentence for the loaded history („In der nachgeladenen Historie (… Stunden) …“). */
export const historyEpisodesLine = (eps: readonly Episode[], hours: number, side: SqueezeSide | null): string => episodesLine(eps, hours, side).replace("Im Archiv", "In der nachgeladenen Historie");

/** Names of the history series that have no point for the symbol (so the reading would say „keine Daten“ for them). */
export function missingHistory(counts: { mark: number; funding: number; oi: number; ls: number; top: number }): string[] {
  const out: string[] = [];
  if (counts.mark === 0) out.push("Markpreis");
  if (counts.funding === 0) out.push("Funding");
  if (counts.oi === 0) out.push("Open Interest");
  if (counts.ls === 0) out.push("Long/Short aller Konten");
  return out;
}

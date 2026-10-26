/**
 * Datenarchiv view (F26) – the pure part of the card: German texts, durations and sizes, the rows grouped by symbol, the
 * totals. No React, no I/O (the card reads the store).
 */
import { estimateBytes, gapMs, seriesDef, type Gap, type SeriesId, type SeriesInfo } from "@/domain/archive";
import { n0, n1 } from "@/lib/format";
import { ddmmHHmm } from "@/market/format";

export const ARCHIVE_STRINGS = {
  title: "Datenarchiv",
  note: "Sammelt öffentliche Marktzahlen und Analysezustände auf diesem Gerät – nur solange die App offen ist.",
  what: "Gespeichert wird (erst nach dem Einschalten): Markpreis und zuletzt abgerechnete Funding-Rate, Open Interest und drei Long/Short-Verhältnisse der gewählten Binance-USDⓈ-M-Symbole – alle öffentlich, ohne Schlüssel – dazu die Lage-Ampel und die Box-Phasen des Markt-Symbols, wie die App sie damals zeigte.",
  local: "Nichts verlässt dein Gerät. Das Archiv ist kein Teil von Backup oder Cloud-Sync (zu groß, nur lokal); auf einem anderen Gerät beginnt es neu.",
  limit: "Kein Server-Archiv: Es wird nur gesammelt, solange die App geöffnet ist. War sie zu, bleibt eine Lücke – sie wird nie gefüllt oder geschätzt. Binance selbst hält Verhältnisse und Open-Interest-Historie nur etwa 30 Tage vor; die App holt davon nichts nach.",
  switch: "Archiv sammeln",
  switchOff: "Aus (Standard) – es wird nichts gesammelt.",
  switchOn: (min: number) => `An – ein Abruf alle ${min} Minuten, solange die App offen ist.`,
  interval: "Takt",
  symbols: "Symbole",
  symbolsHelp: "Die Symbole, die du beobachtest: das Markt-Symbol und deine Box-Watchlist. Höchstens 8.",
  symbolsAuto: "Automatisch",
  symbolsFull: "Höchstens 8 Symbole.",
  states: "Analysezustände mitschreiben",
  statesHelp: "Lage-Ampel und Box-Phasen des Markt-Symbols zum Zeitpunkt des Abrufs (nur, was die App gerade zeigt – nichts nachgerechnet).",
  maxMb: "Größe höchstens",
  maxMbHelp: "Geschätzt aus der Zahl der Einträge. Ist die Grenze erreicht, fallen die ältesten Einträge zuerst heraus (Ringpuffer).",
  unavailable: "Dieser Browser kann das Archiv hier nicht speichern (IndexedDB nicht verfügbar, z. B. im privaten Fenster).",
  overview: "Was vorliegt",
  empty: "Noch nichts gespeichert. Schalte das Archiv ein; der erste Abruf kommt nach etwa 15 Sekunden.",
  loading: "Lese das Archiv …",
  gapsChecking: "Lücken werden geprüft …",
  gapsNone: "keine Lücke",
  gapsShow: "Lücken anzeigen",
  gapsHide: "Lücken ausblenden",
  csv: "CSV",
  json: "JSON",
  del: "Löschen",
  delAsk: "Wirklich löschen?",
  yes: "Ja",
  no: "Nein",
  exportAll: "Alles als JSON",
  delAll: "Alles löschen",
  exportBig: "Das Archiv ist groß – der Export kann auf dem Handy scheitern. Exportiere dann je Reihe.",
  exportFailed: "Export fehlgeschlagen",
  csvHelp: "CSV: Komma-getrennt, Dezimalpunkt, Zeiten in UTC (ISO 8601) und als Epoch in ms.",
  statusOff: "Aus – es wird nichts gesammelt.",
  starting: "Startet …",
  ticking: "Fragt gerade ab …",
  quota: "Der Browser-Speicher ist fast voll – das Archiv pausiert, bis wieder Platz ist.",
  viaProxy: "über den EU-Proxy der App",
  direct: "direkt von Binance",
  disclaimer: "Rohdaten und Zustände, keine Prognose. Keine professionelle Finanzberatung.",
} as const;

export const SIZE_LABEL = (mb: number): string => `${mb} MB`;

/** `35 min` · `5 h 10 min` · `2 Tage 3 h`. */
export function durationText(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} Tage ${h % 24} h` : `${d} Tage`;
}

/** `412 KB` · `1,3 MB` (estimated sizes are shown with „ca.“ by the caller). */
export function bytesText(b: number): string {
  if (b < 1_000_000) return `${n0(Math.max(1, Math.round(b / 1000)))} KB`;
  return `${n1(b / 1_000_000)} MB`;
}

export interface RowView {
  info: SeriesInfo;
  /** `null` while the gaps are not checked yet */
  gaps: readonly Gap[] | null;
}

export interface SymbolGroup {
  symbol: string;
  rows: RowView[];
  count: number;
  first: number;
  last: number;
}

/** Rows grouped by symbol (symbols alphabetical, series in the table's order). */
export function groupBySymbol(rows: readonly RowView[]): SymbolGroup[] {
  const order = (s: SeriesId): number => ["premium", "oi", "lsAcc", "lsTopPos", "lsTopAcc", "lage", "box4h", "box1d", "box1w"].indexOf(s);
  const by = new Map<string, RowView[]>();
  for (const r of rows) by.set(r.info.symbol, [...(by.get(r.info.symbol) ?? []), r]);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([symbol, list]) => {
      const sorted = [...list].sort((a, b) => order(a.info.series) - order(b.info.series));
      return { symbol, rows: sorted, count: sorted.reduce((s, r) => s + r.info.count, 0), first: Math.min(...sorted.map((r) => r.info.first)), last: Math.max(...sorted.map((r) => r.info.last)) };
    });
}

export interface Totals {
  count: number;
  bytes: number;
  first: number | null;
  last: number | null;
}

export function totalsOf(rows: readonly RowView[]): Totals {
  if (!rows.length) return { count: 0, bytes: 0, first: null, last: null };
  return {
    count: rows.reduce((s, r) => s + r.info.count, 0),
    bytes: rows.reduce((s, r) => s + estimateBytes(r.info.series, r.info.count), 0),
    first: Math.min(...rows.map((r) => r.info.first)),
    last: Math.max(...rows.map((r) => r.info.last)),
  };
}

/** `25.10. 01:10 bis 26.10. 02:00`. */
export const rangeText = (first: number, last: number): string => `${ddmmHHmm(first)} bis ${ddmmHHmm(last)}`;

/** `3 Lücken, zusammen 5 h 10 min` · `keine Lücke` · `Lücken werden geprüft …`. */
export function gapSummary(gaps: readonly Gap[] | null): string {
  if (gaps === null) return ARCHIVE_STRINGS.gapsChecking;
  if (!gaps.length) return ARCHIVE_STRINGS.gapsNone;
  return `${gaps.length} ${gaps.length === 1 ? "Lücke" : "Lücken"}, zusammen ${durationText(gapMs(gaps))}`;
}

export const rowLabel = (series: SeriesId): string => seriesDef(series).label;

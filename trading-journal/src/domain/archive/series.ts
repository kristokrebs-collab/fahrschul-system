/**
 * The series of the archive: what each one holds, where it comes from, how often a point is expected and how many the
 * ring buffer keeps. One table, so the collector, the view, the export and the tests say the same.
 */
import type { SeriesId, SeriesKind } from "./types";

export interface FieldDef {
  key: string;
  /** German label (view, CSV header comment) */
  label: string;
  /** unit / format hint for the view and the export */
  unit: "preis" | "anteil" | "prozent" | "kontrakte" | "zeit" | "zahl" | "wort";
}

export interface SeriesDef {
  id: SeriesId;
  kind: SeriesKind;
  /** German name */
  label: string;
  /** one sentence: what it is */
  what: string;
  /** the public endpoint it is read from (raw) – or the app part that produces it (state) */
  source: string;
  fields: readonly FieldDef[];
  /** expected distance of two points in ms; 0 = one point per tick (the tick log gives the threshold) */
  stepMs: number;
  /** ring buffer: points kept per symbol (the size limit may keep fewer) */
  cap: number;
  /** estimated bytes of one stored point (key + value in IndexedDB) – the size shown is an estimate from this */
  bytes: number;
}

const FIVE_MIN = 5 * 60_000;
const RATIO_FIELDS: readonly FieldDef[] = [
  { key: "long", label: "Long-Anteil", unit: "prozent" },
  { key: "short", label: "Short-Anteil", unit: "prozent" },
  { key: "ratio", label: "Long/Short-Verhältnis", unit: "zahl" },
];
const BOX_FIELDS: readonly FieldDef[] = [
  { key: "phase", label: "Phase", unit: "wort" },
  { key: "dir", label: "Richtung des laufenden Ausbruchs (1 hoch, −1 runter, 0 keiner)", unit: "zahl" },
  { key: "brk", label: "Richtung, in die die Box verlassen wurde (1 hoch, −1 runter, 0 noch nicht)", unit: "zahl" },
  { key: "top", label: "Obere Kante", unit: "preis" },
  { key: "bottom", label: "Untere Kante", unit: "preis" },
  { key: "grade", label: "Boxnote", unit: "wort" },
  { key: "pos", label: "Lage in der Box (0 unten … 1 oben)", unit: "zahl" },
  { key: "price", label: "Preis bei der Auswertung", unit: "preis" },
];

export const SERIES: readonly SeriesDef[] = [
  {
    id: "premium",
    kind: "raw",
    label: "Funding & Preis",
    what: "Markpreis, Indexpreis und die zuletzt abgerechnete Funding-Rate samt nächster Abrechnung.",
    source: "Binance /fapi/v1/premiumIndex",
    fields: [
      { key: "mark", label: "Markpreis", unit: "preis" },
      { key: "index", label: "Indexpreis", unit: "preis" },
      { key: "rate", label: "Funding-Rate (zuletzt abgerechnet, Anteil)", unit: "anteil" },
      { key: "next", label: "Nächste Abrechnung", unit: "zeit" },
    ],
    stepMs: 0,
    cap: 8640,
    bytes: 150,
  },
  {
    id: "oi",
    kind: "raw",
    label: "Open Interest",
    what: "Offene Kontrakte (in der Basiswährung) zum Zeitpunkt der Abfrage.",
    source: "Binance /fapi/v1/openInterest",
    fields: [{ key: "oi", label: "Open Interest", unit: "kontrakte" }],
    stepMs: 0,
    cap: 8640,
    bytes: 100,
  },
  {
    id: "lsAcc",
    kind: "raw",
    label: "Long/Short · alle Konten",
    what: "Anteil der Konten mit Long- bzw. Short-Position (alle Binance-Konten), 5-Minuten-Werte.",
    source: "Binance /futures/data/globalLongShortAccountRatio",
    fields: RATIO_FIELDS,
    stepMs: FIVE_MIN,
    cap: 8640,
    bytes: 120,
  },
  {
    id: "lsTopPos",
    kind: "raw",
    label: "Long/Short · Top-Trader-Positionen",
    what: "Long-/Short-Anteil der Positionsgrößen der Top-Trader, 5-Minuten-Werte.",
    source: "Binance /futures/data/topLongShortPositionRatio",
    fields: RATIO_FIELDS,
    stepMs: FIVE_MIN,
    cap: 8640,
    bytes: 120,
  },
  {
    id: "lsTopAcc",
    kind: "raw",
    label: "Long/Short · Top-Trader-Konten",
    what: "Long-/Short-Anteil der Konten der Top-Trader, 5-Minuten-Werte.",
    source: "Binance /futures/data/topLongShortAccountRatio",
    fields: RATIO_FIELDS,
    stepMs: FIVE_MIN,
    cap: 8640,
    bytes: 120,
  },
  {
    id: "lage",
    kind: "state",
    label: "Marktampel (Lage)",
    what: "Was die Lage-Ampel des Markt-Symbols zum Zeitpunkt des Ticks zeigte.",
    source: "Lage-Ampel der App (Tageskerzen)",
    fields: [
      { key: "state", label: "Ampel (green, amber, red, none)", unit: "wort" },
      { key: "signs", label: "Erfüllte Umkehrzeichen (0–4)", unit: "zahl" },
      { key: "price", label: "Preis bei der Auswertung", unit: "preis" },
      { key: "dist", label: "Abstand zur 1D-EMA 21 (Anteil)", unit: "anteil" },
    ],
    stepMs: 0,
    cap: 4320,
    bytes: 120,
  },
  { id: "box4h", kind: "state", label: "Box-Zustand 4h", what: "Phase und Kanten der neuesten 4h-Box des Markt-Symbols zum Zeitpunkt des Ticks.", source: "Box-zu-Box der App (geschlossene Kerzen)", fields: BOX_FIELDS, stepMs: 0, cap: 4320, bytes: 150 },
  { id: "box1d", kind: "state", label: "Box-Zustand 1D", what: "Phase und Kanten der neuesten Tages-Box des Markt-Symbols zum Zeitpunkt des Ticks.", source: "Box-zu-Box der App (geschlossene Kerzen)", fields: BOX_FIELDS, stepMs: 0, cap: 4320, bytes: 150 },
  { id: "box1w", kind: "state", label: "Box-Zustand 1W", what: "Phase und Kanten der neuesten Wochen-Box des Markt-Symbols zum Zeitpunkt des Ticks.", source: "Box-zu-Box der App (geschlossene Kerzen)", fields: BOX_FIELDS, stepMs: 0, cap: 4320, bytes: 150 },
];

const BY_ID = new Map<SeriesId, SeriesDef>(SERIES.map((s) => [s.id, s]));

export const SERIES_IDS: readonly SeriesId[] = SERIES.map((s) => s.id);
export const RAW_SERIES: readonly SeriesId[] = SERIES.filter((s) => s.kind === "raw").map((s) => s.id);
export const STATE_SERIES: readonly SeriesId[] = SERIES.filter((s) => s.kind === "state").map((s) => s.id);

export const isSeriesId = (v: unknown): v is SeriesId => typeof v === "string" && BY_ID.has(v as SeriesId);

export function seriesDef(id: SeriesId): SeriesDef {
  return BY_ID.get(id)!;
}

/** Bytes of one tick record in the log (key + value). */
export const TICK_BYTES = 160;
/** The tick log keeps this many ticks (≈ 60 days at 10 minutes). */
export const TICK_CAP = 8640;
/** At most this many symbols are archived (keeps the requests under the exchange's limits). */
export const ARCHIVE_MAX_SYMBOLS = 8;
/** Symbols taken when the selection is automatic: the live symbol plus the first of the watchlist. */
export const ARCHIVE_AUTO_SYMBOLS = 5;

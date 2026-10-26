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
/** Funding is settled every 8 hours on most USDⓈ-M contracts (some alts every 4 h or 1 h – that only makes the grid denser). */
export const FUNDING_STEP_MS = 8 * 3_600_000;
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

const BACKFILL_NOTE = "Nachgeladen aus der öffentlichen Binance-Historie, getrennt vom selbst Gesammelten gespeichert.";
const FIVE_MIN_HIST = 8640;

/**
 * The backfilled series („Börsenhistorie nachladen“): what Binance's public history held when the user asked for it. Same
 * numbers as the collected rows of the same name, but a series of their own – stored under their own id, labelled
 * „nachgeladen“, never merged with what the app collected. `stepMs` is the exchange's own grid; a stretch without a value is
 * a gap and stays one.
 */
export const BACKFILL_SERIES: readonly SeriesDef[] = [
  {
    id: "oiHist",
    kind: "backfill",
    label: "Open Interest (nachgeladen)",
    what: `Offene Kontrakte (Basiswährung) und ihr Wert in USDT, 5-Minuten-Werte der Börsen-Historie. ${BACKFILL_NOTE}`,
    source: "Binance /futures/data/openInterestHist (5m)",
    fields: [
      { key: "oi", label: "Open Interest", unit: "kontrakte" },
      { key: "value", label: "Open-Interest-Wert (USDT)", unit: "zahl" },
    ],
    stepMs: FIVE_MIN,
    cap: FIVE_MIN_HIST,
    bytes: 110,
  },
  {
    id: "lsAccHist",
    kind: "backfill",
    label: "Long/Short · alle Konten (nachgeladen)",
    what: `Anteil der Konten mit Long- bzw. Short-Position (alle Binance-Konten), 5-Minuten-Werte der Börsen-Historie. ${BACKFILL_NOTE}`,
    source: "Binance /futures/data/globalLongShortAccountRatio (5m)",
    fields: RATIO_FIELDS,
    stepMs: FIVE_MIN,
    cap: FIVE_MIN_HIST,
    bytes: 120,
  },
  {
    id: "lsTopPosHist",
    kind: "backfill",
    label: "Long/Short · Top-Trader-Positionen (nachgeladen)",
    what: `Long-/Short-Anteil der Positionsgrößen der Top-Trader, 5-Minuten-Werte der Börsen-Historie. ${BACKFILL_NOTE}`,
    source: "Binance /futures/data/topLongShortPositionRatio (5m)",
    fields: RATIO_FIELDS,
    stepMs: FIVE_MIN,
    cap: FIVE_MIN_HIST,
    bytes: 120,
  },
  {
    id: "lsTopAccHist",
    kind: "backfill",
    label: "Long/Short · Top-Trader-Konten (nachgeladen)",
    what: `Long-/Short-Anteil der Konten der Top-Trader, 5-Minuten-Werte der Börsen-Historie. ${BACKFILL_NOTE}`,
    source: "Binance /futures/data/topLongShortAccountRatio (5m)",
    fields: RATIO_FIELDS,
    stepMs: FIVE_MIN,
    cap: FIVE_MIN_HIST,
    bytes: 120,
  },
  {
    id: "fundingHist",
    kind: "backfill",
    label: "Funding-Abrechnungen (nachgeladen)",
    what: `Die abgerechneten Funding-Raten, eine je Abrechnung (meist alle 8 Stunden); die Zeit ist die der Abrechnung. ${BACKFILL_NOTE}`,
    source: "Binance /fapi/v1/fundingRate",
    fields: [{ key: "rate", label: "Funding-Rate der Abrechnung (Anteil)", unit: "anteil" }],
    stepMs: FUNDING_STEP_MS,
    cap: 1000,
    bytes: 80,
  },
  {
    id: "markHist",
    kind: "backfill",
    label: "Markpreis (nachgeladen)",
    what: `Schlusskurs des Markpreises je 5-Minuten-Kerze; die Zeit ist das Ende der Kerze. ${BACKFILL_NOTE}`,
    source: "Binance /fapi/v1/markPriceKlines (5m)",
    fields: [{ key: "mark", label: "Markpreis (Schluss der Kerze)", unit: "preis" }],
    stepMs: FIVE_MIN,
    cap: FIVE_MIN_HIST,
    bytes: 80,
  },
];

const ALL: readonly SeriesDef[] = [...SERIES, ...BACKFILL_SERIES];
const BY_ID = new Map<SeriesId, SeriesDef>(ALL.map((s) => [s.id, s]));

/** Every series the store can hold: collected first, then the backfilled ones (the order the view lists them in). */
export const ALL_SERIES: readonly SeriesDef[] = ALL;
export const SERIES_IDS: readonly SeriesId[] = ALL.map((s) => s.id);
export const RAW_SERIES: readonly SeriesId[] = SERIES.filter((s) => s.kind === "raw").map((s) => s.id);
export const STATE_SERIES: readonly SeriesId[] = SERIES.filter((s) => s.kind === "state").map((s) => s.id);
export const BACKFILL_SERIES_IDS: readonly SeriesId[] = BACKFILL_SERIES.map((s) => s.id);

/** `true` for the series that were loaded afterwards from the exchange's history. */
export const isBackfillSeries = (id: SeriesId): boolean => BY_ID.get(id)?.kind === "backfill";

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

/**
 * TradingView "Export chart data" (CSV) reader (F64, pure): the candles of the chart (`time, open, high, low, close`, optionally `Volume`)
 * and one column per plot of the indicators on it. Everything is read IN THE BROWSER; nothing is sent anywhere. The columns are only
 * data to hold the lab's own calculation against (`indicators.ts`) – never a source of signals or candles for a run.
 *
 * Tolerant like the trade-list reader: comma / semicolon / tab, quotes, BOM, point or comma decimals, ISO times with or without an
 * offset or UNIX seconds / milliseconds, English or German header words. Unreadable rows are listed with their line and left out; the
 * rest is kept. A cell that is empty is "no value" (`NaN`) – TradingView leaves it empty where an indicator has no value yet.
 */
import type { Bar } from "../signals/indicators";
import { detectDelimiter, parseNumber, parseTvTime, splitCsv } from "./parse";

export interface ChartColumn {
  /** position in the file's header */
  index: number;
  name: string;
  /** one value per candle, `NaN` = empty cell */
  values: number[];
  /** most decimals written in any cell – the rounding the export shows */
  decimals: number;
  /** non-empty cells */
  filled: number;
}

export interface ChartError {
  /** 1-based line of the file */
  line: number;
  message: string;
}

export interface ChartParse {
  bars: Bar[];
  columns: ChartColumn[];
  hasVolume: boolean;
  /** seconds between two candles (the typical gap), `null` below two candles */
  intervalSec: number | null;
  errors: ChartError[];
  errorsCut: boolean;
  warnings: string[];
  /** ms of the first / last candle, `null` without candles */
  from: number | null;
  to: number | null;
}

export interface ChartOptions {
  /** how far the file's wall-clock times are ahead of UTC when they carry no offset (0 = UTC) */
  utcOffsetMinutes?: number;
}

/** A candle series needs at least this many rows for any comparison to mean something. */
export const MIN_CHART_BARS = 30;
const MAX_ERRORS = 40;

const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9%+-]/g, "");

const HEADS: Record<"time" | "open" | "high" | "low" | "close" | "volume", RegExp> = {
  time: /^(time|zeit|date|datum|timestamp)$/,
  open: /^(open|eroffnung|eroeffnung|opening|eroffnungskurs)$/,
  high: /^(high|hoch|hochst|hochstkurs|hoechst)$/,
  low: /^(low|tief|tiefst|tiefstkurs)$/,
  close: /^(close|schluss|schlusskurs|schliessung)$/,
  volume: /^(volume|volumen|vol)$/,
};

const decimalsOf = (raw: string): number => {
  const m = /[.,](\d+)\s*$/.exec(raw.trim().replace(/e[+-]?\d+$/i, ""));
  return m ? Math.min(12, m[1]!.length) : 0;
};

/** The typical gap between candles in seconds (the median of the positive gaps). */
function typicalGap(ts: readonly number[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    const g = ts[i]! - ts[i - 1]!;
    if (g > 0) gaps.push(g);
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1]!;
}

/** "1m", "15m", "4h", "1D", "1W" for a gap in seconds, else the plain seconds. */
export function intervalLabel(sec: number | null): string {
  if (sec == null) return "unbekannt";
  const table: [number, string][] = [[60, "1m"], [180, "3m"], [300, "5m"], [900, "15m"], [1800, "30m"], [3600, "1h"], [7200, "2h"], [14400, "4h"], [28800, "8h"], [43200, "12h"], [86400, "1D"], [259200, "3D"], [604800, "1W"]];
  return table.find(([s]) => s === sec)?.[1] ?? `${sec} s`;
}

/** Reads a TradingView chart-data export. */
export function parseTvChart(text: string, opts: ChartOptions = {}): ChartParse {
  const out: ChartParse = { bars: [], columns: [], hasVolume: false, intervalSec: null, errors: [], errorsCut: false, warnings: [], from: null, to: null };
  const fail = (line: number, message: string): void => {
    if (out.errors.length < MAX_ERRORS) out.errors.push({ line, message });
    else out.errorsCut = true;
  };
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectDelimiter(src);
  if (!delimiter) {
    fail(1, "Die Datei ist leer oder hat keine Spalten.");
    return out;
  }
  const recs = splitCsv(src, delimiter);
  const header = recs[0];
  if (!header) {
    fail(1, "Die Datei ist leer.");
    return out;
  }
  const cols = header.cells.map((c) => c.trim());
  const idx: Partial<Record<keyof typeof HEADS, number>> = {};
  cols.forEach((c, i) => {
    const n = norm(c);
    for (const k of Object.keys(HEADS) as (keyof typeof HEADS)[]) if (idx[k] === undefined && HEADS[k].test(n)) idx[k] = i;
  });
  const missing = (["time", "open", "high", "low", "close"] as const).filter((k) => idx[k] === undefined);
  if (missing.length) {
    fail(header.line, `In der Kopfzeile fehlen die Spalten: ${missing.join(", ")}. Erwartet wird der Export „Chartdaten exportieren“ (time, open, high, low, close, …).`);
    return out;
  }
  const taken = new Set(Object.values(idx));
  const extra = cols.map((name, index) => ({ name, index })).filter((c) => !taken.has(c.index) && c.name !== "");
  const columns: ChartColumn[] = extra.map((c) => ({ index: c.index, name: c.name, values: [], decimals: 0, filled: 0 }));
  const decimal: "comma" | "point" = delimiter === ";" ? "comma" : "point";
  const offset = opts.utcOffsetMinutes ?? 0;

  let prevMs = -Infinity;
  let ambiguousSeen = false;
  const bars: Bar[] = [];
  for (const rec of recs.slice(1)) {
    const cell = (i: number | undefined): string => (i === undefined ? "" : (rec.cells[i] ?? "").trim());
    const rawTime = cell(idx.time);
    let ms: number;
    if (/^\d{9,13}$/.test(rawTime)) ms = rawTime.length >= 13 ? Number(rawTime) : Number(rawTime) * 1000;
    else {
      const t = parseTvTime(rawTime, offset);
      ms = t.ms ?? NaN;
      if (t.ambiguous) ambiguousSeen = true;
    }
    if (!Number.isFinite(ms)) {
      fail(rec.line, `Die Zeit „${rawTime.slice(0, 30)}“ ist nicht lesbar.`);
      continue;
    }
    const o = parseNumber(cell(idx.open), decimal);
    const h = parseNumber(cell(idx.high), decimal);
    const l = parseNumber(cell(idx.low), decimal);
    const c = parseNumber(cell(idx.close), decimal);
    if (o == null || h == null || l == null || c == null || [o, h, l, c].some((x) => Number.isNaN(x))) {
      fail(rec.line, "Eine der Preisspalten (open, high, low, close) ist leer oder keine Zahl.");
      continue;
    }
    if (h < l - 1e-12) {
      fail(rec.line, "Das Hoch liegt unter dem Tief.");
      continue;
    }
    if (ms <= prevMs) {
      fail(rec.line, "Die Zeit liegt nicht nach der Zeit der Zeile davor: Die Datei muss aufsteigend sortiert sein, jede Kerze einmal.");
      continue;
    }
    prevMs = ms;
    const bar: Bar = { t: Math.round(ms / 1000), o, h, l, c };
    if (idx.volume !== undefined) {
      const v = parseNumber(cell(idx.volume), decimal);
      if (v != null && !Number.isNaN(v)) bar.v = v;
    }
    bars.push(bar);
    columns.forEach((col) => {
      const raw = (rec.cells[col.index] ?? "").trim();
      const v = raw === "" ? null : parseNumber(raw, decimal);
      if (v == null || Number.isNaN(v)) col.values.push(NaN);
      else {
        col.values.push(v);
        col.filled++;
        col.decimals = Math.max(col.decimals, decimalsOf(raw));
      }
    });
  }
  out.bars = bars;
  out.columns = columns.filter((c) => c.filled > 0);
  out.hasVolume = idx.volume !== undefined && bars.some((b) => b.v != null);
  out.intervalSec = typicalGap(bars.map((b) => b.t));
  out.from = bars.length ? bars[0]!.t * 1000 : null;
  out.to = bars.length ? bars[bars.length - 1]!.t * 1000 : null;
  if (ambiguousSeen) out.warnings.push("Ein Datum wie 03/04/2026 lässt sich als 3. April oder als 4. März lesen – es wurde als Monat/Tag gelesen. Exportiere die Zeit besser als ISO-Text oder UNIX-Zeit.");
  if (!bars.length) fail(header.line, "Keine lesbare Kerze in der Datei.");
  else if (bars.length < MIN_CHART_BARS) out.warnings.push(`Nur ${bars.length} Kerzen: Für einen Abgleich braucht es mindestens ${MIN_CHART_BARS}.`);
  if (bars.length && !out.columns.length) out.warnings.push("Die Datei hat keine Spalte mit Indikatorwerten (nur Kerzen). Füge im Chart den Indikator hinzu und exportiere die Daten noch einmal.");
  return out;
}

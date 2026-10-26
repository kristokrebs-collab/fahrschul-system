/**
 * Archive export (F26): CSV and JSON of the raw points, exactly as stored – no rounding, no filling of gaps. CSV: comma
 * separated, decimal point, times in UTC (ISO 8601) plus the epoch in ms, one row per point, the field keys of the series
 * table as header. JSON: the points plus the gaps found in them and where the numbers come from. Pure.
 */
import { seriesDef } from "./series";
import type { ArchivePoint, Cell, Gap, SeriesId } from "./types";

export const ARCHIVE_CSV_MIME = "text/csv;charset=utf-8";
export const ARCHIVE_JSON_MIME = "application/json";
export const ARCHIVE_FORMAT = "tj-archive";

const csvCell = (v: Cell | undefined): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

/** `2026-10-26T01:40:00.000Z` – never the viewer's zone. */
export const isoUtc = (ms: number): string => new Date(ms).toISOString();

/** One series (possibly several symbols), oldest first. The header lists the field keys of the series table. */
export function pointsToCsv(series: SeriesId, points: readonly ArchivePoint[]): string {
  const def = seriesDef(series);
  const keys = def.fields.map((f) => f.key);
  const lines = [["zeit_utc", "epoch_ms", "symbol", ...keys].join(",")];
  const rows = [...points].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.t - b.t);
  for (const p of rows) lines.push([isoUtc(p.t), String(p.t), csvCell(p.symbol), ...keys.map((k) => csvCell(p.d[k]))].join(","));
  return `${lines.join("\n")}\n`;
}

export interface JsonSeries {
  series: SeriesId;
  symbol: string;
  points: readonly ArchivePoint[];
  gaps: readonly Gap[];
}

export interface JsonExportMeta {
  /** device time of the export (ms) */
  exportedAt: number;
}

/** The JSON file: points + gaps of the given rows. `rows` are what the user asked for (one row, one symbol, everything). */
export function archiveToJson(rows: readonly JsonSeries[], meta: JsonExportMeta): string {
  const out = {
    format: ARCHIVE_FORMAT,
    v: 1,
    exportedAt: isoUtc(meta.exportedAt),
    note: "Gesammelt von der Trading-Journal-App, solange sie geöffnet war. Lücken sind nie gefüllt oder geschätzt; sie stehen in „gaps“. Quelle der Rohreihen: öffentliche Binance-USDⓈ-M-Futures-Daten; Zustandsreihen: Auswertungen der App.",
    series: rows.map((r) => {
      const def = seriesDef(r.series);
      return {
        series: r.series,
        label: def.label,
        kind: def.kind,
        source: def.source,
        symbol: r.symbol,
        fields: def.fields.map((f) => ({ key: f.key, label: f.label, unit: f.unit })),
        count: r.points.length,
        points: r.points.map((p) => ({ t: p.t, time: isoUtc(p.t), ...p.d })),
        gaps: r.gaps.map((g) => ({ from: isoUtc(g.from), to: isoUtc(g.to), cause: g.cause, detail: g.detail, ticks: g.ticks })),
      };
    }),
  };
  return JSON.stringify(out, null, 1);
}

/** `tj-archiv-premium-BTCUSDT-2026-10-26.csv` / `tj-archiv-alles-2026-10-26.json`. */
export function archiveFilename(kind: "csv" | "json", series: SeriesId | null, symbol: string | null, now: Date = new Date()): string {
  const parts = ["tj-archiv", series ?? "alles", symbol ?? null, now.toISOString().slice(0, 10)].filter(Boolean);
  return `${parts.join("-")}.${kind}`;
}

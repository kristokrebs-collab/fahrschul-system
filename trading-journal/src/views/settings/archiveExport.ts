/**
 * Datenarchiv view (F26) – the export of one row or of everything: reads the points from the store exactly as stored,
 * adds the gaps (checked when the view had not yet), and hands the file to the download helper. Throws when a read or the
 * download fails; the card shows „Export fehlgeschlagen“.
 */
import { ARCHIVE_CSV_MIME, ARCHIVE_JSON_MIME, archiveFilename, archiveToJson, findGaps, pointsToCsv, seriesDef, type Gap, type JsonSeries } from "@/domain/archive";
import type { ArchiveDb } from "@/market/archive/db";
import { download } from "@/store/download";
import type { RowView } from "./archiveModel";

async function gapsOf(db: ArchiveDb, row: RowView): Promise<readonly Gap[]> {
  if (row.gaps) return row.gaps;
  return findGaps(seriesDef(row.info.series), row.info.symbol, await db.times(row.info.series, row.info.symbol), await db.ticks());
}

async function jsonRow(db: ArchiveDb, row: RowView): Promise<JsonSeries> {
  return { series: row.info.series, symbol: row.info.symbol, points: await db.range(row.info.series, row.info.symbol, 0, Infinity), gaps: await gapsOf(db, row) };
}

export async function exportRowFile(db: ArchiveDb, row: RowView, kind: "csv" | "json"): Promise<void> {
  const { series, symbol } = row.info;
  if (kind === "csv") {
    const points = await db.range(series, symbol, 0, Infinity);
    await download(archiveFilename("csv", series, symbol), pointsToCsv(series, points), ARCHIVE_CSV_MIME);
  } else {
    await download(archiveFilename("json", series, symbol), archiveToJson([await jsonRow(db, row)], { exportedAt: Date.now() }), ARCHIVE_JSON_MIME);
  }
}

export async function exportAllFile(db: ArchiveDb, rows: readonly RowView[]): Promise<void> {
  const all: JsonSeries[] = [];
  for (const r of rows) all.push(await jsonRow(db, r));
  await download(archiveFilename("json", null, null), archiveToJson(all, { exportedAt: Date.now() }), ARCHIVE_JSON_MIME);
}

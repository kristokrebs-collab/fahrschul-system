/**
 * "Bild-Hashes" (A2): a CSV that lists, for every screenshot of the journal, the SHA-256 of its bytes with name, type,
 * size, pixel size, where it lives and whether it is the original or a shrunk version from an older app release. The
 * list is the proof a trader (or an auditor) can check against the downloaded file with any hash tool.
 * References from before A2 carry no hash: it is computed from the stored bytes on the way out (and marked as a version).
 */
import { CSV_BOM, csvCell, csvTextCell } from "@/domain/csv";
import type { ScreenshotRef, Trade } from "@/domain/types";
import { download } from "@/store/download";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { isOriginal, ORIGINAL_LABEL, SHRUNK_LABEL, STORAGE_LABELS, shotStorageOf } from "./info";
import { loadOriginal } from "./original";
import { isSha256, sha256Hex } from "./sha256";

export const HASH_HEADER = ["Trade-ID", "Screenshot-ID", "Dateiname", "Typ", "Bytes", "SHA-256", "Breite", "Höhe", "Speicher", "Stufe", "Hinweis"] as const;

export interface HashRow {
  tradeId: string;
  shotId: string;
  name: string;
  mime: string;
  bytes: number | null;
  sha256: string;
  w: number | null;
  h: number | null;
  storage: string;
  level: typeof ORIGINAL_LABEL | typeof SHRUNK_LABEL;
  note: string;
}

/** One row per picture reference that holds bytes. Hashes missing on a reference are computed from the stored bytes. */
export async function collectHashRows(trades: readonly Pick<Trade, "id" | "screenshots">[]): Promise<HashRow[]> {
  const rows: HashRow[] = [];
  const computed = new Map<string, { sha: string; bytes: number } | null>();
  for (const t of trades) {
    for (const ref of t.screenshots ?? []) {
      if (ref.store === "url") continue;
      let sha = isSha256(ref.sha256) ? ref.sha256 : "";
      let bytes = typeof ref.bytes === "number" ? ref.bytes : null;
      let note = "";
      if (!sha) {
        const id = ref.cacheKey ?? ref.key ?? ref.id;
        if (!computed.has(id)) {
          const got = await loadOriginal(ref, false);
          computed.set(id, got ? { sha: await sha256Hex(got.blob), bytes: got.blob.size } : null);
        }
        const c = computed.get(id);
        if (c) {
          sha = c.sha;
          bytes ??= c.bytes;
          note = "Hash aus den gespeicherten Bytes berechnet (Bild stammt aus einer älteren App-Fassung)";
        } else note = "Bild nicht erreichbar, kein Hash bekannt";
      }
      if (!isOriginal(ref) && !note) note = "Verkleinerte Version aus einer älteren App-Fassung, nicht das Original";
      rows.push({
        tradeId: t.id,
        shotId: ref.id,
        name: ref.originalName ?? "",
        mime: ref.mime ?? "",
        bytes,
        sha256: sha,
        w: ref.w ?? null,
        h: ref.h ?? null,
        storage: STORAGE_LABELS[shotStorageOf(ref as ScreenshotRef)],
        level: isOriginal(ref) ? ORIGINAL_LABEL : SHRUNK_LABEL,
        note,
      });
    }
  }
  return rows;
}

/** CSV text (BOM, `;`, like the other exports). */
export function hashRowsToCsv(rows: readonly HashRow[]): string {
  const lines = rows.map((r) => [csvTextCell(r.tradeId), csvTextCell(r.shotId), csvTextCell(r.name), csvTextCell(r.mime), csvCell(r.bytes), csvCell(r.sha256), csvCell(r.w), csvCell(r.h), csvCell(r.storage), csvCell(r.level), csvTextCell(r.note)].join(";"));
  return CSV_BOM + [HASH_HEADER.join(";"), ...lines].join("\n");
}

/** Saves `trade-journal-YYYY-MM-DD-bild-hashes.csv`. */
export async function exportShotHashes(now: Date = new Date()): Promise<boolean> {
  const rows = await collectHashRows(useJournal.getState().trades);
  if (!rows.length) {
    pushToast({ kind: "info", title: "Keine Screenshots im Journal" });
    return false;
  }
  const day = now.toISOString().slice(0, 10);
  return download(`trade-journal-${day}-bild-hashes.csv`, hashRowsToCsv(rows), "text/csv;charset=utf-8");
}

/**
 * CSV import (P11): parse → detect the format (or map columns) → journal trades → merge into the journal.
 * Works in every build (local only, no server). Re-importing the same file updates the same records (deterministic
 * ids) and – like the exchange sync – only touches the exchange fields of a trade that already exists, never the
 * trader's notes, setups or feelings. The write goes through `importBackup(…, { mode: "merge" })` (safety snapshot).
 */
import type { Trade } from "@/domain/types";
import { importBackup } from "@/store/backup";
import { freshSnapshot } from "@/store/journalStore";
import { mergeSyncedTrade } from "../syncFields";
import { detectFormat, FORMATS } from "./formats";
import { toJournalTrade, type CsvFormat, type CsvTrade, type ParseResult } from "./model";
import { parseCsv, type CsvTable } from "./parse";

export { FORMATS, detectFormat } from "./formats";
export { guessMapping, parseWithMapping, MAP_FIELDS, MAP_LABEL, MAP_REQUIRED, type ColumnMapping, type MapField } from "./generic";
export { aggregateFills, toJournalTrade, csvTradeId, type CsvTrade, type CsvFormat, type ParseResult, type CsvFill } from "./model";
export { parseCsv, parseNum, numberStyle, parseTime, normalizePair, toWallClock, type CsvTable, type NumberStyle } from "./parse";

export interface LoadedCsv {
  table: CsvTable;
  format: CsvFormat | null;
  score: number;
}

/** Reads a CSV text and detects its format (null → the mapping assistant). */
export function loadCsv(text: string): LoadedCsv {
  const table = parseCsv(text);
  const hit = detectFormat(table.header);
  return { table, format: hit?.format ?? null, score: hit?.score ?? 0 };
}

export function formatById(id: string): CsvFormat | null {
  return FORMATS.find((f) => f.id === id) ?? null;
}

export interface BuildOptions {
  formatId: string;
  venue?: string;
  account: "makro" | "scalp";
  /** Pair for trades the export left without one (TradingView). */
  fallbackPair: string;
  now?: Date;
}

/** Parsed CSV trades → journal records (pair filled in where the export has none). */
export function buildTrades(parsed: ParseResult, opts: BuildOptions): Trade[] {
  const nowIso = (opts.now ?? new Date()).toISOString();
  return parsed.trades.map((t: CsvTrade) =>
    toJournalTrade({ ...t, pair: t.pair || opts.fallbackPair }, { formatId: opts.formatId, venue: opts.venue, account: opts.account, nowIso }),
  );
}

export interface CsvMergePlan {
  added: Trade[];
  updated: Trade[];
  unchanged: number;
}

/** Minutes of a journal wall clock `YYYY-MM-DDTHH:mm` on a zone-less scale (only differences are used), or null. */
function wallMinutes(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(date);
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) / 60_000 : null;
}

const sameNumber = (a: number | null | undefined, b: number | null | undefined): boolean =>
  a == null || b == null ? a == null && b == null : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** The widest shift between two readings of one wall clock (UTC−12 … UTC+14), in minutes. */
const ZONE_SPAN_MIN = 14 * 60;

/**
 * The same trade under another id (QA Runde 13): a trade typed by hand has a random id, the same trade read back from a CSV – above
 * all the journal's OWN export – gets a deterministic one, so the import added every trade a second time (41 → 82). Same pair, side,
 * entry and exit, and the same opening time – to the minute, or shifted by whole quarter hours within the span of the time zones (the
 * file read as UTC instead of local time). Entry and exit must both match exactly; an open trade matches an open one. `planCsvMerge`
 * applies it only across DIFFERENT sources (a hand-typed trade against a file, one import path against another).
 */
export function sameTrade(a: Trade, b: Trade): boolean {
  if (a.side !== b.side || a.pair.replace(/[^A-Za-z0-9]/g, "").toUpperCase() !== b.pair.replace(/[^A-Za-z0-9]/g, "").toUpperCase()) return false;
  if (a.entry == null || !sameNumber(a.entry, b.entry) || !sameNumber(a.exit, b.exit)) return false;
  const ta = wallMinutes(a.date);
  const tb = wallMinutes(b.date);
  if (ta === null || tb === null) return false;
  const d = Math.abs(ta - tb);
  return d <= ZONE_SPAN_MIN && d % 15 === 0;
}

/** Pure: which records are new, which exchange fields change, which stay as they are. */
export function planCsvMerge(current: readonly Trade[], incoming: readonly Trade[], nowIso: string): CsvMergePlan {
  const byId = new Map(current.map((t) => [t.id, t] as const));
  // candidates for "the same trade under another id", by pair + side (the journal is small; the bucket keeps it linear enough)
  const bucketKey = (t: Trade): string => `${t.pair.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}|${t.side}`;
  const buckets = new Map<string, Trade[]>();
  for (const t of current) {
    const k = bucketKey(t);
    const list = buckets.get(k);
    if (list) list.push(t);
    else buckets.set(k, [t]);
  }
  const added: Trade[] = [];
  const updated: Trade[] = [];
  let unchanged = 0;
  const seen = new Set<string>();
  for (const t of incoming) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const cur = byId.get(t.id);
    if (!cur) {
      // already in the journal under another id – typed by hand, or imported through ANOTHER path (`syncSource` differs): nothing to
      // write. Two rows of the same source with different ids stay two trades: the source's own identity wins there.
      if (buckets.get(bucketKey(t))?.some((c) => c.syncSource !== t.syncSource && sameTrade(c, t))) unchanged++;
      else added.push(t);
    } else {
      const merged = mergeSyncedTrade(cur as unknown as Record<string, unknown>, t as unknown as Record<string, unknown>, nowIso);
      if (merged) updated.push(merged as unknown as Trade);
      else unchanged++;
    }
  }
  return { added, updated, unchanged };
}

export interface CsvImportResult {
  ok: boolean;
  added: number;
  updated: number;
  unchanged: number;
  error?: string;
}

/** Writes the trades into the journal (merge with snapshot). */
export async function importCsvTrades(trades: readonly Trade[], now = new Date()): Promise<CsvImportResult> {
  const plan = planCsvMerge(freshSnapshot().trades, trades, now.toISOString());
  const write = [...plan.added, ...plan.updated];
  if (!write.length) return { ok: true, added: 0, updated: 0, unchanged: plan.unchanged };
  const res = await importBackup(JSON.stringify({ trades: write }), { mode: "merge", silent: true, now });
  return res.ok
    ? { ok: true, added: plan.added.length, updated: plan.updated.length, unchanged: plan.unchanged }
    : { ok: false, added: 0, updated: 0, unchanged: 0, error: res.error };
}

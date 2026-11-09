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
export { parseCsv, parseNum, parseTime, normalizePair, toWallClock, type CsvTable } from "./parse";

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

/** Pure: which records are new, which exchange fields change, which stay as they are. */
export function planCsvMerge(current: readonly Trade[], incoming: readonly Trade[], nowIso: string): CsvMergePlan {
  const byId = new Map(current.map((t) => [t.id, t] as const));
  const added: Trade[] = [];
  const updated: Trade[] = [];
  let unchanged = 0;
  const seen = new Set<string>();
  for (const t of incoming) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const cur = byId.get(t.id);
    if (!cur) added.push(t);
    else {
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

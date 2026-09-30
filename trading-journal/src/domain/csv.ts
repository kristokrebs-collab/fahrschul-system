/**
 * Exports – bundle `K$` (50236–50344): CSV (BOM, ";", de decimals) and JSON backup (Plan 8.4).
 */
import type { EnrichedTrade, HyblockReading, JsonBackup, Settings, Trade } from "./types";
import { tradeTime } from "@/lib/dates";
import { RESULT_LABELS } from "./defaults";

export const CSV_HEADER = [
  "Datum",
  "Konto",
  "Paar",
  "Richtung",
  "Status",
  "Einstieg",
  "Stop",
  "Ziel",
  "Ausstieg",
  "Größe",
  "Hebel",
  "Gebühren",
  "P&L",
  "R",
  "Kursbewegung %",
  "Ergebnis",
  "Grundlagen",
  "Checkliste",
  "Überzeugung",
  "Plan befolgt",
  "Gefühl",
  "Timeframe",
  "Begründung",
  "Notizen",
  "Chart",
] as const;

export const CSV_BOM = "﻿";
export const SCHEMA_VERSION = 1;

/** Bundle `m`: null → "", numbers with the first "." → ",", quote when the value contains `"`, `;` or a newline. */
export function csvCell(h: unknown): string {
  const v = h == null ? "" : typeof h === "number" ? String(h).replace(".", ",") : String(h);
  return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Characters a spreadsheet interprets as the start of a formula (`=`, `+`, `-`, `@`, tab, CR). */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * `csvCell` for free-text columns: a value starting with a formula character is prefixed with `'` so
 * Excel / Sheets / Numbers show it as text (CSV formula injection). Numeric columns keep `csvCell` because
 * negative `,`-decimal numbers legitimately start with `-`.
 */
export function csvTextCell(h: unknown): string {
  const v = h == null ? "" : String(h);
  return csvCell(FORMULA_LEAD.test(v) ? `'${v}` : v);
}

export type CsvColumnKind = "text" | "value";

/**
 * Per-column escaping, index-aligned with `CSV_HEADER`. `text` = user-entered free text (formula-escaped),
 * `value` = numbers, dates, enumerations and computed fields (written as-is).
 */
export const CSV_COLUMN_KINDS: Readonly<Record<(typeof CSV_HEADER)[number], CsvColumnKind>> = {
  Datum: "value",
  Konto: "value",
  Paar: "text",
  Richtung: "value",
  Status: "value",
  Einstieg: "value",
  Stop: "value",
  Ziel: "value",
  Ausstieg: "value",
  Größe: "value",
  Hebel: "value",
  Gebühren: "value",
  "P&L": "value",
  R: "value",
  "Kursbewegung %": "value",
  Ergebnis: "value",
  Grundlagen: "text",
  Checkliste: "value",
  Überzeugung: "value",
  "Plan befolgt": "value",
  Gefühl: "text",
  Timeframe: "text",
  Begründung: "text",
  Notizen: "text",
  Chart: "text",
};

const CELL_FORMATTERS: ReadonlyArray<(h: unknown) => string> = CSV_HEADER.map((name) => (CSV_COLUMN_KINDS[name] === "text" ? csvTextCell : csvCell));

export function tradeToCsvRow(t: EnrichedTrade, setupNames: ReadonlyMap<string, string>): string {
  return [
    t.date,
    t.account === "makro" ? "Makro" : "Scalp",
    t.pair,
    t.side,
    t.status,
    t.entry,
    t.stop,
    t.target,
    t.exit,
    t.size,
    t.leverage,
    t.fees,
    t.pnl != null ? +t.pnl.toFixed(2) : "",
    t.r != null ? +t.r.toFixed(2) : "",
    t.move != null ? +(t.move * 100).toFixed(2) : "",
    RESULT_LABELS[t.result],
    (t.setups || [])
      .map((id) => setupNames.get(id))
      .filter(Boolean)
      .join(" | "),
    `${t.checked}/${t.items.length}`,
    t.conviction,
    t.followedPlan == null ? "" : t.followedPlan ? "Ja" : "Nein",
    t.emotion,
    t.timeframe,
    t.reason,
    t.notes,
    t.chart,
  ]
    .map((cell, i) => (CELL_FORMATTERS[i] ?? csvCell)(cell))
    .join(";");
}

/** Full CSV text: BOM + header + rows sorted by trade time ascending, "\n" separated. */
export function tradesToCsv(enriched: readonly EnrichedTrade[], settings: Pick<Settings, "setups">): string {
  const names = new Map(settings.setups.map((s) => [s.id, s.name] as const));
  const rows = [...enriched].sort((a, b) => +tradeTime(a) - +tradeTime(b)).map((t) => tradeToCsvRow(t, names));
  return CSV_BOM + [CSV_HEADER.join(";"), ...rows].join("\n");
}

/** Strip enrichment (items, checked, complete, move, risk, rr, result); `pnl`/`r` stay (recomputed values). */
export function stripEnrichment(t: EnrichedTrade | Trade): Trade {
  const { items: _i, checked: _c, complete: _co, move: _m, risk: _ri, rr: _rr, result: _re, ...rest } = t as EnrichedTrade;
  return rest;
}

export function toJsonBackup(
  trades: readonly (EnrichedTrade | Trade)[],
  settings: Settings,
  hyblock?: readonly HyblockReading[],
  now: Date = new Date(),
): JsonBackup {
  const out: JsonBackup = {
    exportedAt: now.toISOString(),
    settings,
    trades: trades.map(stripEnrichment),
    schemaVersion: SCHEMA_VERSION,
  };
  if (hyblock) out.hyblock = [...hyblock];
  return out;
}

/** Pretty-printed JSON (2 spaces), like the bundle. */
export function jsonBackupText(backup: JsonBackup): string {
  return JSON.stringify(backup, null, 2);
}

/** "trade-journal-YYYY-MM-DD.csv" / ".json" (UTC date slice like the bundle). */
export function exportFilename(kind: "csv" | "json", now: Date = new Date()): string {
  return `trade-journal-${now.toISOString().slice(0, 10)}.${kind}`;
}

export const CSV_MIME = "text/csv;charset=utf-8";
export const JSON_MIME = "application/json";

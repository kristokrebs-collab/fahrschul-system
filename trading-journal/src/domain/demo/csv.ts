/**
 * Der Import der Demo (F58): eine ERFUNDENE Beispiel-CSV im Aufbau der Bitunix-Positionshistorie, gelesen mit dem ECHTEN Parser
 * des CSV-Imports (`@/exchanges/csv`: Tabelle lesen → Format erkennen → Positionen → Journal-Trades). Das Kürzel `DEMOUSDT`, die
 * Preise, Mengen und Zeiten sind ausgedacht; die Datei kommt von keiner Börse. Nichts wird gespeichert: `previewDemoCsv` liefert nur
 * Daten, der Import in das Journal (`importCsvTrades`, Merge mit Sicherung) kommt hier nicht vor – dieses Modul importiert weder den
 * Speicher noch das Journal.
 *
 * Vorsicht bei den Importen: nur die reinen Dateien des Parsers (`parse`, `formats`, `model`), nicht `csv/index.ts` (das den Speicher
 * einbindet).
 */
import { wilsonCI, type Interval } from "../analytics/stats";
import type { Trade } from "../types";
import { detectFormat } from "@/exchanges/csv/formats";
import { toJournalTrade, type CsvTrade } from "@/exchanges/csv/model";
import { parseCsv } from "@/exchanges/csv/parse";

/** Die Beispieldatei (Kopfzeile wie der Bitunix-Export; alle Werte erfunden). */
export const DEMO_CSV = `Futures,Side,Leverage,Margin mode,Avg. entry price,Avg. close price,Closed amount,Realized PnL,Fee,Funding fee,Open time,Close time
DEMOUSDT,Long,5,Isolated,98.40,101.20,40,112.00,3.99,-0.20,2024-03-04 09:30:00,2024-03-04 15:10:00
DEMOUSDT,Short,5,Isolated,102.10,100.70,35,49.00,3.55,0.10,2024-03-05 08:05:00,2024-03-05 11:45:00
DEMOUSDT,Long,5,Isolated,99.60,98.20,45,-63.00,4.50,-0.15,2024-03-06 13:20:00,2024-03-06 16:00:00
DEMOUSDT,Long,5,Isolated,97.80,100.90,30,93.00,2.99,-0.30,2024-03-07 07:40:00,2024-03-07 18:25:00
DEMOUSDT,Short,5,Isolated,103.50,104.60,40,-44.00,4.17,0.05,2024-03-08 10:15:00,2024-03-08 12:30:00
DEMOUSDT,Long,5,Isolated,100.20,102.60,38,91.20,3.85,-0.12,2024-03-11 09:00:00,2024-03-11 14:50:00
DEMOUSDT,Short,5,Isolated,104.00,102.90,42,46.20,4.34,0.08,2024-03-12 14:10:00,2024-03-12 17:35:00
DEMOUSDT,Long,5,Isolated,101.40,100.10,36,-46.80,3.66,-0.10,2024-03-13 08:25:00,2024-03-13 10:05:00
`;

export interface DemoCsvPreview {
  /** the format the header was recognised as (`null` = the real import would ask for a column mapping) */
  format: { id: string; label: string; hint: string } | null;
  /** 0 … 1 */
  score: number;
  header: string[];
  rows: number;
  skipped: number;
  warnings: string[];
  trades: CsvTrade[];
  /** the journal records the real import would write (deterministic ids; NOT written) */
  records: Trade[];
}

/** The real parser on the example file. Pure: nothing is stored, sent or imported. */
export function previewDemoCsv(text: string = DEMO_CSV): DemoCsvPreview {
  const table = parseCsv(text);
  const hit = detectFormat(table.header);
  if (!hit) return { format: null, score: 0, header: table.header, rows: table.rows.length, skipped: 0, warnings: [], trades: [], records: [] };
  const parsed = hit.format.parse(table);
  const records = parsed.trades.map((t) => toJournalTrade(t, { formatId: hit.format.id, venue: hit.format.venue, account: "scalp", nowIso: "1970-01-01T00:00:00.000Z" }));
  return {
    format: { id: hit.format.id, label: hit.format.label, hint: hit.format.hint },
    score: hit.score,
    header: table.header,
    rows: table.rows.length,
    skipped: parsed.skipped,
    warnings: parsed.warnings,
    trades: parsed.trades,
    records,
  };
}

export interface DemoCsvSummary {
  n: number;
  wins: number;
  losses: number;
  winRate: number | null;
  winCI: Interval | null;
  /** Σ net P&L as the file states it, Σ fees */
  net: number;
  fees: number;
  /** trades with a stop in the file (the export has none → R is unknown) */
  withStop: number;
}

/** The numbers of the imported trades: what a journal would show for them. */
export function summarizeDemoCsv(trades: readonly CsvTrade[]): DemoCsvSummary {
  const closed = trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
  const losses = closed.filter((t) => (t.pnl ?? 0) < 0).length;
  const n = closed.length;
  return {
    n,
    wins,
    losses,
    winRate: n ? wins / n : null,
    winCI: n ? wilsonCI(wins, n) : null,
    net: closed.reduce((a, t) => a + (t.pnl ?? 0), 0),
    fees: closed.reduce((a, t) => a + Math.abs(t.fees ?? 0), 0),
    withStop: closed.filter((t) => t.stop != null).length,
  };
}

/** UTC wall clock of an export time for the preview table ("03-04 09:30") – the same in every zone. */
export function clockOf(ms: number | null): string {
  return ms == null ? "–" : new Date(ms).toISOString().slice(5, 16).replace("T", " ");
}

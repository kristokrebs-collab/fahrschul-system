/**
 * Transaktionsbuch (F70): CSV export in the app's CSV dialect (BOM, `;`, decimal comma, formula guard) – the book and the
 * first-in-first-out matching as two files. The head names what the file is: a Hilfsrechnung ohne Steuerberatung, with
 * the zone, the currency, the matching rule and what is NOT in it. Pure; the creation time is a parameter.
 */
import { CSV_BOM, csvCell, csvTextCell } from "../csv";
import { formatDay, formatStamp } from "../events/zone";
import { rowsOfYear } from "./build";
import { FLAG_LABEL, KIND_LABEL, type Ledger, type LedgerRow } from "./types";

/** The line that heads every export and the print view. */
export const LEDGER_NOTE = "Hilfsrechnung ohne Steuerberatung; Steuerregeln prüft eine Fachperson";

/** What the book does not hold – said in every export. */
export const LEDGER_SCOPE_NOTE = "Nicht enthalten: Ein- und Auszahlungen, Überweisungen zwischen Konten oder Wallets, Staking, Rewards, Airdrops und die Umrechnung in eine Fiat-Währung (die Beträge stehen in der Handelswährung). Offene Positionen sind nicht bewertet. Es wird keine Steuer berechnet und keine Haltefrist behauptet: Anschaffung und Veräußerung sind nur Datumsspalten.";

export const SCOPE_TEXT = { position: "je Position (ein Journal-Eintrag)", market: "je Markt (alle Einträge eines Marktes)" } as const;

/** Number with a decimal comma, between `min` and `max` decimals, trailing zeros beyond `min` removed. */
export function dec(v: number | null | undefined, min = 2, max = 8): string {
  if (v == null || !Number.isFinite(v)) return "";
  let s = v.toFixed(max);
  if (s.includes(".")) {
    const keep = s.indexOf(".") + 1 + min;
    s = s.slice(0, keep) + s.slice(keep).replace(/0+$/, "");
    s = s.replace(/\.$/, "");
  }
  return s.replace(".", ",");
}

export function ledgerFilename(kind: "buch" | "zuordnung", year: number | null, ext: "csv" = "csv"): string {
  return `${kind === "buch" ? "transaktionsbuch" : "fifo-zuordnung"}-${year ?? "alle-jahre"}.${ext}`;
}

const line = (cells: readonly string[]): string => cells.join(";");
const text = (s: string): string => csvTextCell(s);

function headLines(ledger: Ledger, title: string, year: number | null, now: number): string[] {
  const o = ledger.options;
  return [
    text(LEDGER_NOTE),
    csvCell(`${title} ${year ?? "alle Jahre"} · Währung ${ledger.currency} · Zeitzone ${o.displayZone} · Zuordnung FIFO ${SCOPE_TEXT[o.scope]} · erstellt ${formatStamp(now, o.displayZone)}`),
    csvCell(`Die Zeiten im Journal gelten als Ortszeit der Zone ${o.sourceZone}; die Spalte „Zeit (UTC)“ ist die umgerechnete Zeit.`),
    csvCell("Eröffnung und Schließung entsprechen Anschaffung und Veräußerung bei Long- und Spot-Positionen; bei Short ist es umgekehrt (Spalte „Kauf/Verkauf“). Es wird keine Haltefrist behauptet."),
    csvCell(LEDGER_SCOPE_NOTE),
    "",
  ];
}

const lotDates = (r: LedgerRow, zone: string): string => {
  const days: string[] = [];
  for (const m of r.matches) {
    const d = formatDay(m.openAt, zone);
    if (!days.includes(d)) days.push(d);
  }
  return days.join(" / ");
};

const flagsText = (r: LedgerRow): string => r.flags.map((f) => `${FLAG_LABEL[f.id]}: ${f.text}`).join(" | ");

/** The book as CSV: head, one line per row, then the year summary. */
export function ledgerToCsv(ledger: Ledger, year: number | null, now: number): string {
  const zone = ledger.options.displayZone;
  const out = headLines(ledger, "Transaktionsbuch", year, now);
  out.push(
    line(["Datum/Zeit", "Zeit (UTC)", "Konto", "Börse", "Markt", "Art", "Kauf/Verkauf", "Richtung", "Menge", "Preis", "Gebühr", "Funding", "Realisiertes Ergebnis (brutto)", "Eröffnung (Datum)", "Schließung (Datum)", "Währung", "Quelle", "Eintrag-ID", "Hinweise"].map(csvCell)),
  );
  for (const r of rowsOfYear(ledger, year, zone)) {
    out.push(
      line([
        csvCell(formatStamp(r.at, zone)),
        csvCell(new Date(r.at).toISOString().replace(".000Z", "Z")),
        csvCell(r.account === "makro" ? "Makro" : "Scalp"),
        text(r.exchange ?? ""),
        text(r.market),
        csvCell(KIND_LABEL[r.kind]),
        csvCell(r.action ?? ""),
        csvCell(r.side === "short" ? "Short" : "Long"),
        csvCell(dec(r.qty, 0)),
        csvCell(dec(r.price)),
        csvCell(dec(r.fee)),
        csvCell(dec(r.funding)),
        csvCell(dec(r.realized)),
        csvCell(r.kind === "open" ? formatDay(r.at, zone) : r.kind === "close" ? lotDates(r, zone) : ""),
        csvCell(r.kind === "close" ? formatDay(r.at, zone) : ""),
        csvCell(ledger.currency),
        csvCell(r.source === "fills" ? "Ausführung" : "Eintrag"),
        text(r.tradeId),
        text(flagsText(r)),
      ]),
    );
  }
  out.push("", csvCell("Jahreszusammenfassung (Ergebnis im Jahr der Schließung, Gebühren und Funding im Jahr der Zahlung)"));
  out.push(line(["Jahr", "Schließungen", "Gewinne", "Verluste", "Ergebnis brutto", "Gebühren", "Funding gezahlt", "Funding erhalten", "Ergebnis nach Gebühren und Funding", "Zeilen mit Hinweis", "Währung"].map(csvCell)));
  for (const y of ledger.years.filter((s) => year == null || s.year === year)) {
    out.push(line([csvCell(y.year), csvCell(y.closes), csvCell(dec(y.gains)), csvCell(dec(y.losses)), csvCell(dec(y.gross)), csvCell(dec(y.fees)), csvCell(dec(y.fundingPaid)), csvCell(dec(y.fundingReceived)), csvCell(dec(y.net)), csvCell(y.flagged), csvCell(ledger.currency)]));
  }
  return CSV_BOM + out.join("\n") + "\n";
}

/** The first-in-first-out matching as CSV: one line per matched piece. */
export function matchesToCsv(ledger: Ledger, year: number | null, now: number): string {
  const zone = ledger.options.displayZone;
  const out = headLines(ledger, "FIFO-Zuordnung", year, now);
  out.push(line(["Schließung (Datum/Zeit)", "Eröffnung (Datum/Zeit)", "Konto", "Markt", "Richtung", "Menge", "Preis Eröffnung", "Preis Schließung", "Ergebnis (brutto)", "Währung", "Eintrag-ID", "Zeile"].map(csvCell)));
  for (const r of rowsOfYear(ledger, year, zone)) {
    if (r.kind !== "close") continue;
    for (const m of r.matches) {
      out.push(
        line([
          csvCell(formatStamp(r.at, zone)),
          csvCell(formatStamp(m.openAt, zone)),
          csvCell(r.account === "makro" ? "Makro" : "Scalp"),
          text(r.market),
          csvCell(r.side === "short" ? "Short" : "Long"),
          csvCell(dec(m.qty, 0)),
          csvCell(dec(m.openPrice)),
          csvCell(dec(m.closePrice)),
          csvCell(dec(m.realized)),
          csvCell(ledger.currency),
          text(r.tradeId),
          text(r.id),
        ]),
      );
    }
    if (r.unmatchedQty > 0) out.push(line([csvCell(formatStamp(r.at, zone)), "", csvCell(r.account === "makro" ? "Makro" : "Scalp"), text(r.market), csvCell(r.side === "short" ? "Short" : "Long"), csvCell(dec(r.unmatchedQty, 0)), "", csvCell(dec(r.price)), "", csvCell(ledger.currency), text(r.tradeId), text(`${r.id} · ohne passenden Einstieg, Ergebnis offen`)]));
  }
  return CSV_BOM + out.join("\n") + "\n";
}

/** Years that hold at least one row, for the picker. */
export const yearsOf = (ledger: Pick<Ledger, "years">): number[] => ledger.years.map((y) => y.year);

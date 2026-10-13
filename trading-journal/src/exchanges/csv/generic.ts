/**
 * Generic mapping assistant (P11, pure): any CSV with one closed trade per row – the trader picks which column is
 * what (pre-filled by a guess from the header), the preview shows the result at once.
 */
import type { CsvTrade, ParseResult } from "./model";
import { cell, normalizePair, parseNum, parseSide, parseTime, type CsvTable } from "./parse";

export const MAP_FIELDS = ["date", "exitDate", "pair", "side", "entry", "exit", "qty", "size", "fees", "pnl", "stop", "target", "leverage", "bot"] as const;
export type MapField = (typeof MAP_FIELDS)[number];

/** Field → column index (−1 = not mapped). */
export type ColumnMapping = Record<MapField, number>;

export const MAP_LABEL: Readonly<Record<MapField, string>> = {
  date: "Einstieg (Zeit)",
  exitDate: "Ausstieg (Zeit)",
  pair: "Paar",
  side: "Richtung",
  entry: "Einstiegspreis",
  exit: "Ausstiegspreis",
  qty: "Menge",
  size: "Größe (Wert)",
  fees: "Gebühren",
  pnl: "P&L netto",
  stop: "Stop",
  target: "Ziel",
  leverage: "Hebel",
  bot: "Bot (Name)",
};

/** Fields without which a row is skipped. */
export const MAP_REQUIRED: readonly MapField[] = ["date", "side", "entry"];

const GUESS: Readonly<Record<MapField, RegExp[]>> = {
  date: [/^(open(ing)?|entry|einstieg|created).*(time|date|zeit|datum)/i, /^(date|datum|time|zeit)$/i, /date|datum/i],
  exitDate: [/^(clos(e|ing|ed)|exit|ausstieg).*(time|date|zeit|datum)/i],
  pair: [/^(pair|paar|symbol|instrument|market|contract|asset|ticker)s?$/i, /symbol|pair|instrument/i],
  side: [/^(side|direction|richtung|type|typ|position side)$/i],
  entry: [/(entry|open|einstieg).*price|^entry$|einstieg/i, /^price$/i],
  exit: [/(exit|close|ausstieg).*price|^exit$|ausstieg/i],
  qty: [/^(qty|quantity|menge|amount|volume|contracts|size)$/i],
  size: [/notional|value|wert|position value/i],
  fees: [/fee|gebühr|commission/i],
  pnl: [/net.*p(n|&)l|realized.*p(n|&)l|^p(n|&)l|profit|gewinn/i],
  stop: [/^(stop|sl|s ?\/ ?l|stop.?loss)$/i],
  target: [/^(target|tp|t ?\/ ?p|take.?profit|ziel)$/i],
  leverage: [/leverage|hebel/i],
  // review F14: a bot / strategy column marks the rows as bot trades (Herkunft „Bot · <Name>“)
  bot: [/^(bot|bot.?name|bot.?id|strateg(y|ie)|algo)$/i],
};

/** First-guess mapping from the header (each column used once). */
export function guessMapping(header: readonly string[]): ColumnMapping {
  const used = new Set<number>();
  const out = {} as ColumnMapping;
  for (const f of MAP_FIELDS) {
    let hit = -1;
    for (const p of GUESS[f]) {
      hit = header.findIndex((h, i) => !used.has(i) && p.test(h.trim()));
      if (hit >= 0) break;
    }
    out[f] = hit;
    if (hit >= 0) used.add(hit);
  }
  return out;
}

export interface GenericOptions {
  /** Times without zone: exchange exports are UTC, journals / platforms often local. */
  assume: "utc" | "local";
  /** Pair for rows without a pair column. */
  fallbackPair: string;
}

/** Rows → trades with the trader's mapping. */
export function parseWithMapping(t: CsvTable, m: ColumnMapping, opts: GenericOptions): ParseResult {
  const decimalComma = t.delimiter === ";";
  const out: CsvTrade[] = [];
  let skipped = 0;
  t.rows.forEach((r) => {
    const side = parseSide(cell(r, m.side));
    const entry = parseNum(cell(r, m.entry), decimalComma);
    const openedAt = parseTime(cell(r, m.date), { assume: opts.assume });
    if (!side || !entry || openedAt === null) {
      skipped++;
      return;
    }
    const closedAt = parseTime(cell(r, m.exitDate), { assume: opts.assume });
    const exit = parseNum(cell(r, m.exit), decimalComma);
    const pairRaw = cell(r, m.pair);
    out.push({
      key: `${pairRaw}|${openedAt}|${side}|${entry}|${exit ?? ""}`,
      pair: pairRaw ? normalizePair(pairRaw) : opts.fallbackPair,
      side,
      status: exit || closedAt !== null ? "closed" : "open",
      openedAt,
      closedAt: closedAt ?? (exit ? openedAt : null),
      entry,
      exit,
      qty: parseNum(cell(r, m.qty), decimalComma),
      size: parseNum(cell(r, m.size), decimalComma),
      fees: (() => {
        const f = parseNum(cell(r, m.fees), decimalComma);
        return f === null ? null : Math.abs(f);
      })(),
      pnl: parseNum(cell(r, m.pnl), decimalComma),
      stop: parseNum(cell(r, m.stop), decimalComma),
      target: parseNum(cell(r, m.target), decimalComma),
      leverage: parseNum(cell(r, m.leverage), decimalComma),
      ...(cell(r, m.bot ?? -1) ? { bot: cell(r, m.bot ?? -1).slice(0, 40) } : null),
    });
  });
  return { trades: out, skipped, warnings: [] };
}

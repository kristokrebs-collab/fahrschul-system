/**
 * Generic mapping assistant (P11, pure): any CSV with one closed trade per row – the trader picks which column is
 * what (pre-filled by a guess from the header), the preview shows the result at once.
 */
import type { CsvTrade, ParseResult } from "./model";
import { cell, normalizePair, numberStyle, parseNum, parseSide, parseTime, type CsvTable } from "./parse";
import { isInverseContract, noRejections, reject, rejectionWarnings } from "./scope";

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
  // "Größe" is the journal's own word for the position value (its CSV export). The old loose `wert` matched „Be-wert-ung“ (the rating
  // column of that export) and never „Größe“ (QA Runde 13): whole-word matches first, then the unambiguous compounds.
  size: [/^(gr(ö|oe)(ß|ss)e|positionsgr(ö|oe)(ß|ss)e|positionswert|notional|wert|value)(\s*\(.*\))?$/i, /notional|position.?value|positionswert/i],
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
  // the file's own number convention, read from every mapped number column (fallback for the comma: a semicolon file is German)
  const numCols = (["entry", "exit", "qty", "size", "fees", "pnl", "stop", "target", "leverage"] as const).map((f) => m[f]).filter((i) => i >= 0);
  const style = numberStyle(
    t.rows.flatMap((r) => numCols.map((i) => cell(r, i))),
    t.delimiter === ";",
  );
  const num = (raw: string): number | null => parseNum(raw, style.decimalComma, style.dotThousands);
  const out: CsvTrade[] = [];
  const rej = noRejections();
  let skipped = 0;
  t.rows.forEach((r) => {
    // F42: a pair that is spelled like a Coin-M contract (BTCUSD_PERP, BTC-USD-SWAP) is not read as a linear one
    if (isInverseContract("any", cell(r, m.pair))) return reject(rej, "inverse", cell(r, m.pair));
    const side = parseSide(cell(r, m.side));
    const entry = num(cell(r, m.entry));
    const openedAt = parseTime(cell(r, m.date), { assume: opts.assume });
    if (!side || !entry || openedAt === null) {
      skipped++;
      return;
    }
    const closedAt = parseTime(cell(r, m.exitDate), { assume: opts.assume });
    const exit = num(cell(r, m.exit));
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
      qty: num(cell(r, m.qty)),
      size: num(cell(r, m.size)),
      fees: (() => {
        const f = num(cell(r, m.fees));
        return f === null ? null : Math.abs(f);
      })(),
      pnl: num(cell(r, m.pnl)),
      stop: num(cell(r, m.stop)),
      target: num(cell(r, m.target)),
      leverage: num(cell(r, m.leverage)),
      ...(cell(r, m.bot ?? -1) ? { bot: cell(r, m.bot ?? -1).slice(0, 40) } : null),
    });
  });
  return { trades: out, skipped, warnings: rejectionWarnings(rej) };
}

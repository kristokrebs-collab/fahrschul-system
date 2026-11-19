/**
 * Rows of a Periodic Transaction Report (PTR) from the positioned text runs of its PDF. PURE and alias-free (the server function
 * extracts the runs with `netlify/functions/_lib/congress/pdf.ts` and calls this).
 *
 * The form is a table: `ID · Owner · Asset · Transaction Type · Date · Notification Date · Amount · Cap. Gains > $200?`, one block
 * per transaction. In the Asset cell the first lines are the asset's name with its ticker in parentheses and a two-letter type
 * code in brackets ("Intel Corporation - Common Stock (INTC) [OP]"), then labelled lines: `F S:` (filing status), `S O:` (the
 * account the asset is "subholding of"), `L:` (location), `D:` (description, which names the shares or the option contract:
 * "Purchased 100 call options with a strike price of $100 and an expiration date of 6/17/27."). The header repeats on every page;
 * a block may run over a page break.
 *
 * How it reads: the header row of each page gives the column starts; a row is anchored by the line that carries a date in the Date
 * column (or a transaction type in the Type column); everything between two anchors belongs to the first. The block of the next
 * page that comes before its first anchor continues the last row of the page before.
 *
 * What it refuses to do: guess. A row whose owner, type, trade date or amount cannot be read cleanly becomes an unreadable row
 * ("nicht lesbar" + its raw text), and a report whose rows cannot be told apart (the number of rows and of `F S:` labels differ)
 * is unreadable as a whole. Nothing is filled in from the neighbours.
 */
import { isoOfMdy } from "./clerk";
import type { CongressOption, CongressOwner, CongressRow, CongressSide, ReportProblem } from "./wire";

export interface TextItem {
  /** left edge, page units */
  x: number;
  /** baseline, page units, growing downward */
  y: number;
  text: string;
  size: number;
}

export interface PageText {
  width: number;
  height: number;
  items: readonly TextItem[];
}

export interface ParsedPtr {
  /** "Filing ID #…" printed in the PDF */
  filingId: string | null;
  /** "Hon. Nancy Pelosi" */
  filer: string | null;
  /** `YYYY-MM-DD` of "Digitally Signed" */
  signed: string | null;
  rows: CongressRow[];
  /** set when the report as a whole could not be read */
  problem?: ReportProblem;
  message?: string;
}

type Col = "id" | "owner" | "asset" | "type" | "date" | "notified" | "amount" | "gains";
const COLS: readonly Col[] = ["id", "owner", "asset", "type", "date", "notified", "amount", "gains"];

const HEADER_WORDS = new Set(["ID", "Owner", "Asset", "Transaction", "Type", "Date", "Notification", "Amount", "Cap.", "Gains >", "$200?"]);
const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const TYPE_RE = /^(P|S|S \(partial\)|E)$/;
/** the rows of one block and of one line are told apart by the baseline; runs of one line differ by well under a point */
const SAME_LINE = 1.2;
const ROW_LEAD = 3;

const SIDE: Readonly<Record<string, CongressSide>> = { P: "buy", S: "sell", "S (partial)": "sell-partial", E: "exchange" };
const OWNER: Readonly<Record<string, CongressOwner>> = { "": "self", SP: "spouse", JT: "joint", DC: "child" };

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

interface Layout {
  starts: Record<Col, number>;
  /** first baseline of the table body */
  top: number;
}

/** The column starts and the top of the body from a page's header row; `null` = the page has no table header. */
function layoutOf(items: readonly TextItem[]): Layout | null {
  const owner = items.find((i) => i.text.trim() === "Owner");
  if (!owner) return null;
  const onLine = (word: string, line = owner.y): TextItem | undefined => items.find((i) => i.text.trim() === word && Math.abs(i.y - line) < SAME_LINE);
  const asset = onLine("Asset");
  const tx = onLine("Transaction");
  const date = onLine("Date");
  const notified = onLine("Notification");
  const amount = onLine("Amount");
  if (!asset || !tx || !date || !notified || !amount) return null;
  const id = onLine("ID");
  const gains = onLine("Cap.");
  const starts: Record<Col, number> = {
    id: id ? id.x : owner.x - 40,
    owner: owner.x,
    asset: asset.x,
    type: tx.x,
    date: date.x,
    notified: notified.x,
    amount: amount.x,
    gains: gains ? gains.x : amount.x + 80,
  };
  let top = owner.y;
  for (const i of items) if (i.y >= owner.y - SAME_LINE && i.y <= owner.y + 40 && HEADER_WORDS.has(i.text.trim())) top = Math.max(top, i.y);
  return { starts, top: top + 2 };
}

function colOf(x: number, starts: Record<Col, number>): Col {
  let found: Col = "id";
  for (const c of COLS) if (x >= starts[c] - 2.5) found = c;
  return found;
}

/** Items → lines (by baseline), each the runs joined left to right as printed. */
function linesOf(items: readonly TextItem[]): string[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { y: number; parts: TextItem[] }[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(it.y - last.y) < SAME_LINE) last.parts.push(it);
    else lines.push({ y: it.y, parts: [it] });
  }
  return lines.map((l) => clean(l.parts.sort((a, b) => a.x - b.x).map((p) => p.text).join(""))).filter(Boolean);
}

type Cells = Record<Col, string[]>;
const emptyCells = (): Cells => ({ id: [], owner: [], asset: [], type: [], date: [], notified: [], amount: [], gains: [] });

/** The page's body items split into blocks: `lead` (before the first anchor) and one entry per anchored row. */
function blocksOf(items: readonly TextItem[], lay: Layout): { lead: Cells; rows: { anchor: number; cells: Cells }[] } {
  let end = Infinity;
  for (const i of items) {
    if (i.y <= lay.top) continue;
    if (/^\*\s*For the complete list/i.test(i.text.trim()) || i.size >= 11) end = Math.min(end, i.y);
  }
  const body = items.filter((i) => i.y > lay.top && i.y < end - 0.5);
  const anchors: number[] = [];
  for (const i of [...body].sort((a, b) => a.y - b.y)) {
    const c = colOf(i.x, lay.starts);
    const t = i.text.trim();
    if ((c === "date" && DATE_RE.test(t)) || (c === "type" && TYPE_RE.test(t))) {
      if (!anchors.some((a) => Math.abs(a - i.y) < SAME_LINE + 1)) anchors.push(i.y);
    }
  }
  anchors.sort((a, b) => a - b);
  const slice = (from: number, to: number): Cells => {
    const grouped: Record<Col, TextItem[]> = { id: [], owner: [], asset: [], type: [], date: [], notified: [], amount: [], gains: [] };
    for (const i of body) if (i.y >= from && i.y < to) grouped[colOf(i.x, lay.starts)].push(i);
    const cells = emptyCells();
    for (const c of COLS) cells[c] = linesOf(grouped[c]);
    return cells;
  };
  const first = anchors[0] ?? Infinity;
  const lead = slice(-Infinity, first - ROW_LEAD);
  const rows = anchors.map((a, k) => ({ anchor: a, cells: slice(a - ROW_LEAD, k + 1 < anchors.length ? anchors[k + 1]! - ROW_LEAD : Infinity) }));
  return { lead, rows };
}

/* ----------------------------------------------------------------------------------------------- the cells */

const LABEL = /^(F S|FILING STATUS|S O|SUBHOLDING OF|L|LOCATION|D|DESCRIPTION|C|COMMENTS?)\s*:\s*(.*)$/i;
const TICKER = /\(([A-Z][A-Z0-9./-]{0,9})\)/g;
const CODE = /\[([A-Z]{2})\]/g;

interface AssetCell {
  name: string;
  ticker: string | null;
  code: string | null;
  status: string | null;
  account: string | null;
  description: string | null;
  labels: number;
}

function readAsset(lines: readonly string[]): AssetCell {
  const head: string[] = [];
  const val: Record<string, string> = {};
  let current: string | null = null;
  let labels = 0;
  for (const line of lines) {
    const m = LABEL.exec(line);
    if (m) {
      const key = m[1]!.toUpperCase();
      current = key === "F S" || key === "FILING STATUS" ? "status" : key === "S O" || key === "SUBHOLDING OF" ? "account" : key === "D" || key === "DESCRIPTION" ? "description" : key === "L" || key === "LOCATION" ? "location" : "comments";
      val[current] = clean(`${val[current] ?? ""} ${m[2]!}`);
      labels++;
    } else if (current) val[current] = clean(`${val[current] ?? ""} ${line}`);
    else head.push(line);
  }
  const asset = clean(head.join(" "));
  const tickers = [...asset.matchAll(TICKER)];
  const codes = [...asset.matchAll(CODE)];
  const ticker = tickers.length ? tickers[tickers.length - 1]![1]! : null;
  const code = codes.length ? codes[codes.length - 1]![1]! : null;
  let name = asset.replace(CODE, "");
  if (ticker) name = name.replace(new RegExp(`\\s*\\(${ticker.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\)`), "");
  name = clean(name).replace(/[\s\-–]+$/, "");
  return { name, ticker, code, status: val.status || null, account: val.account || null, description: val.description || null, labels };
}

const money = (s: string): number => Number(s.replace(/,/g, ""));

/** "$1,001 - $15,000" → 1001 / 15000; "Over $50,000,000" → 50000000 / null; anything else → `null`. */
export function parseAmount(text: string): { low: number | null; high: number | null } | null {
  const t = clean(text);
  const range = /^\$([\d,]+)\s*-\s*\$([\d,]+)$/.exec(t);
  if (range) return { low: money(range[1]!), high: money(range[2]!) };
  const over = /^Over\s+\$([\d,]+)$/i.exec(t);
  if (over) return { low: money(over[1]!), high: null };
  const single = /^\$([\d,]+)$/.exec(t);
  if (single) return { low: money(single[1]!), high: money(single[1]!) };
  return null;
}

/**
 * The option contract a description names. The descriptions are free text the member types: "Purchased 100 call options with a
 * strike price of $100 and an expiration date of 6/17/27.", "Call options; Strike price $325; Expires 06/18/2026", "Put Option",
 * "10 puts at $11.80". Only what is stated with its word is taken (a price after "at" is NOT assumed to be the strike); what is
 * not stated stays `null` and the row shows the description as printed.
 */
export function parseOption(description: string | null, assetCode: string | null): CongressOption | null {
  const d = description ?? "";
  // on an option row ([OP]) "calls" / "puts" are enough; elsewhere only "call option(s)" / "put option(s)" counts ("capital call" is a fund term)
  const kind = assetCode === "OP" ? /\b(calls?|puts?)\b/i.exec(d) : /\b(call|put)s?\s+options?\b/i.exec(d);
  if (!kind && assetCode !== "OP") return null;
  const contracts = /\b([\d,]+)\s+(?:calls?|puts?)\b/i.exec(d);
  const strike = /\bstrike(?:\s+price)?(?:\s+of)?\s*:?\s*\$\s*([\d,]+(?:\.\d+)?)/i.exec(d);
  const expiry = /\b(?:expiration(?:\s+date)?|expires?|expiring)(?:\s+(?:of|on))?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(d);
  return {
    contracts: contracts ? Number(contracts[1]!.replace(/,/g, "")) : null,
    kind: kind ? (kind[1]!.toLowerCase().replace(/s$/, "") as "call" | "put") : null,
    strike: strike ? Number(strike[1]!.replace(/,/g, "")) : null,
    expires: expiry ? isoOfMdy(expiry[1]!) : null,
    exercised: /^\s*exercised\b/i.test(d),
  };
}

const rawOf = (c: Cells): string => clean([c.owner.join(" "), c.asset.join(" "), c.type.join(" "), c.date.join(" "), c.notified.join(" "), c.amount.join(" ")].join(" | ")).slice(0, 200);

function readRow(c: Cells): CongressRow {
  const bad = (reason: string): CongressRow => ({ ok: false, reason, raw: rawOf(c) });
  const ownerText = clean(c.owner.join(" "));
  const owner = OWNER[ownerText];
  if (owner === undefined) return bad(`Eigentümer-Kürzel „${ownerText.slice(0, 12)}“ unbekannt.`);
  const typeText = clean(c.type.join(" "));
  const side = SIDE[typeText];
  if (!side) return bad(typeText ? `Geschäftsart „${typeText.slice(0, 16)}“ unbekannt.` : "Geschäftsart fehlt.");
  const tradeDate = isoOfMdy(c.date.join(" "));
  if (!tradeDate) return bad("Handelsdatum nicht lesbar.");
  const amountText = clean(c.amount.join(" "));
  if (!/\$\s*\d/.test(amountText)) return bad("Betragsspanne fehlt.");
  const amount = parseAmount(amountText);
  const a = readAsset(c.asset);
  if (!a.name && !a.ticker) return bad("Wertpapier nicht lesbar.");
  const option = parseOption(a.description, a.code);
  const shares = /(?:purchased|sold|bought|exchanged)\s+([\d,]+)\s+shares/i.exec(a.description ?? "");
  return {
    ok: true,
    owner,
    asset: a.name,
    ticker: a.ticker,
    assetCode: a.code,
    side,
    tradeDate,
    notifiedDate: isoOfMdy(c.notified.join(" ")),
    amountText,
    amountLow: amount?.low ?? null,
    amountHigh: amount ? amount.high : null,
    option,
    shares: shares ? Number(shares[1]!.replace(/,/g, "")) : null,
    description: a.description,
    account: a.account,
  };
}

/* ------------------------------------------------------------------------------------------------ the report */

function lineAfter(items: readonly TextItem[], label: RegExp): string | null {
  const l = items.find((i) => label.test(i.text.trim()));
  if (!l) return null;
  const text = clean(
    items
      .filter((i) => Math.abs(i.y - l.y) < SAME_LINE && i.x > l.x + 1)
      .sort((a, b) => a.x - b.x)
      .map((i) => i.text)
      .join(""),
  );
  return text || null;
}

function unreadable(problem: ReportProblem, message: string, head: Partial<ParsedPtr> = {}): ParsedPtr {
  return { filingId: null, filer: null, signed: null, ...head, rows: [], problem, message };
}

/** Rows of a PTR. Never throws for what it does not understand: such a report is `problem` + a sentence. */
export function parsePtr(pages: readonly PageText[]): ParsedPtr {
  if (!pages.length) return unreadable("format", "Die Datei enthält keine Seiten.");
  const all = pages.flatMap((p) => p.items);
  if (!all.some((i) => i.text.trim().length > 0)) return unreadable("scan", "Die Meldung ist ein eingescanntes Papierformular (ein Bild ohne Text) und lässt sich nicht automatisch lesen.");
  const fid = /Filing ID #\s*(\d+)/.exec(all.map((i) => i.text).join(" "));
  const filer = lineAfter(pages[0]!.items, /^Name:$/);
  const signedLine = lineAfter(pages[pages.length - 1]!.items, /^Digitally Signed:$/) ?? lineAfter(all, /^Digitally Signed:$/);
  const signed = signedLine ? isoOfMdy(/(\d{1,2}\/\d{1,2}\/\d{4})\s*$/.exec(signedLine)?.[1] ?? null) : null;
  const head = { filingId: fid ? fid[1]! : null, filer, signed };

  const rows: CongressRow[] = [];
  const cellsOfRows: Cells[] = [];
  let sawTable = false;
  let leftover = 0;
  for (const page of pages) {
    const lay = layoutOf(page.items);
    if (!lay) continue;
    sawTable = true;
    const b = blocksOf(page.items, lay);
    const lead = b.lead;
    const hasLead = COLS.some((c) => lead[c].length > 0 && c !== "id" && c !== "gains");
    if (hasLead) {
      const prev = cellsOfRows[cellsOfRows.length - 1];
      if (prev) for (const c of COLS) prev[c] = [...prev[c], ...lead[c]];
      else leftover++;
    }
    for (const r of b.rows) cellsOfRows.push(r.cells);
  }
  if (!sawTable) return unreadable("format", "Die Tabelle der Geschäfte wurde nicht gefunden – der Aufbau des Formulars hat sich vermutlich geändert.", head);
  if (leftover) return unreadable("format", "Auf einer Seite stehen Zeilen ohne Anfang – der Aufbau des Formulars hat sich vermutlich geändert.", head);

  let labelled = 0;
  for (const c of cellsOfRows) {
    labelled += c.asset.some((l) => /^(F S|FILING STATUS)\s*:/i.test(l)) ? 1 : 0;
    rows.push(readRow(c));
  }
  // a form with one status label per transaction: when the counts differ, the blocks were not told apart correctly
  if (cellsOfRows.length !== labelled) return unreadable("format", `Zeilen und „Filing Status“-Angaben passen nicht zusammen (${cellsOfRows.length} zu ${labelled}) – die Meldung wird nicht geraten.`, head);
  return { ...head, rows };
}

/**
 * Raw records → typed, checked records (PURE): numbers and times cleaned, the sign of coloured results read, the side
 * decided, the numbers cross-checked (`plausibility.ts`), derived fees marked as derived, and every record judged
 * COMPLETE or not. A card that the screenshot cuts off is reported as incomplete – its missing fields are never
 * guessed, and it never becomes a trade.
 */
import type { Side } from "@/domain/types";
import { detectNumberStyle, parseShotNumber, type NumberStyle } from "@/journal/extract/numbers";
import type { RawCell, RawRecord, ParsedPage } from "./layout";
import { checkRecord, leverageFromRoi, type Plausibility, type PlauField } from "./plausibility";
import { cleanNumberText, cleanTimeText, hasSign, isFullTime } from "./text";
import type { Box } from "./types";
import { baseAsset, parseLeverageToken, type FieldId, type ViewId } from "./vocab";

/** A value of a record: the text as the screenshot shows it (cleaned), how sure we are, and why not. */
export interface RField {
  text: string;
  /** 0–1 */
  conf: number;
  value: number | null;
  /** Where the text sits in the picture (the row crop / the doubtful cell). */
  box: Box;
  /** What was assumed or doubtful (German, shown on the field). */
  notes: string[];
  /** The value does not come from a reading of this field (sign from colour, fees from the difference …). */
  derived?: boolean;
}

export type NumField = "entry" | "exit" | "qty" | "price" | "orderPrice" | "fee" | "funding" | "pnl" | "roi";
export type TimeField = "openTime" | "closeTime" | "time";

export interface ReadRecord {
  id: string;
  page: number;
  layout: "cards" | "table";
  view: ViewId;
  box: Box;
  kind: "position" | "order";
  status: "closed" | "open" | "cancelled" | "filled" | "partial" | null;
  symbol: RField;
  side: { value: Side | null; conf: number; notes: string[]; derived?: boolean; text: string };
  /** „Long schließen“ of an order. */
  action: { action: "open" | "close"; side: Side; label: string } | null;
  nums: Partial<Record<NumField, RField>>;
  times: Partial<Record<TimeField, RField>>;
  leverage: RField | null;
  marginMode: "isolated" | "cross" | null;
  /** Unit of the result („USDT“). */
  currency: string | null;
  /** Fees (incl. funding) derived from prices, quantity and result – DERIVED, not read. */
  derivedFees: number | null;
  maxQty: number | null;
  plausibility: Plausibility;
  /** Required fields that are not there (German names). */
  missing: string[];
  notes: string[];
}

export interface IncompleteCard {
  page: number;
  box: Box;
  /** What could be read of it (German, for the message). */
  known: string[];
  missing: string[];
  /** Cut off at the edge of the picture (otherwise: a row could not be read). */
  cut: boolean;
  text: string;
  /** Symbol / side / leverage / result texts, to recognise the same card in another picture. */
  signature: { symbol: string | null; side: Side | null; leverage: number | null; pnl: number | null; entry: number | null };
}

export interface PageRecords {
  page: number;
  view: ViewId;
  viewLabel: string;
  viewHow: ParsedPage["viewHow"];
  exchange: { id: string; name: string } | null;
  layout: ParsedPage["layout"];
  /** The decimal style of the numbers on the page („81,214.3“ → point). */
  style: NumberStyle | null;
  records: ReadRecord[];
  incomplete: IncompleteCard[];
  notes: string[];
}

const LABEL_DE: Partial<Record<FieldId, string>> = {
  symbol: "Symbol",
  side: "Richtung",
  entry: "Einstiegspreis",
  exit: "Schlusspreis",
  qty: "Menge",
  price: "Preis",
  orderPrice: "Auftragspreis",
  pnl: "Ergebnis (PnL)",
  openTime: "Zeit geöffnet",
  closeTime: "Zeit geschlossen",
  time: "Zeit",
};

const conf01 = (c: number): number => Math.max(0, Math.min(1, c / 100));

function numField(cell: RawCell, style: NumberStyle | null, opts: { negativeByInk?: boolean } = {}): RField {
  const cleaned = cleanNumberText(cell.text);
  let text = cleaned.text;
  const notes: string[] = [];
  let conf = conf01(cell.conf);
  let derived = false;
  if (cleaned.repaired) {
    conf = Math.min(conf, 0.75);
    notes.push(`„${cell.text}“: Buchstaben als Ziffern gelesen`);
  }
  if (cell.reread && cell.reread.agree < 2 && cell.reread.of > 1) {
    conf = Math.min(conf, 0.6);
    notes.push("die Lesungen widersprechen sich");
  }
  // the minus sign is thin: the colour tells (exchanges paint losses red) – a marked assumption
  if (opts.negativeByInk && cell.ink === "red" && text && !hasSign(text)) {
    text = `-${text}`;
    conf = Math.min(conf, 0.65);
    derived = true;
    notes.push("Minus aus der roten Farbe ergänzt – nicht gelesen");
  }
  const p = parseShotNumber(text, style);
  if (!p) return { text, conf: 0, value: null, box: cell.box, notes: [...notes, `„${cell.text}“ ist keine lesbare Zahl`] };
  if (p.ambiguous) {
    conf = Math.min(conf, 0.6);
    notes.push(`Zahlenformat unklar: „${text}“ könnte auch ${String(p.alt).replace(".", ",")} heißen`);
  }
  return { text, conf, value: p.value, box: cell.box, notes, ...(derived ? { derived } : {}) };
}

function timeField(cell: RawCell): RField {
  const cleaned = cleanTimeText(cell.text);
  const notes: string[] = [];
  let conf = conf01(cell.conf);
  if (cleaned.repaired) {
    conf = Math.min(conf, 0.8);
    notes.push("Trennzeichen der Uhrzeit korrigiert");
  }
  if (!isFullTime(cleaned.text)) {
    conf = Math.min(conf, 0.55);
    notes.push(`„${cleaned.text}“ ist kein vollständiges Datum mit Uhrzeit`);
  }
  if (cell.reread && cell.reread.agree < 2 && cell.reread.of > 1) conf = Math.min(conf, 0.6);
  return { text: cleaned.text, conf, value: null, box: cell.box, notes };
}

const NUM_FIELDS: readonly NumField[] = ["entry", "exit", "qty", "price", "orderPrice", "fee", "funding", "pnl", "roi"];
const TIME_FIELDS: readonly TimeField[] = ["openTime", "closeTime", "time"];

const cut = (t: string, n = 28): string => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function readOne(raw: RawRecord, i: number, view: ViewId, style: NumberStyle | null): ReadRecord {
  const nums: ReadRecord["nums"] = {};
  const times: ReadRecord["times"] = {};
  const notes = [...raw.notes];
  for (const f of NUM_FIELDS) {
    const c = raw.fields[f];
    if (c) nums[f] = numField(c, style, { negativeByInk: f === "pnl" || f === "roi" || f === "funding" });
  }
  for (const f of TIME_FIELDS) {
    const c = raw.fields[f];
    if (c) times[f] = timeField(c);
  }
  // the ROI has the sign of the result: a lost minus is restored from the result's, as a marked assumption
  const pnl = nums.pnl;
  const roi = nums.roi;
  if (roi && roi.value != null && pnl && pnl.value != null && pnl.value < 0 && roi.value > 0 && !hasSign(roi.text)) {
    roi.value = -roi.value;
    roi.text = `-${roi.text}`;
    roi.conf = Math.min(roi.conf, 0.65);
    roi.derived = true;
    roi.notes.push("Minus vom Ergebnis übernommen – nicht gelesen");
  }
  const kind: ReadRecord["kind"] = nums.entry || nums.exit || times.openTime || times.closeTime || raw.fields.maxQty || view === "positions" ? "position" : "order";

  let leverage: RField | null = null;
  if (raw.leverage) {
    const tok = parseLeverageToken(raw.leverage.cell.text) ?? { value: raw.leverage.value, repaired: raw.leverage.repaired };
    const notesL: string[] = [];
    let conf = conf01(raw.leverage.cell.conf);
    const confirmedByReread = (raw.leverage.cell.reread?.agree ?? 0) >= 2;
    if (tok.repaired && !confirmedByReread) {
      conf = Math.min(conf, 0.6);
      notesL.push(`„${raw.leverage.cell.text}“ als ${tok.value}× gelesen`);
    }
    leverage = { text: `${tok.value}x`, conf: confirmedByReread ? Math.max(conf, 0.85) : conf, value: tok.value, box: raw.leverage.cell.box, notes: notesL };
  }

  // the position's side
  let side: ReadRecord["side"] = { value: null, conf: 0, notes: [], text: "" };
  if (raw.action) side = { value: raw.action.side, conf: Math.max(0.9, conf01(raw.action.cell.conf)), notes: [], text: raw.action.cell.text };
  else if (raw.side && (raw.side.word === "long" || raw.side.word === "short")) side = { value: raw.side.word, conf: conf01(raw.side.cell.conf), notes: [], text: raw.side.cell.text };
  else if (raw.side) {
    // Kauf / Verkauf names the ORDER's direction, not the position's: only a hint
    const guess: Side = raw.side.word === "buy" ? "long" : "short";
    side = { value: guess, conf: 0.5, notes: [`„${raw.side.cell.text}“ ist die Richtung der Order, nicht der Position – Long/Short prüfen`], derived: true, text: raw.side.cell.text };
  }
  if (raw.side && side.value && (raw.side.word === "long" || raw.side.word === "short") && raw.side.cell.ink && (raw.side.cell.ink === "green" || raw.side.cell.ink === "red")) {
    // exchanges paint Long green and Short red; the word wins, a different colour is only noted
    const colourSide: Side = raw.side.cell.ink === "green" ? "long" : "short";
    if (colourSide !== side.value) side.notes.push("Die Farbe des Wortes passt nicht zur Richtung (Farbe sagt nichts über die Position) – Wort gilt");
  }

  let plausibility = checkRecord({
    side: side.value,
    entry: nums.entry?.value ?? null,
    exit: nums.exit?.value ?? null,
    qty: nums.qty?.value ?? null,
    pnl: nums.pnl?.value ?? null,
    roi: nums.roi?.value ?? null,
    leverage: leverage?.value ?? null,
    fee: nums.fee?.value ?? null,
  });
  // a side that is unknown: the numbers may point at one (an offer – marked derived, not sure)
  if (!side.value) {
    const hint = plausibility.flags.find((f) => f.code === "side_hint");
    if (hint && nums.entry?.value != null && nums.exit?.value != null && nums.pnl?.value != null) {
      const s: Side = (nums.exit.value! - nums.entry.value!) * nums.pnl.value! > 0 ? "long" : "short";
      side = { value: s, conf: 0.5, notes: ["Richtung aus Preisen und Ergebnis abgeleitet – nicht gelesen"], derived: true, text: "" };
      plausibility = checkRecord({ side: s, entry: nums.entry.value, exit: nums.exit.value, qty: nums.qty?.value ?? null, pnl: nums.pnl.value, roi: nums.roi?.value ?? null, leverage: leverage?.value ?? null, fee: null });
    }
  }
  // the leverage the ROI proves confirms an uncertain reading
  const proven = leverageFromRoi(plausibility);
  if (leverage && proven != null && proven === leverage.value && leverage.conf < 0.85) {
    leverage.conf = 0.9;
    leverage.notes = [`durch ROI bestätigt (${proven}×)`];
  }
  // fields that do not fit together are doubtful – the preview marks them
  const fieldOf = (f: PlauField): RField | null => (f === "leverage" ? leverage : f === "entry" || f === "exit" || f === "qty" || f === "pnl" || f === "roi" ? (nums[f] ?? null) : null);
  for (const flag of plausibility.flags) {
    if (flag.code === "side_hint" && !flag.fields.includes("entry")) continue;
    for (const f of flag.fields) {
      const x = fieldOf(f);
      if (x) {
        x.conf = Math.min(x.conf, 0.65);
        if (!x.notes.includes(flag.text)) x.notes.push(flag.text);
      }
    }
    if (flag.fields.includes("side") && flag.code === "side_hint" && flag.fields.includes("entry")) {
      side.conf = Math.min(side.conf, 0.65);
      side.notes.push(flag.text);
    }
  }

  const symbol: RField = { text: raw.symbol.text, conf: conf01(raw.symbol.conf), value: null, box: raw.symbol.box, notes: raw.notes.filter((n) => /Symbol/.test(n)) };
  if (symbol.notes.length) symbol.conf = Math.min(symbol.conf, 0.65);
  const unit = raw.fields.pnl?.unit ?? raw.fields.exit?.unit ?? raw.fields.price?.unit ?? null;
  const qtyUnit = raw.fields.qty?.unit ?? null;
  if (qtyUnit && baseAsset(symbol.text) && qtyUnit !== baseAsset(symbol.text) && qtyUnit !== "USDT" && nums.qty) {
    nums.qty.conf = Math.min(nums.qty.conf, 0.65);
    nums.qty.notes.push(`Einheit ${qtyUnit} passt nicht zu ${baseAsset(symbol.text)}`);
  }
  const maxQty = raw.fields.maxQty ? numField(raw.fields.maxQty, style).value : null;

  return {
    id: `p${raw.page}r${i}`,
    page: raw.page,
    layout: raw.layout,
    view,
    box: raw.box,
    kind,
    status: raw.status?.word ?? null,
    symbol,
    side,
    action: raw.action ? { action: raw.action.action, side: raw.action.side, label: raw.action.cell.text } : null,
    nums,
    times,
    leverage,
    marginMode: raw.marginMode?.word ?? null,
    currency: unit,
    derivedFees: nums.fee ? null : plausibility.derivedFees,
    maxQty,
    plausibility,
    missing: [],
    notes,
  };
}

/** Required fields of a record, as field ids. */
function requiredOf(r: ReadRecord): FieldId[] {
  if (r.kind === "position") {
    const need: FieldId[] = ["symbol", "side", "entry", "qty"];
    if (r.status !== "open") need.push("exit");
    return need;
  }
  return ["symbol", "side", r.nums.price ? "price" : "orderPrice", "qty"];
}

function presentIds(r: ReadRecord): Set<FieldId> {
  const s = new Set<FieldId>();
  if (r.symbol.text) s.add("symbol");
  if (r.side.value) s.add("side");
  for (const k of Object.keys(r.nums) as NumField[]) if (r.nums[k]?.value != null) s.add(k);
  for (const k of Object.keys(r.times) as TimeField[]) s.add(k);
  if (r.leverage) s.add("leverage");
  return s;
}

const SEEN_FIELDS: readonly FieldId[] = ["entry", "exit", "qty", "pnl", "openTime", "closeTime", "time", "fee", "price", "orderPrice"];

/** Typed records of a parsed page; incomplete cards are split off. */
export function finalizePage(parsed: ParsedPage): PageRecords {
  const raws = parsed.records;
  const allTexts: string[] = [];
  for (const r of raws) for (const c of Object.values(r.fields)) if (c && /\d/.test(c.text) && !/\d{1,2}:\d{2}/.test(c.text)) allTexts.push(cleanNumberText(c.text).text);
  const style = detectNumberStyle(allTexts);
  const read = raws.map((r, i) => readOne(r, i, parsed.view, style));

  // fields most cards of the page show: a card that lacks one of them as the LAST one is cut off
  const rich = read.filter((r) => presentIds(r).size >= 4);
  const expected = new Set<FieldId>();
  for (const f of SEEN_FIELDS) if (rich.length && rich.filter((r) => presentIds(r).has(f)).length >= Math.ceil(rich.length / 2)) expected.add(f);

  const records: ReadRecord[] = [];
  const incomplete: IncompleteCard[] = [];
  read.forEach((r, i) => {
    const have = presentIds(r);
    const core = requiredOf(r);
    const last = i === read.length - 1;
    const lackCore = core.filter((f) => !have.has(f));
    const lackTime = r.kind === "position" && !have.has("openTime") && !have.has("closeTime") && !have.has("time");
    const lackExpected = last ? [...expected].filter((f) => !have.has(f) && f !== "time" && !(f === "fee" && r.derivedFees != null)) : [];
    const missingIds = [...new Set<FieldId>([...lackCore, ...(lackTime ? (["openTime"] as FieldId[]) : []), ...lackExpected])];
    r.missing = missingIds.map((f) => LABEL_DE[f] ?? f);
    const cutOff = last && missingIds.length > 0;
    if (cutOff) {
      const known = [r.symbol.text, r.side.value ? (r.side.value === "long" ? "Long" : "Short") : null, r.leverage ? `${r.leverage.value}×` : null, r.nums.pnl ? `Ergebnis ${r.nums.pnl.text}` : null].filter((x): x is string => !!x);
      incomplete.push({
        page: r.page,
        box: r.box,
        known,
        missing: r.missing,
        cut: true,
        text: `${cut(known.join(" · "), 60)} – unvollständig: der Screenshot ist hier abgeschnitten (es fehlen ${r.missing.join(", ")}). Bitte den nächsten Ausschnitt mit hochladen.`,
        signature: { symbol: r.symbol.text || null, side: r.side.value, leverage: r.leverage?.value ?? null, pnl: r.nums.pnl?.value ?? null, entry: r.nums.entry?.value ?? null },
      });
      return;
    }
    records.push(r);
  });

  // label rows above the first symbol: the lower part of a card cut at the TOP of the picture
  for (const o of parsed.orphans) {
    const rows = Object.keys(o.fields).map((k) => LABEL_DE[k as FieldId] ?? k);
    incomplete.push({
      page: parsed.page,
      box: o.box,
      known: rows,
      missing: ["Symbol", "Richtung"],
      cut: true,
      text: `Oben ist eine Karte angeschnitten (Symbol nicht sichtbar, ${rows.length} Zeilen) – unvollständig. Bitte den vorherigen Ausschnitt mit hochladen.`,
      signature: { symbol: null, side: null, leverage: null, pnl: null, entry: null },
    });
  }
  return { page: parsed.page, view: parsed.view, viewLabel: parsed.viewLabel, viewHow: parsed.viewHow, exchange: parsed.exchange, layout: parsed.layout, style, records, incomplete, notes: parsed.notes };
}

/** An incomplete card that another picture shows complete (same symbol, side, leverage and result) is not reported. */
export function dropCoveredIncomplete(pages: readonly PageRecords[]): PageRecords[] {
  const all = pages.flatMap((p) => p.records);
  const same = (a: IncompleteCard["signature"], r: ReadRecord): boolean =>
    !!a.symbol && a.symbol === r.symbol.text && (!a.side || a.side === r.side.value) && (a.leverage == null || a.leverage === r.leverage?.value) && a.pnl != null && r.nums.pnl?.value != null && Math.abs(a.pnl - r.nums.pnl.value) < 1e-9;
  return pages.map((p) => ({ ...p, incomplete: p.incomplete.filter((c) => !all.some((r) => r.page !== p.page && same(c.signature, r))) }));
}

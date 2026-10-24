/**
 * Layout-aware reader of one recognised picture (PURE: words with boxes in, records out).
 *
 * Two layouts of exchange histories are read with the same vocabulary (`vocab.ts`):
 *   - CARDS (phones): per position / order one card – a head (symbol, status, side, margin mode, leverage) and rows with
 *     the LABEL at the left and the VALUE at the right edge; some apps print the labels above their values in a grid;
 *   - TABLES (desktop): a header row names the columns, every following row is one record (a cell may wrap onto a
 *     second line: date above time).
 * A record is anchored at its SYMBOL (`BTCUSDT`, `ETH-USDT`, `BTC/USDT`, `BTC-PERP` …), so status bar, filter chips,
 * tab bars, ads and the system navigation bar never become part of a trade. What no known label names is not
 * guessed – it stays out of the record.
 */
import { parseOrderLabel } from "@/journal/extract/orders";
import { boxCx, boxCy, boxH, buildLines, unionBox, type Line, type Seg } from "./lines";
import type { Box, InkColor, OcrPage } from "./types";
import {
  CLOCK_RE,
  DATE_RE,
  EXCHANGE_BRANDS,
  fold,
  isDateTimeLike,
  isNumberLike,
  isSymbol,
  matchLabel,
  matchTab,
  parseLeverageToken,
  parseMarginWord,
  parseSideWord,
  parseStatusWord,
  VIEW_LABEL,
  type FieldId,
  type MarginWord,
  type SideWord,
  type ViewId,
} from "./vocab";

/** One value of a record as the page shows it. */
export interface RawCell {
  /** The text as read (joined, trimmed). */
  text: string;
  /** Lowest word confidence in the cell, 0–100. */
  conf: number;
  box: Box;
  ink?: InkColor;
  lum?: number;
  /** The label the value was found under („Einstiegspreis“). */
  label?: string;
  /** Unit in the label („(BTC)“). */
  unit?: string | null;
  /** Set by the second reading (`refine.ts`): how many of the readings agreed on the final text. */
  reread?: { agree: number; of: number; before: string };
  /** The label was NOT read: the row was assigned by its place in the other cards (a marked assumption). */
  inferred?: boolean;
}

export interface RawRecord {
  page: number;
  layout: "cards" | "table";
  /** The card / row: from the symbol to the last row of the record. */
  box: Box;
  symbol: RawCell;
  fields: Partial<Record<FieldId, RawCell>>;
  /** Side as a word of the card head / the side column (Long, Short, Buy, Sell …). */
  side?: { word: SideWord; cell: RawCell };
  /** „Long schließen“, „Open Short“: what an order does to which position. */
  action?: { action: "open" | "close"; side: "long" | "short"; cell: RawCell };
  marginMode?: { word: MarginWord; cell: RawCell };
  leverage?: { value: number; repaired: boolean; cell: RawCell };
  status?: { word: NonNullable<ReturnType<typeof parseStatusWord>>; cell: RawCell };
  /** Values on a line of their own whose label was not read; `inferLabels` places them by the other cards. */
  unlabeled?: RawCell[];
  /** Label rows whose value the engine skipped; `refine.ts` reads the place right of the label again. */
  empty?: { field: FieldId; label: string; unit: string | null; box: Box; labelBox: Box; /** Where the value must be (table gaps); else right of the label. */ region?: Box }[];
  notes: string[];
}

/** Label rows above the first symbol (a card cut at the top) or labels without any symbol. */
export interface Orphan {
  where: "top" | "bottom";
  fields: Partial<Record<FieldId, RawCell>>;
  box: Box;
}

export interface ParsedPage {
  page: number;
  width: number;
  height: number;
  /** Which history the active tab names. */
  view: ViewId;
  viewLabel: string;
  /** How the view was decided: the highlighted tab, the only tab, or not at all. */
  viewHow: "active-tab" | "only-tab" | "none";
  /** Exchange whose brand word is on the page (never guessed from the layout). */
  exchange: { id: string; name: string } | null;
  layout: "cards" | "table" | "none";
  /** The header row of a table (where the column names stand). */
  header?: Box;
  records: RawRecord[];
  orphans: Orphan[];
  lines: Line[];
  notes: string[];
}

const cellOf = (s: Seg, extra: Partial<RawCell> = {}): RawCell => ({
  text: s.text.trim(),
  conf: s.conf,
  box: s.box,
  ...(s.ink ? { ink: s.ink } : {}),
  ...(s.lum != null ? { lum: s.lum } : {}),
  ...extra,
});

/* ------------------------------------------------------------------ tabs / exchange */

function findView(lines: readonly Line[]): { view: ViewId; how: ParsedPage["viewHow"] } {
  for (const l of lines) {
    const tabs = l.segs.map((s) => ({ s, view: matchTab(s.text) })).filter((t): t is { s: Seg; view: ViewId } => t.view != null);
    if (tabs.length >= 2) {
      const sorted = [...tabs].sort((a, b) => (b.s.lum ?? 0) - (a.s.lum ?? 0));
      const top = sorted[0]!;
      const second = sorted[1]!;
      if ((top.s.lum ?? 0) - (second.s.lum ?? 0) >= 30) return { view: top.view, how: "active-tab" };
      return { view: "unknown", how: "none" };
    }
  }
  // one title only (a desktop page head: „Position History“)
  for (const l of lines.slice(0, 40)) {
    for (const s of l.segs) {
      const v = matchTab(s.text);
      if (v) return { view: v, how: "only-tab" };
    }
  }
  return { view: "unknown", how: "none" };
}

function findExchange(lines: readonly Line[]): ParsedPage["exchange"] {
  for (const l of lines)
    for (const w of l.words) {
      const f = fold(w.text);
      for (const e of EXCHANGE_BRANDS) if (e.words.includes(f)) return { id: e.id, name: e.name };
    }
  return null;
}

/* ------------------------------------------------------------------ symbols */

const SYMBOL_QUOTES = ["USDT", "USDC", "BUSD", "USD"];

/** A symbol word, also when the engine slipped inside the quote asset („BTCUSOT“, „ETHU5DT“): the repair is reported. */
export function symbolOf(text: string): { text: string; repaired: boolean } | null {
  const t = text.trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.]+$/g, "");
  if (isSymbol(t)) return { text: t, repaired: false };
  const up = t.toUpperCase();
  // exchanges print symbols in capitals; a mixed-case word („Verlust)“) is a word, not a symbol with a slip
  if (t !== up) return null;
  for (const q of SYMBOL_QUOTES) {
    if (up.length < q.length + 2 || up.length > 20) continue;
    const head = up.slice(0, -q.length);
    const tail = up.slice(-q.length);
    let d = 0;
    for (let i = 0; i < q.length; i++) if (q[i] !== tail[i]) d += 1;
    if (d === 1 && /^[A-Z0-9]{2,14}$/.test(head) && /[A-Z]{2}/.test(head) && /^[A-Z0-9]+$/.test(up)) return { text: head + q, repaired: true };
  }
  return null;
}

function symbolSeg(line: Line): { seg: Seg; text: string; repaired: boolean } | null {
  for (const s of line.segs) {
    for (const w of s.words) {
      const sym = symbolOf(w.text);
      if (sym) return { seg: { ...s, text: sym.text, box: w.box, conf: w.conf, words: [w] }, text: sym.text, repaired: sym.repaired };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ label / value rows */

/** The label a run of leading cells names: tries 1–3 cells, the longest good match wins. */
function labelOf(segs: readonly Seg[]): { field: FieldId; unit: string | null; used: number; text: string } | null {
  let best: { field: FieldId; unit: string | null; used: number; text: string; score: number } | null = null;
  for (let k = 1; k <= Math.min(3, segs.length - 0); k++) {
    const text = segs
      .slice(0, k)
      .map((s) => s.text)
      .join(" ");
    const m = matchLabel(text);
    if (m && (!best || m.score >= best.score - 0.02) && (!best || k > best.used || m.score > best.score)) best = { field: m.field, unit: m.unit, used: k, text, score: m.score };
  }
  return best && best.score >= 0.8 ? best : null;
}

const looksLikeValue = (t: string): boolean => (isNumberLike(t) && !/^[A-Za-z]/.test(t.trim())) || isDateTimeLike(t);

/** A cell whose trailing words are icon junk („-4.03 % [4“): the words are dropped until the rest is a value. */
function trimToValue(s: Seg): Seg | null {
  if (looksLikeValue(s.text)) return s;
  let words = s.words;
  while (words.length > 1) {
    words = words.slice(0, -1);
    const text = words.map((w) => w.text).join(" ");
    if (looksLikeValue(text))
      return { ...s, text, conf: Math.min(...words.map((w) => w.conf)), box: unionBox(words.map((w) => w.box)), words };
  }
  return null;
}

/** The value cell after a label: the first number / time cell; a date cell and its clock cell are joined. */
function valueAfter(segs: readonly Seg[], from: number): Seg | null {
  for (let i = from; i < segs.length; i++) {
    const s = trimToValue(segs[i]!);
    if (!s) continue;
    const next = segs[i + 1];
    if (next && DATE_RE.test(s.text.trim()) && CLOCK_RE.test(next.text.trim()))
      return { ...s, text: `${s.text} ${next.text}`, conf: Math.min(s.conf, next.conf), box: unionBox([s.box, next.box]), words: [...s.words, ...next.words] };
    return s;
  }
  return null;
}

interface RowRead {
  field: FieldId;
  cell: RawCell;
}

/** `Label … Value` on one line. */
function readRow(line: Line): RowRead | null {
  const lab = labelOf(line.segs);
  if (!lab) return null;
  const value = valueAfter(line.segs, lab.used);
  if (!value) return null;
  return { field: lab.field, cell: cellOf(value, { label: lab.text, unit: lab.unit }) };
}

/** Which of `labels` (x-sorted) a value cell stands under: the closest by left edge, right edge or centre. */
function nearestIndex(value: Box, labels: readonly Box[]): number {
  let best = -1;
  let bestD = Infinity;
  labels.forEach((l, i) => {
    const d = Math.min(Math.abs(boxCx(value) - boxCx(l)), Math.abs(value.x0 - l.x0), Math.abs(value.x1 - l.x1));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/* ------------------------------------------------------------------ cards */

interface Anchor {
  line: Line;
  seg: Seg;
  text: string;
  repaired: boolean;
}

function readHead(lines: readonly Line[], symbolSegment: Seg, rec: RawRecord): void {
  for (const l of lines) {
    for (const s of l.segs) {
      const act = parseOrderLabel(s.text);
      if (act && !rec.action) rec.action = { ...act, cell: cellOf(s) };
      for (const w of s.words) {
        if (symbolSegment.words.includes(w)) continue;
        const cell: RawCell = { text: w.text, conf: w.conf, box: w.box, ...(w.ink ? { ink: w.ink } : {}), ...(w.lum != null ? { lum: w.lum } : {}) };
        const side = parseSideWord(w.text);
        if (side && !rec.side) rec.side = { word: side, cell };
        const mm = parseMarginWord(w.text);
        if (mm && !rec.marginMode) rec.marginMode = { word: mm, cell };
        const lev = parseLeverageToken(w.text);
        if (lev && !rec.leverage) rec.leverage = { ...lev, cell };
        const st = parseStatusWord(w.text);
        if (st && !rec.status) rec.status = { word: st, cell };
      }
    }
  }
}

/** Label cells above value cells („Qty  Entry Price  Exit Price“ over „0.5  81,000  81,500“) paired by their x position. */
function readGrid(labelLine: Line, valueLine: Line): RowRead[] {
  const labels: { seg: Seg; field: FieldId; unit: string | null; text: string }[] = [];
  for (const s of labelLine.segs) {
    const m = matchLabel(s.text);
    if (m && m.score >= 0.8 && !looksLikeValue(s.text)) labels.push({ seg: s, field: m.field, unit: m.unit, text: s.text });
  }
  if (labels.length < 2) return [];
  const out: RowRead[] = [];
  const taken = new Set<number>();
  for (const v of valueLine.segs) {
    if (!looksLikeValue(v.text)) continue;
    const i = nearestIndex(
      v.box,
      labels.map((l) => l.seg.box),
    );
    if (i < 0 || taken.has(i)) continue;
    taken.add(i);
    const l = labels[i]!;
    out.push({ field: l.field, cell: cellOf(v, { label: l.text, unit: l.unit }) });
  }
  return out;
}

/**
 * Cards of one list have the same rows in the same places. A value whose label the engine did not read (it stands alone on
 * its line) is assigned to the field the OTHER cards have at that place – only when the place is clear (the nearest row
 * is closer than a third of the row pitch and the field is missing in this card) – and is marked `inferred`.
 */
export function inferLabels(records: readonly RawRecord[]): void {
  if (records.length < 2) return;
  const offsets = new Map<FieldId, number[]>();
  for (const r of records)
    for (const [f, c] of Object.entries(r.fields) as [FieldId, RawCell][]) {
      if (c.inferred) continue;
      const list = offsets.get(f) ?? [];
      list.push(boxCy(c.box) - boxCy(r.symbol.box));
      offsets.set(f, list);
    }
  const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const table = [...offsets.entries()].filter(([, v]) => v.length >= Math.max(2, Math.ceil(records.length / 2))).map(([f, v]) => ({ f, dy: med(v) }));
  if (table.length < 3) return;
  const sorted = table.map((t) => t.dy).sort((a, b) => a - b);
  const pitch = med(sorted.slice(1).map((v, i) => v - sorted[i]!).filter((d) => d > 4));
  if (!Number.isFinite(pitch) || pitch <= 0) return;
  for (const r of records) {
    for (const cell of r.unlabeled ?? []) {
      const dy = boxCy(cell.box) - boxCy(r.symbol.box);
      const best = table.filter((t) => !r.fields[t.f]).sort((a, b) => Math.abs(a.dy - dy) - Math.abs(b.dy - dy))[0];
      if (!best || Math.abs(best.dy - dy) > pitch / 3) continue;
      r.fields[best.f] = { ...cell, inferred: true, label: "(Bezeichnung nicht gelesen)" };
      r.notes.push(`Eine Zeile ohne lesbare Bezeichnung wurde nach den anderen Karten als „${best.f}“ gedeutet.`);
    }
  }
}

function parseCards(lines: readonly Line[], page: OcrPage): { records: RawRecord[]; orphans: Orphan[] } {
  const anchors: Anchor[] = [];
  for (const l of lines) {
    const s = symbolSeg(l);
    if (s) anchors.push({ line: l, seg: s.seg, text: s.text, repaired: s.repaired });
  }
  const records: RawRecord[] = [];
  anchors.forEach((a, k) => {
    const end = anchors[k + 1]?.line.i ?? lines.length;
    const block = lines.slice(a.line.i, end);
    const rec: RawRecord = {
      page: page.index,
      layout: "cards",
      box: a.line.box,
      symbol: { text: a.text, conf: a.seg.conf, box: a.seg.box, ...(a.seg.ink ? { ink: a.seg.ink } : {}) },
      fields: {},
      notes: a.repaired ? [`Symbol „${a.seg.words[0]?.text ?? a.text}“ als ${a.text} gelesen.`] : [],
    };
    // the head: everything up to the first label row
    let headEnd = block.length;
    for (let i = 1; i < block.length; i++) {
      const row = readRow(block[i]!);
      if (row) {
        headEnd = i;
        break;
      }
      const lab = labelOf(block[i]!.segs);
      if (lab && block[i]!.segs.length <= 1 + (lab.used - 1)) {
        // a label alone on its line: the value stands below (checked in the loop that follows) – the head ends here too
        headEnd = i;
        break;
      }
    }
    readHead(block.slice(0, Math.max(1, headEnd)), a.seg, rec);
    // a value whose label the engine did not read stands alone on its line (a dashed underline under the label is enough)
    const loose = (line: Line): void => {
      // one cell alone, or a garbled label (no known field) followed by a value
      if (line.segs.length < 1 || (line.segs.length > 1 && labelOf(line.segs))) return;
      const v = trimToValue(line.segs[line.segs.length - 1]!);
      if (v && !parseLeverageToken(v.text) && /\d{2}/.test(v.text)) (rec.unlabeled ??= []).push(cellOf(v));
    };
    for (let i = 1; i < headEnd; i++) loose(block[i]!);
    for (let i = headEnd; i < block.length; i++) {
      const line = block[i]!;
      const row = readRow(line);
      if (row) {
        if (!rec.fields[row.field]) rec.fields[row.field] = row.cell;
        else rec.notes.push(`„${row.cell.label}“ steht mehrfach – der erste Wert gilt.`);
        continue;
      }
      if (!block[i + 1] || block[i + 1]!.cy - line.cy >= Math.max(line.h, block[i + 1]!.h) * 2.6 || !labelOf(line.segs)) loose(line);
      // labels above values (grid)
      const next = block[i + 1];
      if (next && next.cy - line.cy < Math.max(line.h, next.h) * 2.6) {
        const pairs = readGrid(line, next);
        if (pairs.length) {
          for (const p of pairs) if (!rec.fields[p.field]) rec.fields[p.field] = p.cell;
          i += 1;
          continue;
        }
        // one label alone, its value on the next line
        const lab = labelOf(line.segs);
        if (lab && line.segs.length === lab.used) {
          const v = valueAfter(next.segs, 0);
          if (v && !labelOf(next.segs)) {
            if (!rec.fields[lab.field]) rec.fields[lab.field] = cellOf(v, { label: lab.text, unit: lab.unit });
            i += 1;
            continue;
          }
        }
      }
      // a label with NO value on its line (the engine skipped it): the second reading looks for it to the right of the label
      const alone = labelOf(line.segs);
      if (alone && line.segs.length === alone.used && !rec.fields[alone.field]) (rec.empty ??= []).push({ field: alone.field, label: alone.text, unit: alone.unit, box: line.box, labelBox: unionBox(line.segs.map((s) => s.box)) });
    }
    // a time printed in the card's head („BTCUSDT … 2026-10-24 15:22:57“) when no row carries one
    if (!rec.fields.time && !rec.fields.openTime && !rec.fields.closeTime)
      for (const l of block.slice(0, Math.max(1, headEnd)))
        for (const s of l.segs) {
          const t = s.text.trim();
          if (s.words.includes(a.seg.words[0]!) || !/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[ T]\d{1,2}[:.]\d{2}/.test(t)) continue;
          rec.fields.time = cellOf(s, { label: "Zeit" });
        }
    const used = [a.line.box, ...Object.values(rec.fields).map((c) => c!.box)];
    rec.box = unionBox(used.concat(rec.side ? [rec.side.cell.box] : [], rec.status ? [rec.status.cell.box] : []));
    records.push(rec);
  });

  inferLabels(records);

  // label rows above the first symbol: the lower part of a card that is cut at the top of the picture
  const orphans: Orphan[] = [];
  const firstAnchor = anchors[0]?.line.i ?? lines.length;
  const topFields: Partial<Record<FieldId, RawCell>> = {};
  const boxes: Box[] = [];
  for (const l of lines.slice(0, firstAnchor)) {
    const row = readRow(l);
    if (row && !topFields[row.field]) {
      topFields[row.field] = row.cell;
      boxes.push(row.cell.box);
    }
  }
  if (Object.keys(topFields).length >= 2) orphans.push({ where: "top", fields: topFields, box: unionBox(boxes) });
  return { records, orphans };
}

/* ------------------------------------------------------------------ tables */

interface Column {
  field: FieldId;
  label: string;
  unit: string | null;
  box: Box;
}

/** A header line: ≥ 3 cells that name known fields and hardly any cell with a number. */
function headerOf(line: Line, next: Line | undefined): Column[] | null {
  const read = (segs: readonly { text: string; box: Box }[]): Column[] => {
    const cols: Column[] = [];
    for (const s of segs) {
      if (looksLikeValue(s.text) || symbolOf(s.text)) continue;
      const m = matchLabel(s.text);
      if (m && m.score >= 0.8) cols.push({ field: m.field, label: s.text, unit: m.unit, box: s.box });
    }
    return cols;
  };
  let segs: { text: string; box: Box }[] = line.segs.map((s) => ({ text: s.text, box: s.box }));
  // a header that wraps onto a second line („Avg. Entry“ / „Price“): join cells that overlap in x
  if (next && next.cy - line.cy < line.h * 2.1 && next.segs.every((s) => !looksLikeValue(s.text) && !symbolOf(s.text))) {
    const merged = segs.map((s) => ({ ...s }));
    let any = false;
    for (const n of next.segs) {
      const j = merged.findIndex((m) => Math.min(m.box.x1, n.box.x1) - Math.max(m.box.x0, n.box.x0) > Math.min(boxCx(m.box) - m.box.x0, boxCx(n.box) - n.box.x0) * 0.4);
      if (j >= 0) {
        merged[j] = { text: `${merged[j]!.text} ${n.text}`, box: unionBox([merged[j]!.box, n.box]) };
        any = true;
      } else merged.push({ text: n.text, box: n.box });
    }
    if (any) {
      const wrapped = read(merged);
      if (wrapped.length > read(segs).length) segs = merged;
    }
  }
  const cols = read(segs);
  return cols.length >= 3 && cols.length >= segs.length * 0.6 ? cols : null;
}

/** Column of a cell: the one whose header it overlaps most, else the closest header. */
function columnOf(box: Box, cols: readonly Column[]): number {
  let best = -1;
  let bestScore = -Infinity;
  cols.forEach((c, i) => {
    const overlap = Math.min(box.x1, c.box.x1) - Math.max(box.x0, c.box.x0);
    const d = Math.min(Math.abs(boxCx(box) - boxCx(c.box)), Math.abs(box.x0 - c.box.x0), Math.abs(box.x1 - c.box.x1));
    const score = (overlap > 0 ? 1000 + overlap : 0) - d;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

function parseTable(lines: readonly Line[], page: OcrPage): { records: RawRecord[]; orphans: Orphan[]; ok: boolean; header?: Box } {
  let hi = -1;
  let cols: Column[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const c = headerOf(lines[i]!, lines[i + 1]);
    if (c) {
      hi = i;
      cols = c;
      break;
    }
  }
  if (!cols || hi < 0) return { records: [], orphans: [], ok: false };
  const headLine = lines[hi]!;
  const bandEnd = lines[hi + 1] && lines[hi + 1]!.cy - headLine.cy < headLine.h * 2.1 && lines[hi + 1]!.segs.every((s) => !looksLikeValue(s.text) && !symbolOf(s.text)) ? hi + 1 : hi;
  const body = lines.slice(bandEnd + 1);
  const hasSymbolCol = cols.some((c) => c.field === "symbol");
  const rowStarts: number[] = [];
  body.forEach((l, i) => {
    if (symbolSeg(l)) rowStarts.push(i);
  });
  // no symbols printed (a single-market page): every line with a clock cell starts a row
  if (!rowStarts.length && !hasSymbolCol) body.forEach((l, i) => l.segs.some((s) => CLOCK_RE.test(s.text.trim().split(" ").pop() ?? "")) && rowStarts.push(i));
  const records: RawRecord[] = [];
  rowStarts.forEach((start, k) => {
    const end = rowStarts[k + 1] ?? body.length;
    const rowLines = body.slice(start, end).filter((l, j) => j === 0 || l.cy - body[start + j - 1]!.cy < Math.max(l.h, 10) * 2.6);
    const sym = symbolSeg(rowLines[0]!);
    const symbolCell: RawCell = sym ? { text: sym.text, conf: sym.seg.conf, box: sym.seg.box, ...(sym.seg.ink ? { ink: sym.seg.ink } : {}) } : { text: "", conf: 0, box: rowLines[0]!.box };
    const rec: RawRecord = { page: page.index, layout: "table", box: unionBox(rowLines.map((l) => l.box)), symbol: symbolCell, fields: {}, notes: sym?.repaired ? [`Symbol als ${sym.text} gelesen.`] : [] };
    const bucket = new Map<number, Seg[]>();
    for (const l of rowLines)
      for (const s of l.segs) {
        if (sym && s.words.includes(sym.seg.words[0]!) && s.words.length === 1) continue;
        // two numbers glued into one cell by a narrow gutter: split them at the word level
        const nums = s.words.filter((w) => isNumberLike(w.text));
        if (s.words.length >= 2 && nums.length === s.words.length && !s.words.some((w) => DATE_RE.test(w.text) || CLOCK_RE.test(w.text))) {
          const idx = s.words.map((w) => columnOf(w.box, cols));
          if (new Set(idx).size > 1) {
            s.words.forEach((w, j) => bucket.set(idx[j]!, [...(bucket.get(idx[j]!) ?? []), { text: w.text, conf: w.conf, box: w.box, words: [w], ...(w.ink ? { ink: w.ink } : {}) }]));
            continue;
          }
        }
        const c = columnOf(s.box, cols);
        if (c >= 0) bucket.set(c, [...(bucket.get(c) ?? []), s]);
      }
    for (const [c, segs] of bucket) {
      const col = cols![c]!;
      const ordered = [...segs].sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
      const text = ordered.map((s) => s.text).join(" ");
      const conf = Math.min(...ordered.map((s) => s.conf));
      const box = unionBox(ordered.map((s) => s.box));
      const first = ordered[0]!;
      const cell: RawCell = { text, conf, box, label: col.label, unit: col.unit, ...(first.ink ? { ink: first.ink } : {}), ...(first.lum != null ? { lum: first.lum } : {}) };
      const f = col.field;
      if (f === "side") {
        const w = parseSideWord(text.split(" ")[0] ?? "");
        const act = parseOrderLabel(text);
        if (act) rec.action = { ...act, cell };
        if (w) rec.side = { word: w, cell };
        else if (!act) rec.fields[f] = cell;
      } else if (f === "action") {
        const act = parseOrderLabel(text);
        if (act) rec.action = { ...act, cell };
      } else if (f === "status") {
        const st = parseStatusWord(text);
        if (st) rec.status = { word: st, cell };
      } else if (f === "leverage") {
        const lev = parseLeverageToken(text.replace(/\s/g, "")) ?? (isNumberLike(text) ? { value: Number(text.replace(",", ".")), repaired: false } : null);
        if (lev && Number.isFinite(lev.value)) rec.leverage = { ...lev, cell };
      } else if (f === "symbol") {
        // „BTCUSDT Perp Long“: side / margin words may ride in the symbol cell
        for (const w of text.split(" ").slice(1)) {
          const side = parseSideWord(w);
          if (side && !rec.side) rec.side = { word: side, cell };
          const mm = parseMarginWord(w);
          if (mm && !rec.marginMode) rec.marginMode = { word: mm, cell };
        }
      } else if (!rec.fields[f]) rec.fields[f] = cell;
    }
    // an order's / trade's name can also stand in any cell of the row („Close Long“)
    if (!rec.action)
      for (const l of rowLines)
        for (const s of l.segs) {
          const act = parseOrderLabel(s.text);
          if (act) {
            rec.action = { ...act, cell: cellOf(s) };
            break;
          }
        }
    records.push(rec);
  });
  markTableGaps(records, cols);
  return { records, orphans: [], ok: records.length > 0, header: unionBox(lines.slice(hi, bandEnd + 1).map((l) => l.box)) };
}

/**
 * A column that most rows have a value in, but one row does not: the engine skipped that cell. The place where the cell
 * must be (the column's x range, the row's line) is handed to the second reading (`RawRecord.empty`).
 */
function markTableGaps(records: readonly RawRecord[], cols: readonly Column[]): void {
  if (records.length < 3) return;
  for (const col of cols) {
    const f = col.field;
    if (!["entry", "exit", "qty", "price", "orderPrice", "fee", "pnl", "openTime", "closeTime", "time"].includes(f)) continue;
    const have = records.filter((r) => r.fields[f]);
    if (have.length < Math.ceil(records.length * 0.6) || have.length === records.length) continue;
    const x0 = Math.min(...have.map((r) => r.fields[f]!.box.x0)) - 6;
    const x1 = Math.max(...have.map((r) => r.fields[f]!.box.x1)) + 6;
    for (const r of records) {
      if (r.fields[f]) continue;
      const y0 = r.symbol.box.y0 - 2;
      const y1 = r.symbol.box.y1 + 2;
      (r.empty ??= []).push({ field: f, label: col.label, unit: col.unit, box: { x0, y0, x1, y1 }, labelBox: { x0, y0, x1: x0, y1 }, region: { x0, y0, x1, y1 } });
    }
  }
}

/* ------------------------------------------------------------------ page */

/** Reads one recognised picture: the view (tab), the layout and the records. */
export function parsePage(page: OcrPage): ParsedPage {
  const lines = buildLines(page.words);
  const { view, how } = findView(lines);
  const exchange = findExchange(lines);
  const notes: string[] = [];
  const table = parseTable(lines, page);
  let layout: ParsedPage["layout"] = "none";
  let records: RawRecord[] = [];
  let orphans: Orphan[] = [];
  let header: Box | undefined;
  const cards = parseCards(lines, page);
  // a table with a header wins when it found rows; cards otherwise
  if (table.ok && table.records.length >= Math.max(1, cards.records.filter((r) => Object.keys(r.fields).length >= 3).length)) {
    layout = "table";
    records = table.records;
    header = table.header;
  } else if (cards.records.length || cards.orphans.length) {
    layout = "cards";
    records = cards.records;
    orphans = cards.orphans;
  }
  if (!records.length && !orphans.length) notes.push("Auf dem Bild wurde keine Orderliste erkannt (kein Symbol wie BTCUSDT mit Werten dahinter).");
  return { page: page.index, width: page.width, height: page.height, view, viewLabel: VIEW_LABEL[view], viewHow: how, exchange, layout, ...(header ? { header } : {}), records, orphans, lines, notes };
}

export { boxCy, boxH };
export type { Line, Seg };

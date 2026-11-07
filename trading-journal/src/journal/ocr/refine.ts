/**
 * Second reading of the cells that matter (the numbers and times of a record).
 *
 * A whole-page reading is good at words and bad at the tiny things that decide a trade: a decimal point beside a
 * chevron („81,214.3“ → „81,2143“), a minus sign in coloured text, the 5 in „5X“ read as an S. So every number / time
 * cell the first reading is not sure of (or whose FORMAT is suspicious) is cut out of the original ink, scaled up at
 * several sizes and read again as a single line with only the characters a number can have. The readings VOTE: two
 * agreeing readings win; when they all differ the cell stays uncertain (yellow in the preview) with the best one.
 * Pure orchestration over the `OcrEngine` interface.
 */
import type { OcrEngine } from "./engine";
import type { RawCell, RawRecord } from "./layout";
import { detectNumberStyle, parseShotNumber, type NumberStyle } from "@/journal/extract/numbers";
import { checkRecord, feeShareOf, UNUSUAL_FEE_SHARE, type PlausibilityInput } from "./plausibility";
import { printCrop, type Prepared } from "./preprocess";
import { cleanNumberText, cleanTimeText, decimalsOf, isFullTime } from "./text";
import type { FieldId } from "./vocab";

export const NUMBER_FIELDS: readonly FieldId[] = ["entry", "exit", "qty", "price", "orderPrice", "fee", "funding", "pnl", "roi"];
export const TIME_FIELDS: readonly FieldId[] = ["openTime", "closeTime", "time"];
const PRICE_FIELDS: readonly FieldId[] = ["entry", "exit", "price", "orderPrice"];

const NUMBER_CHARS = "0123456789.,-+";
const TIME_CHARS = "0123456789-:./ ";
const LEVERAGE_CHARS = "0123456789xX";
/**
 * Heights (px) the digits of a cell are scaled to for the re-readings. RELATIVE to the cell: a decimal point of 13-px text
 * survives at 5× and is lost at 2×, the same point of a phone screenshot's 26-px text is fine at 2×.
 */
export const REREAD_SCALES = [48, 60, 72] as const;
/** A first reading at or above this confidence with a sane format is not read again. */
export const SURE = 88;

export interface RefineContext {
  /** Decimals the prices of this picture are printed with (the tick size), when they agree. */
  priceDecimals: number | null;
  /** The same for quantities of this market (needs three agreeing readings). */
  qtyDecimals: number | null;
}

/**
 * The decimals the prices of ONE market are printed with (its tick size; from the surest readings of its records), or
 * `null` when fewer than two records agree. Markets differ (BTC 1, ETH 2, XRP 4), so it is per symbol.
 */
export function modalPriceDecimals(records: readonly RawRecord[], symbol?: string): number | null {
  return modalDecimals(records, PRICE_FIELDS, symbol, 2);
}

/** The decimals most of the (sure, separator-bearing) readings of `fields` share – `null` below `minSamples` agreeing ones. */
export function modalDecimals(records: readonly RawRecord[], fields: readonly FieldId[], symbol: string | undefined, minSamples: number): number | null {
  const counts = new Map<number, number>();
  for (const r of records) {
    if (symbol != null && r.symbol.text !== symbol) continue;
    for (const f of fields) {
      const c = r.fields[f];
      if (!c || c.conf < 85) continue;
      const t = cleanNumberText(c.text).text;
      if (!/[.,]/.test(t)) continue;
      const d = decimalsOf(t);
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  let best: [number, number] | null = null;
  for (const [d, n] of counts) if (!best || n > best[1]) best = [d, n];
  return best && best[1] >= minSamples ? best[0] : null;
}

/** Whether a first reading deserves a second look. */
export function needsReread(field: FieldId | "leverage", cell: RawCell, ctx: RefineContext): boolean {
  if (field === "leverage") return cell.conf < 80 || !/^[0-9]{1,3}\s*[xX×]$/.test(cell.text.trim());
  if (TIME_FIELDS.includes(field as FieldId)) return cell.conf < SURE || !isFullTime(cleanTimeText(cell.text).text);
  if (!NUMBER_FIELDS.includes(field as FieldId)) return false;
  if (cell.conf < SURE) return true;
  const t = cleanNumberText(cell.text).text;
  if (PRICE_FIELDS.includes(field as FieldId)) {
    if (!/[.,]/.test(t) && t.replace(/\D/g, "").length >= 5 && ctx.priceDecimals) return true;
    if (ctx.priceDecimals != null && /[.,]/.test(t) && decimalsOf(t) !== ctx.priceDecimals) return true;
  }
  // a quantity is printed with the market's lot decimals ("13.2", "20.8"): one without them has probably lost its point
  if (field === "qty" && ctx.qtyDecimals != null && decimalsOf(t) !== ctx.qtyDecimals && !/[.,]\d/.test(t)) return true;
  if (field === "roi" && !/[.,]/.test(t)) return true;
  return false;
}

interface Vote {
  key: string;
  text: string;
  n: number;
  conf: number[];
}

const keyOf = (field: FieldId | "leverage", text: string): string => (TIME_FIELDS.includes(field as FieldId) ? cleanTimeText(text).text : field === "leverage" ? text.replace(/\s/g, "").toLowerCase() : cleanNumberText(text).text.replace(/\s/g, ""));

/** The readings of one cell, voted. Pure given the reads (the engine part is `readCell`). */
export function vote(field: FieldId | "leverage", first: { text: string; conf: number }, reads: readonly { text: string; conf: number }[], ctx: RefineContext): { text: string; conf: number; agree: number; of: number } {
  const votes = new Map<string, Vote>();
  const add = (r: { text: string; conf: number }) => {
    const text = r.text.trim();
    if (!text) return;
    const key = keyOf(field, text);
    if (!key) return;
    const v = votes.get(key) ?? { key, text, n: 0, conf: [] };
    v.n += 1;
    v.conf.push(r.conf);
    votes.set(key, v);
  };
  add(first);
  for (const r of reads) add(r);
  const of = 1 + reads.length;
  const list = [...votes.values()];
  if (!list.length) return { text: first.text, conf: first.conf, agree: 0, of };
  const mean = (v: Vote) => v.conf.reduce((a, b) => a + b, 0) / v.conf.length;
  // a price printed with the picture's own decimals beats one that is not (a lost point shows as a different count)
  const fits = (v: Vote) => (PRICE_FIELDS.includes(field as FieldId) && ctx.priceDecimals != null ? (decimalsOf(v.text) === ctx.priceDecimals ? 1 : 0) : 0);
  list.sort((a, b) => b.n - a.n || fits(b) - fits(a) || mean(b) - mean(a));
  const top = list[0]!;
  if (top.n >= 2) return { text: top.text, conf: Math.min(96, Math.max(mean(top), 70) + 8 * (top.n - 1)), agree: top.n, of };
  // nothing agrees: the surest one, but only as sure as a guess
  return { text: top.text, conf: Math.min(mean(top), 60), agree: 1, of };
}

/** Reads one cell again at several sizes (the engine part). */
async function readCell(prep: Prepared, engine: OcrEngine, cell: RawCell, whitelist: string, join: string, scales: readonly number[]): Promise<{ text: string; conf: number }[]> {
  const out: { text: string; conf: number }[] = [];
  const h = Math.max(6, cell.box.y1 - cell.box.y0);
  for (const target of scales) {
    const s = Math.min(9, Math.max(1, target / h));
    const words = await engine.recognize(printCrop(prep, cell.box, s), { psm: "7", whitelist });
    if (!words.length) continue;
    out.push({ text: words.map((w) => w.text).join(join), conf: Math.min(...words.map((w) => w.conf)) });
  }
  return out;
}

/** The numbers of a raw record as the plausibility checks want them. */
function rawNumbers(r: RawRecord, style: NumberStyle | null): PlausibilityInput {
  const n = (f: FieldId): number | null => {
    const c = r.fields[f];
    return c ? (parseShotNumber(cleanNumberText(c.text).text, style)?.value ?? null) : null;
  };
  const side = r.action?.side ?? (r.side && (r.side.word === "long" || r.side.word === "short") ? r.side.word : null);
  return { side, entry: n("entry"), exit: n("exit"), qty: n("qty"), pnl: n("pnl"), roi: n("roi"), leverage: r.leverage?.value ?? null, fee: n("fee") };
}

/** Median fee rate (fee ÷ price × quantity) of the orders of the page: orders of one exchange pay about the same rate. */
export function medianFeeRate(records: readonly RawRecord[], style: NumberStyle | null): number | null {
  const rates: number[] = [];
  for (const r of records) {
    const n = (f: FieldId): number | null => {
      const c = r.fields[f];
      return c ? (parseShotNumber(cleanNumberText(c.text).text, style)?.value ?? null) : null;
    };
    const price = n("price") ?? n("orderPrice");
    const qty = n("qty");
    const fee = n("fee");
    if (price && qty && fee && price * qty > 0) rates.push(Math.abs(fee) / (price * qty));
  }
  if (rates.length < 3) return null;
  rates.sort((a, b) => a - b);
  return rates[Math.floor(rates.length / 2)]!;
}

/** Whether the numbers of a record cannot belong together (a lost decimal point shows exactly like this). */
export function numbersDoNotFit(r: RawRecord, style: NumberStyle | null, feeRate: number | null = null): boolean {
  if (feeRate != null) {
    const n = (f: FieldId): number | null => {
      const c = r.fields[f];
      return c ? (parseShotNumber(cleanNumberText(c.text).text, style)?.value ?? null) : null;
    };
    const price = n("price") ?? n("orderPrice");
    const qty = n("qty");
    const fee = n("fee");
    if (price && qty && fee && price * qty > 0) {
      const ratio = Math.abs(fee) / (price * qty) / feeRate;
      if (ratio > 3 || ratio < 1 / 3) return true;
    }
  }
  const i = rawNumbers(r, style);
  if (i.entry == null || i.exit == null || i.qty == null) return false;
  const share = feeShareOf(i);
  if (share != null && (share > UNUSUAL_FEE_SHARE || share < -0.0003)) return true;
  return checkRecord(i).flags.some((f) => f.code === "price_scale" || f.code === "result_far" || f.code === "result_sign" || f.code === "roi_mismatch");
}

/** Cells that are numbers worth a second look when their record does not add up. */
const CHECK_FIELDS: readonly FieldId[] = ["entry", "exit", "qty", "pnl", "roi", "fee", "price", "orderPrice"];
/** More sizes for a record that does not add up: a decimal point that one size loses another often keeps. */
export const REREAD_SCALES_MORE = [36, 48, 60, 72, 90] as const;

export interface RefineStats {
  checked: number;
  reread: number;
  changed: number;
  /** Records whose numbers did not add up after the first round and were read again as a whole. */
  recheck: number;
}

type Job = { field: FieldId | "leverage"; cell: RawCell; ctx: RefineContext };

async function run(jobs: readonly Job[], prep: Prepared, engine: OcrEngine, stats: RefineStats, scales: readonly number[], tick: () => void): Promise<void> {
  for (const j of jobs) {
    const isTime = TIME_FIELDS.includes(j.field as FieldId);
    const whitelist = j.field === "leverage" ? LEVERAGE_CHARS : isTime ? TIME_CHARS : j.field === "roi" ? `${NUMBER_CHARS}%` : NUMBER_CHARS;
    const reads = await readCell(prep, engine, j.cell, whitelist, isTime ? " " : "", scales);
    stats.reread += 1;
    const before = j.cell.reread?.before ?? j.cell.text;
    const v = vote(j.field, { text: j.cell.text, conf: j.cell.conf }, reads, j.ctx);
    if (keyOf(j.field, v.text) !== keyOf(j.field, j.cell.text)) stats.changed += 1;
    j.cell.text = v.text;
    j.cell.conf = v.conf;
    j.cell.reread = { agree: v.agree, of: v.of, before };
    tick();
  }
}

/**
 * A label row whose value the first reading skipped: the place right of the label is read as a single line, at several
 * sizes, and the readings vote. Only a value two readings agree on (or one that is the only reading and well-formed, kept
 * unsure) is taken; the cell is marked as recovered.
 */
async function recoverEmpty(records: readonly RawRecord[], prep: Prepared, engine: OcrEngine, stats: RefineStats): Promise<void> {
  for (const r of records) {
    for (const e of r.empty ?? []) {
      if (r.fields[e.field]) continue;
      const isTime = TIME_FIELDS.includes(e.field);
      if (!isTime && !NUMBER_FIELDS.includes(e.field)) continue;
      // right edge: where the same field's values of the other cards end (the app's arrow sits behind them)
      const siblings = records.map((o) => o.fields[e.field]?.box.x1).filter((x): x is number => x != null);
      const rightEdge = siblings.length ? Math.max(...siblings) + 6 : prep.raster.width;
      const box = e.region ?? { x0: e.labelBox.x1 + 6, y0: e.box.y0, x1: Math.min(prep.raster.width, Math.max(rightEdge, e.labelBox.x1 + 40)), y1: e.box.y1 };
      const whitelist = isTime ? TIME_CHARS : e.field === "roi" ? `${NUMBER_CHARS}%` : NUMBER_CHARS;
      const reads = await readCell(prep, engine, { text: "", conf: 0, box }, whitelist, isTime ? " " : "", REREAD_SCALES);
      stats.reread += 1;
      const v = vote(e.field, { text: "", conf: 0 }, reads, { priceDecimals: modalPriceDecimals(records, r.symbol.text), qtyDecimals: null });
      const ok = isTime ? isFullTime(cleanTimeText(v.text).text) : /\d/.test(v.text) && parseShotNumber(cleanNumberText(v.text).text, null) != null;
      if (!v.text || !ok) continue;
      r.fields[e.field] = { text: v.text, conf: v.agree >= 2 ? v.conf : Math.min(v.conf, 60), box, label: e.label, unit: e.unit, reread: { agree: v.agree, of: v.of, before: "" } };
      r.notes.push(`„${e.label}“: der Wert war im ersten Durchgang nicht gelesen worden und kommt aus der zweiten Lesung.`);
      stats.changed += 1;
    }
  }
}

/**
 * Reads the doubtful cells of the records again and replaces their text / confidence by the voted result. Round 2: a
 * record whose numbers still do not add up (prices vs. quantity vs. result) gets ALL its numbers read again at more sizes.
 */
export async function refineRecords(records: readonly RawRecord[], prep: Prepared, engine: OcrEngine, onStep?: (done: number, total: number) => void): Promise<RefineStats> {
  const bySymbol = new Map<string, RefineContext>();
  const ctxOf = (symbol: string): RefineContext => {
    let c = bySymbol.get(symbol);
    if (!c) bySymbol.set(symbol, (c = { priceDecimals: modalPriceDecimals(records, symbol), qtyDecimals: modalDecimals(records, ["qty"], symbol, 2) }));
    return c;
  };
  const stats0: RefineStats = { checked: 0, reread: 0, changed: 0, recheck: 0 };
  await recoverEmpty(records, prep, engine, stats0);
  const jobs: Job[] = [];
  for (const r of records) {
    const ctx = ctxOf(r.symbol.text);
    for (const [f, cell] of Object.entries(r.fields) as [FieldId, RawCell][]) if (needsReread(f, cell, ctx)) jobs.push({ field: f, cell, ctx });
    if (r.leverage && needsReread("leverage", r.leverage.cell, ctx)) jobs.push({ field: "leverage", cell: r.leverage.cell, ctx });
  }
  const stats: RefineStats = { checked: records.reduce((n, r) => n + Object.keys(r.fields).length + (r.leverage ? 1 : 0), 0), reread: stats0.reread, changed: stats0.changed, recheck: 0 };
  let done = 0;
  await run(jobs, prep, engine, stats, REREAD_SCALES, () => onStep?.(++done, jobs.length + 1));
  // round 2
  const texts: string[] = [];
  for (const r of records) for (const c of Object.values(r.fields)) if (c && /\d/.test(c.text) && !/\d{1,2}:\d{2}/.test(c.text)) texts.push(cleanNumberText(c.text).text);
  const style = detectNumberStyle(texts);
  const feeRate = medianFeeRate(records, style);
  const again: Job[] = [];
  for (const r of records) {
    if (!numbersDoNotFit(r, style, feeRate)) continue;
    stats.recheck += 1;
    for (const f of CHECK_FIELDS) {
      const cell = r.fields[f];
      if (cell) again.push({ field: f, cell, ctx: ctxOf(r.symbol.text) });
    }
  }
  await run(again, prep, engine, stats, REREAD_SCALES_MORE, () => onStep?.(done, jobs.length + 1));
  onStep?.(jobs.length + 1, jobs.length + 1);
  return stats;
}

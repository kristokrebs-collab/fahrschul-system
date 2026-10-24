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
import { printCrop, type Prepared } from "./preprocess";
import { cleanNumberText, cleanTimeText, decimalsOf, isFullTime } from "./text";
import type { FieldId } from "./vocab";

export const NUMBER_FIELDS: readonly FieldId[] = ["entry", "exit", "qty", "price", "orderPrice", "fee", "funding", "pnl", "roi"];
export const TIME_FIELDS: readonly FieldId[] = ["openTime", "closeTime", "time"];
const PRICE_FIELDS: readonly FieldId[] = ["entry", "exit", "price", "orderPrice"];

const NUMBER_CHARS = "0123456789.,-+";
const TIME_CHARS = "0123456789-:./ ";
const LEVERAGE_CHARS = "0123456789xX";
/** Cell sizes (× the original pixels) of the re-readings. */
export const REREAD_SCALES = [2, 2.5, 3] as const;
/** A first reading at or above this confidence with a sane format is not read again. */
export const SURE = 88;

export interface RefineContext {
  /** Decimals the prices of this picture are printed with (the tick size), when they agree. */
  priceDecimals: number | null;
}

/** The decimals most prices of the picture share (from the surest readings), or `null`. */
export function modalPriceDecimals(records: readonly RawRecord[]): number | null {
  const counts = new Map<number, number>();
  for (const r of records)
    for (const f of PRICE_FIELDS) {
      const c = r.fields[f];
      if (!c || c.conf < 85) continue;
      const t = cleanNumberText(c.text).text;
      if (!/[.,]/.test(t)) continue;
      const d = decimalsOf(t);
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  let best: [number, number] | null = null;
  for (const [d, n] of counts) if (!best || n > best[1]) best = [d, n];
  return best && best[1] >= 2 ? best[0] : null;
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
async function readCell(prep: Prepared, engine: OcrEngine, cell: RawCell, whitelist: string, join: string): Promise<{ text: string; conf: number }[]> {
  const out: { text: string; conf: number }[] = [];
  for (const s of REREAD_SCALES) {
    const words = await engine.recognize(printCrop(prep, cell.box, s), { psm: "7", whitelist });
    if (!words.length) continue;
    out.push({ text: words.map((w) => w.text).join(join), conf: Math.min(...words.map((w) => w.conf)) });
  }
  return out;
}

export interface RefineStats {
  checked: number;
  reread: number;
  changed: number;
}

/** Reads the doubtful cells of the records again and replaces their text / confidence by the voted result. */
export async function refineRecords(records: readonly RawRecord[], prep: Prepared, engine: OcrEngine, onStep?: (done: number, total: number) => void): Promise<RefineStats> {
  const ctx: RefineContext = { priceDecimals: modalPriceDecimals(records) };
  const jobs: { field: FieldId | "leverage"; cell: RawCell }[] = [];
  for (const r of records) {
    for (const [f, cell] of Object.entries(r.fields) as [FieldId, RawCell][]) if (needsReread(f, cell, ctx)) jobs.push({ field: f, cell });
    if (r.leverage && needsReread("leverage", r.leverage.cell, ctx)) jobs.push({ field: "leverage", cell: r.leverage.cell });
  }
  const stats: RefineStats = { checked: records.reduce((n, r) => n + Object.keys(r.fields).length + (r.leverage ? 1 : 0), 0), reread: 0, changed: 0 };
  let done = 0;
  for (const j of jobs) {
    const isTime = TIME_FIELDS.includes(j.field as FieldId);
    const whitelist = j.field === "leverage" ? LEVERAGE_CHARS : isTime ? TIME_CHARS : j.field === "roi" ? `${NUMBER_CHARS}%` : NUMBER_CHARS;
    const reads = await readCell(prep, engine, j.cell, whitelist, isTime ? " " : "");
    stats.reread += 1;
    const before = j.cell.text;
    const v = vote(j.field, { text: j.cell.text, conf: j.cell.conf }, reads, ctx);
    if (keyOf(j.field, v.text) !== keyOf(j.field, before)) stats.changed += 1;
    j.cell.text = v.text;
    j.cell.conf = v.conf;
    j.cell.reread = { agree: v.agree, of: v.of, before };
    onStep?.(++done, jobs.length);
  }
  return stats;
}

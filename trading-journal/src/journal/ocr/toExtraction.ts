/**
 * Read records → the screenshot import's own wire format (`Extraction` of `@/journal/extract/contract`), so the
 * existing normalisers take over (`buildCandidates`: numbers / times / sides, `merge`, `checks`, `implied`, `dedupe`,
 * `draft`). The OCR reads the same TEXT the model path would return – only the producer differs.
 *
 * An order history needs one more step: an opening and a closing order of the same market / side / quantity are one
 * trade; an order that cannot be paired stays what it is (a closing order without its opening is „Einstieg fehlt im
 * Bild“ and offers „Einstieg aus PnL berechnen“ as before – never silently invented).
 */
import { pairKey } from "@/journal/extract/candidate";
import type { Extraction, ExtractedExecution, ExtractedTrade } from "@/journal/extract/contract";
import type { IncompleteCard, PageRecords, ReadRecord } from "./records";

export interface OcrExtraction {
  extraction: Extraction;
  /** The records each extracted trade was made of (two for a paired open + close order). */
  sources: ReadRecord[][];
  incomplete: IncompleteCard[];
  /** Records that are not trades (cancelled orders) or not decidable (an order without „öffnen / schließen“). */
  skipped: { page: number; text: string }[];
  pages: PageRecords[];
}

const KEYS = ["market", "side", "entries", "exits", "stop", "targets", "leverage", "fees", "funding", "realizedPnl", "exchange", "productType", "status"] as const;

const num = (v: number): string => String(Number(v.toFixed(8)));
const minConf = (...c: (number | undefined)[]): number => Math.min(...c.filter((x): x is number => x != null));

function execOf(price: string, qty: string | null, time: string | null, label: string | null): ExtractedExecution {
  return { price, qty, time, label };
}

function baseTrade(r: ReadRecord, exchange: string | null): ExtractedTrade {
  const conf = Object.fromEntries(KEYS.map((k) => [k, 0])) as ExtractedTrade["confidence"];
  conf.market = r.symbol.conf;
  conf.side = r.side.value ? r.side.conf : 0;
  conf.leverage = r.leverage?.conf ?? 0;
  conf.exchange = exchange ? 0.9 : 0;
  conf.status = 0.85;
  return {
    market: r.symbol.text || null,
    side: r.side.value,
    entries: [],
    exits: [],
    plannedEntry: null,
    stop: null,
    targets: [],
    leverage: r.leverage?.text ?? null,
    fees: null,
    funding: r.nums.funding?.text ?? null,
    realizedPnl: null,
    pnlCurrency: r.currency && r.currency.length <= 12 ? r.currency : null,
    exchange,
    productType: r.leverage || r.marginMode ? "perp" : null,
    status: "closed",
    confidence: conf,
    unreadable: [],
    sources: [r.page],
  };
}

function fromPosition(r: ReadRecord, exchange: string | null): ExtractedTrade {
  const t = baseTrade(r, exchange);
  const qty = r.nums.qty?.text ?? null;
  const open = r.times.openTime ?? r.times.time ?? null;
  const close = r.times.closeTime ?? null;
  if (r.nums.entry) t.entries = [execOf(r.nums.entry.text, qty, open?.text ?? null, null)];
  if (r.nums.exit && r.status !== "open") t.exits = [execOf(r.nums.exit.text, qty, close?.text ?? null, null)];
  t.status = r.status === "open" || !t.exits.length ? "open" : "closed";
  if (t.status === "closed") t.realizedPnl = r.nums.pnl?.text ?? null;
  t.fees = r.nums.fee ? r.nums.fee.text : r.derivedFees != null ? num(r.derivedFees) : null;
  t.confidence.entries = t.entries.length ? minConf(r.nums.entry?.conf, r.nums.qty?.conf, open?.conf) : 0;
  t.confidence.exits = t.exits.length ? minConf(r.nums.exit?.conf, r.nums.qty?.conf, close?.conf) : 0;
  t.confidence.realizedPnl = r.nums.pnl ? r.nums.pnl.conf : 0;
  t.confidence.fees = r.nums.fee ? r.nums.fee.conf : r.derivedFees != null ? 0.8 : 0;
  t.confidence.funding = r.nums.funding ? r.nums.funding.conf : 0;
  t.confidence.productType = t.productType ? 0.75 : 0;
  return t;
}

/** One order (open or close) as a trade with a single execution. */
function fromOrder(r: ReadRecord, exchange: string | null): ExtractedTrade | null {
  if (!r.action) return null;
  const t = baseTrade(r, exchange);
  const priceField = r.nums.price ?? r.nums.orderPrice ?? null;
  if (!priceField) return null;
  const qty = (r.nums.qty ?? null)?.text ?? null;
  const time = (r.times.time ?? r.times.openTime ?? r.times.closeTime ?? null)?.text ?? null;
  const ex = execOf(priceField.text, qty, time, r.action.label);
  const conf = minConf(priceField.conf, r.nums.qty?.conf, r.times.time?.conf) * (r.nums.price ? 1 : 0.85);
  if (r.action.action === "open") {
    t.entries = [ex];
    t.status = "open";
    t.confidence.entries = conf;
  } else {
    t.exits = [ex];
    t.status = "closed";
    t.confidence.exits = conf;
    t.realizedPnl = r.nums.pnl?.text ?? null;
    t.confidence.realizedPnl = r.nums.pnl?.conf ?? 0;
  }
  t.fees = r.nums.fee?.text ?? null;
  t.confidence.fees = r.nums.fee?.conf ?? 0;
  if (!r.nums.price && r.nums.orderPrice) t.unreadable = ["Durchschnittspreis"];
  return t;
}

const sameQty = (a: string | null, b: string | null, qa: number | null, qb: number | null): boolean => (qa != null && qb != null ? Math.abs(qa - qb) <= Math.max(qa, qb) * 0.005 : a != null && a === b);

/** Joins an opening and a closing order of the same market, side and quantity (the opening first in time) into one trade. */
function pairOrders(list: { t: ExtractedTrade; r: ReadRecord }[]): { t: ExtractedTrade; rs: ReadRecord[] }[] {
  const used = new Set<number>();
  const out: { t: ExtractedTrade; rs: ReadRecord[] }[] = [];
  list.forEach((close, ci) => {
    if (used.has(ci) || !close.t.exits.length || close.t.entries.length) return;
    const oi = list.findIndex((o, i) => {
      if (used.has(i) || i === ci || !o.t.entries.length || o.t.exits.length) return false;
      if (pairKey(o.t.market) !== pairKey(close.t.market) || o.t.side !== close.t.side) return false;
      const qo = o.r.nums.qty?.value ?? null;
      const qc = close.r.nums.qty?.value ?? null;
      if (!sameQty(o.t.entries[0]!.qty, close.t.exits[0]!.qty, qo, qc)) return false;
      const to = o.t.entries[0]!.time;
      const tc = close.t.exits[0]!.time;
      return !(to && tc && to > tc);
    });
    if (oi < 0) return;
    used.add(ci);
    used.add(oi);
    const open = list[oi]!;
    const t: ExtractedTrade = { ...close.t, entries: open.t.entries, status: "closed", sources: [...new Set([...open.t.sources, ...close.t.sources])] };
    const fees = [open.r.nums.fee?.value, close.r.nums.fee?.value].filter((v): v is number => v != null);
    if (fees.length) t.fees = num(fees.reduce((a, b) => a + b, 0));
    t.confidence = { ...close.t.confidence, entries: open.t.confidence.entries };
    out.push({ t, rs: [open.r, close.r] });
  });
  list.forEach((x, i) => {
    if (!used.has(i)) out.push({ t: x.t, rs: [x.r] });
  });
  return out;
}

export function toExtraction(pages: readonly PageRecords[]): OcrExtraction {
  const trades: ExtractedTrade[] = [];
  const sources: ReadRecord[][] = [];
  const skipped: OcrExtraction["skipped"] = [];
  const orders: { t: ExtractedTrade; r: ReadRecord }[] = [];
  for (const p of pages) {
    const exchange = p.exchange?.name ?? null;
    for (const r of p.records) {
      if (r.status === "cancelled") {
        skipped.push({ page: p.page, text: `${r.symbol.text}: storniert / abgelehnt – nichts gehandelt, nicht übernommen.` });
        continue;
      }
      if (r.kind === "position") {
        trades.push(fromPosition(r, exchange));
        sources.push([r]);
        continue;
      }
      const t = fromOrder(r, exchange);
      if (!t) {
        skipped.push({ page: p.page, text: `${r.symbol.text}: ${r.action ? "kein Preis lesbar" : "„öffnen“ oder „schließen“ nicht erkennbar"} – nicht übernommen.` });
        continue;
      }
      orders.push({ t, r });
    }
  }
  for (const x of pairOrders(orders)) {
    trades.push(x.t);
    sources.push(x.rs);
  }
  return {
    extraction: { trades, timezone: null, notes: [] },
    sources,
    incomplete: pages.flatMap((p) => p.incomplete),
    skipped,
    pages: [...pages],
  };
}

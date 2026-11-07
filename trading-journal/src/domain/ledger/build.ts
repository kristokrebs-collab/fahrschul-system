/**
 * Transaktionsbuch (F70): builds the ledger from the journal's trades. Pure; the clock never enters.
 *
 * Rows. A trade with executions (`fills`) gives one row per execution (opening / closing, with the fee of the fill if
 * the fill has one). A trade without executions gives an opening row from its entry and – when it is closed – a closing row
 * from its exit, both marked as "aus dem Eintrag". A closed trade whose fills leave a rest open gets a closing row for the
 * rest at the exit price of the entry (marked, as in the journal's own derivation). The fee of the entry and the funding
 * payments are rows of their own ("Gebühr", "Funding") – the journal stores them as sums, so the funding row is dated at
 * the closing and says so. Times: the journal writes a local wall clock; `sourceZone` names the zone it was written in, the
 * rows are kept in UTC and shown in `displayZone`.
 *
 * Matching. Closings are matched to openings first-in-first-out, per direction. `scope: "position"` (default) matches
 * within one journal position (the entry, or the entries of one `positionId`) – the same unit the journal's own P&L uses –,
 * `scope: "market"` lets all entries of one account and market share one queue. A closing for which no opening is left is
 * NOT valued: its quantity is reported as "unmatchedQty" and the row carries a visible flag. The result of a piece is
 * `(closePrice − openPrice) × qty × direction` in the trading currency, before fees and funding.
 *
 * Nothing is guessed: a missing fee, a missing funding payment, a missing time, a gap in the stock and a possible duplicate
 * each get a flag on the row, and an entry that cannot be turned into rows goes to the list of open questions
 * (`unresolved`). Open positions are not valued – they stay in `openLots`.
 */
import { reconcile } from "@/exchanges/reconcile";
import { isFin } from "@/lib/format";
import { deriveTrade } from "../derive";
import { FUNDING_INTERVAL } from "../events/rules";
import { wallStringToUtc, yearIn } from "../events/zone";
import { hasFills, orderFills, QTY_EPS } from "../fills";
import type { AccountId, Fill, Trade } from "../types";
import { FLAG_LEVEL, type FlagId, type Ledger, type LedgerFlag, type LedgerKind, type LedgerOptions, type LedgerRow, type LotMatch, type OpenLot, type Unresolved, type YearSummary } from "./types";

export const DEFAULT_OPTIONS: Pick<LedgerOptions, "scope"> = { scope: "position" };

const MINUTE = 60_000;
const num = (v: number, d = 2): string => v.toFixed(d).replace(".", ",").replace("-", "−");
const qtyText = (v: number): string => num(v, 8).replace(/,?0+$/, "");

const flag = (id: FlagId, text: string): LedgerFlag => ({ id, level: FLAG_LEVEL[id], text });

/** Quantity of an entry without executions – the journal's own rule (`size ÷ entry`, else `qty`). */
export function entryQty(t: Pick<Trade, "entry" | "size" | "qty">): number | null {
  const entry = t.entry ?? 0;
  if (entry > 0 && isFin(t.size) && t.size > 0) return t.size / entry;
  if (entry > 0 && isFin(t.qty) && t.qty > 0) return t.qty;
  return null;
}

interface Built {
  rows: LedgerRow[];
  unresolved: Unresolved | null;
}

interface Ctx {
  src: string;
}

const actionOf = (t: Trade, kind: "open" | "close"): "Kauf" | "Verkauf" => ((kind === "open") === (t.side !== "short") ? "Kauf" : "Verkauf");

function baseRow(t: Trade, kind: LedgerKind, id: string, at: number): LedgerRow {
  const acc: AccountId = t.account ?? "scalp";
  return {
    id,
    tradeId: t.id,
    at,
    account: acc,
    exchange: t.exchange ?? null,
    market: t.pair || "–",
    marketKind: t.market === "spot" ? "spot" : "perp",
    kind,
    side: t.side === "short" ? "short" : "long",
    action: kind === "open" || kind === "close" ? actionOf(t, kind) : null,
    qty: null,
    price: null,
    fee: null,
    funding: null,
    realized: null,
    matches: [],
    unmatchedQty: 0,
    source: "entry",
    flags: [],
  };
}

/** Rows of one journal trade. */
function rowsOf(t: Trade, ctx: Ctx): Built {
  const rows: LedgerRow[] = [];
  const openAt = wallStringToUtc(t.date, ctx.src);
  const closeAtEntry = t.exitDate ? wallStringToUtc(t.exitDate, ctx.src) : NaN;
  const closed = t.status !== "open";
  const fail = (reason: string): Built => ({ rows: [], unresolved: { tradeId: t.id, market: t.pair || "–", at: Number.isFinite(openAt) ? openAt : null, reason } });
  if (!Number.isFinite(openAt)) return fail("Die Zeit des Eintrags ist nicht lesbar.");
  const exitOk = isFin(t.exit) && t.exit > 0;
  const timeFlag = (what: string, instead: string): LedgerFlag => flag("time-missing", `${what} fehlt – ersatzweise gilt ${instead}, die Zeile ist nicht verlässlich datiert.`);

  let lastClose = NaN;
  let firstOpen = NaN;
  const usable: Fill[] = hasFills(t) ? orderFills(t.fills) : [];
  const fillFeeKnown = usable.some((f) => isFin(f.fee));
  const fillFeeSum = usable.reduce((s, f) => s + (isFin(f.fee) ? f.fee : 0), 0);
  const tradeFee = isFin(t.fees) ? t.fees : null;
  // the journal counts the entry's own fee when it is set, else the sum of the fills (`effectiveFees`): single fees are shown only when they add up to it
  const perFill = fillFeeKnown && (tradeFee === null || Math.abs(fillFeeSum - tradeFee) <= 0.005);
  const feeMismatch = fillFeeKnown && tradeFee !== null && !perFill;

  if (usable.length) {
    let openSum = 0;
    let closeSum = 0;
    usable.forEach((f, i) => {
      let at = wallStringToUtc(f.at, ctx.src);
      const row = baseRow(t, f.side === "open" ? "open" : "close", `${t.id}:f${i}`, 0);
      if (!Number.isFinite(at)) {
        const viaExit = f.side === "close" && Number.isFinite(closeAtEntry);
        at = viaExit ? closeAtEntry : openAt;
        row.flags.push(timeFlag("Die Zeit der Ausführung", viaExit ? "die Ausstiegszeit des Eintrags" : "die Zeit des Eintrags"));
      }
      row.at = at;
      row.qty = f.qty;
      row.price = f.price;
      row.source = "fills";
      if (perFill && isFin(f.fee)) row.fee = f.fee;
      rows.push(row);
      if (f.side === "open") {
        openSum += f.qty;
        if (!Number.isFinite(firstOpen) || at < firstOpen) firstOpen = at;
      } else {
        closeSum += f.qty;
        if (!Number.isFinite(lastClose) || at > lastClose) lastClose = at;
      }
    });
    // what the fills leave open: opened − closed, whatever the order of the times (the journal's own `remaining`)
    const pos = Math.max(0, openSum - closeSum);
    if (closed && pos > QTY_EPS) {
      if (exitOk) {
        const at = Number.isFinite(closeAtEntry) ? closeAtEntry : openAt;
        const row = baseRow(t, "close", `${t.id}:rest`, at);
        row.qty = pos;
        row.price = t.exit!;
        row.flags.push(flag("rest", "Rest der Position, nicht als Ausführung erfasst: zum Ausstiegskurs des Eintrags geschlossen (wie die Auswertung des Journals)."));
        if (!Number.isFinite(closeAtEntry)) row.flags.push(timeFlag("Die Ausstiegszeit", "die Zeit des Eintrags"));
        rows.push(row);
        if (!Number.isFinite(lastClose) || at > lastClose) lastClose = at;
      } else {
        return { rows, unresolved: { tradeId: t.id, market: t.pair || "–", at: openAt, reason: `Eintrag ist geschlossen, aber ${qtyText(pos)} Einheiten sind weder durch Ausführungen noch durch einen Ausstiegskurs geschlossen.` } };
      }
    }
  } else {
    const q = entryQty(t);
    if (!(t.entry && t.entry > 0) || q == null) {
      const manual = isFin(t.pnlManual) ? " Es gibt nur ein von Hand eingetragenes Ergebnis." : "";
      return fail(`Einstiegskurs oder Menge fehlen, daraus lassen sich keine Zeilen bilden.${manual}`);
    }
    const open = baseRow(t, "open", `${t.id}:open`, openAt);
    open.qty = q;
    open.price = t.entry;
    rows.push(open);
    firstOpen = openAt;
    if (closed) {
      if (!exitOk) return { rows, unresolved: { tradeId: t.id, market: t.pair || "–", at: openAt, reason: "Eintrag ist geschlossen, hat aber keinen Ausstiegskurs." } };
      const at = Number.isFinite(closeAtEntry) ? closeAtEntry : openAt;
      const close = baseRow(t, "close", `${t.id}:close`, at);
      close.qty = q;
      close.price = t.exit!;
      if (!Number.isFinite(closeAtEntry)) close.flags.push(timeFlag("Die Ausstiegszeit", "die Zeit des Eintrags"));
      rows.push(close);
      lastClose = at;
    }
  }

  const feeAt = Number.isFinite(lastClose) ? lastClose : openAt;
  // the entry's fee when it does not break down into the executions
  if (!perFill && tradeFee !== null && tradeFee !== 0) {
    const fee = baseRow(t, "fee", `${t.id}:fee`, feeAt);
    fee.fee = tradeFee;
    fee.source = "entry";
    fee.flags.push(flag("lump", "Gebühr des ganzen Eintrags als Summe; die einzelnen Ausführungen tragen keine Gebühr."));
    if (feeMismatch) fee.flags.push(flag("fee-diff", `Die Gebühren der Ausführungen ergeben ${num(fillFeeSum)}, der Eintrag nennt ${num(tradeFee)}: es zählt der Eintrag, wie im Journal.`));
    rows.push(fee);
  }
  if (!fillFeeKnown && tradeFee === null) {
    for (const r of rows) if (r.kind === "open" || r.kind === "close") r.flags.push(flag("fee-missing", "Gebühr nicht erfasst – das Buch schätzt sie nicht."));
  }
  // funding is stored as one sum per entry: dated at the closing, and it says so
  if (isFin(t.fundingFees) && t.fundingFees !== 0) {
    const fund = baseRow(t, "funding", `${t.id}:funding`, feeAt);
    fund.funding = t.fundingFees;
    fund.flags.push(flag("lump", "Funding als Summe des Eintrags; die einzelnen Zahlungen sind nicht bekannt, die Zeit ist die der Schließung."));
    rows.push(fund);
  } else if (!isFin(t.fundingFees) && t.market !== "spot" && closed && Number.isFinite(firstOpen) && Number.isFinite(lastClose) && Math.floor(lastClose / FUNDING_INTERVAL) > Math.floor(firstOpen / FUNDING_INTERVAL)) {
    for (const r of rows) if (r.kind === "close") r.flags.push(flag("funding-missing", "Zwischen Eröffnen und Schließen lag mindestens eine Funding-Abrechnung (Raster 00/08/16 Uhr UTC), im Eintrag steht kein Funding – nicht geschätzt."));
  }
  if (Number.isFinite(firstOpen) && Number.isFinite(lastClose) && lastClose < firstOpen) {
    for (const r of rows) if (r.kind === "open" || r.kind === "close") r.flags.push(flag("order", "Das Schließen liegt zeitlich vor dem Eröffnen – die Zeiten des Eintrags prüfen."));
  }
  return { rows, unresolved: null };
}

const KIND_ORDER: Readonly<Record<LedgerKind, number>> = { open: 0, close: 1, fee: 2, funding: 3 };

interface Lot {
  rowId: string;
  at: number;
  price: number;
  qty: number;
  trade: Trade;
}

/** Marks rows that look like the same event twice. */
function markDuplicates(rows: LedgerRow[], trades: readonly Trade[]): void {
  const add = (r: LedgerRow, text: string): void => {
    if (!r.flags.some((f) => f.id === "duplicate" && f.text === text)) r.flags.push(flag("duplicate", text));
  };
  // (1) the same time (to the minute), market, direction, quantity and price in different entries
  const groups = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    if ((r.kind !== "open" && r.kind !== "close") || r.qty == null || r.price == null) continue;
    const key = [r.account, r.market.toUpperCase().replace(/[^A-Z0-9]/g, ""), r.kind, r.side, Math.floor(r.at / MINUTE), r.qty.toPrecision(9), r.price.toPrecision(9)].join("|");
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  for (const g of groups.values()) {
    if (new Set(g.map((r) => r.tradeId)).size < 2) continue;
    for (const r of g) add(r, "Gleiche Zeit (auf die Minute), gleicher Markt, gleiche Menge und gleicher Preis wie in einem anderen Eintrag – möglicherweise doppelt importiert.");
  }
  // (2) the same exchange id
  const byExt = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!t.externalId || !t.exchange) continue;
    const k = `${t.exchange}|${t.externalId}`;
    const g = byExt.get(k);
    if (g) g.push(t);
    else byExt.set(k, [t]);
  }
  const dupTrades = new Set<string>();
  for (const g of byExt.values()) if (g.length > 1) for (const t of g) dupTrades.add(t.id);
  // (3) a hand-typed entry next to the synced one (the reconciliation of the account page)
  for (const p of reconcile(trades).duplicates) {
    dupTrades.add(p.synced.id);
    dupTrades.add(p.manual.id);
  }
  for (const r of rows) if (dupTrades.has(r.tradeId)) add(r, "Dieselbe Position steht zweimal im Journal (gleiche Börsen-ID oder Handeingabe neben dem Börsen-Sync, siehe Abgleich unter Konto).");
}

/** Builds the ledger. */
export function buildLedger(trades: readonly Trade[], settings: { currency: string }, options: LedgerOptions): Ledger {
  const ctx: Ctx = { src: options.sourceZone };
  const rows: LedgerRow[] = [];
  const unresolved: Unresolved[] = [];
  const byTrade = new Map<string, Trade>();
  for (const t of trades) {
    byTrade.set(t.id, t);
    const b = rowsOf(t, ctx);
    rows.push(...b.rows);
    if (b.unresolved) unresolved.push(b.unresolved);
  }
  markDuplicates(rows, trades);

  // first in, first out
  const seq = new Map(rows.map((r, i) => [r.id, i]));
  const order = rows.filter((r) => r.kind === "open" || r.kind === "close").sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || seq.get(a.id)! - seq.get(b.id)!);
  const queues = new Map<string, Lot[]>();
  const keyOf = (r: LedgerRow): string => {
    const t = byTrade.get(r.tradeId)!;
    return options.scope === "market" ? `${r.account}|${r.market.toUpperCase().replace(/[^A-Z0-9]/g, "")}|${r.marketKind}|${r.side}` : `${t.positionId ?? t.id}|${r.side}`;
  };
  for (const r of order) {
    const t = byTrade.get(r.tradeId)!;
    const k = keyOf(r);
    let q = queues.get(k);
    if (!q) queues.set(k, (q = []));
    if (r.kind === "open") {
      q.push({ rowId: r.id, at: r.at, price: r.price!, qty: r.qty!, trade: t });
      continue;
    }
    const dir = r.side === "short" ? -1 : 1;
    let need = r.qty!;
    const matches: LotMatch[] = [];
    while (need > QTY_EPS && q.length) {
      const lot = q[0]!;
      const piece = Math.min(need, lot.qty);
      matches.push({ openRowId: lot.rowId, openAt: lot.at, openPrice: lot.price, closePrice: r.price!, qty: piece, realized: (r.price! - lot.price) * piece * dir });
      lot.qty -= piece;
      need -= piece;
      if (lot.qty <= QTY_EPS) q.shift();
    }
    r.matches = matches;
    r.realized = matches.length ? matches.reduce((s, m) => s + m.realized, 0) : null;
    r.unmatchedQty = need > QTY_EPS ? need : 0;
    if (r.unmatchedQty > 0) r.flags.push(flag("gap", `${qtyText(r.unmatchedQty)} Einheiten ohne passenden Einstieg im Buch (die Anschaffung fehlt oder liegt vor dem Beginn der Daten). Das Ergebnis dafür bleibt offen.`));
  }

  // compare each closed entry with the journal's own result
  if (options.scope === "position") {
    for (const t of trades) {
      if (t.status === "open") continue;
      const mine = rows.filter((r) => r.tradeId === t.id);
      const closes = mine.filter((r) => r.kind === "close");
      if (!closes.length || closes.some((r) => r.unmatchedQty > 0 || r.realized == null)) continue;
      const journal = deriveTrade(t).pnl;
      if (journal == null) continue;
      const net = mine.reduce((s, r) => s + (r.realized ?? 0) - (r.fee ?? 0) - (r.funding ?? 0), 0);
      if (Math.abs(net - journal) > Math.max(0.01, Math.abs(journal) * 0.005)) {
        const text = `Das Journal rechnet ${num(journal)}, das Buch ${num(net)} (FIFO statt Durchschnittspreis, ein von Hand eingetragenes Ergebnis oder eine fehlende Gebühr). Keine der beiden Zahlen wird geändert.`;
        for (const r of closes) r.flags.push(flag("diff", text));
      }
    }
  }

  const openLots: OpenLot[] = [];
  for (const q of queues.values()) for (const lot of q) if (lot.qty > QTY_EPS) openLots.push({ tradeId: lot.trade.id, market: lot.trade.pair || "–", account: lot.trade.account ?? "scalp", side: lot.trade.side === "short" ? "short" : "long", qty: lot.qty, price: lot.price, at: lot.at });
  openLots.sort((a, b) => a.at - b.at);

  rows.sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || seq.get(a.id)! - seq.get(b.id)!);
  const flagCounts: Ledger["flagCounts"] = {};
  for (const r of rows) for (const f of new Set(r.flags.map((x) => x.id))) flagCounts[f] = (flagCounts[f] ?? 0) + 1;

  return { rows, years: summarize(rows, options.displayZone), openLots, unresolved, flagCounts, currency: settings.currency, options, trades: trades.length };
}

/** Per year (closing date, fees and funding in the year they were paid) in the zone the book is read in. */
export function summarize(rows: readonly LedgerRow[], zone: string): YearSummary[] {
  const by = new Map<number, YearSummary>();
  const get = (y: number): YearSummary => {
    let s = by.get(y);
    if (!s) by.set(y, (s = { year: y, closes: 0, gains: 0, losses: 0, gross: 0, fees: 0, fundingPaid: 0, fundingReceived: 0, funding: 0, net: 0, flagged: 0, duplicateGross: 0, unmatchedQty: 0 }));
    return s;
  };
  for (const r of rows) {
    const s = get(yearIn(r.at, zone));
    if (r.flags.some((f) => f.level === "warn")) s.flagged++;
    if (r.fee != null) s.fees += r.fee;
    if (r.funding != null) {
      if (r.funding > 0) s.fundingPaid += r.funding;
      else s.fundingReceived += -r.funding;
    }
    if (r.kind === "close") {
      s.unmatchedQty += r.unmatchedQty;
      if (r.realized != null) {
        s.closes++;
        for (const m of r.matches) {
          if (m.realized > 0) s.gains += m.realized;
          else s.losses += m.realized;
        }
        if (r.flags.some((f) => f.id === "duplicate")) s.duplicateGross += r.realized;
      }
    }
  }
  const out = [...by.values()].sort((a, b) => a.year - b.year);
  for (const s of out) {
    s.gross = s.gains + s.losses;
    s.funding = s.fundingPaid - s.fundingReceived;
    s.net = s.gross - s.fees - s.funding;
  }
  return out;
}

/** The rows of one year in `zone` (`null` = all). */
export function rowsOfYear(ledger: Pick<Ledger, "rows">, year: number | null, zone: string): LedgerRow[] {
  return year == null ? ledger.rows : ledger.rows.filter((r) => yearIn(r.at, zone) === year);
}

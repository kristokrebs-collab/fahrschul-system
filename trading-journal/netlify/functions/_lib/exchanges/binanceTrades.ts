/**
 * Binance fills → closed positions (Paket Verbindungen, B2). PURE: no I/O, no clock.
 *
 * Binance has no "position history" endpoint. A trade is rebuilt from the fills (`/fapi/v1/userTrades`,
 * `/api/v3/myTrades`): a position starts with the first opening fill, ends when the quantity is flat again, and gets the
 * deterministic id `<market>-<symbol>[-<leg>]-<first fill id>`. The first fill id never changes, so reading the same fills
 * again (overlapping windows, a repeated sync, a resumed import) produces the same id and the journal upsert writes
 * nothing twice – this is the whole duplicate protection (`mapClosedPosition` → `syncedTradeId` → `upsert_synced_trades`).
 *
 * Honest limits (counted, never hidden):
 * - a closing fill whose opening lies before the history that was read is an `orphan` (no trade is invented);
 * - a position that is still open at the end of the history is not returned (it becomes a trade when it closes);
 * - spot is long only (BUY adds, SELL reduces, average cost); a spot sell above the known inventory is an orphan;
 * - futures realized P&L is the venue's own per-fill value (before fees), fees come from the fills, funding from the
 *   income history (allocated by `allocateFunding`).
 */
import type { VenueClosedPosition, VenueFill, VenueSide } from "./types";

export interface BnFill {
  id: string;
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  price: number;
  /** Quantity of the fill (base units). */
  qty: number;
  /** Spot: quantity that really arrived/left the account (a BUY fee paid in the base coin is deducted). Futures: = qty. */
  qtyNet: number;
  /** Fee as a positive cost in the quote coin; 0 when it cannot be converted (`feeUnknown`). */
  fee: number;
  feeUnknown: boolean;
  /** Futures only: the venue's realized P&L of this fill (0 for an opening fill). */
  realizedPnl: number;
  at: number;
  /** Futures: `both` (one-way) | `long` | `short` (hedge). Spot: `both`. */
  positionSide: "both" | "long" | "short";
}

export interface GroupedPosition {
  position: VenueClosedPosition;
  fills: VenueFill[];
}

export interface GroupResult {
  positions: GroupedPosition[];
  orphanFills: number;
  unknownFees: number;
  /** Positions still open after the last fill (symbol, side, quantity) – informational. */
  open: { symbol: string; side: VenueSide; qty: number }[];
}

const EPS = 1e-9;

const byTime = (a: BnFill, b: BnFill): number => a.at - b.at || compareIds(a.id, b.id);

/** Numeric ids compare numerically, others as strings. */
function compareIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Acc {
  dir: 1 | -1;
  key: string;
  firstId: string;
  symbol: string;
  leg: BnFill["positionSide"];
  qty: number;
  maxQty: number;
  openQty: number;
  openNotional: number;
  closeQty: number;
  closeNotional: number;
  fee: number;
  pnl: number;
  openedAt: number;
  closedAt: number;
  fills: VenueFill[];
}

function newAcc(f: BnFill, dir: 1 | -1, market: "spot" | "futures"): Acc {
  const leg = f.positionSide;
  return {
    dir,
    key: market === "spot" ? `s-${f.symbol}-${f.id}` : `f-${f.symbol}${leg === "both" ? "" : `-${leg}`}-${f.id}`,
    firstId: f.id,
    symbol: f.symbol,
    leg,
    qty: 0,
    maxQty: 0,
    openQty: 0,
    openNotional: 0,
    closeQty: 0,
    closeNotional: 0,
    fee: 0,
    pnl: 0,
    openedAt: f.at,
    closedAt: f.at,
    fills: [],
  };
}

function venueFill(f: BnFill, qty: number, feeShare: number, pnl: number, idSuffix = ""): VenueFill {
  return {
    tradeId: `${f.id}${idSuffix}`,
    orderId: f.orderId,
    symbol: f.symbol,
    side: f.side,
    qty,
    price: f.price,
    fee: feeShare,
    realizedPnl: pnl,
    reduceOnly: null,
    at: f.at,
  };
}

function finish(a: Acc, hedge: boolean): GroupedPosition {
  const entry = a.openQty > 0 ? a.openNotional / a.openQty : 0;
  const exit = a.closeQty > 0 ? a.closeNotional / a.closeQty : 0;
  return {
    position: {
      positionId: a.key,
      symbol: a.symbol,
      side: a.dir === 1 ? "long" : "short",
      maxQty: a.maxQty,
      entryPrice: entry,
      closePrice: exit,
      liqQty: 0,
      marginMode: null,
      positionMode: hedge ? "hedge" : "one_way",
      leverage: null,
      fee: a.fee,
      funding: 0,
      realizedPnl: a.pnl,
      liqPrice: null,
      openedAt: a.openedAt,
      closedAt: a.closedAt,
    },
    fills: a.fills,
  };
}

/**
 * USDⓈ-M futures: one-way (`both`: a fill through zero closes and opens the opposite side) and hedge (`long` / `short`
 * legs, each leg its own position). `fills` may contain several symbols and may overlap with earlier reads.
 */
export function groupFuturesFills(fills: readonly BnFill[]): GroupResult {
  const out: GroupResult = { positions: [], orphanFills: 0, unknownFees: 0, open: [] };
  const groups = new Map<string, BnFill[]>();
  const seen = new Set<string>();
  for (const f of fills) {
    if (!(f.qty > 0) || !(f.price > 0)) continue;
    const dedup = `${f.symbol}:${f.id}`;
    if (seen.has(dedup)) continue; // the same fill read twice (overlapping pages / windows)
    seen.add(dedup);
    const k = `${f.symbol}|${f.positionSide}`;
    const list = groups.get(k);
    if (list) list.push(f);
    else groups.set(k, [f]);
  }
  for (const list of groups.values()) {
    list.sort(byTime);
    const hedge = list[0]!.positionSide !== "both";
    let acc: Acc | null = null;
    const startFill = (f: BnFill, dir: 1 | -1): Acc => newAcc(f, dir, "futures");
    for (const f of list) {
      const fdir: 1 | -1 = f.side === "buy" ? 1 : -1;
      if (f.feeUnknown) out.unknownFees++;
      if (!acc) {
        const opens = hedge ? (f.positionSide === "long" ? fdir === 1 : fdir === -1) : f.realizedPnl === 0;
        if (!opens) {
          out.orphanFills++;
          continue;
        }
        acc = startFill(f, hedge ? (f.positionSide === "long" ? 1 : -1) : fdir);
      }
      if (fdir === acc.dir) {
        acc.qty += f.qty;
        acc.maxQty = Math.max(acc.maxQty, acc.qty);
        acc.openQty += f.qty;
        acc.openNotional += f.qty * f.price;
        acc.fee += f.fee;
        acc.closedAt = f.at;
        acc.fills.push(venueFill(f, f.qty, f.fee, 0));
        continue;
      }
      // closing (maybe through zero)
      const closeQ = Math.min(f.qty, acc.qty);
      const share = closeQ / f.qty;
      acc.qty -= closeQ;
      acc.closeQty += closeQ;
      acc.closeNotional += closeQ * f.price;
      acc.fee += f.fee * share;
      acc.pnl += f.realizedPnl;
      acc.closedAt = f.at;
      acc.fills.push(venueFill(f, closeQ, f.fee * share, f.realizedPnl));
      const rest = f.qty - closeQ;
      if (acc.qty <= EPS * Math.max(1, acc.maxQty)) {
        out.positions.push(finish(acc, hedge));
        acc = null;
        if (rest > EPS) {
          if (hedge) out.orphanFills++;
          else {
            const flip = startFill(f, fdir);
            flip.qty = rest;
            flip.maxQty = rest;
            flip.openQty = rest;
            flip.openNotional = rest * f.price;
            flip.fee = f.fee * (rest / f.qty);
            flip.fills.push(venueFill(f, rest, flip.fee, 0, ".o"));
            acc = flip;
          }
        }
      }
    }
    if (acc && acc.qty > EPS) out.open.push({ symbol: acc.symbol, side: acc.dir === 1 ? "long" : "short", qty: acc.qty });
  }
  out.positions.sort((a, b) => a.position.closedAt - b.position.closedAt || (a.position.positionId < b.position.positionId ? -1 : 1));
  return out;
}

/** Spot: long only, average cost. `qtyNet` is what was really bought/sold (base-coin fees already deducted). */
export function groupSpotFills(fills: readonly BnFill[]): GroupResult {
  const out: GroupResult = { positions: [], orphanFills: 0, unknownFees: 0, open: [] };
  const bySymbol = new Map<string, BnFill[]>();
  const seen = new Set<string>();
  for (const f of fills) {
    if (!(f.qty > 0) || !(f.price > 0)) continue;
    const dedup = `${f.symbol}:${f.id}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    const list = bySymbol.get(f.symbol);
    if (list) list.push(f);
    else bySymbol.set(f.symbol, [f]);
  }
  for (const list of bySymbol.values()) {
    list.sort(byTime);
    let acc: Acc | null = null;
    let avgCost = 0;
    for (const f of list) {
      if (f.feeUnknown) out.unknownFees++;
      if (f.side === "buy") {
        acc ??= newAcc(f, 1, "spot");
        const net = f.qtyNet > 0 ? f.qtyNet : f.qty;
        avgCost = (acc.qty * avgCost + net * f.price) / (acc.qty + net);
        acc.qty += net;
        acc.maxQty = Math.max(acc.maxQty, acc.qty);
        acc.openQty += net;
        acc.openNotional += net * f.price;
        acc.fee += f.fee;
        acc.closedAt = f.at;
        acc.fills.push(venueFill(f, net, f.fee, 0));
        continue;
      }
      if (!acc) {
        out.orphanFills++; // a sale of coins bought before the history that was read
        continue;
      }
      const closeQ = Math.min(f.qty, acc.qty);
      const share = closeQ / f.qty;
      acc.qty -= closeQ;
      acc.closeQty += closeQ;
      acc.closeNotional += closeQ * f.price;
      acc.fee += f.fee * share;
      acc.pnl += (f.price - avgCost) * closeQ;
      acc.closedAt = f.at;
      acc.fills.push(venueFill(f, closeQ, f.fee * share, (f.price - avgCost) * closeQ));
      // flat: nothing left, or dust below 0.1 % of the largest holding (lot-size rounding)
      if (acc.qty <= Math.max(EPS, 0.001 * acc.maxQty)) {
        out.positions.push(finish(acc, false));
        acc = null;
        avgCost = 0;
      }
    }
    if (acc && acc.qty > EPS) out.open.push({ symbol: acc.symbol, side: "long", qty: acc.qty });
  }
  out.positions.sort((a, b) => a.position.closedAt - b.position.closedAt || (a.position.positionId < b.position.positionId ? -1 : 1));
  return out;
}

/** One funding payment of the income history (signed: negative = paid). */
export interface FundingRow {
  symbol: string;
  amount: number;
  at: number;
}

/**
 * Funding payments belong to the position that was open when they were booked. In hedge mode two legs of one symbol are
 * open at once and the income row does not say which one paid – the amount is split evenly between them.
 */
export function allocateFunding(positions: readonly VenueClosedPosition[], rows: readonly FundingRow[]): void {
  for (const r of rows) {
    const hit = positions.filter((p) => p.symbol === r.symbol && r.at >= p.openedAt && r.at <= p.closedAt);
    if (!hit.length) continue;
    for (const p of hit) p.funding = Math.round((p.funding + r.amount / hit.length) * 1e8) / 1e8;
  }
}

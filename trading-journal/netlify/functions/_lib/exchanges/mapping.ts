/**
 * Venue position → journal trade (P11). PURE: no I/O, no clock (the caller passes `nowIso`), used by the sync and the
 * unit tests. The record follows `src/domain/types.ts` `Trade` (Journal v3 fields) and the field ownership of
 * `src/exchanges/syncFields.ts` (SET / FILL / trader-owned).
 *
 * Bitunix semantics (docs "Get History Positions", cross-checked with a production integration):
 * - `realizedPNL` EXCLUDES trading fees and funding; `fee` = fees deducted during the position (cost, reported positive);
 *   `funding` = funding total, NEGATIVE when paid (doc example "-0.2"). So
 *     net P&L = realizedPNL − |fee| + funding,   fundingFees (journal: positive = paid) = −funding.
 *   Because the docs were wrong before (timestamp unit, endTime text), `detectPnlConvention` checks real positions:
 *   when realizedPNL matches (close − entry) × qty − |fee| instead of the plain gross move, the fees are already inside
 *   and are not subtracted twice. The dry run shows both numbers per position.
 * - `maxQty` = largest quantity held → `qty`; `size` = qty × entry (notional in quote currency, `derive.ts`).
 * - `ctime` / `mtime` = open / last change (epoch ms) → `date` / `exitDate` as LOCAL wall clock of the user's time
 *   zone (`profiles.tz`, or the browser's zone sent with a manual sync).
 * - Stop / target from the TP/SL history of the position (oldest first): first SL = stop, first TP = target, several
 *   SL prices → `stopHistory`, several TP prices → `targets`. Only FILL keys: a stop the trader typed wins.
 * - Fills from the trade history: BUY opens a long / closes a short and vice versa; kept only when they add up to a flat
 *   position (a cut-off page never produces a half fill list).
 */
import { splitSyncFields, syncedTradeId } from "../../../../src/exchanges/syncFields";
import type { ExchangeId, VenueClosedPosition, VenueFill, VenueOpenPosition, VenueTicker, VenueTpSl } from "./types";

export const DEFAULT_TZ = "Europe/Berlin";

/** Journal trade as written by the sync (a `Trade` record; kept structural to stay alias-free). */
export type SyncedTrade = Record<string, unknown> & { id: string };

export interface PnlConvention {
  /** true: realizedPNL already contains the fees; false: it is the gross move (documented); null: not decided. */
  feesIncluded: boolean | null;
  /** Positions that allowed a decision / voted for each answer. */
  samples: number;
  votesExcluded: number;
  votesIncluded: number;
}

export interface MapContext {
  exchange: ExchangeId;
  /** IANA zone for `date` / `exitDate` / fill times. */
  tz: string;
  journalAccount: "makro" | "scalp";
  /** Connection label → `exchangeAccount` (omitted when empty). */
  exchangeAccount?: string;
  nowIso: string;
  /** Decided convention; null / undefined → documented (fees excluded). */
  feesIncluded?: boolean | null;
  tpsl?: readonly VenueTpSl[];
  fills?: readonly VenueFill[] | null;
}

export interface MappedPosition {
  trade: SyncedTrade;
  /** Payload of `upsert_synced_trades`. */
  item: { id: string; set: Record<string, unknown>; fill: Record<string, unknown>; new: Record<string, unknown> };
  /** What the dry run shows per position (raw venue numbers next to the journal numbers). */
  check: PositionCheck;
}

export interface PositionCheck {
  id: string;
  externalId: string;
  pair: string;
  side: "long" | "short";
  date: string;
  exitDate: string;
  qty: number;
  entry: number;
  exit: number;
  /** (exit − entry) × qty × dir. */
  gross: number;
  realizedPnl: number;
  fee: number;
  funding: number;
  /** Journal net P&L (`pnlManual`). */
  net: number;
  fills: number;
  stop: number | null;
  target: number | null;
}

/* ------------------------------------------------------------------ small helpers */

export const round = (n: number, digits = 8): number => {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** digits;
  const v = Math.round(n * f) / f;
  return Object.is(v, -0) ? 0 : v;
};

const QUOTES = ["USDT", "USDC", "FDUSD", "BUSD", "USD", "EUR", "BTC", "ETH"] as const;

/** `BTCUSDT` → `BTC/USDT` (the journal's pair format); unknown quotes stay as they are. */
export function symbolToPair(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const q of QUOTES) if (s.length > q.length && s.endsWith(q)) return `${s.slice(0, -q.length)}/${q}`;
  return s || symbol;
}

/** `BTC/USDT` → `BTCUSDT`. */
export function pairToSymbol(pair: string): string {
  return pair.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** A valid IANA zone, else `DEFAULT_TZ`. */
export function safeTz(tz: unknown): string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

/** Epoch ms → local wall clock `YYYY-MM-DDTHH:mm` (`seconds` adds `:ss`) in `tz`. */
export function localWallClock(ms: number, tz: string, seconds = false): string {
  const zone = safeTz(tz);
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    fmtCache.set(zone, f);
  }
  const parts: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) parts[p.type] = p.value;
  const hh = parts.hour === "24" ? "00" : parts.hour;
  const base = `${parts.year}-${parts.month}-${parts.day}T${hh}:${parts.minute}`;
  return seconds ? `${base}:${parts.second}` : base;
}

/* ------------------------------------------------------------------ P&L convention */

const gross = (p: Pick<VenueClosedPosition, "side" | "entryPrice" | "closePrice" | "maxQty">): number =>
  (p.closePrice - p.entryPrice) * p.maxQty * (p.side === "short" ? -1 : 1);

/**
 * Decides on real positions whether `realizedPNL` already contains the fees. Only clean positions vote (no liquidation,
 * a fee, prices and quantity present); a decision needs ≥ 3 votes with ≥ 80 % agreement, else `feesIncluded: null`.
 */
export function detectPnlConvention(positions: readonly VenueClosedPosition[]): PnlConvention {
  let ex = 0;
  let inc = 0;
  for (const p of positions) {
    const fee = Math.abs(p.fee);
    if (p.liqQty > 0 || p.maxQty <= 0 || p.entryPrice <= 0 || p.closePrice <= 0 || fee <= 0) continue;
    const g = gross(p);
    const tol = Math.max(0.01, Math.abs(g) * 1e-4);
    const dEx = Math.abs(p.realizedPnl - g);
    const dIn = Math.abs(p.realizedPnl - (g - fee));
    if (dEx <= tol && dIn > tol) ex++;
    else if (dIn <= tol && dEx > tol) inc++;
  }
  const samples = ex + inc;
  let feesIncluded: boolean | null = null;
  if (samples >= 3) {
    if (ex / samples >= 0.8) feesIncluded = false;
    else if (inc / samples >= 0.8) feesIncluded = true;
  }
  return { feesIncluded, samples, votesExcluded: ex, votesIncluded: inc };
}

/** Journal net P&L of a closed position: realized − fees (unless already inside) − funding paid. */
export function netPnl(p: Pick<VenueClosedPosition, "realizedPnl" | "fee" | "funding">, feesIncluded: boolean | null | undefined): number {
  const feeCost = feesIncluded ? 0 : Math.abs(p.fee);
  const fundingPaid = -p.funding;
  return round(p.realizedPnl - feeCost - fundingPaid);
}

/* ------------------------------------------------------------------ TP / SL */

export interface StopTarget {
  stop: number | null;
  target: number | null;
  stopHistory?: { at: string; price: number; source: "exchange" }[];
  targets?: { price: number; pct?: number | null; qty?: number | null; label?: string }[];
}

/** Stop / target / history / ladder of one position from its TP/SL orders (any order; sorted here, oldest first). */
export function stopTargetOf(orders: readonly VenueTpSl[], tz: string, maxQty: number): StopTarget {
  const sorted = [...orders].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const sls: { at: number; price: number }[] = [];
  const tps = new Map<number, number | null>();
  for (const o of sorted) {
    if (o.slPrice !== null && (!sls.length || sls[sls.length - 1]!.price !== o.slPrice)) sls.push({ at: o.createdAt, price: o.slPrice });
    if (o.tpPrice !== null && !tps.has(o.tpPrice)) tps.set(o.tpPrice, o.tpQty);
  }
  const out: StopTarget = { stop: sls[0]?.price ?? null, target: tps.size ? [...tps.keys()][0]! : null };
  if (sls.length > 1) out.stopHistory = sls.map((s) => ({ at: localWallClock(s.at, tz), price: s.price, source: "exchange" as const }));
  if (tps.size > 1) {
    out.targets = [...tps].map(([price, qty]) => ({
      price,
      qty: qty ?? null,
      pct: qty !== null && maxQty > 0 ? round(Math.min(100, (qty / maxQty) * 100), 2) : null,
    }));
  }
  return out;
}

/* ------------------------------------------------------------------ fills */

const QTY_TOL = 1e-6;

/**
 * Journal fills of a position, oldest first, or null when they do not describe a complete (flat) position.
 * `kind`: first opening fill `entry`, later openings `add`, closings `partial` until the last one (`exit`).
 */
export function fillsOf(fills: readonly VenueFill[], side: "long" | "short", tz: string): Record<string, unknown>[] | null {
  if (!fills.length) return null;
  const sorted = [...fills].sort((a, b) => a.at - b.at || a.tradeId.localeCompare(b.tradeId));
  const opens = (f: VenueFill): boolean => {
    if (f.side) return side === "long" ? f.side === "buy" : f.side === "sell";
    if (f.reduceOnly !== null) return !f.reduceOnly;
    return f.realizedPnl === 0;
  };
  let open = 0;
  let opened = 0;
  let closed = 0;
  const out: Record<string, unknown>[] = [];
  for (const f of sorted) {
    if (!(f.qty > 0) || !(f.price > 0)) return null;
    const isOpen = opens(f);
    let kind: string;
    if (isOpen) {
      kind = opened > 0 ? "add" : "entry";
      open += f.qty;
      opened += f.qty;
    } else {
      open -= f.qty;
      closed += f.qty;
      kind = open <= QTY_TOL * Math.max(1, opened) ? "exit" : "partial";
    }
    const fill: Record<string, unknown> = {
      id: `bx_${f.tradeId}`,
      at: localWallClock(f.at, tz, true),
      side: isOpen ? "open" : "close",
      price: f.price,
      qty: f.qty,
      kind,
    };
    if (f.fee !== 0) fill.fee = round(Math.abs(f.fee));
    out.push(fill);
  }
  if (opened <= 0 || Math.abs(opened - closed) > QTY_TOL * Math.max(1, opened)) return null;
  return out;
}

/* ------------------------------------------------------------------ closed position → trade */

/** Maps one closed position (plus its TP/SL orders and fills, when fetched) to the journal record and the upsert item. */
export function mapClosedPosition(p: VenueClosedPosition, ctx: MapContext): MappedPosition {
  const tz = safeTz(ctx.tz);
  const id = syncedTradeId(ctx.exchange, p.positionId);
  const side = p.side;
  const qty = p.maxQty;
  const entry = p.entryPrice;
  const exit = p.closePrice;
  const net = netPnl(p, ctx.feesIncluded);
  const st = stopTargetOf((ctx.tpsl ?? []).filter((o) => o.positionId === p.positionId), tz, qty);
  const fills = ctx.fills ? fillsOf(ctx.fills, side, tz) : null;
  const risk = st.stop !== null && entry > 0 && qty > 0 ? Math.abs(entry - st.stop) * qty : 0;

  const set: Record<string, unknown> = {
    exchange: ctx.exchange,
    externalId: p.positionId,
    syncSource: `${ctx.exchange}-api`,
    syncedAt: ctx.nowIso,
    origin: { kind: "api" },
    market: "perp",
    side,
    status: "closed",
    date: localWallClock(p.openedAt, tz),
    exitDate: localWallClock(p.closedAt, tz),
    pair: symbolToPair(p.symbol),
    entry: entry > 0 ? entry : null,
    exit: exit > 0 ? exit : null,
    qty: qty > 0 ? qty : null,
    size: qty > 0 && entry > 0 ? round(qty * entry) : null,
    leverage: p.leverage,
    fees: round(Math.abs(p.fee)),
    fundingFees: round(-p.funding),
    pnlManual: net,
    pnl: net,
  };
  if (ctx.exchangeAccount) set.exchangeAccount = ctx.exchangeAccount;
  if (p.marginMode) set.marginMode = p.marginMode;
  if (fills) set.fills = fills;

  const fill: Record<string, unknown> = {};
  if (st.stop !== null) fill.stop = st.stop;
  if (st.target !== null) fill.target = st.target;
  if (st.stopHistory) fill.stopHistory = st.stopHistory;
  if (st.targets) fill.targets = st.targets;
  if (p.liqPrice !== null) fill.liqPrice = p.liqPrice;

  const fresh: Record<string, unknown> = {
    account: ctx.journalAccount,
    timeframe: "",
    stop: null,
    target: null,
    setups: [],
    checks: {},
    conviction: null,
    followedPlan: null,
    emotion: "",
    reason: "",
    notes: "",
    chart: "",
    mistakes: [],
    r: risk > 0 ? round(net / risk, 4) : null,
    createdAt: ctx.nowIso,
  };

  // `splitSyncFields` is the single source of the ownership rule; the item carries exactly its split.
  const split = splitSyncFields({ ...set, ...fill });
  const trade: SyncedTrade = { ...fresh, ...fill, ...set, id, updatedAt: ctx.nowIso };
  return {
    trade,
    item: { id, set: split.set, fill: split.fill, new: fresh },
    check: {
      id,
      externalId: p.positionId,
      pair: set.pair as string,
      side,
      date: set.date as string,
      exitDate: set.exitDate as string,
      qty,
      entry,
      exit,
      gross: round(gross(p)),
      realizedPnl: p.realizedPnl,
      fee: p.fee,
      funding: p.funding,
      net,
      fills: fills?.length ?? 0,
      stop: st.stop,
      target: st.target,
    },
  };
}

/* ------------------------------------------------------------------ open position → live position (P05 contract) */

/** Shape of `src/exchanges/positions.ts` `ExchangePosition` (kept structural – the functions cannot import aliases). */
export interface LivePosition {
  id: string;
  exchange: ExchangeId;
  account?: string;
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry: number;
  mark: number | null;
  notional: number;
  leverage: number | null;
  marginMode: "isolated" | "cross" | null;
  margin: number | null;
  liqPrice: number | null;
  unrealizedPnl: number | null;
  fundingFees: number | null;
  openedAt: number | null;
  updatedAt: number;
}

/** Open venue position → live position; the mark comes from the ticker, else from the unrealized P&L. */
export function mapOpenPosition(p: VenueOpenPosition, exchange: ExchangeId, ticker: VenueTicker | undefined, nowMs: number, account?: string): LivePosition {
  const dir = p.side === "short" ? -1 : 1;
  const derived = p.unrealizedPnl !== null && p.qty > 0 && p.entryPrice > 0 ? p.entryPrice + p.unrealizedPnl / (p.qty * dir) : null;
  const mark = ticker?.markPrice ?? ticker?.lastPrice ?? (derived !== null && derived > 0 ? round(derived, 8) : null);
  const out: LivePosition = {
    id: p.positionId,
    exchange,
    symbol: p.symbol,
    side: p.side,
    qty: p.qty,
    entry: p.entryPrice,
    mark,
    notional: round(p.qty * (mark ?? p.entryPrice), 8),
    leverage: p.leverage,
    marginMode: p.marginMode,
    margin: p.margin,
    liqPrice: p.liqPrice,
    unrealizedPnl: p.unrealizedPnl,
    fundingFees: round(-p.funding),
    openedAt: p.openedAt || null,
    updatedAt: p.updatedAt || nowMs,
  };
  if (account) out.account = account;
  return out;
}

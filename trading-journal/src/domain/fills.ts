/**
 * Executions of one position (Journal v3, P06): Ø entry / Ø exit, realised P&L per partial exit, remaining quantity and
 * the DCA picture – pure, no React, no I/O.
 *
 * Accounting: average cost. Fills are processed in time order (`at`, a local wall clock like `Trade.date`; fills
 * without a parsable time keep their stored order behind the timed ones). An `open` fill raises the position and moves
 * the running Ø entry; a `close` fill realises `(price − Ø entry) × qty × dir` against the Ø entry AT THAT MOMENT, so a
 * DCA add after a partial exit never rewrites the P&L of the part already taken. A close larger than the open position
 * (data out of order) is valued against the overall Ø entry instead of failing.
 *
 * Fees: `Fill.fee` is in `settings.currency` (positive = paid). The trade's own `fees` field stays the total that the
 * derivation subtracts; fill fees only stand in when `fees` is empty (`effectiveFees`) – never both.
 */
import type { Fill, FillKind, Side, Trade } from "./types";

/** Quantities below this are rounding noise (a "fully closed" position may keep 1e-12 contracts). */
export const QTY_EPS = 1e-9;

export interface FillPart {
  id: string;
  at: string;
  kind: FillKind;
  price: number;
  qty: number;
  /** Ø entry the part was valued against. */
  basis: number;
  /** Gross realised P&L of this part (before fees), in quote currency. */
  pnl: number;
  /** Share of the total opened quantity (0–1). */
  share: number;
  /** Fee of this fill (0 when unknown). */
  fee: number;
}

export interface DcaStats {
  /** Number of opening fills (first entry + adds). */
  entries: number;
  /** Fills marked `add` or every opening fill after the first. */
  adds: number;
  /** Price of the first opening fill. */
  first: number;
  /** Price of the last opening fill. */
  last: number;
  /** Lowest / highest opening price. */
  low: number;
  high: number;
  /** (high − low) ÷ first – how far the entries are spread. */
  spread: number;
  /**
   * How much the averaging helped (+) or hurt (−) against the first entry, as a fraction of the first price, signed in
   * the trade's favour: long Ø below the first price → positive.
   */
  improvement: number;
}

export interface FillStats {
  /** Fills in processing order (time order). */
  ordered: Fill[];
  openQty: number;
  closeQty: number;
  /** Still open (≥ 0). */
  remaining: number;
  /** Quantity-weighted Ø of the opening fills, `null` without one. */
  avgEntry: number | null;
  /** Quantity-weighted Ø of the closing fills, `null` without one. */
  avgExit: number | null;
  /** Σ realised gross P&L of the closing fills (before fees); 0 without one. */
  realized: number;
  /** Per closing fill (partials and the final exit). */
  parts: FillPart[];
  /** Σ fill fees; `feesKnown` = at least one fill carries a fee. */
  fees: number;
  feesKnown: boolean;
  /** Largest position held at any time. */
  peakQty: number;
  /** `null` with fewer than 2 opening fills. */
  dca: DcaStats | null;
  /** Something was opened and everything opened has been closed again. */
  flat: boolean;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Milliseconds of a fill time, `NaN` when it does not parse. */
function fillTime(at: string): number {
  if (!at) return NaN;
  return new Date(at).getTime();
}

/** Valid fills (price and qty > 0) in time order; untimed fills keep their order after the timed ones. */
export function orderFills(fills: readonly Fill[] | undefined | null): Fill[] {
  if (!fills?.length) return [];
  const valid = fills
    .map((f, i) => ({ f, i, t: fillTime(f.at) }))
    .filter(({ f }) => fin(f.price) && f.price > 0 && fin(f.qty) && f.qty > 0);
  return valid
    .sort((a, b) => {
      const ta = Number.isNaN(a.t) ? Infinity : a.t;
      const tb = Number.isNaN(b.t) ? Infinity : b.t;
      return ta === tb ? a.i - b.i : ta - tb;
    })
    .map(({ f }) => f);
}

/** True when the trade carries at least one usable opening fill – only then does the derivation use the fills. */
export function hasFills(t: { fills?: readonly Fill[] | null }): boolean {
  return orderFills(t.fills ?? undefined).some((f) => f.side === "open");
}

/** Full statistics of a trade's fills (`side` decides the sign of the realised P&L). */
export function fillStats(fills: readonly Fill[] | undefined | null, side: Side = "long"): FillStats {
  const ordered = orderFills(fills);
  const dir = side === "short" ? -1 : 1;
  let pos = 0;
  let cost = 0; // running Ø entry
  let openQty = 0;
  let openNotional = 0;
  let closeQty = 0;
  let closeNotional = 0;
  let peakQty = 0;
  let fees = 0;
  let feesKnown = false;
  const opens: Fill[] = [];
  const pending: { f: Fill; basis: number | null }[] = [];

  for (const f of ordered) {
    if (fin(f.fee)) {
      fees += f.fee;
      feesKnown = true;
    }
    if (f.side === "open") {
      cost = pos > QTY_EPS ? (cost * pos + f.price * f.qty) / (pos + f.qty) : f.price;
      pos += f.qty;
      openQty += f.qty;
      openNotional += f.price * f.qty;
      opens.push(f);
      peakQty = Math.max(peakQty, pos);
    } else {
      // a close beyond the open position is valued against the overall Ø entry (resolved after the loop)
      const covered = pos > QTY_EPS;
      pending.push({ f, basis: covered ? cost : null });
      pos = Math.max(0, pos - f.qty);
      closeQty += f.qty;
      closeNotional += f.price * f.qty;
    }
  }

  const avgEntry = openQty > QTY_EPS ? openNotional / openQty : null;
  const avgExit = closeQty > QTY_EPS ? closeNotional / closeQty : null;
  const parts: FillPart[] = [];
  let realized = 0;
  for (const { f, basis } of pending) {
    const b = basis ?? avgEntry;
    const pnl = b == null ? 0 : (f.price - b) * f.qty * dir;
    realized += pnl;
    parts.push({ id: f.id, at: f.at, kind: f.kind, price: f.price, qty: f.qty, basis: b ?? f.price, pnl, share: openQty > QTY_EPS ? f.qty / openQty : 0, fee: fin(f.fee) ? f.fee : 0 });
  }

  let dca: DcaStats | null = null;
  if (opens.length >= 2 && avgEntry != null) {
    const prices = opens.map((f) => f.price);
    const first = prices[0]!;
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    dca = {
      entries: opens.length,
      adds: Math.max(opens.filter((f) => f.kind === "add").length, opens.length - 1),
      first,
      last: prices[prices.length - 1]!,
      low,
      high,
      spread: first > 0 ? (high - low) / first : 0,
      improvement: first > 0 ? ((first - avgEntry) / first) * dir : 0,
    };
  }

  const remaining = Math.max(0, openQty - closeQty);
  return {
    ordered,
    openQty,
    closeQty,
    remaining: remaining > QTY_EPS ? remaining : 0,
    avgEntry,
    avgExit,
    realized,
    parts,
    fees,
    feesKnown,
    peakQty,
    dca,
    flat: openQty > QTY_EPS && remaining <= QTY_EPS * Math.max(1, openQty),
  };
}

/** The fee total the derivation subtracts: the trade's `fees` when set, else the Σ of the fill fees, else 0. */
export function effectiveFees(t: Pick<Trade, "fees"> & { fills?: readonly Fill[] | null }): number {
  if (fin(t.fees)) return t.fees;
  const s = fillStats(t.fills ?? undefined);
  return s.feesKnown ? s.fees : 0;
}

/**
 * Position figures the derivation works with when fills exist:
 * - `entry` = Ø entry, `qty` = Σ opened quantity;
 * - `gross` = realised P&L of the closing fills plus the remainder valued at `exit` (when the trade is closed and an
 *   exit price is given). `null` when a closed trade still has an open remainder without an exit price (incomplete);
 * - `exit` = quantity-weighted Ø of everything closed (fills + remainder at `exit`).
 */
export interface FillPosition {
  entry: number;
  qty: number;
  gross: number | null;
  exit: number | null;
}

export function fillPosition(t: Pick<Trade, "exit" | "side" | "status"> & { fills?: readonly Fill[] | null }): FillPosition | null {
  const s = fillStats(t.fills ?? undefined, t.side);
  if (s.avgEntry == null) return null;
  const closed = t.status !== "open";
  const dir = t.side === "short" ? -1 : 1;
  let gross: number | null = s.realized;
  let exitNotional = s.avgExit != null ? s.avgExit * s.closeQty : 0;
  let exitQty = s.closeQty;
  if (s.remaining > 0) {
    if (closed && fin(t.exit) && t.exit > 0) {
      // the rest is valued against the Ø entry still held (= running cost after the last fill)
      const held = runningCost(s.ordered) ?? s.avgEntry;
      gross += (t.exit - held) * s.remaining * dir;
      exitNotional += t.exit * s.remaining;
      exitQty += s.remaining;
    } else if (closed) gross = null;
  }
  return { entry: s.avgEntry, qty: s.openQty, gross: closed ? gross : null, exit: exitQty > QTY_EPS ? exitNotional / exitQty : null };
}

/** Ø entry of the position still held after all fills (`null` when flat or never opened). */
export function runningCost(ordered: readonly Fill[]): number | null {
  let pos = 0;
  let cost = 0;
  for (const f of ordered) {
    if (f.side === "open") {
      cost = pos > QTY_EPS ? (cost * pos + f.price * f.qty) / (pos + f.qty) : f.price;
      pos += f.qty;
    } else pos = Math.max(0, pos - f.qty);
  }
  return pos > QTY_EPS ? cost : null;
}

/**
 * Position bar segments for the UI (`FillsRail`): each closing part as a slice of the opened quantity (0–1, in time
 * order) plus the remainder. `tone` = sign of the part's P&L.
 */
export interface PositionSlice {
  id: string;
  from: number;
  to: number;
  tone: "win" | "loss" | "be" | "open";
  label: string;
}

export function positionSlices(s: FillStats): PositionSlice[] {
  if (s.openQty <= QTY_EPS) return [];
  const out: PositionSlice[] = [];
  let at = 0;
  s.parts.forEach((p, i) => {
    const w = Math.min(1 - at, p.share);
    if (w <= 0) return;
    out.push({ id: p.id || `p${i}`, from: at, to: at + w, tone: p.pnl > 0 ? "win" : p.pnl < 0 ? "loss" : "be", label: p.kind === "exit" ? "Ausstieg" : `Teil ${i + 1}` });
    at += w;
  });
  if (at < 1 - 1e-9) out.push({ id: "rest", from: at, to: 1, tone: "open", label: "Offen" });
  return out;
}

/** Fill kind labels (German UI). */
export const FILL_KIND_LABELS: Record<FillKind, string> = { entry: "Einstieg", add: "Nachkauf", partial: "Teil-Exit", exit: "Ausstieg" };

/** The natural kind of a new fill: first opening fill = entry, later ones = add; a close that flattens = exit. */
export function nextFillKind(existing: readonly Fill[], side: Fill["side"]): FillKind {
  if (side === "open") return existing.some((f) => f.side === "open") ? "add" : "entry";
  return "partial";
}

/**
 * Re-labels the closing fills: the one that brings the position to flat is `exit`, earlier ones `partial` (opening
 * fills: the first `entry`, the rest `add`). Returns a new array in the input order.
 */
export function relabelFills(fills: readonly Fill[]): Fill[] {
  const ordered = orderFills(fills);
  const kinds = new Map<Fill, FillKind>();
  let pos = 0;
  let opened = false;
  for (const f of ordered) {
    if (f.side === "open") {
      kinds.set(f, opened ? "add" : "entry");
      opened = true;
      pos += f.qty;
    } else {
      pos = Math.max(0, pos - f.qty);
      kinds.set(f, pos <= QTY_EPS ? "exit" : "partial");
    }
  }
  return fills.map((f) => (kinds.has(f) ? { ...f, kind: kinds.get(f)! } : f));
}

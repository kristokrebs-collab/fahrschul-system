/**
 * „Einstieg aus PnL berechnen“ (F29) – pure. A closing order whose opening order is NOT in the picture still carries the
 * exit price, the closed quantity and the realised PnL. For a position that was closed in one go:
 *
 *   Long : PnL = (Ausstieg − Einstieg) × Menge   →   Einstieg = Ausstieg − PnL ÷ Menge
 *   Short: PnL = (Einstieg − Ausstieg) × Menge   →   Einstieg = Ausstieg + PnL ÷ Menge
 *
 * This is an ASSUMPTION, never a reading, and two things in it the screenshot does not settle:
 *   - whether the exchange's „Realisierter PnL“ is before fees (`gross`) or already after the fee of the closing order
 *     (`net`; then the gross result is PnL + fee, and the entry moves by fee ÷ Menge),
 *   - that the whole position was closed by this one order (a partial close leaves the entry of the closed part right,
 *     but the position's size larger).
 * The offer shows both variants and the difference; nothing is applied unless the trader presses a button.
 */
import type { Side } from "@/domain/types";
import { averagePrice, totalQty, type Candidate } from "./candidate";

export type ImpliedBasis = "gross" | "net";

export interface ImpliedEntry {
  basis: ImpliedBasis;
  /** The computed entry price (8 significant digits). */
  price: number;
}

export interface ImpliedEntries {
  /** Realised PnL read as before fees. */
  gross: ImpliedEntry;
  /** Realised PnL read as already after the visible fee; `null` without a fee. */
  net: ImpliedEntry | null;
  /** Difference between the two variants in the money unit (= the fee) and in price points. */
  diffMoney: number | null;
  diffPrice: number | null;
  qty: number;
  exit: number;
  pnl: number;
  fee: number | null;
  side: Side;
}

const sig = (n: number): number => Number(n.toPrecision(8));

/** Entry from exit, closed quantity and a gross result. */
export function entryFromResult(side: Side, exit: number, qty: number, result: number): number {
  return side === "long" ? exit - result / qty : exit + result / qty;
}

/**
 * The offer for a candidate that has closing orders but no opening order, or `null` when it does not apply (an entry
 * exists, side / exit / quantity / result unknown, or the computed price would not be positive).
 */
export function impliedEntries(c: Pick<Candidate, "entries" | "exits" | "side" | "pnl" | "fees" | "status">): ImpliedEntries | null {
  const side = c.side.value;
  const pnl = c.pnl.value;
  if (c.status !== "closed" || c.entries.length || !c.exits.length || !side || pnl == null) return null;
  const exit = averagePrice(c.exits);
  const qty = totalQty(c.exits);
  if (exit == null || qty == null || !(qty > 0) || !(exit > 0)) return null;
  const fee = c.fees.value != null && c.fees.value > 0 ? c.fees.value : null;
  const gross = entryFromResult(side, exit, qty, pnl);
  if (!(gross > 0)) return null;
  const net = fee != null ? entryFromResult(side, exit, qty, pnl + fee) : null;
  if (net != null && !(net > 0)) return null;
  return {
    gross: { basis: "gross", price: sig(gross) },
    net: net == null ? null : { basis: "net", price: sig(net) },
    diffMoney: fee,
    diffPrice: net == null ? null : Math.abs(net - gross),
    qty,
    exit,
    pnl,
    fee,
    side,
  };
}

/**
 * Per-trade derivation – 1:1 port of bundle `qw` (21237–21260).
 * Leverage is never used; `size` is the position value incl. leverage, qty = size / entry.
 * Fees are subtracted only from the automatic P&L; `pnlManual` is used as-is.
 *
 * Journal v3 (P06), strictly additive – a record without these fields derives exactly as before:
 * - `fills` with at least one opening fill: Ø entry and the opened quantity replace `entry` / `size`, the realised P&L of
 *   the closing fills (plus a remainder valued at `exit`) replaces `(exit − entry) × qty` (`fills.ts`).
 * - `fundingFees` (positive = paid) is subtracted from the automatic P&L only when it is a number.
 * - `qty` stands in for `size / entry` only when `size` is empty.
 */
import type { AccountId, Fill, Trade, TradeResult } from "./types";
import { ED } from "./edition";
import { isFin } from "@/lib/format";
import { effectiveFees, fillPosition, hasFills } from "./fills";

export interface Derived {
  pnl: number | null;
  risk: number | null;
  r: number | null;
  rr: number | null;
  move: number | null;
  result: TradeResult;
}

export type DeriveInput = Pick<Trade, "entry" | "exit" | "stop" | "target" | "size" | "fees" | "pnlManual"> &
  Partial<Pick<Trade, "side" | "status" | "fundingFees" | "qty">> & { fills?: readonly Fill[] | null };

export function deriveTrade(t: DeriveInput): Derived {
  if (t.fills && t.fills.length && hasFills(t)) return deriveFromFills(t);
  const entry = t.entry || 0;
  const exit = t.exit || 0;
  const stop = t.stop || 0;
  const target = t.target || 0;
  const size = t.size || 0;
  const fees = t.fees || 0;
  const dir = t.side === "short" ? -1 : 1;
  const qty = entry > 0 && size > 0 ? size / entry : entry > 0 && isFin(t.qty) && t.qty > 0 ? t.qty : 0;
  const closed = t.status !== "open";

  let pnl: number | null = null;
  if (isFin(t.pnlManual)) pnl = t.pnlManual;
  else if (closed && entry > 0 && exit > 0 && qty) pnl = (exit - entry) * qty * dir - fees - (isFin(t.fundingFees) ? t.fundingFees : 0);

  const risk = entry > 0 && stop > 0 && qty ? Math.abs(entry - stop) * qty : null;
  const r = pnl != null && risk ? pnl / risk : null;
  const rr = entry > 0 && stop > 0 && target > 0 && entry !== stop ? Math.abs(target - entry) / Math.abs(entry - stop) : null;
  const move = closed && entry > 0 && exit > 0 ? ((exit - entry) / entry) * dir : null;
  const result: TradeResult = !closed || pnl == null ? "open" : pnl > 0 ? "win" : pnl < 0 ? "loss" : "be";
  return { pnl, risk, r, rr, move, result };
}

/** `deriveTrade` for a trade with fills (same formulas on the fills' Ø entry / opened quantity / realised P&L). */
function deriveFromFills(t: DeriveInput): Derived {
  const pos = fillPosition({ exit: t.exit, side: t.side ?? "long", status: t.status ?? "closed", fills: t.fills });
  if (!pos) return deriveTrade({ ...t, fills: undefined });
  const stop = t.stop || 0;
  const target = t.target || 0;
  const dir = t.side === "short" ? -1 : 1;
  const closed = t.status !== "open";
  const { entry, qty } = pos;

  let pnl: number | null = null;
  if (isFin(t.pnlManual)) pnl = t.pnlManual;
  else if (closed && pos.gross != null) pnl = pos.gross - effectiveFees(t) - (isFin(t.fundingFees) ? t.fundingFees : 0);

  const risk = entry > 0 && stop > 0 && qty ? Math.abs(entry - stop) * qty : null;
  const r = pnl != null && risk ? pnl / risk : null;
  const rr = entry > 0 && stop > 0 && target > 0 && entry !== stop ? Math.abs(target - entry) / Math.abs(entry - stop) : null;
  const move = closed && pos.exit != null && entry > 0 ? ((pos.exit - entry) / entry) * dir : null;
  const result: TradeResult = !closed || pnl == null ? "open" : pnl > 0 ? "win" : pnl < 0 ? "loss" : "be";
  return { pnl, risk, r, rr, move, result };
}

/** The persisted snapshot fields (`pnl`, `r`) as written by the trade form on save. */
export function computePnlR(t: DeriveInput): { pnl: number | null; r: number | null } {
  const d = deriveTrade(t);
  return { pnl: d.pnl, r: d.r };
}

/** Trade-form leverage rule of the build's edition (`ED.LEVERAGE_RULE`: personal scalp > 4x / makro > 5x, share > 5x). */
export function leverageOverRule(leverage: number | null | undefined, account: AccountId): boolean {
  return leverage != null && leverage > ED.LEVERAGE_RULE[account];
}

export const qw = deriveTrade;

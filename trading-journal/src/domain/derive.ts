/**
 * Per-trade derivation – 1:1 port of bundle `qw` (21237–21260).
 * Leverage is never used; `size` is the position value incl. leverage, qty = size / entry.
 * Fees are subtracted only from the automatic P&L; `pnlManual` is used as-is.
 */
import type { Trade, TradeResult } from "./types";
import { isFin } from "@/lib/format";

export interface Derived {
  pnl: number | null;
  risk: number | null;
  r: number | null;
  rr: number | null;
  move: number | null;
  result: TradeResult;
}

export type DeriveInput = Pick<Trade, "entry" | "exit" | "stop" | "target" | "size" | "fees" | "pnlManual"> &
  Partial<Pick<Trade, "side" | "status">>;

export function deriveTrade(t: DeriveInput): Derived {
  const entry = t.entry || 0;
  const exit = t.exit || 0;
  const stop = t.stop || 0;
  const target = t.target || 0;
  const size = t.size || 0;
  const fees = t.fees || 0;
  const dir = t.side === "short" ? -1 : 1;
  const qty = entry > 0 && size > 0 ? size / entry : 0;
  const closed = t.status !== "open";

  let pnl: number | null = null;
  if (isFin(t.pnlManual)) pnl = t.pnlManual;
  else if (closed && entry > 0 && exit > 0 && qty) pnl = (exit - entry) * qty * dir - fees;

  const risk = entry > 0 && stop > 0 && qty ? Math.abs(entry - stop) * qty : null;
  const r = pnl != null && risk ? pnl / risk : null;
  const rr = entry > 0 && stop > 0 && target > 0 && entry !== stop ? Math.abs(target - entry) / Math.abs(entry - stop) : null;
  const move = closed && entry > 0 && exit > 0 ? ((exit - entry) / entry) * dir : null;
  const result: TradeResult = !closed || pnl == null ? "open" : pnl > 0 ? "win" : pnl < 0 ? "loss" : "be";
  return { pnl, risk, r, rr, move, result };
}

/** The persisted snapshot fields (`pnl`, `r`) as written by the trade form on save. */
export function computePnlR(t: DeriveInput): { pnl: number | null; r: number | null } {
  const d = deriveTrade(t);
  return { pnl: d.pnl, r: d.r };
}

/** Trade-form leverage rule: scalp > 4x, makro > 5x. */
export function leverageOverRule(leverage: number | null | undefined, account: "makro" | "scalp"): boolean {
  return leverage != null && (account === "scalp" ? leverage > 4 : leverage > 5);
}

export const qw = deriveTrade;

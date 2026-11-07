/**
 * Bridge from a journal trade to the simulation input (pure): the (Ø) entry from the fills, the recorded exit time and
 * the quantity. `null` = the trade cannot be replayed (the German reason comes from `whatIfBlocker`).
 */
import { fillStats } from "../fills";
import type { Trade } from "../types";
import { whatIfBlocker, type WhatIfTrade } from "./simulate";

const ms = (local: string | undefined): number => (local ? new Date(local).getTime() : NaN);

/** The trade's quantity: the stored one, else the notional ÷ entry (`size` is the notional in quote currency). */
export function tradeQty(t: Pick<Trade, "qty" | "size" | "entry" | "fills" | "side">): number | null {
  if (t.qty != null && t.qty > 0) return t.qty;
  const avg = t.fills?.length ? fillStats(t.fills, t.side).avgEntry : null;
  const entry = avg ?? t.entry;
  return t.size != null && t.size > 0 && entry != null && entry > 0 ? t.size / entry : null;
}

/** Simulation input of a closed trade, or the reason it cannot be replayed. */
export function whatIfTradeOf(t: Trade): { ok: true; trade: WhatIfTrade } | { ok: false; why: string } {
  const avg = t.fills?.length ? fillStats(t.fills, t.side).avgEntry : null;
  const entry = avg ?? t.entry;
  const why = whatIfBlocker({ entry, stop: t.stop, side: t.side, status: t.status, exitDate: t.exitDate, exit: t.exit });
  if (why) return { ok: false, why };
  const entryMs = ms(t.date);
  const exitMs = ms(t.exitDate);
  if (!Number.isFinite(entryMs) || !Number.isFinite(exitMs) || exitMs < entryMs) return { ok: false, why: "Einstiegs- und Ausstiegszeit passen nicht zusammen." };
  return { ok: true, trade: { side: t.side === "short" ? "short" : "long", entry: entry!, stop: t.stop!, target: t.target ?? null, exit: t.exit, entryMs, exitMs, qty: tradeQty(t) } };
}

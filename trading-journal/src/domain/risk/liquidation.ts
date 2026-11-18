/**
 * Liquidation price – an APPROXIMATION (P05). Venues differ (mark vs. last price, fee reserve, tier boundaries,
 * cross-margin with other positions), so every result is labelled "Näherung" in the UI and the tier table is editable
 * (`settings.risk.tiers`).
 *
 * Model (one-way mode, linear USDⓈ-M contract): the position is liquidated when the wallet W plus the unrealised P&L
 * meets the maintenance margin: W + s·Q·(P − E) = Q·P·mmr − cum, so
 *   P = (W + cum − s·Q·E) / (Q·mmr − s·Q)          (s = +1 long, −1 short)
 * W = the isolated margin (margin, else notional ÷ leverage) or, for cross, the wallet balance the user enters
 * (default: the account capital). `cum` (maintenance amount) follows from the tier floors so the maintenance margin is
 * continuous. The tier is picked by the notional AT the liquidation price (two refinement passes).
 */
import type { MarginMode, Side } from "../types";
import type { MaintTier } from "./config";

export interface TierRow extends MaintTier {
  /** notional floor of the tier */
  from: number;
  /** maintenance amount: Σ floor_i · (mmr_i − mmr_{i−1}) */
  cum: number;
}

/** The tier table with floors and maintenance amounts. */
export function tierTable(tiers: readonly MaintTier[]): TierRow[] {
  const out: TierRow[] = [];
  let from = 0;
  let cum = 0;
  let prevMmr = 0;
  for (const t of tiers) {
    cum += from * (t.mmr - prevMmr);
    out.push({ ...t, from, cum });
    prevMmr = t.mmr;
    from = t.upTo;
  }
  return out;
}

/** Tier of a notional (the last tier for anything above). */
export function tierFor(notional: number, table: readonly TierRow[]): TierRow | null {
  if (!table.length) return null;
  for (const t of table) if (notional <= t.upTo) return t;
  return table[table.length - 1]!;
}

export interface LiqInput {
  side: Side;
  entry: number;
  /** base quantity (> 0) */
  qty: number;
  mode?: MarginMode;
  /** isolated: margin of the position (else notional ÷ leverage) */
  margin?: number | null;
  leverage?: number | null;
  /** cross: wallet balance backing the position */
  wallet?: number | null;
  tiers: readonly MaintTier[];
  /** reference price for the distance (mark / live), else the entry */
  mark?: number | null;
  atr?: number | null;
}

export interface LiqResult {
  /** null = no liquidation above 0 (a long with enough margin) or not computable */
  price: number | null;
  mode: MarginMode;
  /** wallet used (isolated margin or cross balance) */
  wallet: number;
  mmr: number;
  cum: number;
  /** distance from the reference to the liquidation, as a positive fraction (null without a price) */
  distPct: number | null;
  /** the same in ATR */
  distAtr: number | null;
  /** the reference price is already beyond the liquidation */
  breached: boolean;
}

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Liquidation approximation (see the module comment); `null` for invalid input. */
export function liquidationPrice(i: LiqInput): LiqResult | null {
  const { side, entry, qty } = i;
  if (!fin(entry) || entry <= 0 || !fin(qty) || qty <= 0) return null;
  const mode: MarginMode = i.mode ?? "isolated";
  const notional = qty * entry;
  let wallet: number | null = null;
  if (mode === "cross") wallet = fin(i.wallet) && i.wallet > 0 ? i.wallet : null;
  else wallet = fin(i.margin) && i.margin > 0 ? i.margin : fin(i.leverage) && i.leverage > 0 ? notional / i.leverage : null;
  if (wallet == null) return null;
  const table = tierTable(i.tiers);
  const s = side === "long" ? 1 : -1;
  const solve = (t: TierRow): number => (wallet! + t.cum - s * qty * entry) / (qty * t.mmr - s * qty);
  let tier = tierFor(notional, table);
  if (!tier) return null;
  let price = solve(tier);
  for (let pass = 0; pass < 2; pass++) {
    const at = tierFor(Math.max(0, qty * price), table);
    if (!at || at === tier) break;
    tier = at;
    price = solve(tier);
  }
  const ref = fin(i.mark) && i.mark > 0 ? i.mark : entry;
  const none = side === "long" ? !(price > 0) : !Number.isFinite(price) || price <= 0;
  if (none) return { price: null, mode, wallet, mmr: tier.mmr, cum: tier.cum, distPct: null, distAtr: null, breached: false };
  const gap = side === "long" ? ref - price : price - ref;
  const atrV = fin(i.atr) && i.atr > 0 ? i.atr : null;
  return {
    price,
    mode,
    wallet,
    mmr: tier.mmr,
    cum: tier.cum,
    distPct: Math.max(0, gap) / ref,
    distAtr: atrV ? Math.max(0, gap) / atrV : null,
    breached: gap <= 0,
  };
}

/** Does the liquidation come before the stop (the stop can never fill)? */
export function liqBeforeStop(side: Side, stop: number | null | undefined, liq: number | null | undefined): boolean {
  if (!fin(stop) || stop <= 0 || !fin(liq)) return false;
  return side === "long" ? liq >= stop : liq <= stop;
}

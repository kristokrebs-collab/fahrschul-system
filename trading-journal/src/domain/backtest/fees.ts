/**
 * Fees and funding of the backtest (P07, pure).
 *
 * - Fees: maker / taker in basis points of the notional, per exchange (USDⓈ-M perpetuals, base tier, no VIP or token
 *   discount – the presets are labelled as such in the UI and can be overridden). Market entries, stops and time /
 *   signal exits pay taker; a take-profit is a resting limit order and pays maker.
 * - Funding: perpetuals settle every 8 h (00:00, 08:00, 16:00 UTC). A position open across a settlement pays
 *   `notional × rate` when long and receives it when short (negative rates the other way round). With the real
 *   history (`fundingRate` of the exchange) each settlement uses the rate published for it; without one, a flat
 *   assumption per 8 h.
 */
import type { FeeModel, FundingModel, FundingPoint } from "./types";

export interface FeePreset extends FeeModel {
  label: string;
}

/** Base-tier perpetual fees (bps). Sources: the exchanges' public fee schedules (VIP 0, without discounts). */
export const FEE_PRESETS: readonly FeePreset[] = [
  { exchange: "binance", label: "Binance", makerBps: 2, takerBps: 5 },
  { exchange: "bitunix", label: "Bitunix", makerBps: 2, takerBps: 6 },
  { exchange: "bybit", label: "Bybit", makerBps: 2, takerBps: 5.5 },
  { exchange: "okx", label: "OKX", makerBps: 2, takerBps: 5 },
];

export const DEFAULT_FEES: FeeModel = { exchange: "binance", makerBps: 2, takerBps: 5 };

/** Flat funding assumption when no history is at hand: Binance's base rate 0,01 % per 8 h. */
export const DEFAULT_FUNDING_RATE = 0.0001;
export const FUNDING_EVERY_MS = 8 * 3_600_000;

export const feePreset = (exchange: string): FeePreset => FEE_PRESETS.find((p) => p.exchange === exchange) ?? { ...DEFAULT_FEES, label: "Binance" };

/** Fee in money for a fill of `notional` (maker or taker). */
export function feeFor(notional: number, maker: boolean, m: FeeModel): number {
  const bps = maker ? m.makerBps : m.takerBps;
  return (Math.abs(notional) * Math.max(0, bps)) / 10_000;
}

/** Funding settlements (ms) in (from, to]: every 8 h on the UTC grid. */
export function settlementsBetween(from: number, to: number): number[] {
  const out: number[] = [];
  if (!(to > from)) return out;
  let t = Math.floor(from / FUNDING_EVERY_MS) * FUNDING_EVERY_MS + FUNDING_EVERY_MS;
  for (; t <= to; t += FUNDING_EVERY_MS) out.push(t);
  return out;
}

/**
 * Rate published for the settlement at `t` (history: the point within ±1 h of `t`, else the latest point before it,
 * else the model's fallback; flat: the flat rate; none: 0).
 */
export function rateAt(model: FundingModel, t: number, cursor?: { i: number }): number {
  if (model.kind === "none") return 0;
  if (model.kind === "flat") return model.ratePer8h;
  const pts: readonly FundingPoint[] = model.points;
  if (!pts.length) return model.fallbackRate;
  // monotone cursor: callers walk forward in time
  let i = cursor ? Math.min(cursor.i, pts.length - 1) : 0;
  if (i > 0 && pts[i]!.t > t) i = 0;
  while (i + 1 < pts.length && pts[i + 1]!.t <= t + 3_600_000) i++;
  if (cursor) cursor.i = i;
  const p = pts[i]!;
  if (p.t > t + 3_600_000) return model.fallbackRate; // history starts after this settlement
  return p.rate;
}

/**
 * Funding paid (positive) or received (negative) by a position of `qty` on `side` held from `from` to `to` (ms).
 * `priceAt(t)` gives the mark used for the notional at a settlement (the backtest uses the close of the bar that
 * contains it).
 */
export function fundingCost(model: FundingModel, side: "long" | "short", qty: number, from: number, to: number, priceAt: (t: number) => number): number {
  if (model.kind === "none") return 0;
  const dir = side === "long" ? 1 : -1;
  const cursor = { i: 0 };
  let cost = 0;
  for (const t of settlementsBetween(from, to)) {
    const rate = rateAt(model, t, cursor);
    const px = priceAt(t);
    if (!Number.isFinite(px) || px <= 0) continue;
    cost += dir * rate * qty * px;
  }
  return cost;
}

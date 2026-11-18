/**
 * Scenario (P05), pure: a price shock of ±x % on every open position (crypto moves together – one shock for all legs)
 * → P&L change against now, liquidations, the equity and the margin load afterwards, and the P&L curve over the
 * shock range (its kinks are the liquidations: an isolated position can lose at most its margin).
 */
import type { Side } from "../types";

export interface ScenarioLeg {
  id: string;
  label: string;
  side: Side;
  qty: number;
  entry: number;
  /** price now (mark / live, else the entry) */
  price: number;
  /** isolated margin (caps the loss at liquidation); null = cross / unknown → no cap */
  margin: number | null;
  liqPrice: number | null;
}

export interface ScenarioLegResult {
  id: string;
  price: number;
  /** P&L change against now */
  pnl: number;
  liquidated: boolean;
}

export interface ScenarioResult {
  shock: number;
  /** Σ P&L change against now */
  pnl: number;
  legs: ScenarioLegResult[];
  liquidated: string[];
  equityAfter: number;
  /** Σ margin of the legs still open ÷ equity after (null without margins or with equity ≤ 0) */
  marginLoad: number | null;
}

const dirOf = (s: Side): 1 | -1 => (s === "long" ? 1 : -1);

/** Shock (fraction) at which the leg is liquidated, null without a liquidation price. */
export function liquidationShock(l: Pick<ScenarioLeg, "price" | "liqPrice" | "side">): number | null {
  if (l.liqPrice == null || !(l.liqPrice > 0) || !(l.price > 0)) return null;
  const s = l.liqPrice / l.price - 1;
  return (l.side === "long" ? s < 0 : s > 0) ? s : 0;
}

/** One leg under the shock. */
export function shockLeg(l: ScenarioLeg, shock: number): ScenarioLegResult {
  const price = l.price * (1 + shock);
  const d = dirOf(l.side);
  const liq = l.liqPrice != null && l.liqPrice > 0 && (l.side === "long" ? price <= l.liqPrice : price >= l.liqPrice);
  let pnl = d * l.qty * (price - l.price);
  if (liq && l.margin != null && l.margin > 0) {
    // isolated: the whole margin is gone – relative to now that is −(margin + uPnL now)
    const upnlNow = d * l.qty * (l.price - l.entry);
    pnl = -(l.margin + upnlNow);
  }
  return { id: l.id, price, pnl, liquidated: liq };
}

/** All legs under the shock. */
export function scenarioAt(legs: readonly ScenarioLeg[], shock: number, equity: number): ScenarioResult {
  const res = legs.map((l) => shockLeg(l, shock));
  const pnl = res.reduce((s, r) => s + r.pnl, 0);
  const equityAfter = equity + pnl;
  const margins = legs.filter((l, i) => !res[i]!.liquidated && l.margin != null).map((l) => l.margin!);
  return {
    shock,
    pnl,
    legs: res,
    liquidated: res.filter((r) => r.liquidated).map((r) => r.id),
    equityAfter,
    marginLoad: margins.length && equityAfter > 0 ? margins.reduce((s, m) => s + m, 0) / equityAfter : null,
  };
}

/** Shock range of the slider (±30 %). */
export const SCENARIO_MAX = 0.3;
export const SCENARIO_STEPS = 121;

/** The P&L change over the shock range, `steps` points from −max to +max. */
export function scenarioCurve(legs: readonly ScenarioLeg[], max = SCENARIO_MAX, steps = SCENARIO_STEPS): { shocks: number[]; pnl: number[] } {
  const shocks: number[] = [];
  const pnl: number[] = [];
  const n = Math.max(3, steps);
  for (let i = 0; i < n; i++) {
    const s = -max + (2 * max * i) / (n - 1);
    shocks.push(s);
    pnl.push(legs.reduce((acc, l) => acc + shockLeg(l, s).pnl, 0));
  }
  return { shocks, pnl };
}

/**
 * View models of the Risiko page (P05), pure: liquidation rows of the open legs, the scenario legs and the pairs the
 * correlation looks at. Kept out of the components so the view test and the page share one computation.
 */
import { liqBeforeStop, liquidationPrice, symbolOf, type ExposureLeg, type MaintTier, type ScenarioLeg } from "@/domain/risk";
import type { EnrichedTrade } from "@/domain/types";

export interface LiqRow {
  id: string;
  label: string;
  side: "long" | "short";
  /** reference price (mark / live, else the entry) */
  price: number;
  liq: number | null;
  /** the venue / trade gave the liquidation price (else the approximation) */
  given: boolean;
  distPct: number | null;
  distAtr: number | null;
  beforeStop: boolean;
  leverage: number | null;
}

/** Where the shown liquidation rows come from (F27): how many legs are journal trades / venue positions, and how many prices are given vs. calculated. */
export interface LiqBasis {
  journal: number;
  exchange: number;
  /** the venue / the trade gave the liquidation price */
  given: number;
  /** calculated from the tier table (an approximation) */
  approx: number;
}

/** Counts the legs that have a row (a leg without liquidation data has none and is not counted). */
export function liqBasis(legs: readonly ExposureLeg[], rows: readonly LiqRow[]): LiqBasis {
  const byId = new Map(legs.map((l) => [l.id, l] as const));
  const b: LiqBasis = { journal: 0, exchange: 0, given: 0, approx: 0 };
  for (const r of rows) {
    const leg = byId.get(r.id);
    if (leg) b[leg.source] += 1;
    if (r.given) b.given += 1;
    else if (r.liq != null) b.approx += 1;
  }
  return b;
}

/**
 * Liquidation of every open leg that carries one: the venue's / trade's own price when it has one, else the
 * approximation (isolated margin from the leverage / margin; cross from the wallet). Closest first.
 */
export function liqRows(legs: readonly ExposureLeg[], tiers: readonly MaintTier[], wallet: number, atrOf: (symbol: string | null) => number | null): LiqRow[] {
  const out: LiqRow[] = [];
  for (const l of legs) {
    const price = l.mark ?? l.entry;
    const atr = atrOf(l.symbol);
    let liq = l.liqPrice;
    const given = liq != null;
    if (liq == null && (l.leverage != null || l.margin != null)) {
      const r = liquidationPrice({ side: l.side, entry: l.entry, qty: l.qty, leverage: l.leverage, margin: l.margin, mode: l.marginMode ?? "isolated", wallet, tiers, mark: price, atr });
      liq = r?.price ?? null;
      if (r && r.price == null) {
        out.push({ id: l.id, label: l.label, side: l.side, price, liq: null, given: false, distPct: null, distAtr: null, beforeStop: false, leverage: l.leverage });
        continue;
      }
    }
    if (liq == null) continue;
    const gap = Math.max(0, l.side === "long" ? price - liq : liq - price);
    out.push({
      id: l.id,
      label: l.label,
      side: l.side,
      price,
      liq,
      given,
      distPct: gap / price,
      distAtr: atr ? gap / atr : null,
      beforeStop: liqBeforeStop(l.side, l.stop, liq),
      leverage: l.leverage,
    });
  }
  return out.sort((a, b) => (a.distPct ?? Infinity) - (b.distPct ?? Infinity));
}

/** Scenario legs of the exposure legs (isolated margin caps the loss; cross / unknown has no cap). */
export function scenarioLegs(legs: readonly ExposureLeg[], rows: readonly LiqRow[]): ScenarioLeg[] {
  const liqOf = new Map(rows.map((r) => [r.id, r.liq]));
  return legs.map((l) => ({
    id: l.id,
    label: l.label,
    side: l.side,
    qty: l.qty,
    entry: l.entry,
    price: l.mark ?? l.entry,
    margin: l.marginMode === "cross" ? null : l.margin,
    liqPrice: liqOf.get(l.id) ?? l.liqPrice,
  }));
}

/** Pairs to correlate: open ones first, then the most traded of the last 200 trades; normalised, at most `max`. */
export function corrSymbols(enriched: readonly EnrichedTrade[], venue: readonly { symbol: string }[], max = 8): string[] {
  const out: string[] = [];
  const push = (s: string | null) => {
    if (s && !out.includes(s) && out.length < max) out.push(s);
  };
  for (const p of venue) push(symbolOf(p.symbol));
  for (const t of enriched) if (t.result === "open") push(symbolOf(t.pair));
  const counts = new Map<string, number>();
  for (const t of enriched.slice(-200)) {
    const s = symbolOf(t.pair);
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  for (const [s] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) push(s);
  return out;
}

/**
 * Pre-trade calculator (P05), pure: position size from the risk, stop candidates (%, ATR, box edge, structure), take
 * profit candidates (R multiples, box targets) and the R:R with the fee breakeven.
 *
 * Units follow the journal: `notional` = qty × entry in quote currency = `Trade.size`; fees are a fraction of the
 * notional per side (taker); slippage a fraction of the price on the stop fill. The loss at the stop therefore is
 * qty × (|entry − stop| + fee × (entry + stop) + slip × stop) – the size is chosen so that loss equals the risk amount.
 */
import type { BoxState, Target } from "../boxes";
import type { Structure } from "../signals/structure";
import type { Side } from "../types";

export type SizingError = "capital" | "risk" | "entry" | "stop" | "side";

export interface SizingInput {
  /** account capital (quote currency) */
  capital: number;
  /** risk per trade, fraction of the capital (0.01 = 1 %) */
  riskPct: number;
  entry: number;
  stop: number;
  /** omitted → from the stop (below the entry = long) */
  side?: Side;
  /** taker fee per side, fraction of the notional */
  feePct?: number;
  /** slippage on the stop fill, fraction of the price */
  slippagePct?: number;
  /** chosen leverage → margin; omitted → the needed leverage (at least 1×) */
  leverage?: number | null;
  /** the trader's leverage rule (`ED.LEVERAGE_RULE`) */
  maxLeverage?: number | null;
}

export interface Sizing {
  ok: true;
  side: Side;
  /** capital × riskPct */
  riskAmount: number;
  stopDist: number;
  /** stopDist ÷ entry */
  stopPct: number;
  /** loss per unit at the stop incl. fees and slippage */
  lossPerUnit: number;
  qty: number;
  /** qty × entry = the journal's `size` */
  notional: number;
  /** notional ÷ capital: the leverage the account needs to carry the position */
  neededLeverage: number;
  /** leverage used for the margin (chosen, else the needed one rounded up to a whole number, at least 1×) */
  leverage: number;
  margin: number;
  /** round-trip fees at the stop */
  fees: number;
  slippage: number;
  /** the leverage needed or chosen is above the rule */
  overRule: boolean;
  /** the margin is larger than the capital (the position cannot be opened at this leverage) */
  marginOver: boolean;
  /** with `overRule`: the largest position the rule allows and the risk it would carry */
  capped: { qty: number; notional: number; riskAmount: number; riskPct: number } | null;
}

export type SizingResult = Sizing | { ok: false; error: SizingError };

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Side implied by entry and stop (stop below → long). */
export const sideOf = (entry: number, stop: number): Side => (stop < entry ? "long" : "short");

/** Position size for a risk amount (see the module comment). */
export function positionSize(input: SizingInput): SizingResult {
  const { capital, riskPct, entry, stop } = input;
  if (!fin(capital) || capital <= 0) return { ok: false, error: "capital" };
  if (!fin(riskPct) || riskPct <= 0 || riskPct > 1) return { ok: false, error: "risk" };
  if (!fin(entry) || entry <= 0) return { ok: false, error: "entry" };
  if (!fin(stop) || stop <= 0 || stop === entry) return { ok: false, error: "stop" };
  const side = input.side ?? sideOf(entry, stop);
  if ((side === "long" && stop >= entry) || (side === "short" && stop <= entry)) return { ok: false, error: "side" };
  const fee = fin(input.feePct) && input.feePct > 0 ? input.feePct : 0;
  const slip = fin(input.slippagePct) && input.slippagePct > 0 ? input.slippagePct : 0;
  const stopDist = Math.abs(entry - stop);
  const lossPerUnit = stopDist + fee * (entry + stop) + slip * stop;
  const riskAmount = capital * riskPct;
  const qty = riskAmount / lossPerUnit;
  const notional = qty * entry;
  const neededLeverage = notional / capital;
  const chosen = fin(input.leverage) && input.leverage > 0 ? input.leverage : null;
  const leverage = chosen ?? Math.max(1, Math.ceil(neededLeverage - 1e-9));
  const margin = notional / leverage;
  const rule = fin(input.maxLeverage) && input.maxLeverage > 0 ? input.maxLeverage : null;
  const overRule = rule != null && Math.max(neededLeverage, chosen ?? 0) > rule + 1e-9;
  let capped: Sizing["capped"] = null;
  if (overRule && rule != null) {
    const cNotional = capital * rule;
    const cQty = cNotional / entry;
    const cRisk = cQty * lossPerUnit;
    capped = { qty: cQty, notional: cNotional, riskAmount: cRisk, riskPct: cRisk / capital };
  }
  return {
    ok: true,
    side,
    riskAmount,
    stopDist,
    stopPct: stopDist / entry,
    lossPerUnit,
    qty,
    notional,
    neededLeverage,
    leverage,
    margin,
    fees: qty * fee * (entry + stop),
    slippage: qty * slip * stop,
    overRule,
    marginOver: margin > capital * (1 + 1e-9),
    capped,
  };
}

// ── stop candidates ─────────────────────────────────────────────────────────────────────────────────────────────

export type StopKind = "pct" | "atr" | "box" | "structure";

export interface StopCandidate {
  kind: StopKind;
  price: number;
  label: string;
  detail: string;
  /** distance from the entry in % of the entry */
  distPct: number;
  /** distance in ATR (null without an ATR) */
  distAtr: number | null;
}

const dirOf = (side: Side): 1 | -1 => (side === "long" ? 1 : -1);
const valid = (side: Side, entry: number, stop: number): boolean => stop > 0 && (side === "long" ? stop < entry : stop > entry);

/** Stop `pct` (fraction) away from the entry. */
export function stopFromPct(entry: number, side: Side, pct: number): number | null {
  if (!(entry > 0) || !(pct > 0) || pct >= 1) return null;
  const s = entry * (1 - dirOf(side) * pct);
  return valid(side, entry, s) ? s : null;
}

/** Stop `mult` × ATR away from the entry. */
export function stopFromAtr(entry: number, side: Side, atrValue: number, mult: number): number | null {
  if (!(entry > 0) || !(atrValue > 0) || !(mult > 0)) return null;
  const s = entry - dirOf(side) * atrValue * mult;
  return valid(side, entry, s) ? s : null;
}

/** Buffer beyond a box edge, in ATR (the box engine's breakout buffer). */
export const BOX_STOP_BUFFER_ATR = 0.25;

/**
 * Stop behind the box: a long sits below the support (bottom − buffer), a short above the resistance (top + buffer) –
 * the edge whose loss invalidates the trade. `null` without a box or when the edge is on the wrong side of the entry.
 */
export function stopFromBox(side: Side, entry: number, box: Pick<BoxState, "box" | "atr"> | null | undefined, bufferAtr = BOX_STOP_BUFFER_ATR): number | null {
  const b = box?.box;
  if (!b || !(entry > 0)) return null;
  const a = b.atr > 0 ? b.atr : box?.atr ?? 0;
  const s = side === "long" ? b.bottom - bufferAtr * a : b.top + bufferAtr * a;
  return valid(side, entry, s) ? s : null;
}

/** Buffer beyond a structure level, in ATR (the entry check's S/R part: lean.btm − 0.1 ATR). */
export const STRUCTURE_STOP_BUFFER_ATR = 0.1;

/** Stop behind the nearest structure level on the risk side (support for a long, resistance for a short). */
export function stopFromStructure(side: Side, entry: number, s: Pick<Structure, "supports" | "resistances" | "atr"> | null | undefined): number | null {
  if (!s || !(entry > 0)) return null;
  const buf = STRUCTURE_STOP_BUFFER_ATR * (s.atr > 0 ? s.atr : 0);
  if (side === "long") {
    const lv = s.supports.filter((l) => l.btm < entry).sort((a, b) => b.btm - a.btm)[0];
    const stop = lv ? lv.btm - buf : null;
    return stop != null && valid(side, entry, stop) ? stop : null;
  }
  const lv = s.resistances.filter((l) => l.top > entry).sort((a, b) => a.top - b.top)[0];
  const stop = lv ? lv.top + buf : null;
  return stop != null && valid(side, entry, stop) ? stop : null;
}

export interface StopInput {
  entry: number;
  side: Side;
  /** fraction for the % stop */
  pct: number;
  atr?: number | null;
  atrMult: number;
  box?: Pick<BoxState, "box" | "atr"> | null;
  structure?: Pick<Structure, "supports" | "resistances" | "atr"> | null;
}

const pctText = (x: number): string => `${(x * 100).toFixed(x < 0.01 ? 2 : 1).replace(".", ",")} %`;

/** Every stop the calculator can offer for the inputs (the ones that cannot be computed are left out). */
export function stopCandidates(i: StopInput): StopCandidate[] {
  const out: StopCandidate[] = [];
  const atrV = i.atr != null && i.atr > 0 ? i.atr : null;
  const add = (kind: StopKind, price: number | null, label: string, detail: string) => {
    if (price == null) return;
    const dist = Math.abs(i.entry - price);
    out.push({ kind, price, label, detail, distPct: dist / i.entry, distAtr: atrV ? dist / atrV : null });
  };
  add("pct", stopFromPct(i.entry, i.side, i.pct), pctText(i.pct), "fester Abstand");
  if (atrV) add("atr", stopFromAtr(i.entry, i.side, atrV, i.atrMult), `${String(i.atrMult).replace(".", ",")}× ATR`, "Volatilität");
  add("box", stopFromBox(i.side, i.entry, i.box), "Boxkante", i.side === "long" ? "unter dem Boden der Box" : "über dem Deckel der Box");
  add("structure", stopFromStructure(i.side, i.entry, i.structure), "Struktur", i.side === "long" ? "unter der nächsten Unterstützung" : "über dem nächsten Widerstand");
  return out;
}

// ── take profit ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface TargetCandidate {
  kind: "r" | "box";
  price: number;
  label: string;
  /** reward ÷ risk */
  r: number;
}

export const R_MULTIPLES: readonly number[] = [1, 2, 3];

/** Targets at R multiples of the stop distance. */
export function rTargets(entry: number, stop: number, multiples: readonly number[] = R_MULTIPLES): TargetCandidate[] {
  if (!(entry > 0) || !(stop > 0) || entry === stop) return [];
  const d = entry - stop; // > 0 long
  return multiples
    .filter((m) => m > 0)
    .map((m) => ({ kind: "r" as const, price: entry + d * m, label: `${String(m).replace(".", ",")} R`, r: m }))
    .filter((t) => t.price > 0);
}

/** Box-zu-Box targets beyond the entry in the trade's direction, with their R multiple (at most 3). */
export function boxTargetsFor(side: Side, entry: number, stop: number, targets: readonly Target[] | null | undefined): TargetCandidate[] {
  if (!targets?.length || !(entry > 0) || !(stop > 0) || entry === stop) return [];
  const risk = Math.abs(entry - stop);
  return targets
    .filter((t) => (side === "long" ? t.price > entry : t.price < entry) && t.price > 0)
    .map((t) => ({ kind: "box" as const, price: t.price, label: t.label, r: Math.abs(t.price - entry) / risk }))
    .sort((a, b) => a.r - b.r)
    .slice(0, 3);
}

// ── R:R ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RrInput {
  entry: number;
  stop: number;
  target: number;
  side?: Side;
  feePct?: number;
  slippagePct?: number;
}

export interface RrResult {
  side: Side;
  /** reward ÷ risk on prices */
  rr: number;
  /** after fees on both legs and the stop slippage */
  rrNet: number;
  /** price at which the trade is flat after the round-trip fees */
  breakeven: number;
  /** win rate needed at `rrNet` to break even (1 ÷ (1 + rrNet)) */
  beWinRate: number;
  /** round-trip fees in R (fees at the target ÷ risk) */
  feeR: number;
}

/** R:R with the fee breakeven; `null` for invalid input (target on the wrong side, stop = entry …). */
export function rrCalc(i: RrInput): RrResult | null {
  const { entry, stop, target } = i;
  if (!(entry > 0) || !(stop > 0) || !(target > 0) || stop === entry) return null;
  const side = i.side ?? sideOf(entry, stop);
  if (!valid(side, entry, stop)) return null;
  if (side === "long" ? target <= entry : target >= entry) return null;
  const fee = i.feePct && i.feePct > 0 ? i.feePct : 0;
  const slip = i.slippagePct && i.slippagePct > 0 ? i.slippagePct : 0;
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const feeWin = fee * (entry + target);
  const feeLoss = fee * (entry + stop) + slip * stop;
  const rrNet = Math.max(0, reward - feeWin) / (risk + feeLoss);
  const breakeven = side === "long" ? (entry * (1 + fee)) / (1 - fee) : (entry * (1 - fee)) / (1 + fee);
  return { side, rr: reward / risk, rrNet, breakeven, beWinRate: 1 / (1 + rrNet), feeR: feeWin / risk };
}

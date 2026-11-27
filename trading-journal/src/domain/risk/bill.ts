/**
 * Die „Rechnung“ des Positionsgrößen-Rechners (rein): was aus einer gültigen Größe (`positionSize`) noch folgt – der Anteil der
 * Kosten am Risiko, der Mindestabstand, ab dem die Kosten nicht mehr als ein Viertel des Risikos fressen, der Abstand in ATR, der
 * Betrag am Ziel nach Gebühren, ein Beispiel für die Rundung auf einen Mengenschritt und die Hinweise in Worten.
 *
 * Alles hier ist Rechnung aus den Eingaben und den Annahmen (Gebühr je Seite, Slippage am Stop) – keine Empfehlung, keine Prognose,
 * keine Order. Die Schwellen sind Richtwerte der App und stehen als Konstanten da, damit die Seite sie nennen kann.
 */
import type { Side } from "../types";
import { rrCalc, type RrResult, type Sizing } from "./sizing";

/** Ab diesem Anteil der Kosten (Gebühren + Slippage) am Risiko sagt die Rechnung „teuer“. */
export const COST_SHARE_WARN = 0.25;
/** Unter diesem Abstand in ATR sagt die Rechnung „eng“ (derselbe Richtwert wie im Ausstiegsplan des Handelsplans). */
export const TIGHT_STOP_ATR = 0.5;

export type RiskMode = "pct" | "amount";

/**
 * Risk as a fraction of the capital from what was typed: percent (1 = 1 %) or an amount in the account currency.
 * `NaN` for anything that is no usable number – `positionSize` then answers with the error `risk`.
 */
export function riskFraction(mode: RiskMode, value: number, capital: number): number {
  if (!Number.isFinite(value)) return NaN;
  if (mode === "pct") return value / 100;
  return Number.isFinite(capital) && capital > 0 ? value / capital : NaN;
}

/** An example step for the rounding hint, by the size of the quantity – NOT the step of a real market (the exchange names that). */
export function exampleStep(qty: number): number {
  if (!(qty > 0)) return 0.001;
  if (qty >= 100) return 1;
  if (qty >= 10) return 0.1;
  if (qty >= 1) return 0.01;
  return 0.001;
}

/** `qty` rounded DOWN to a multiple of `step` (never up: a bigger position would carry more than the planned risk). */
export function floorToStep(qty: number, step: number): number {
  if (!(qty > 0) || !(step > 0)) return 0;
  const n = Math.floor(qty / step + 1e-9);
  return Number((n * step).toFixed(10));
}

export interface BillInput {
  sizing: Sizing;
  capital: number;
  entry: number;
  stop: number;
  /** `NaN` / `null` = none typed */
  target?: number | null;
  feePct: number;
  slippagePct: number;
  atr?: number | null;
  /** the trader's own risk per trade (fraction) */
  ownRiskPct?: number | null;
  /** a real step when the caller knows one; else the example by size */
  step?: number | null;
}

export type BillNoteCode = "overRule" | "marginOver" | "overRisk" | "cost" | "tight" | "targetSide" | "ok";
export interface BillNote {
  code: BillNoteCode;
  tone: "ok" | "warn" | "bad";
}

export interface Bill {
  side: Side;
  riskPct: number;
  /** fees + slippage per unit at the stop */
  costPerUnit: number;
  /** fees + slippage at the stop, in money */
  cost: number;
  /** cost ÷ risk amount */
  costShare: number;
  /** the stop distance at which the cost is exactly `COST_SHARE_WARN` of the loss */
  minDist: number;
  minDistPct: number;
  /** the stop is closer than `minDist` */
  belowMin: boolean;
  stopAtr: number | null;
  /** net at the target: qty × (reward − fees of both sides) */
  target: { price: number; rr: RrResult; gain: number } | null;
  /** a target was typed but lies on the wrong side of the entry */
  targetWrongSide: boolean;
  step: { step: number; example: boolean; qty: number; notional: number; loss: number; lossPct: number };
  /** every note that applies, the worst first; `[{ ok }]` when none does */
  notes: BillNote[];
  tone: "ok" | "warn" | "bad";
}

const TONE_RANK = { ok: 0, warn: 1, bad: 2 } as const;

export function positionBill(i: BillInput): Bill {
  const s = i.sizing;
  const fee = i.feePct > 0 ? i.feePct : 0;
  const slip = i.slippagePct > 0 ? i.slippagePct : 0;
  const costPerUnit = fee * (i.entry + i.stop) + slip * i.stop;
  const cost = s.fees + s.slippage;
  const costShare = s.riskAmount > 0 ? cost / s.riskAmount : 0;
  const minDist = costPerUnit * (1 / COST_SHARE_WARN - 1);
  const riskPct = s.riskAmount / i.capital;
  const stopAtr = i.atr != null && i.atr > 0 ? s.stopDist / i.atr : null;

  const t = i.target;
  const hasTarget = t != null && Number.isFinite(t) && t > 0;
  const rr = hasTarget ? rrCalc({ entry: i.entry, stop: i.stop, target: t, side: s.side, feePct: fee, slippagePct: slip }) : null;
  const target = rr && hasTarget ? { price: t, rr, gain: s.qty * (Math.abs(t - i.entry) - fee * (i.entry + t)) } : null;
  const targetWrongSide = hasTarget && !rr;

  const real = i.step != null && i.step > 0;
  const step = real ? i.step! : exampleStep(s.qty);
  const qty = floorToStep(s.qty, step);
  const loss = qty * s.lossPerUnit;

  const notes: BillNote[] = [];
  if (s.overRule) notes.push({ code: "overRule", tone: "bad" });
  if (s.marginOver) notes.push({ code: "marginOver", tone: "bad" });
  const own = i.ownRiskPct != null && i.ownRiskPct > 0 ? i.ownRiskPct : null;
  if (own != null && riskPct > own * (1 + 1e-9)) notes.push({ code: "overRisk", tone: riskPct > own * 2 * (1 + 1e-9) ? "bad" : "warn" });
  if (costShare > COST_SHARE_WARN + 1e-12) notes.push({ code: "cost", tone: "warn" });
  if (stopAtr != null && stopAtr < TIGHT_STOP_ATR) notes.push({ code: "tight", tone: "warn" });
  if (targetWrongSide) notes.push({ code: "targetSide", tone: "warn" });
  notes.sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone]);
  if (!notes.length) notes.push({ code: "ok", tone: "ok" });

  return {
    side: s.side,
    riskPct,
    costPerUnit,
    cost,
    costShare,
    minDist,
    minDistPct: minDist / i.entry,
    belowMin: s.stopDist < minDist - 1e-12,
    stopAtr,
    target,
    targetWrongSide,
    step: { step, example: !real, qty, notional: qty * i.entry, loss, lossPct: loss / i.capital },
    notes,
    tone: notes[0]!.tone,
  };
}

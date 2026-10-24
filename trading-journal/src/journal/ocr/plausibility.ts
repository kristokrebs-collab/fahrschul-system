/**
 * Plausibility of one read record (PURE): do the numbers belong together? The prices, the quantity, the result, the ROI
 * and the leverage of a position are tied by arithmetic, so a number the engine misread shows up as a number that does
 * not fit. Everything computed here is DERIVED (never "read") and is labelled so:
 *
 *   gross  = (exit − entry) × qty × direction
 *   fees   = gross − result              (the exchange's "Position PnL" is NET of fees and funding)
 *   ROI    = result ÷ (entry × qty ÷ leverage) × 100
 *
 * A check never changes a value; it flags the fields involved (`fields`) and may suggest one (`suggest`).
 */
import type { Side } from "@/domain/types";

export interface PlausibilityInput {
  side: Side | null;
  entry: number | null;
  exit: number | null;
  qty: number | null;
  /** The result as the exchange shows it. */
  pnl: number | null;
  /** ROI in percent as shown. */
  roi: number | null;
  leverage: number | null;
  /** A fee the screenshot itself shows (then nothing is derived). */
  fee: number | null;
}

export type PlauField = "entry" | "exit" | "qty" | "pnl" | "roi" | "leverage" | "side" | "fees";

export interface PlausibilityFlag {
  code: "price_scale" | "result_sign" | "result_far" | "roi_mismatch" | "leverage_hint" | "side_hint";
  /** The fields that do not fit together (the preview marks them). */
  fields: PlauField[];
  text: string;
  /** A value that would make the numbers fit (an offer, never applied). */
  suggest?: { field: PlauField; value: number };
}

export interface Plausibility {
  gross: number | null;
  /** Position value at entry (entry × qty). */
  notional: number | null;
  /** Fees (incl. funding) implied by gross and result; `null` when not derivable or implausible. */
  derivedFees: number | null;
  /** ROI the prices / leverage give, in percent. */
  roiExpected: number | null;
  /** Leverage the ROI implies (informational, not rounded). */
  leverageImplied: number | null;
  /** The ROI agrees with the result (within rounding), `null` when not checkable. */
  roiOk: boolean | null;
  flags: PlausibilityFlag[];
}

const dir = (s: Side): 1 | -1 => (s === "short" ? -1 : 1);
const fmt = (v: number, d = 2): string => new Intl.NumberFormat("de-DE", { maximumFractionDigits: d }).format(v);

/** Fees + funding of a position, as a share of its value, that are still believable (taker 0.06 % × 2 + funding + slack). */
export const MAX_FEE_SHARE = 0.006;
/** Beyond this share the numbers cannot belong together. */
export const IMPLAUSIBLE_FEE_SHARE = 0.02;

export function checkRecord(i: PlausibilityInput): Plausibility {
  const out: Plausibility = { gross: null, notional: null, derivedFees: null, roiExpected: null, leverageImplied: null, roiOk: null, flags: [] };
  const { entry, exit, qty, pnl, roi, leverage, side } = i;
  if (entry != null && qty != null) out.notional = entry * qty;

  if (entry != null && exit != null && entry > 0 && exit > 0) {
    const ratio = exit / entry;
    if (ratio > 1.6 || ratio < 1 / 1.6) out.flags.push({ code: "price_scale", fields: ["entry", "exit"], text: `Einstieg ${fmt(entry, 8)} und Ausstieg ${fmt(exit, 8)} liegen weit auseinander – vermutlich fehlt oder verrutscht ein Dezimalzeichen.` });
  }
  if (side && entry != null && exit != null && qty != null && !out.flags.some((f) => f.code === "price_scale")) out.gross = (exit - entry) * qty * dir(side);

  // direction from the numbers: an offer when the side is unknown, a warning when it contradicts
  if (entry != null && exit != null && pnl != null && out.notional && Math.abs(pnl) > out.notional * 0.0004 && exit !== entry) {
    const implied: Side = (exit - entry) * pnl > 0 ? "long" : "short";
    if (!side) out.flags.push({ code: "side_hint", fields: ["side"], text: `Richtung nicht lesbar. Aus Preisen und Ergebnis würde ${implied === "long" ? "Long" : "Short"} folgen.` });
    else if (side !== implied && Math.abs((exit - entry) * (qty ?? 0)) > Math.abs(pnl) * 0.2 + out.notional * MAX_FEE_SHARE)
      out.flags.push({ code: "side_hint", fields: ["side", "entry", "exit", "pnl"], text: `Preise und Ergebnis passen eher zu ${implied === "long" ? "Long" : "Short"} als zu ${side === "long" ? "Long" : "Short"} – Richtung, Preise oder Vorzeichen prüfen.` });
  }

  if (out.gross != null && pnl != null && out.notional) {
    const fees = out.gross - pnl;
    const share = fees / out.notional;
    if (share >= -0.0005 && share <= MAX_FEE_SHARE) out.derivedFees = Math.max(0, fees);
    else if (Math.abs(share) > IMPLAUSIBLE_FEE_SHARE || share < -0.0005)
      out.flags.push({
        code: Math.sign(out.gross) !== Math.sign(pnl) && Math.abs(out.gross) > out.notional * 0.001 ? "result_sign" : "result_far",
        fields: ["entry", "exit", "qty", "pnl"],
        text: `Ergebnis ${fmt(pnl)} und Preise × Menge (${fmt(out.gross)}) passen nicht zusammen (Differenz ${fmt(fees)} = ${fmt(share * 100, 2)} % des Positionswerts) – eine der Zahlen ist vermutlich falsch gelesen.`,
      });
    // in between (0.6 % … 2 %): high fees / funding on a long hold – no fee is derived, no alarm
  }

  if (pnl != null && out.notional && out.notional > 0) {
    if (leverage != null && leverage > 0) {
      out.roiExpected = (pnl / (out.notional / leverage)) * 100;
      if (roi != null) {
        const tol = Math.max(0.08, Math.abs(roi) * 0.025);
        out.roiOk = Math.abs(out.roiExpected - roi) <= tol;
        if (!out.roiOk) {
          const sign = Math.sign(out.roiExpected) !== Math.sign(roi) && Math.abs(roi) > 0.05;
          out.flags.push({
            code: "roi_mismatch",
            fields: ["roi", "pnl", "leverage"],
            text: sign
              ? `ROI ${fmt(roi)} % hat ein anderes Vorzeichen als das Ergebnis ${fmt(pnl)} – Vorzeichen prüfen.`
              : `ROI ${fmt(roi)} % passt nicht zu Ergebnis, Positionswert und Hebel ${fmt(leverage, 4)}× (erwartet ≈ ${fmt(out.roiExpected)} %).`,
          });
        }
      }
    }
    if (roi != null && Math.abs(roi) > 0.01 && Math.abs(pnl) > 1e-9 && Math.sign(roi) === Math.sign(pnl)) {
      out.leverageImplied = ((roi / 100) * out.notional) / pnl;
      const rounded = Math.round(out.leverageImplied);
      if (leverage != null && rounded >= 1 && Math.abs(out.leverageImplied - rounded) <= Math.max(0.12, rounded * 0.02) && rounded !== leverage && out.roiOk === false)
        out.flags.push({ code: "leverage_hint", fields: ["leverage"], text: `Aus ROI, Ergebnis und Positionswert würde ein Hebel von ${rounded}× folgen (gelesen: ${fmt(leverage, 4)}×).`, suggest: { field: "leverage", value: rounded } });
    }
  }
  return out;
}

/** Leverage the ROI proves: the integer that fits within rounding, or `null` – used to confirm a leverage reading. */
export function leverageFromRoi(p: Pick<Plausibility, "leverageImplied">): number | null {
  const v = p.leverageImplied;
  if (v == null) return null;
  const r = Math.round(v);
  return r >= 1 && Math.abs(v - r) <= Math.max(0.12, r * 0.02) ? r : null;
}

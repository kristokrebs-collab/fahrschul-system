/**
 * Budget und Positionsgröße (nach dem Skill trader-budget): ganze Einheiten innerhalb von vier Grenzen. Die kleinste Menge
 * gewinnt, und die Seite sagt, welche Grenze gerade bindet.
 *
 *   Verlust   das Risiko pro Trade (Konto × Risiko-%) ÷ Verlust je Einheit am Stop – inkl. Gebühren und Slippage am Stop
 *             (dieselbe Rechnung wie der Positionsrechner der Risiko-Seite, `positionSize`)
 *   Position  der Deckel für den Wert einer Position (Anteil am Konto) ÷ Einstieg
 *   Kaufkraft Konto nach dem Cash-Puffer × Hebel ÷ Einstieg (ohne Hebel: nur Bargeld; Aktien: Hebel 1)
 *   Tageslimit der Rest des Tagesverlust-Limits ÷ Verlust je Einheit (aus den Live-Limits der Risiko-Seite)
 *
 * Gerundet wird immer AB auf den Mengenschritt (Lot; Krypto z. B. 0,001, Aktien 1). Ein Stop, der für das Risiko zu weit weg
 * ist, ist eine klare Ablehnung – die App macht nicht still eine kleinere Position daraus oder den Stop enger. Nichts wird
 * hier gesendet oder platziert.
 */
import type { Side } from "../types";
import { positionSize } from "../risk/sizing";
import { moneyText, num, pctText, priceText, qtyText, toStep } from "./format";

export type LimitKey = "loss" | "position" | "power" | "day";

export const LIMIT_LABEL: Readonly<Record<LimitKey, string>> = {
  loss: "Max. Verlust pro Trade",
  position: "Max. Positionswert",
  power: "Kaufkraft (Hebel, Cash-Puffer)",
  day: "Rest des Tageslimits",
};
export const LIMIT_ORDER: readonly LimitKey[] = ["loss", "position", "power", "day"];

export interface SizeInput {
  side: Side;
  entry: number;
  stop: number;
  /** price step, for the words */
  tick: number;
  /** account capital (quote currency) */
  capital: number;
  /** risk per trade, fraction of the capital */
  riskPct: number;
  /** cap of one position's value, fraction of the capital */
  maxPositionPct: number;
  /** share of the capital that always stays free (fraction) */
  cashBufferPct: number;
  /** leverage used for the buying power (1 = none) */
  leverage: number;
  /** loss budget left today in money (limit − used); `null` = unknown, the row is left out */
  dayRemaining: number | null;
  /** quantity step */
  lot: number;
  feePct: number;
  slippagePct: number;
  /** smallest position value (quote currency); 0 = none */
  minOrderValue: number;
  currency: string;
}

export interface LimitRow {
  key: LimitKey;
  label: string;
  /** the quantity this limit alone allows (exact), `null` when the limit is unknown */
  qty: number | null;
  /** … rounded down to the lot */
  rounded: number | null;
  /** how it was computed, in words */
  detail: string;
  /** this limit decided the size */
  binding: boolean;
}

export interface Sizing {
  ok: true;
  qty: number;
  notional: number;
  margin: number;
  /** notional ÷ capital */
  neededLeverage: number;
  /** loss per unit at the stop incl. fees and slippage */
  lossPerUnit: number;
  /** qty × distance to the stop – the plain price loss */
  priceLoss: number;
  /** loss at the stop incl. round-trip fees and the slippage on the stop fill */
  maxLoss: number;
  fees: number;
  slippage: number;
  /** maxLoss ÷ capital */
  riskOfCapital: number;
  rows: LimitRow[];
  binding: LimitKey;
  /** one sentence: which limit decided and why */
  headline: string;
  lot: number;
}

export type SizeErrorCode = "input" | "too-far" | "position" | "power" | "day" | "min-order";

export interface SizeRefusal {
  ok: false;
  code: SizeErrorCode;
  reason: string;
  rows: LimitRow[];
}

export type SizeResult = Sizing | SizeRefusal;

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Rounds a quantity down to the lot (no floating-point dust). */
export const floorLot = (qty: number, lot: number): number => (qty > 0 ? toStep(qty, lot, "floor") : 0);

export function positionSizing(i: SizeInput): SizeResult {
  const cur = i.currency;
  const M = (x: number): string => `${moneyText(x)} ${cur}`;
  const P = (x: number): string => priceText(x, i.tick);
  const bad = (reason: string): SizeRefusal => ({ ok: false, code: "input", reason, rows: [] });
  if (![i.entry, i.stop, i.capital, i.riskPct, i.lot, i.leverage, i.maxPositionPct, i.cashBufferPct].every(fin)) return bad("Eine Eingabe fehlt oder ist keine Zahl.");
  if (!(i.capital > 0)) return bad("Das Konto hat kein Kapital – trage es in den Einstellungen ein.");
  if (!(i.riskPct > 0 && i.riskPct <= 1)) return bad("Das Risiko pro Trade muss zwischen 0 und 100 % liegen.");
  if (!(i.lot > 0)) return bad("Der Mengenschritt muss über null liegen.");
  if (!(i.leverage >= 1)) return bad("Der Hebel ist mindestens 1 (kein Hebel).");

  const ps = positionSize({ capital: i.capital, riskPct: i.riskPct, entry: i.entry, stop: i.stop, side: i.side, feePct: i.feePct, slippagePct: i.slippagePct });
  if (!ps.ok) return bad(ps.error === "side" || ps.error === "stop" ? "Der Stop liegt auf der falschen Seite des Einstiegs." : "Einstieg, Stop oder Risiko sind nicht rechenbar.");
  const riskAmount = ps.riskAmount;
  const lossPerUnit = ps.lossPerUnit;

  const raw: Record<LimitKey, number | null> = {
    loss: ps.qty,
    position: (i.maxPositionPct * i.capital) / i.entry,
    power: (i.capital * (1 - i.cashBufferPct) * i.leverage) / i.entry,
    day: i.dayRemaining == null ? null : Math.max(0, i.dayRemaining) / lossPerUnit,
  };
  const detail: Record<LimitKey, string> = {
    loss: `${M(riskAmount)} (${pctText(i.riskPct, 2)} des Kontos) ÷ ${M(lossPerUnit)} je Einheit – Abstand zum Stop ${P(Math.abs(i.entry - i.stop))} plus Gebühren und Slippage`,
    position: `${pctText(i.maxPositionPct, 0)} von ${M(i.capital)} = ${M(i.maxPositionPct * i.capital)} ÷ Einstieg ${P(i.entry)}`,
    power: `${M(i.capital)} × ${pctText(1 - i.cashBufferPct, 0)} (nach ${pctText(i.cashBufferPct, 0)} Cash-Puffer) × ${num(i.leverage, Number.isInteger(i.leverage) ? 0 : 1)}× Hebel = ${M(i.capital * (1 - i.cashBufferPct) * i.leverage)} ÷ Einstieg ${P(i.entry)}`,
    day: i.dayRemaining == null ? "Kein Tageslimit bekannt." : i.dayRemaining <= 0 ? "Das Tageslimit ist schon aufgebraucht." : `${M(i.dayRemaining)} Rest ÷ ${M(lossPerUnit)} je Einheit`,
  };

  const known = LIMIT_ORDER.filter((k) => raw[k] != null);
  let bindingKey: LimitKey = known[0]!;
  for (const k of known) if (raw[k]! < raw[bindingKey]! - 1e-12 * Math.max(1, raw[bindingKey]!)) bindingKey = k;
  const rows: LimitRow[] = LIMIT_ORDER.map((k) => ({
    key: k,
    label: LIMIT_LABEL[k],
    qty: raw[k],
    rounded: raw[k] == null ? null : floorLot(raw[k]!, i.lot),
    detail: detail[k],
    binding: k === bindingKey,
  }));
  const qty = floorLot(raw[bindingKey]!, i.lot);
  const lot = qtyText(i.lot, i.lot);

  if (qty <= 0) {
    const refusal: Record<LimitKey, [SizeErrorCode, string]> = {
      loss: ["too-far", `Schon die kleinste Menge (${lot}) würde am Stop ${M(lossPerUnit * i.lot)} verlieren – mehr als dein Risiko von ${M(riskAmount)}. Der Stop ist für dieses Risiko zu weit weg. Die App macht daraus keine kleinere Position und rückt den Stop nicht: Stop näher setzen, das Risiko erhöhen oder den Trade auslassen.`],
      position: ["position", `Die kleinste Menge (${lot}) wäre ${M(i.lot * i.entry)} wert – mehr als der Deckel für eine Position erlaubt (${M(i.maxPositionPct * i.capital)}).`],
      power: ["power", `Die kleinste Menge (${lot}) wäre ${M(i.lot * i.entry)} wert – mehr als deine Kaufkraft von ${M(i.capital * (1 - i.cashBufferPct) * i.leverage)}.`],
      day: ["day", i.dayRemaining != null && i.dayRemaining <= 0 ? "Das Tageslimit ist schon erreicht – heute keine neue Position." : `Der Rest des Tageslimits (${M(Math.max(0, i.dayRemaining ?? 0))}) reicht nicht einmal für die kleinste Menge (${lot}), die am Stop ${M(lossPerUnit * i.lot)} verlieren würde.`],
    };
    const [code, reason] = refusal[bindingKey];
    return { ok: false, code, reason, rows };
  }
  const notional = qty * i.entry;
  if (i.minOrderValue > 0 && notional < i.minOrderValue) {
    return { ok: false, code: "min-order", reason: `Der Positionswert ${M(notional)} liegt unter dem Minimum von ${M(i.minOrderValue)}.`, rows };
  }
  const maxLoss = qty * lossPerUnit;
  const priceLoss = qty * Math.abs(i.entry - i.stop);
  const headline: Record<LimitKey, string> = {
    loss: `Dein Risiko pro Trade bindet: mehr Menge würde am Stop mehr als ${M(riskAmount)} verlieren.`,
    position: `Der Deckel für den Positionswert bindet (${M(i.maxPositionPct * i.capital)}): nach dem Risiko wäre mehr erlaubt gewesen.`,
    power: `Die Kaufkraft bindet (${M(i.capital * (1 - i.cashBufferPct) * i.leverage)}): ${i.leverage > 1 ? "mit mehr Hebel" : "mit Hebel"} und weniger Puffer wäre mehr möglich – im Rahmen deiner Regeln.`,
    day: `Der Rest des Tageslimits bindet (${M(Math.max(0, i.dayRemaining ?? 0))}): heute ist nicht mehr Verlust eingeplant.`,
  };
  return {
    ok: true,
    qty,
    notional,
    margin: notional / i.leverage,
    neededLeverage: notional / i.capital,
    lossPerUnit,
    priceLoss,
    maxLoss,
    fees: qty * i.feePct * (i.entry + i.stop),
    slippage: qty * i.slippagePct * i.stop,
    riskOfCapital: maxLoss / i.capital,
    rows,
    binding: bindingKey,
    headline: headline[bindingKey],
    lot: i.lot,
  };
}

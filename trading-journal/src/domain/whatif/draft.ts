/**
 * The form of "Eigene Variante" (F33) as plain data, and its translation into a `Scenario`. Inputs arrive as typed text
 * (a German decimal comma is fine); anything that is not a usable number leaves that part of the variant out and says so
 * (`draftNotes`) – a half-typed field never changes the result silently.
 */
import type { Scenario } from "./simulate";

export interface CustomDraft {
  stop: "orig" | "factor" | "price";
  stopFactor: string;
  stopPrice: string;
  breakEven: boolean;
  breakEvenR: string;
  partial: boolean;
  partialR: string;
  /** share sold at the partial, in percent */
  partialPct: string;
  partialThenBe: boolean;
  target: "keep" | "none" | "r";
  targetR: string;
  horizon: "actual" | "runOn" | "bars";
  horizonBars: string;
  trail: "off" | "pct" | "atr";
  trailValue: string;
  trailFromR: string;
}

export const DEFAULT_DRAFT: Readonly<CustomDraft> = Object.freeze({
  stop: "orig",
  stopFactor: "0,75",
  stopPrice: "",
  breakEven: false,
  breakEvenR: "1",
  partial: false,
  partialR: "1",
  partialPct: "50",
  partialThenBe: true,
  target: "keep",
  targetR: "2",
  horizon: "actual",
  horizonBars: "8",
  trail: "off",
  trailValue: "1,5",
  trailFromR: "1",
});

/** A typed number: German comma accepted, `null` for anything else. */
export function num(text: string): number | null {
  const v = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(v) ? v : null;
}

/** The scenario a draft describes. Parts with an unusable number are left out. */
export function scenarioOfDraft(d: CustomDraft): Scenario {
  const s: Scenario = { id: "custom", label: "Eigene Variante" };
  const factor = num(d.stopFactor);
  const price = num(d.stopPrice);
  if (d.stop === "factor" && factor != null && factor > 0) s.stop = { kind: "factor", value: factor };
  if (d.stop === "price" && price != null && price > 0) s.stop = { kind: "price", value: price };
  const be = num(d.breakEvenR);
  if (d.breakEven && be != null && be > 0) s.breakEven = { afterR: be, to: "entry" };
  const pr = num(d.partialR);
  const pp = num(d.partialPct);
  if (d.partial && pr != null && pr > 0 && pp != null && pp >= 5 && pp <= 95) s.partial = { atR: pr, frac: pp / 100, thenBreakEven: d.partialThenBe };
  const tr = num(d.targetR);
  if (d.target === "none") s.target = { kind: "none" };
  if (d.target === "r" && tr != null && tr > 0) s.target = { kind: "r", value: tr };
  const hb = num(d.horizonBars);
  if (d.horizon === "runOn") s.horizon = { kind: "runOn" };
  if (d.horizon === "bars" && hb != null && hb >= 1) s.horizon = { kind: "bars", n: Math.floor(hb) };
  const tv = num(d.trailValue);
  const tf = num(d.trailFromR);
  if (d.trail !== "off" && tv != null && tv > 0) s.trail = { kind: d.trail, value: tv, activateR: tf != null && tf >= 0 ? tf : 0 };
  return s;
}

/** German notes for parts of the draft that were left out because their number is unusable. */
export function draftNotes(d: CustomDraft): string[] {
  const out: string[] = [];
  if (d.stop === "factor" && !((num(d.stopFactor) ?? 0) > 0)) out.push("Stopp-Faktor fehlt – es gilt der ursprüngliche Stopp.");
  if (d.stop === "price" && !((num(d.stopPrice) ?? 0) > 0)) out.push("Stopp-Kurs fehlt – es gilt der ursprüngliche Stopp.");
  if (d.breakEven && !((num(d.breakEvenR) ?? 0) > 0)) out.push("Break-even-Schwelle fehlt – ohne Break-even gerechnet.");
  if (d.partial) {
    const p = num(d.partialPct);
    if (!((num(d.partialR) ?? 0) > 0) || p == null || p < 5 || p > 95) out.push("Teilziel unvollständig (R > 0 und Anteil 5–95 %) – ohne Teilziel gerechnet.");
  }
  if (d.target === "r" && !((num(d.targetR) ?? 0) > 0)) out.push("Ziel in R fehlt – es gilt das gebuchte Ziel.");
  if (d.horizon === "bars" && !((num(d.horizonBars) ?? 0) >= 1)) out.push("Kerzenanzahl fehlt – es gilt der Ist-Ausstieg.");
  if (d.trail !== "off" && !((num(d.trailValue) ?? 0) > 0)) out.push("Trailing-Abstand fehlt – ohne Trailing gerechnet.");
  return out;
}

/** True when the draft changes anything against the plain recorded rules. */
export function draftActive(d: CustomDraft): boolean {
  const s = scenarioOfDraft(d);
  return !!(s.stop || s.breakEven || s.partial || s.trail || s.target || s.horizon);
}

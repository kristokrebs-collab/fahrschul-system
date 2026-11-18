/**
 * „Aus Screenshot übernehmen“ with the local reader: the values of ONE read trade go into the OPEN trade form (not a new
 * editor session). Deliberately tiny – the editor imports it; the reader (sheet, engine, parser) stays a lazy chunk that
 * only calls `fillEditorFromShot`.
 *
 * What goes over: a `TradeDraft` with the fields the picture showed (or that were derived from it), and per form field a
 * MARK – read, derived, corrected, or „prüfen“ (doubtful / implausible / missing) – so the trader sees exactly what was
 * taken. Nothing is saved here: the trader presses „Speichern“ in the editor as always.
 */
import { create } from "zustand";
import type { TradeDraft } from "@/store/uiStore";

/** Form fields a screenshot can fill (core fields of the form and those of „Ausführung“). */
export type FillKey = "pair" | "side" | "date" | "entry" | "exit" | "size" | "leverage" | "fees" | "pnlManual" | "exitDate" | "qty" | "market" | "marginMode";

/** `read`: as in the picture · `derived`: computed from other numbers · `review`: doubtful, implausible or missing – please check. */
export type FillState = "read" | "derived" | "review";

export interface FillMark {
  state: FillState;
  /** Why (German, one line), e.g. the plausibility text or „abgeleitet: Preise × Menge − Ergebnis“. */
  note?: string;
}

export interface ShotFill {
  /** Bumped by every fill: the editor applies each one once. */
  seq: number;
  draft: TradeDraft;
  marks: Partial<Record<FillKey, FillMark>>;
  /** The honest sentence above the form (what was taken, what to check, cut-off cards, corrections). */
  note: string;
}

export const useShotFill = create<{ fill: ShotFill | null }>(() => ({ fill: null }));

/** Hands one read trade to the open editor. */
export function fillEditorFromShot(fill: Omit<ShotFill, "seq">): void {
  useShotFill.setState((s) => ({ fill: { ...fill, seq: (s.fill?.seq ?? 0) + 1 } }));
}

/** The editor closed (or took the fill): nothing waits any more. */
export function clearShotFill(): void {
  if (useShotFill.getState().fill) useShotFill.setState({ fill: null });
}

/** German label of a filled field (for the editor's sentence). */
export const FILL_LABEL: Record<FillKey, string> = {
  pair: "Paar",
  side: "Richtung",
  date: "Einstiegszeit",
  entry: "Einstieg",
  exit: "Ausstieg",
  size: "Größe",
  leverage: "Hebel",
  fees: "Gebühren",
  pnlManual: "P&L",
  exitDate: "Ausstiegszeit",
  qty: "Menge",
  market: "Markt",
  marginMode: "Margin-Modus",
};

/** The help line under a marked field. */
export function markText(m: FillMark): string {
  const head = m.state === "review" ? "Aus Screenshot – bitte prüfen" : m.state === "derived" ? "Aus Screenshot abgeleitet" : "Aus Screenshot";
  return m.note ? `${head}: ${m.note}` : head;
}

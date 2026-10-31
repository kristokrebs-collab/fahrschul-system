/**
 * Lage-Ampel gate of the Einstiegs-Check (decision 23, knife-lab REPORT § Integration): a LONG entry counts (`valid`,
 * notifications, strength) only while the Lage is green. On red / amber (mode `block`, the default) the ladder keeps
 * computing and the entry stays visible, faded, with the label `Kaufsignal · Lage rot – zählt nicht (fällt noch)` /
 * `Kaufsignal · Lage gelb – Umkehr bildet sich (2/4)`; mode `warn` lets it count and only adds the warning. Shorts,
 * the switch off, no Lage data (`none`) → untouched. Pure.
 */
import { lageGate, type Lage, type LageGate, type LageSettings } from "../lage";
import type { Strength, Verdict } from "./verdict";

/** = `PROVISIONAL_PREFIX` of `verdict.ts` (not imported: verdict.ts imports this module; a test pins the equality). */
const PROVISIONAL_PREFIX = "Vorläufig: ";

/** The Lage at the evaluation time + the user's setting (`settings.signals.lage`). `lage: null` = no data → no gate. */
export interface LageInput {
  lage: Lage | null;
  cfg: LageSettings;
}

/** The gate result on a verdict. */
export interface VerdictLage extends LageGate {
  /** met reversal signs (0 … 4) */
  signsMet: number;
  /** the strength the entry would have (blocked) or has */
  strength: Strength;
  /** the verdict's own label before the gate */
  from: string;
  /** an entry (valid or provisional) was held back — `blocked` alone also marks a long without an entry under red / amber */
  held: boolean;
}

/** Label prefix of a blocked long entry. */
export const LAGE_BLOCK_PREFIX = "Kaufsignal · ";

/** `Kaufsignal · Lage rot – zählt nicht (fällt noch)` (provisional entries keep the `Vorläufig: ` prefix). */
export function lageBlockedLabel(v: Pick<Verdict, "label" | "state">, gateLabel: string): string {
  return `${v.state === "provisional" ? PROVISIONAL_PREFIX : ""}${LAGE_BLOCK_PREFIX}${gateLabel}`;
}

/**
 * Applies the gate to one verdict. Every long verdict gets `lage` when the gate has something to say (red / amber;
 * also without an entry, so the card can name the Lage); an entry (`valid` or provisional) is held back on `block`:
 * `valid` false, strength 0 (the would-be strength in `lage.strength`, a provisional one keeps `provStrength`), the
 * label above and one reason row.
 */
export function applyLageGate(v: Verdict, input: LageInput | null | undefined): Verdict {
  if (!input || v.side !== "long") return v;
  const g = lageGate(input.lage, input.cfg, "long");
  if (!g.label) return v;
  const entry = v.valid || v.state === "provisional";
  const lage: VerdictLage = { ...g, signsMet: input.lage?.signsMet ?? 0, strength: v.valid ? v.strength : ((v.provStrength ?? 0) as Strength), from: v.label, held: entry && g.blocked };
  if (!entry) return { ...v, lage };
  const reasons = [...v.reasons, { text: g.label, ok: false }];
  if (!g.blocked) return { ...v, lage, reasons };
  return { ...v, valid: false, strength: 0, label: lageBlockedLabel(v, g.label), reasons, lage };
}

/** Text of a verdict's Lage line (`Lage rot – zählt nicht (fällt noch)`), `null` without one. */
export const verdictLageText = (v: Pick<Verdict, "lage">): string | null => v.lage?.label ?? null;

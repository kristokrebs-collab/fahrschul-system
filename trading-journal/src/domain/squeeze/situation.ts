/**
 * Squeeze observation (F07), the context: the crowded side put next to the phase of the box – before a breakout, after it,
 * or after a failed one. Wording is descriptive („möglich“, „bisher“), never an instruction. Pure.
 */
import type { SqueezeSide } from "./types";

export type CtxTf = "4h" | "1d" | "1w";
export type CtxPhase = "inside" | "breakout" | "retest" | "failed" | "target" | "running" | "none";

/** One timeframe's newest box: its phase and the direction of the breakout (also of a failed one; 0 = none). */
export interface BoxCtx {
  tf: CtxTf;
  phase: CtxPhase;
  dir: 1 | -1 | 0;
}

export type Timing = "before" | "after" | "failed";
/** `with` = the break goes the crowd's way · `against` = against the crowd · `null` = before any break */
export type Relation = "with" | "against" | null;

export interface Situation {
  tf: CtxTf;
  timing: Timing;
  relation: Relation;
  text: string;
}

export const TF_NAME: Readonly<Record<CtxTf, string>> = { "4h": "4h", "1d": "1D", "1w": "1W" };
const PRIORITY: readonly CtxTf[] = ["4h", "1d", "1w"];
const AFTER: ReadonlySet<CtxPhase> = new Set(["breakout", "retest", "target", "running"]);
const SIDE_NAME: Readonly<Record<SqueezeSide, string>> = { long: "Long", short: "Short" };

/**
 * The most recent event first (4h, then 1D, then 1W): a breakout or a failed one beats „still inside“. `null` when no box
 * is known at all.
 */
export function situationOf(side: SqueezeSide, ctx: readonly BoxCtx[]): Situation | null {
  const by = new Map(ctx.map((c) => [c.tf, c] as const));
  const ordered = PRIORITY.map((tf) => by.get(tf)).filter((c): c is BoxCtx => !!c && c.phase !== "none");
  const event = ordered.find((c) => AFTER.has(c.phase) || c.phase === "failed");
  const c = event ?? ordered[0];
  if (!c) return null;
  const crowd = `${SIDE_NAME[side]}-Seite`;
  const where = TF_NAME[c.tf];
  if (c.phase === "failed") {
    const up = c.dir > 0;
    const relation: Relation = c.dir === 0 ? null : (up ? "long" : "short") === side ? "with" : "against";
    const dirText = c.dir === 0 ? "" : ` nach ${up ? "oben" : "unten"}`;
    const text =
      relation === "with"
        ? `Fehlausbruch${dirText} (${where}) bei überfüllter ${crowd}: Die Menge stand auf der Seite des Ausbruchs und ist jetzt zurück in der Box.`
        : relation === "against"
          ? `Fehlausbruch${dirText} (${where}): Die überfüllte ${crowd} stand dagegen und behielt vorerst recht.`
          : `Fehlausbruch (${where}) bei überfüllter ${crowd}.`;
    return { tf: c.tf, timing: "failed", relation, text };
  }
  if (AFTER.has(c.phase) && c.dir !== 0) {
    const up = c.dir > 0;
    const relation: Relation = (up ? "long" : "short") === side ? "with" : "against";
    const text =
      relation === "with"
        ? `Ausbruch nach ${up ? "oben" : "unten"} (${where}) in Richtung der überfüllten ${crowd}: Die Menge lag bisher richtig; Funding, Open Interest und Positionierung zeigen Überhitzung.`
        : `Ausbruch nach ${up ? "oben" : "unten"} (${where}) gegen die überfüllte ${crowd}: Deren Positionen geraten unter Druck, ein Squeeze ist möglich.`;
    return { tf: c.tf, timing: "after", relation, text };
  }
  return { tf: c.tf, timing: "before", relation: null, text: `Preis noch in der Box (${where}) bei überfüllter ${crowd}: Ein Ausbruch gegen diese Seite würde sie unter Druck setzen.` };
}

/** `Long-Seite überfüllt` / `Short-Seite überfüllt`. */
export const crowdedText = (side: SqueezeSide): string => `${SIDE_NAME[side]}-Seite überfüllt`;

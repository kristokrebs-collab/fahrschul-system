/**
 * Strict checks of rule data coming from text (the local parser) or from a language model (the server): the lab's
 * `sanitizeParams` clamps silently – fine for a stored draft, wrong for a rule someone just dictated. Here an out-of-range
 * number or an unknown option is a PROBLEM that is named, never a repair.
 */
import { BLOCKS } from "../lab/rules/blocks";
import type { BlockId, LeafParams } from "../lab/rules/types";

const de = (v: number): string => String(Math.round(v * 10_000) / 10_000).replace(".", ",");

/** Why `params` are not valid for `block` (German, one sentence), or `null`. Keys the block does not have are a problem too. */
export function strictParamsProblem(block: BlockId, params: LeafParams): string | null {
  const def = BLOCKS[block];
  for (const [k, v] of Object.entries(params)) {
    const d = def.params.find((x) => x.key === k);
    if (!d) return `${def.label}: „${k}“ ist kein Parameter dieses Bausteins.`;
    if (d.kind === "select") {
      if (typeof v !== "string" || !d.options?.some((o) => o.v === v)) return `${def.label}: „${String(v)}“ ist für „${d.label}“ nicht erlaubt.`;
      continue;
    }
    const x = typeof v === "number" ? v : Number.NaN;
    if (!Number.isFinite(x)) return `${def.label}: „${d.label}“ braucht eine Zahl.`;
    if ((d.min != null && x < d.min) || (d.max != null && x > d.max)) return `${def.label}: ${d.label} ${de(x)} liegt außerhalb von ${d.min != null ? de(d.min) : "–"} bis ${d.max != null ? de(d.max) : "–"}.`;
    if (d.kind === "int" && !Number.isInteger(x)) return `${def.label}: „${d.label}“ muss eine ganze Zahl sein.`;
  }
  return null;
}

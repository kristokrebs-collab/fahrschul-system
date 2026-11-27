/**
 * The description of a pattern filter (plain data, structured-clone safe, versioned) – shared by the miner's conversion
 * (`filter.ts`) and the Labor's filter selection (`lab/filters/types.ts`), which stores it. A leaf module: it imports no lab code.
 */
import { condsKey } from "./cond";
import { FEATURES } from "./features";
import { condsText } from "./text";
import type { Cond } from "./types";

export const PATTERN_VERSION = 1 as const;

export interface PatternFilterSpec {
  v: typeof PATTERN_VERSION;
  /** the pattern in plain language ("RSI(14) ab 55 UND Richtung Long") */
  label: string;
  /** all conditions must hold */
  conds: Cond[];
}

/** Why a feature cannot be evaluated by a backtest filter (null = it can). */
export function filterBlockReason(f: Cond["f"]): string | null {
  const d = FEATURES[f];
  if (d.phase === "after") return `„${d.label}“ ist erst nach dem Trade bekannt – damit kann kein Einstieg gefiltert werden.`;
  if (f === "lossStreak") return "Die Verlustserie hängt vom Verlauf der Trades ab; ein Filter auf dem Signal kennt sie im Backtest nicht.";
  if (f === "setup" || f === "emotion") return `„${d.label}“ kommt aus dem Journal und hat im Backtest keine Entsprechung.`;
  if (f === "keyLevelDist") return "Schlüsselmarken werden im Backtest-Lauf nicht mitgeführt.";
  return null;
}

const isCond = (c: unknown): c is Cond => {
  if (!c || typeof c !== "object") return false;
  const x = c as Record<string, unknown>;
  if (typeof x.f !== "string" || !Object.hasOwn(FEATURES, x.f)) return false;
  if (x.k === "cat") return typeof x.v === "string" && x.v.length > 0 && x.v.length < 60;
  if (x.k !== "num") return false;
  const ok = (v: unknown): boolean => v === null || (typeof v === "number" && Number.isFinite(v));
  return ok(x.lo) && ok(x.hi) && (x.lo !== null || x.hi !== null);
};

/** Any stored value → a valid spec or `null` (unknown version, broken shape, a feature a filter cannot evaluate). */
export function sanitizePatternSpec(raw: unknown): PatternFilterSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== PATTERN_VERSION || !Array.isArray(r.conds) || r.conds.length < 1 || r.conds.length > 3) return null;
  const conds = r.conds.filter(isCond);
  if (conds.length !== r.conds.length || conds.some((c) => filterBlockReason(c.f))) return null;
  const clean: Cond[] = conds.map((c) => (c.k === "cat" ? { f: c.f, k: "cat", v: c.v } : { f: c.f, k: "num", lo: c.lo, hi: c.hi }));
  return { v: PATTERN_VERSION, label: typeof r.label === "string" && r.label ? r.label.slice(0, 300) : condsText(clean), conds: clean };
}

export const patternKey = (spec: PatternFilterSpec): string => condsKey(spec.conds);


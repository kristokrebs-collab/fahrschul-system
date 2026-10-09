/**
 * ID generation – 1:1 port of bundle `Lf`:
 * prefix + 7 random base-36 chars + last 4 base-36 chars of `Date.now()`.
 * Prefixes: "t_" trades, "h_" Hyblock readings, "s_" setups, "c" checklist items, "g" rules (NEW).
 */
export type IdPrefix = "t_" | "h_" | "s_" | "c" | "g" | (string & {});

export function newId(prefix: IdPrefix): string {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export const newTradeId = (): string => newId("t_");
export const newReadingId = (): string => newId("h_");
export const newSetupId = (): string => newId("s_");
export const newChecklistItemId = (): string => newId("c");
export const newRuleId = (): string => newId("g");

/** Bundle `Lf` alias. */
export const Lf = newId;

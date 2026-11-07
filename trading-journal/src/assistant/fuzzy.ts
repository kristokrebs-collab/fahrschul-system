/**
 * Small word matching helpers of the assistant's language layer: the edit distance used for typo repair and the
 * tolerant word test of the insight routes (`insightRoutes.ts`). Pure, no imports – so `understand.ts` and the routes can
 * both use it without importing each other.
 */

/** Damerau-Levenshtein distance (optimal string alignment), early exit above `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, (prev2[j - 2] ?? Infinity) + 1);
      cur[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    prev2.length = 0;
    prev2.push(...prev);
    prev = cur;
  }
  return prev[b.length]!;
}

/** The words of a normalised question (`normalize()` of the NLQ lexicon: lower case, umlauts folded, hyphens split). */
export const tokensOf = (norm: string): string[] => norm.trim().split(" ").filter(Boolean);

/**
 * Does the word `tok` read as `stem`?
 *   `=abc`   the exact word only (short words that would otherwise match too much)
 *   `abc`    the word starts with the stem (plural, compound, ending) – or is a typo of it: one wrong, missing, added or
 *            swapped letter for stems of 5 to 8 letters, two for 9 and more; stems under 5 letters never match by typo
 */
export function near(tok: string, stem: string): boolean {
  if (stem.startsWith("=")) return tok === stem.slice(1);
  if (tok.startsWith(stem)) return true;
  const tol = stem.length >= 9 ? 2 : stem.length >= 5 ? 1 : 0;
  if (!tol || tok.length < stem.length - tol) return false;
  return editDistance(tok.slice(0, stem.length), stem, tol) <= tol || editDistance(tok, stem, tol) <= tol;
}

/** Does any word of `tokens` read as any of `stems`? */
export const has = (tokens: readonly string[], ...stems: string[]): boolean => tokens.some((t) => stems.some((s) => near(t, s)));

/**
 * Fuzzy scorer of the global search (P13). Pure, allocation-light, German aware:
 *   - `normalize`: lower case, umlauts folded (ä → a, ß → ss), diacritics stripped, so "Gebuhren" finds "Gebühren"
 *     and "verlust" finds "Verlust"; the folding keeps a 1:1 index map back into the original text (highlights).
 *   - `matchText`: one query token against one text. Best of: whole word (100) > word prefix (80 + coverage) >
 *     substring (55) > subsequence with gaps (≤ 40, consecutive runs and word starts reward, gaps cost). Returns the
 *     matched character ranges of the ORIGINAL text.
 *   - `scoreFields`: every token of the query must match the title or one keyword (AND); title hits weigh double.
 *     A token typed with the umlaut digraph ("uebersicht", "gebuehren") falls back to its folded form ("ubersicht").
 */

export interface MatchRange {
  start: number;
  end: number;
}

export interface TextMatch {
  score: number;
  ranges: MatchRange[];
}

const FOLD: Record<string, string> = { ä: "a", ö: "o", ü: "u", ß: "ss", æ: "ae", ø: "o", œ: "oe" };

export interface Folded {
  text: string;
  /** index in the folded text → index in the original */
  map: number[];
}

/** Lower-cased, umlaut-folded, diacritic-free copy plus an index map back to the original. */
export function fold(s: string): Folded {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const lower = s[i]!.toLowerCase();
    const f = FOLD[lower] ?? lower.normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (let k = 0; k < f.length; k++) {
      text += f[k];
      map.push(i);
    }
  }
  return { text, map };
}

export const normalize = (s: string): string => fold(s).text;

/** Query → tokens (whitespace / punctuation separated, empty dropped, at most 6). */
export function tokenize(q: string): string[] {
  return normalize(q)
    .split(/[\s,;:/|·]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);
}

const isWordStart = (t: string, i: number): boolean => i === 0 || /[^\p{L}\p{N}]/u.test(t[i - 1]!);

function toRanges(f: Folded, idx: number[]): MatchRange[] {
  const out: MatchRange[] = [];
  for (const i of idx) {
    const o = f.map[i]!;
    const last = out[out.length - 1];
    if (last && last.end === o) last.end = o + 1;
    else if (!last || last.end < o) out.push({ start: o, end: o + 1 });
  }
  return out;
}

/** One (already normalised) token against a folded text. */
export function matchFolded(token: string, f: Folded): TextMatch | null {
  if (!token) return null;
  const t = f.text;
  const n = token.length;
  // word-anchored hits first (whole word, then prefix)
  let at = t.indexOf(token);
  let bestSub = -1;
  while (at !== -1) {
    if (isWordStart(t, at)) {
      const end = at + n;
      const whole = end === t.length || /[^\p{L}\p{N}]/u.test(t[end]!);
      const idx = Array.from({ length: n }, (_, k) => at + k);
      // shorter texts rank a prefix hit a bit higher (coverage)
      const score = whole ? 100 : 80 + Math.round(12 * (n / Math.max(n, t.length)));
      return { score: score - Math.min(10, at / 8), ranges: toRanges(f, idx) };
    }
    if (bestSub === -1) bestSub = at;
    at = t.indexOf(token, at + 1);
  }
  if (bestSub !== -1 && n >= 2) {
    return { score: 55 - Math.min(10, bestSub / 8), ranges: toRanges(f, Array.from({ length: n }, (_, k) => bestSub + k)) };
  }
  // subsequence (typing "lqsw" → "Liquidity Sweep"): greedy left to right, prefer word starts
  if (n < 2) return null;
  const idx: number[] = [];
  let pos = 0;
  let runs = 0;
  let starts = 0;
  let gaps = 0;
  for (let k = 0; k < n; k++) {
    const c = token[k]!;
    // look ahead for a word-start occurrence first, then any occurrence
    let found = -1;
    for (let j = pos; j < t.length; j++) {
      if (t[j] === c && isWordStart(t, j)) {
        found = j;
        break;
      }
    }
    const plain = t.indexOf(c, pos);
    if (plain === -1) return null;
    if (found === -1 || (idx.length && plain === idx[idx.length - 1]! + 1)) found = plain;
    if (idx.length) {
      if (found === idx[idx.length - 1]! + 1) runs++;
      else gaps += found - idx[idx.length - 1]! - 1;
    }
    if (isWordStart(t, found)) starts++;
    idx.push(found);
    pos = found + 1;
  }
  const score = 22 + runs * 3 + starts * 4 - Math.min(18, gaps * 0.6);
  if (score <= 8) return null;
  return { score: Math.min(40, score), ranges: toRanges(f, idx) };
}

/** Convenience: one raw token against one raw text. */
export function matchText(token: string, text: string): TextMatch | null {
  return matchFolded(normalize(token), fold(text));
}

export interface FieldMatch {
  score: number;
  /** highlight ranges inside the title */
  title: MatchRange[];
}

/** Pre-folded searchable fields of an item (fold once, score many queries). */
export interface Haystack {
  title: Folded;
  keywords: Folded[];
}

export function haystack(title: string, keywords: readonly string[] = []): Haystack {
  return { title: fold(title), keywords: keywords.filter(Boolean).map(fold) };
}

/** "uebersicht" → "ubersicht" (the umlaut typed as a digraph, folded like `fold` folds "ü"); null when nothing changes. */
export function digraphFold(token: string): string | null {
  const alt = token.replace(/([aou])e/g, "$1");
  return alt !== token && alt.length >= 2 ? alt : null;
}

/** All tokens must hit (title or a keyword); title hits weigh double. Null when any token misses. */
export function scoreFields(tokens: readonly string[], h: Haystack): FieldMatch | null {
  if (!tokens.length) return { score: 0, title: [] };
  let total = 0;
  const title: MatchRange[] = [];
  for (const tok of tokens) {
    let { inTitle, best } = scoreToken(tok, h);
    const alt = best ? null : digraphFold(tok);
    if (alt) ({ inTitle, best } = scoreToken(alt, h));
    if (!best) return null;
    if (inTitle) title.push(...inTitle.ranges);
    total += best;
  }
  return { score: total / tokens.length, title: mergeRanges(title) };
}

function scoreToken(tok: string, h: Haystack): { inTitle: TextMatch | null; best: number } {
  const inTitle = matchFolded(tok, h.title);
  let best = inTitle ? inTitle.score * 2 : 0;
  for (const k of h.keywords) {
    const m = matchFolded(tok, k);
    if (m && m.score > best) best = m.score;
  }
  return { inTitle, best };
}

export function mergeRanges(r: MatchRange[]): MatchRange[] {
  const s = [...r].sort((a, b) => a.start - b.start);
  const out: MatchRange[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

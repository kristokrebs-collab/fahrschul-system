/**
 * "Muster in deinen Trades" – bundle `The` (48809–48916) as pure data.
 * Input: closed trades of the current account view.
 */
import type { EnrichedTrade } from "./types";
import { aggregate, type Agg } from "./agg";
import { tradeTime, weekdayName } from "@/lib/dates";

export interface PatternTile {
  label: string;
  g: Agg;
}
export interface PatternRow {
  /** dimension key */
  key: "plan" | "side" | "account" | "conviction" | "emotion" | "weekday";
  title: string;
  /** "Mit Plan besser" | "gleich" | "" | "bestes / schlechtestes" | "bester / schlechtester" */
  verdict: string;
  a: PatternTile;
  b: PatternTile;
}

export const PATTERNS_TITLE = "Muster in deinen Trades";
export const PATTERNS_EMPTY_TITLE = "Noch keine Muster";
export const PATTERNS_EMPTY_TEXT =
  "Plan befolgt oder nicht, Long gegen Short, Überzeugung, Gefühl und Wochentag. Das füllt sich mit deinen Trades.";

/** Bundle `n`: compares win rates of two groups; "" when a group is empty. */
export function compareGroups(a: Agg, b: Agg, aLabel: string, bLabel: string): string {
  if (!a.n || !b.n) return "";
  if (a.winRate === b.winRate) return "gleich";
  return `${(a.winRate ?? 0) > (b.winRate ?? 0) ? aLabel : bLabel} besser`;
}

/** Bundle `i`: group by key, aggregate, sort by net descending. */
export function groupBy(closed: readonly EnrichedTrade[], keyOf: (t: EnrichedTrade) => string | null): (Agg & { k: string })[] {
  const m = new Map<string, EnrichedTrade[]>();
  for (const t of closed) {
    const k = keyOf(t);
    if (!k) continue;
    const arr = m.get(k);
    if (arr) arr.push(t);
    else m.set(k, [t]);
  }
  return [...m].map(([k, v]) => ({ k, ...aggregate(v) })).sort((a, b) => b.net - a.net);
}

/** Tile caption: "{n} Trades · {signed(net,0)}" | "keine Trades" (value = n ? pct0(winRate) : "–"). */
export function minePatterns(closed: readonly EnrichedTrade[]): PatternRow[] {
  if (!closed.length) return [];
  const sub = (pred: (t: EnrichedTrade) => boolean): Agg => aggregate(closed.filter(pred));
  const rows: PatternRow[] = [];

  const plan = [sub((t) => t.followedPlan === true), sub((t) => t.followedPlan === false)] as const;
  rows.push({
    key: "plan",
    title: "Plan befolgt?",
    verdict: compareGroups(plan[0], plan[1], "Mit Plan", "Ohne Plan"),
    a: { label: "Ja", g: plan[0] },
    b: { label: "Nein", g: plan[1] },
  });

  const side = [sub((t) => t.side !== "short"), sub((t) => t.side === "short")] as const;
  rows.push({
    key: "side",
    title: "Richtung",
    verdict: compareGroups(side[0], side[1], "Long", "Short"),
    a: { label: "Long", g: side[0] },
    b: { label: "Short", g: side[1] },
  });

  const acc = [sub((t) => t.account === "makro"), sub((t) => t.account !== "makro")] as const;
  if (acc[0].n && acc[1].n)
    rows.push({
      key: "account",
      title: "Konto",
      verdict: compareGroups(acc[0], acc[1], "Makro", "Scalp"),
      a: { label: "Makro", g: acc[0] },
      b: { label: "Scalp", g: acc[1] },
    });

  const conv = [sub((t) => (t.conviction || 0) >= 4), sub((t) => !!t.conviction && t.conviction <= 3)] as const;
  rows.push({
    key: "conviction",
    title: "Überzeugung",
    verdict: compareGroups(conv[0], conv[1], "Hohe", "Niedrige"),
    a: { label: "Hoch (4–5)", g: conv[0] },
    b: { label: "Niedrig (1–3)", g: conv[1] },
  });

  const emo = groupBy(closed, (t) => t.emotion || null);
  if (emo.length >= 2) {
    const first = emo[0]!;
    const last = emo[emo.length - 1]!;
    rows.push({
      key: "emotion",
      title: "Gefühl beim Einstieg",
      verdict: "bestes / schlechtestes",
      a: { label: first.k, g: first },
      b: { label: last.k, g: last },
    });
  }

  const wd = groupBy(closed, (t) => weekdayName(tradeTime(t)));
  if (wd.length >= 2) {
    const first = wd[0]!;
    const last = wd[wd.length - 1]!;
    rows.push({
      key: "weekday",
      title: "Wochentag",
      verdict: "bester / schlechtester",
      a: { label: first.k, g: first },
      b: { label: last.k, g: last },
    });
  }
  return rows;
}

export const The = minePatterns;

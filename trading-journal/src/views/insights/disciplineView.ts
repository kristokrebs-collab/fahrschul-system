/**
 * Pure view helpers of the Disziplin card (decision 12: a heat map that fills its column, every day visible, plus the
 * 30-day score trend, the last trading days with their rule hits and the weakest rule). Metrics stay in
 * `@/domain/insights`; this only shapes them for the card.
 */
import { RULE_ORDER, STREAK_MIN, type DisciplineDay, type HeatCell, type RuleKey, type RuleRate } from "@/domain/insights";
import { localDateKey } from "@/lib/dates";

/** Heat-map geometry (px): the number of weeks follows the measured width, cells then stretch to fill it exactly. */
export const HEAT = { cell: 14, gap: 3, minWeeks: 8, maxWeeks: 53, fallbackWeeks: 26 } as const;

/** Pure: how many week columns of `cell` + `gap` fit into `width` (clamped; unmeasured → the 26-week default). */
export function heatWeeks(width: number, cell: number = HEAT.cell, gap: number = HEAT.gap): number {
  if (!(width > 0) || !Number.isFinite(width)) return HEAT.fallbackWeeks;
  return Math.max(HEAT.minWeeks, Math.min(HEAT.maxWeeks, Math.floor((width + gap) / (cell + gap))));
}

export const MONTHS_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"] as const;

/**
 * Pure: month labels over the week columns – at the column whose week holds the 1st of a month; a label closer than
 * `minGap` columns to the previous one is dropped (no overlap). The first column is labelled when no month starts in
 * its first `minGap` columns, so the map always says where it begins.
 */
export function monthLabels(cols: readonly (readonly Pick<HeatCell, "key">[])[], minGap = 3): { col: number; label: string }[] {
  const out: { col: number; label: string }[] = [];
  cols.forEach((col, c) => {
    const first = col.find((d) => d.key.endsWith("-01"));
    if (!first) return;
    const month = Number(first.key.slice(5, 7)) - 1;
    if (out.length && c - out[out.length - 1]!.col < minGap) return;
    out.push({ col: c, label: MONTHS_SHORT[month] ?? "" });
  });
  const head = cols[0]?.[0];
  if (head && (!out.length || out[0]!.col >= minGap)) out.unshift({ col: 0, label: MONTHS_SHORT[Number(head.key.slice(5, 7)) - 1] ?? "" });
  return out;
}

export interface TrendPoint {
  key: string;
  date: Date;
  /** 0…100 on traded days, null otherwise */
  score: number | null;
  today: boolean;
}

/** Pure: the last `n` calendar days (oldest first, ending today) with the day score of each traded day. */
export function scoreTrend(days: readonly DisciplineDay[], today: Date, n = 30): TrendPoint[] {
  const by = new Map(days.map((d) => [d.key, d]));
  const todayKey = localDateKey(today);
  const out: TrendPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = localDateKey(date);
    out.push({ key, date, score: by.get(key)?.score ?? null, today: key === todayKey });
  }
  return out;
}

/** Pure: the newest `n` scored trading days, newest first. */
export function lastTradingDays(days: readonly DisciplineDay[], n = 5): DisciplineDay[] {
  return days.filter((d) => d.score != null).slice(-n).reverse();
}

/** Short rule names for the compact day rows (the full labels live in the rule list). */
export const RULE_SHORT: Readonly<Record<RuleKey, string>> = {
  stop: "Stop",
  setup: "Grundlage",
  checklist: "Checkliste",
  leverage: "Hebel",
  plan: "Plan",
  lossTrade: "Verlust/Trade",
  lossDay: "Tageslimit",
  maxTrades: "Trade-Anzahl",
  signal: "Check",
  reflect: "Reflexion",
};

/** Pure: a day's rule results in the fixed rule order (missing → n/a). */
export function dayMarks(day: Pick<DisciplineDay, "rules">): { key: RuleKey; ok: boolean | null }[] {
  return RULE_ORDER.map((key) => ({ key, ok: day.rules.find((r) => r.key === key)?.ok ?? null }));
}

export interface WeakRule {
  key: RuleKey;
  label: string;
  /** met / applicable over the window */
  rate: number;
  applicable: number;
  /** days the rule was broken in the window */
  broken: number;
}

/**
 * Pure: the rule kept least often in the window (lowest rate; ties → judged on more days, then rule order). `null` when
 * no rule could be judged or every judged rule was kept every time.
 */
export function weakestRule(rates: readonly RuleRate[]): WeakRule | null {
  let best: WeakRule | null = null;
  for (const r of rates) {
    if (r.rate == null || r.applicable <= 0) continue;
    const cand: WeakRule = { key: r.key, label: r.label, rate: r.rate, applicable: r.applicable, broken: r.applicable - Math.round(r.rate * r.applicable) };
    if (!best || cand.rate < best.rate - 1e-9 || (Math.abs(cand.rate - best.rate) < 1e-9 && cand.applicable > best.applicable)) best = cand;
  }
  return best && best.broken > 0 ? best : null;
}

/** Tone of a day score: ≥ the streak threshold → strong, < 50 → weak (signal red), else neutral. */
export function scoreTone(score: number | null): "strong" | "mid" | "weak" | "none" {
  if (score == null) return "none";
  if (score >= STREAK_MIN) return "strong";
  return score < 50 ? "weak" : "mid";
}

/** Pure: "An 1 von 1 Handelstag verletzt." / "An 2 von 5 Handelstagen verletzt." */
export const brokenLine = (w: Pick<WeakRule, "broken" | "applicable">): string => `An ${w.broken} von ${w.applicable} ${w.applicable === 1 ? "Handelstag" : "Handelstagen"} verletzt.`;

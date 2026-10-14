/**
 * "Disziplin" – Tradezella's progress tracker, but fully automatic: every traded day is scored against rules the
 * journal can check from the fields you already fill in (no ticking). A rule that cannot be judged on a day (e.g. no
 * trade with a checklist) does not count for or against it.
 *   day score = met rules / applicable rules · 100
 *   streak    = traded days in a row (newest first) with a score ≥ 80 %; days without trades do not break it
 * Limits come from `settings.discipline` when present (passthrough, forward compatible), else the defaults below.
 */
import type { AccountId, DayNotes, EnrichedTrade, Settings } from "../types";
import { leverageOverRule } from "../derive";
import { localDateKey, tradeTime } from "@/lib/dates";
import { isFin } from "@/lib/format";
import { accountOf, dayFromKey, groupByDay } from "./shared";
import { snapOf } from "./signal";

export interface DisciplineLimits {
  /** max. loss of one trade as a fraction of the account capital */
  maxLossTradePct: number;
  /** max. loss of one day (per account) as a fraction of the account capital */
  maxLossDayPct: number;
  /** max. trades entered per day and account */
  maxTrades: Record<AccountId, number>;
}

export const DEFAULT_LIMITS: Readonly<DisciplineLimits> = Object.freeze({ maxLossTradePct: 0.02, maxLossDayPct: 0.04, maxTrades: { makro: 2, scalp: 5 } });

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? v : null);

/** Limits from `settings.discipline` (unknown passthrough key) merged over the defaults; invalid values are ignored. */
export function disciplineLimits(settings: { discipline?: unknown }): DisciplineLimits {
  const raw = settings.discipline;
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const mt = typeof r.maxTrades === "object" && r.maxTrades !== null ? (r.maxTrades as Record<string, unknown>) : {};
  return {
    maxLossTradePct: num(r.maxLossTradePct, 0.0001, 1) ?? DEFAULT_LIMITS.maxLossTradePct,
    maxLossDayPct: num(r.maxLossDayPct, 0.0001, 1) ?? DEFAULT_LIMITS.maxLossDayPct,
    maxTrades: {
      makro: num(mt.makro, 1, 1000) ?? DEFAULT_LIMITS.maxTrades.makro,
      scalp: num(mt.scalp, 1, 1000) ?? DEFAULT_LIMITS.maxTrades.scalp,
    },
  };
}

export type RuleKey = "stop" | "setup" | "checklist" | "leverage" | "lossTrade" | "lossDay" | "maxTrades" | "signal" | "reflect" | "plan";
export const RULE_ORDER: readonly RuleKey[] = ["stop", "setup", "checklist", "leverage", "plan", "lossTrade", "lossDay", "maxTrades", "signal", "reflect"];

export function ruleLabel(key: RuleKey, limits: DisciplineLimits): string {
  const p = (x: number) => `${String(Math.round(x * 1000) / 10).replace(".", ",")} %`;
  switch (key) {
    case "stop":
      return "Stop gesetzt";
    case "setup":
      return "Grundlage gewählt";
    case "checklist":
      return "Checkliste komplett";
    case "leverage":
      return "Hebel in der Regel";
    case "plan":
      return "Plan befolgt";
    case "lossTrade":
      return `Max. ${p(limits.maxLossTradePct)} Verlust pro Trade`;
    case "lossDay":
      return `Tageslimit ${p(limits.maxLossDayPct)}`;
    case "maxTrades":
      return `Max. ${limits.maxTrades.scalp} Scalp / ${limits.maxTrades.makro} Makro pro Tag`;
    case "signal":
      return "Einstieg mit gültigem Check";
    case "reflect":
      return "Reflektiert";
  }
}

export const RULE_HINTS: Readonly<Record<RuleKey, string>> = {
  stop: "Jeder Trade des Tages hat einen Stop.",
  setup: "Jeder Trade hat eine Entscheidungsgrundlage.",
  checklist: "Kein Trade mit unvollständiger Checkliste.",
  leverage: "Kein Trade über der Hebel-Regel (Scalp 4×, Makro 5×).",
  plan: "Kein Trade mit „Plan befolgt: Nein“.",
  lossTrade: "Kein einzelner Verlust über der Grenze (vom Startkapital des Kontos).",
  lossDay: "Der Tagesverlust je Konto bleibt unter der Grenze.",
  maxTrades: "Nicht mehr Trades pro Tag und Konto als die Grenze.",
  signal: "Jeder Trade mit gespeichertem Einstiegs-Check hatte ein gültiges Signal.",
  reflect: "Jeder geschlossene Trade hat ein Learning, oder der Tag hat eine Tagesnotiz.",
};

export interface RuleResult {
  key: RuleKey;
  /** `null` = not applicable on that day */
  ok: boolean | null;
}

export interface DisciplineDay {
  key: string;
  date: Date;
  /** all trades entered that day (open ones included) */
  trades: EnrichedTrade[];
  rules: RuleResult[];
  met: number;
  applicable: number;
  /** 0…100, `null` when no rule applied */
  score: number | null;
}

/** Heat-map step of a score: 0 none · 1 < 50 · 2 < 75 · 3 < 100 · 4 = 100. */
export function heatLevel(score: number | null): 0 | 1 | 2 | 3 | 4 {
  if (score == null) return 0;
  if (score >= 100) return 4;
  if (score >= 75) return 3;
  if (score >= 50) return 2;
  return 1;
}

const noteText = (notes: DayNotes | undefined, key: string): boolean => {
  const n = notes?.[key];
  if (!n) return false;
  return [n.note, n.plan, n.review].some((s) => typeof s === "string" && s.trim() !== "");
};

/** Scores of one day's trades. */
export function scoreDay(
  key: string,
  trades: readonly EnrichedTrade[],
  ctx: { knownSetups: ReadonlySet<string>; capital: Record<AccountId, number>; limits: DisciplineLimits; notes?: DayNotes },
): DisciplineDay {
  const { knownSetups, capital, limits, notes } = ctx;
  const closed = trades.filter((t) => t.result !== "open");
  const rules: RuleResult[] = [];
  const add = (k: RuleKey, ok: boolean | null) => rules.push({ key: k, ok });

  add("stop", trades.every((t) => !!t.stop && t.stop > 0));
  add("setup", trades.every((t) => (t.setups || []).some((id) => knownSetups.has(id))));
  const withList = trades.filter((t) => t.complete !== null);
  add("checklist", withList.length ? withList.every((t) => t.complete === true) : null);
  add("leverage", trades.some((t) => isFin(t.leverage)) ? !trades.some((t) => leverageOverRule(t.leverage, accountOf(t))) : null);
  const planned = trades.filter((t) => t.followedPlan !== null);
  add("plan", planned.length ? planned.every((t) => t.followedPlan === true) : null);

  const withCap = closed.filter((t) => capital[accountOf(t)] > 0 && isFin(t.pnl));
  add("lossTrade", withCap.length ? withCap.every((t) => (t.pnl ?? 0) >= -limits.maxLossTradePct * capital[accountOf(t)]) : null);
  if (withCap.length) {
    const net: Partial<Record<AccountId, number>> = {};
    for (const t of withCap) net[accountOf(t)] = (net[accountOf(t)] ?? 0) + (t.pnl ?? 0);
    add("lossDay", (Object.keys(net) as AccountId[]).every((a) => (net[a] ?? 0) >= -limits.maxLossDayPct * capital[a]));
  } else add("lossDay", null);

  const count: Partial<Record<AccountId, number>> = {};
  for (const t of trades) count[accountOf(t)] = (count[accountOf(t)] ?? 0) + 1;
  add("maxTrades", (Object.keys(count) as AccountId[]).every((a) => (count[a] ?? 0) <= limits.maxTrades[a]));

  const snaps = trades.map(snapOf).filter((s) => s !== null);
  add("signal", snaps.length ? snaps.every((s) => s!.valid) : null);
  add("reflect", closed.length ? noteText(notes, key) || closed.every((t) => (t.notes || "").trim() !== "") : null);

  const applicable = rules.filter((r) => r.ok !== null).length;
  const met = rules.filter((r) => r.ok === true).length;
  return { key, date: dayFromKey(key), trades: [...trades], rules, met, applicable, score: applicable ? (met / applicable) * 100 : null };
}

export interface DisciplineInput {
  /** all trades of the account view (closed + open) */
  list: readonly EnrichedTrade[];
  settings: Pick<Settings, "setups" | "capital"> & { discipline?: unknown };
  notes?: DayNotes;
}

/** Every traded day, oldest first. */
export function disciplineDays({ list, settings, notes }: DisciplineInput): DisciplineDay[] {
  const ctx = {
    knownSetups: new Set(settings.setups.map((s) => s.id)),
    capital: settings.capital,
    limits: disciplineLimits(settings),
    notes,
  };
  const sorted = [...list].sort((a, b) => +tradeTime(a) - +tradeTime(b));
  return [...groupByDay(sorted)].map(([key, ts]) => scoreDay(key, ts, ctx)).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Score threshold of a "good" day (streak). */
export const STREAK_MIN = 80;

/** Good days in a row, newest first (days without trades are skipped, not counted as breaks). */
export function disciplineStreak(days: readonly DisciplineDay[]): number {
  let n = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const s = days[i]!.score;
    if (s == null) continue;
    if (s < STREAK_MIN) break;
    n++;
  }
  return n;
}

export interface HeatCell {
  key: string;
  /** 0 = Monday */
  weekday: number;
  inFuture: boolean;
  day: DisciplineDay | null;
  level: 0 | 1 | 2 | 3 | 4;
}

/** `weeks` columns (oldest first) × 7 rows (Mo…So), ending with the week of `today`. */
export function heatMap(days: readonly DisciplineDay[], today: Date, weeks = 26): HeatCell[][] {
  const by = new Map(days.map((d) => [d.key, d]));
  const todayKey = localDateKey(today);
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const cols: HeatCell[][] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - w * 7 + d);
      const key = localDateKey(date);
      const day = by.get(key) ?? null;
      col.push({ key, weekday: d, inFuture: key > todayKey, day, level: heatLevel(day?.score ?? null) });
    }
    cols.push(col);
  }
  return cols;
}

export interface RuleRate {
  key: RuleKey;
  label: string;
  /** met / applicable over the window, `null` when never applicable */
  rate: number | null;
  applicable: number;
  /** result on the last traded day */
  last: boolean | null;
}

export interface DisciplineSummary {
  days: DisciplineDay[];
  last: DisciplineDay | null;
  /** the last traded day is today */
  lastIsToday: boolean;
  streak: number;
  /** mean day score over the window */
  avg: number | null;
  rates: RuleRate[];
  /** window in days (rule rates, average) */
  window: number;
  limits: DisciplineLimits;
}

export function disciplineSummary(input: DisciplineInput, today = new Date(), window = 30): DisciplineSummary {
  const days = disciplineDays(input);
  const limits = disciplineLimits(input.settings);
  const from = localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (window - 1)));
  const recent = days.filter((d) => d.key >= from && d.score != null);
  const last = [...days].reverse().find((d) => d.score != null) ?? null;
  const rates: RuleRate[] = RULE_ORDER.map((key) => {
    let met = 0;
    let applicable = 0;
    for (const d of recent) {
      const r = d.rules.find((x) => x.key === key);
      if (!r || r.ok === null) continue;
      applicable++;
      if (r.ok) met++;
    }
    return { key, label: ruleLabel(key, limits), rate: applicable ? met / applicable : null, applicable, last: last?.rules.find((x) => x.key === key)?.ok ?? null };
  });
  const scores = recent.map((d) => d.score!);
  return {
    days,
    last,
    lastIsToday: !!last && last.key === localDateKey(today),
    streak: disciplineStreak(days),
    avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    rates,
    window,
    limits,
  };
}

/** Mean day score of the traded days in `[fromKey, toKey]`. */
export function disciplineAvg(days: readonly DisciplineDay[], fromKey: string, toKey: string): number | null {
  const s = days.filter((d) => d.key >= fromKey && d.key <= toKey && d.score != null).map((d) => d.score!);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
}


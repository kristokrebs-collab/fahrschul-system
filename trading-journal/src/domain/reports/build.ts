/**
 * Report builder (P04): one period (day … year) of an account view as a report with the sections Performance,
 * Strategie, Risiko, Psychologie, Fehler, Zielerreichung and Vergleich mit der Vorperiode. Built on the same functions
 * as the rest of the app (`aggregate`, P03 `breakdown`, the Auswertung's discipline / mistakes / sessions, P05 risk
 * spread, the coach's behaviours), so a report never disagrees with a card. Trades belong to the period of their ENTRY
 * (like the calendar and the recap). Pure – `now` is passed in.
 */
import type { DayNotes, EnrichedTrade, Settings } from "../types";
import type { GoalDraft, GoalMetric } from "../growth/goals";
import { aggregate, type Agg } from "../agg";
import { breakdown } from "../analytics/breakdowns";
import { streaks } from "../analytics/streaks";
import { disciplineAvg, disciplineDays, disciplineLimits, disciplineStreak } from "../insights/discipline";
import { equityDrawdown } from "../insights/edge";
import { mistakeReport } from "../insights/mistakes";
import { groupByDay } from "../insights/shared";
import { bucketSummary, bySession } from "../insights/time";
import { riskSpread } from "../risk/perStrategy";
import { localDateKey, tradeTime } from "@/lib/dates";
import { pct0, r as fmtR, signed } from "@/lib/format";
import { BEHAVIOR_LABEL, type BehaviorEvent, type BehaviorKey } from "../coach/events";
import { behaviorReport } from "../coach/behaviors";
import { journalRate } from "../coach/recommendations";
import { coachPrefsOf } from "../coach/prefs";
import { contains, KIND_REPORT, shiftPeriod, type ReportPeriod } from "./periods";

export type ReportFocus = "all" | "strategy" | "risk" | "psychology" | "mistakes";
export const REPORT_FOCI: readonly ReportFocus[] = ["all", "strategy", "risk", "psychology", "mistakes"];
export const FOCUS_LABEL: Readonly<Record<ReportFocus, string>> = { all: "Alles", strategy: "Strategie", risk: "Risiko", psychology: "Psychologie", mistakes: "Fehler" };

export interface DayRow {
  key: string;
  net: number;
  n: number;
}

export interface GroupRow {
  key: string;
  label: string;
  n: number;
  net: number;
  winRate: number | null;
  avgR: number | null;
}

export interface GoalRow {
  title: string;
  source: "coach" | "growth";
  metric: GoalMetric;
  target: number;
  comparator: "atLeast" | "atMost";
  /** value in the period, `null` when the journal cannot measure it */
  actual: number | null;
  met: boolean | null;
  /** formatted ("90 %", "2", "+0,35 R") */
  actualText: string;
  targetText: string;
}

export interface PeriodSummary {
  n: number;
  net: number;
  winRate: number | null;
  avgR: number | null;
  pf: number | null;
  discipline: number | null;
}

export interface Report {
  period: ReportPeriod;
  prevPeriod: ReportPeriod;
  title: string;
  generatedAt: number;
  currency: string;
  /** the period has ended */
  complete: boolean;
  empty: boolean;
  /** one sentence */
  summary: string;
  /** the 3 strongest lines ("trade the best") */
  highlights: { tone: "win" | "loss" | "fg"; text: string }[];
  performance: {
    g: Agg;
    /** cumulative P&L within the period, starting at 0 */
    equity: number[];
    /** net ÷ capital at the period start */
    returnPct: number | null;
    /** max drawdown within the period (fraction ≤ 0) */
    maxDD: number;
    days: DayRow[];
    tradingDays: number;
    dayWinRate: number | null;
    bestDay: DayRow | null;
    worstDay: DayRow | null;
    sumR: number | null;
    bestId: string | null;
    worstId: string | null;
  };
  strategy: {
    unit: "R" | "money";
    setups: GroupRow[];
    best: GroupRow | null;
    worst: GroupRow | null;
    sides: GroupRow[];
    sessions: GroupRow[];
    bestSession: GroupRow | null;
  };
  risk: {
    /** risk per trade in % of the account capital */
    avgRiskPct: number | null;
    maxRiskPct: number | null;
    consistency: number | null;
    /** trades above the per-trade limit */
    overLimit: number;
    avgLeverage: number | null;
    maxLeverage: number | null;
    worstR: number | null;
    /** losses beyond 1.1 R */
    bigLosses: number;
    /** days whose loss broke the day limit */
    dayBreaches: number;
    longestLosing: number;
  };
  psychology: {
    behaviors: { key: BehaviorKey; label: string; count: number; net: number; excess: number }[];
    /** share of the closed trades that triggered a behaviour */
    flaggedShare: number | null;
    emotions: GroupRow[];
    /** Ø day mood 1–5 from the day journal */
    mood: number | null;
    stress: number | null;
    confidence: number | null;
    planRate: number | null;
  };
  mistakes: {
    rows: { tag: string; n: number; excess: number; auto: boolean }[];
    leak: { tag: string; excess: number } | null;
    /** share of closed trades without any mistake */
    cleanShare: number | null;
  };
  goals: {
    discipline: number | null;
    /** good days in a row at the end of the period */
    streak: number;
    journalRate: number | null;
    checklistRate: number | null;
    ruleBreaks: number;
    rows: GoalRow[];
  };
  compare: {
    prev: PeriodSummary;
    cur: PeriodSummary;
  };
  /** closed trades of the period (time order) */
  trades: EnrichedTrade[];
}

export interface ReportInput {
  /** every enriched trade of the account view (open ones included) */
  list: readonly EnrichedTrade[];
  settings: Settings;
  days?: DayNotes;
  /** behaviour events of the journal */
  events: readonly BehaviorEvent[];
  /** capital of the account view */
  start: number;
  currency: string;
  period: ReportPeriod;
  now: number;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const meanOf = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const accountOf = (t: EnrichedTrade) => t.account ?? "scalp";
const inP = (p: ReportPeriod) => (t: EnrichedTrade) => contains(p, +tradeTime(t));

function groupRow(key: string, label: string, ts: readonly EnrichedTrade[]): GroupRow {
  const g = aggregate(ts);
  return { key, label, n: g.n, net: g.net, winRate: g.winRate, avgR: g.avgR };
}

function summaryOf(closed: readonly EnrichedTrade[], discipline: number | null): PeriodSummary {
  const g = aggregate(closed);
  return { n: g.n, net: g.net, winRate: g.winRate, avgR: g.avgR, pf: g.pf === Infinity ? null : g.pf, discipline };
}

/** Value of a goal metric over a period's trades (`null` when not measurable from the journal). */
export function goalActual(metric: GoalMetric, scope: GoalDraft["scope"], ctx: { closed: readonly EnrichedTrade[]; list: readonly EnrichedTrade[]; events: readonly BehaviorEvent[]; settings: Settings }): number | null {
  const { closed, list, events, settings } = ctx;
  const ids = new Set(list.map((t) => t.id));
  const g = aggregate(closed);
  switch (metric) {
    case "journalRate":
      return list.length ? journalRate(list) : null;
    case "planAdherence": {
      const xs = list.filter((t) => t.followedPlan != null);
      return xs.length ? xs.filter((t) => t.followedPlan).length / xs.length : null;
    }
    case "checklistRate": {
      const xs = list.filter((t) => t.complete != null);
      return xs.length ? xs.filter((t) => t.complete).length / xs.length : null;
    }
    case "ruleBreaks":
      return events.filter((e) => e.key === "ruleViolation" && ids.has(e.tradeIds[e.tradeIds.length - 1]!)).length;
    case "behavior":
      return scope?.behavior ? events.filter((e) => e.key === scope.behavior && ids.has(e.tradeIds[e.tradeIds.length - 1]!)).length : null;
    case "tradesPerDay": {
      const per = [...groupByDay(list).values()].map((ts) => ts.length);
      return per.length ? Math.max(...per) : 0;
    }
    case "lossDayPct": {
      const cap = settings.capital.makro + settings.capital.scalp;
      const worst = Math.min(0, ...[...groupByDay(closed).values()].map((ts) => aggregate(ts).net));
      return cap > 0 ? -worst / cap : null;
    }
    case "riskPerTradePct": {
      const xs = closed.map((t) => (fin(t.risk) && t.risk > 0 && settings.capital[accountOf(t)] > 0 ? t.risk / settings.capital[accountOf(t)] : null)).filter(fin);
      return meanOf(xs);
    }
    case "expectancyR":
      return g.avgR;
    case "winRate":
      return g.winRate;
    case "profitFactor":
      return g.pf === Infinity ? null : g.pf;
    case "netR": {
      const rs = closed.map((t) => t.r).filter(fin);
      return rs.length ? rs.reduce((a, b) => a + b, 0) : null;
    }
    default:
      return null;
  }
}

const RATE_METRICS = new Set<GoalMetric>(["journalRate", "planAdherence", "checklistRate", "winRate", "lossDayPct", "riskPerTradePct"]);

function fmtGoal(metric: GoalMetric, v: number | null): string {
  if (v == null) return "–";
  if (RATE_METRICS.has(metric)) return pct0(v);
  if (metric === "expectancyR" || metric === "netR") return fmtR(v);
  if (metric === "profitFactor") return v.toFixed(2).replace(".", ",");
  return `${Math.round(v * 100) / 100}`.replace(".", ",");
}

/** Goals of the trader: the coach's accepted plan and P08's goals (`settings.growth.goals`, read defensively). */
function goalsOf(settings: Settings): { draft: GoalDraft; source: "coach" | "growth" }[] {
  const out: { draft: GoalDraft; source: "coach" | "growth" }[] = [];
  const plan = coachPrefsOf(settings).plan;
  for (const g of plan?.goals ?? []) out.push({ draft: g, source: "coach" });
  const growth = (settings as { growth?: { goals?: unknown } }).growth?.goals;
  if (Array.isArray(growth))
    for (const g of growth) {
      const o = g as Partial<GoalDraft> & { status?: string };
      if (o && typeof o.title === "string" && typeof o.metric === "string" && fin(o.target) && (o.comparator === "atLeast" || o.comparator === "atMost") && o.status !== "dropped" && !out.some((x) => x.draft.title === o.title))
        out.push({ draft: o as GoalDraft, source: "growth" });
    }
  return out.slice(0, 12);
}

/** The report of one period. */
export function buildReport(input: ReportInput): Report {
  const { settings, period, now, currency, events } = input;
  const prevPeriod = shiftPeriod(period, -1);
  const allClosed = input.list.filter((t) => t.result !== "open").sort((a, b) => +tradeTime(a) - +tradeTime(b));
  const closed = allClosed.filter(inP(period));
  const list = input.list.filter(inP(period));
  const prevClosed = allClosed.filter(inP(prevPeriod));
  const g = aggregate(closed);

  // performance
  const equity: number[] = [0];
  let cum = 0;
  for (const t of closed) equity.push((cum += t.pnl ?? 0));
  const before = allClosed.filter((t) => +tradeTime(t) < period.from).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const capitalAtStart = input.start + before;
  const dd = equityDrawdown(closed, capitalAtStart);
  const days: DayRow[] = [...groupByDay(closed)].map(([key, ts]) => ({ key, net: aggregate(ts).net, n: ts.length })).sort((a, b) => (a.key < b.key ? -1 : 1));
  let bestDay: DayRow | null = null;
  let worstDay: DayRow | null = null;
  for (const d of days) {
    if (d.net > 0 && (!bestDay || d.net > bestDay.net)) bestDay = d;
    if (d.net < 0 && (!worstDay || d.net < worstDay.net)) worstDay = d;
  }
  const rs = closed.map((t) => t.r).filter(fin);

  // strategy
  const bd = closed.length ? breakdown(closed, "setup", { settings }) : null;
  const setups = bd ? bd.rows.map((r) => ({ key: r.key, label: r.label, n: r.g.n, net: r.g.net, winRate: r.g.winRate, avgR: r.g.avgR })) : [];
  const ranked = setups.filter((s) => s.key !== "__none");
  const topNet = [...ranked].sort((a, b) => b.net - a.net || b.n - a.n)[0];
  const lowNet = [...ranked].sort((a, b) => a.net - b.net || b.n - a.n)[0];
  const best = topNet && topNet.net > 0 ? topNet : null;
  const worst = lowNet && lowNet.net < 0 && lowNet !== best ? lowNet : null;
  const sides = (["long", "short"] as const).map((s) => groupRow(s, s === "long" ? "Long" : "Short", closed.filter((t) => (t.side === "short" ? "short" : "long") === s))).filter((r) => r.n);
  const sess = bySession(closed).filter((b) => b.g.n);
  const sessions = sess.map((b) => groupRow(b.key, b.label, b.trades));
  const bs = bucketSummary(bySession(closed), 2).best;
  const bestSession = bs ? (sessions.find((s) => s.key === bs.key) ?? null) : null;

  // risk
  const limits = disciplineLimits(settings as Settings & { discipline?: unknown });
  const spread = riskSpread(closed, settings, "setup", limits.maxLossTradePct);
  const levs = list.map((t) => t.leverage).filter((v): v is number => fin(v) && v > 0);
  const dayNet = new Map<string, Map<string, number>>();
  for (const t of closed) {
    const k = localDateKey(tradeTime(t));
    const m = dayNet.get(k) ?? new Map<string, number>();
    m.set(accountOf(t), (m.get(accountOf(t)) ?? 0) + (t.pnl ?? 0));
    dayNet.set(k, m);
  }
  let dayBreaches = 0;
  for (const m of dayNet.values()) if ([...m].some(([acc, v]) => settings.capital[acc as "makro" | "scalp"] > 0 && v < -limits.maxLossDayPct * settings.capital[acc as "makro" | "scalp"])) dayBreaches++;

  // psychology
  const brep = behaviorReport(events, closed);
  const moods: number[] = [];
  for (const [k, n] of Object.entries(input.days ?? {})) {
    const ms = new Date(`${k}T12:00`).getTime();
    if (contains(period, ms) && fin(n.mood)) moods.push(n.mood);
  }
  const emo = new Map<string, EnrichedTrade[]>();
  for (const t of closed) if (t.emotion) emo.set(t.emotion, [...(emo.get(t.emotion) ?? []), t]);
  const emotions = [...emo].map(([k, ts]) => groupRow(k, k, ts)).sort((a, b) => b.n - a.n);
  const planned = list.filter((t) => t.followedPlan != null);

  // mistakes
  const mrep = mistakeReport(closed, settings.setups);

  // goals
  const ddays = disciplineDays({ list: input.list, settings, notes: input.days });
  const lastKey = localDateKey(new Date(period.to - 1));
  const discipline = disciplineAvg(ddays, localDateKey(new Date(period.from)), lastKey);
  const streak = disciplineStreak(ddays.filter((d) => d.key <= lastKey));
  const withList = list.filter((t) => t.complete != null);
  const ids = new Set(list.map((t) => t.id));
  const ruleBreaks = events.filter((e) => e.key === "ruleViolation" && ids.has(e.tradeIds[e.tradeIds.length - 1]!)).length;
  const gctx = { closed, list, events, settings };
  const goalRows: GoalRow[] = goalsOf(settings).map(({ draft, source }) => {
    const actual = goalActual(draft.metric, draft.scope, gctx);
    const met = actual == null ? null : draft.comparator === "atLeast" ? actual >= draft.target : actual <= draft.target;
    return { title: draft.title, source, metric: draft.metric, target: draft.target, comparator: draft.comparator, actual, met, actualText: fmtGoal(draft.metric, actual), targetText: `${draft.comparator === "atLeast" ? "≥" : "≤"} ${fmtGoal(draft.metric, draft.target)}` };
  });

  // compare
  const prevDiscipline = disciplineAvg(ddays, localDateKey(new Date(prevPeriod.from)), localDateKey(new Date(prevPeriod.to - 1)));
  const cur = summaryOf(closed, discipline);
  const prev = summaryOf(prevClosed, prevDiscipline);

  // summary + highlights ("trade the best": the strongest three)
  const word = KIND_REPORT[period.kind];
  let summary: string;
  if (!g.n) summary = `Keine abgeschlossenen Trades in diesem Zeitraum.`;
  else summary = `${g.net > 0 ? "Im Plus" : g.net < 0 ? "Im Minus" : "Ausgeglichen"}: ${signed(g.net, 0)} ${currency} aus ${g.n} Trade${g.n === 1 ? "" : "s"}, ${pct0(g.winRate)} Win-Rate${rs.length ? `, ${fmtR(rs.reduce((a, b) => a + b, 0))} gesamt` : ""}.`;
  const hl: { tone: "win" | "loss" | "fg"; score: number; text: string }[] = [];
  if (best && best.net > 0) hl.push({ tone: "win", score: Math.abs(best.net), text: `Stärkstes Setup: ${best.label} (${signed(best.net, 0)} ${currency}, ${best.n} Trade${best.n === 1 ? "" : "s"}).` });
  if (brep.worst) hl.push({ tone: "loss", score: Math.abs(brep.worst.excess), text: `Teuerstes Muster: ${brep.worst.label} (${signed(brep.worst.excess, 0)} ${currency} gegenüber sauberen Trades).` });
  if (mrep.leak) hl.push({ tone: "loss", score: Math.abs(mrep.leak.excess) * 0.9, text: `Größtes Leck: ${mrep.leak.tag} (${signed(mrep.leak.excess, 0)} ${currency}).` });
  if (prev.n && g.n) {
    const d = g.net - prev.net;
    hl.push({ tone: d >= 0 ? "win" : "loss", score: Math.abs(d) * 0.5, text: `Gegenüber der Vorperiode ${signed(d, 0)} ${currency}${cur.winRate != null && prev.winRate != null ? `, Win-Rate ${signed(Math.round((cur.winRate - prev.winRate) * 100), 0)} Pp.` : "."}` });
  }
  if (streak >= 3) hl.push({ tone: "win", score: streak * 50, text: `${streak} disziplinierte Tage in Folge.` });
  if (bestSession && bestSession.net > 0) hl.push({ tone: "fg", score: bestSession.net * 0.4, text: `Beste Session: ${bestSession.label}.` });

  return {
    period,
    prevPeriod,
    title: `${word} · ${period.label}`,
    generatedAt: now,
    currency,
    complete: period.to <= now,
    empty: g.n === 0,
    summary,
    highlights: hl.sort((a, b) => b.score - a.score).slice(0, 3).map(({ tone, text }) => ({ tone, text })),
    performance: {
      g,
      equity,
      returnPct: capitalAtStart > 0 ? g.net / capitalAtStart : null,
      maxDD: dd.maxDD,
      days,
      tradingDays: days.length,
      dayWinRate: days.length ? days.filter((d) => d.net > 0).length / days.length : null,
      bestDay,
      worstDay,
      sumR: rs.length ? rs.reduce((a, b) => a + b, 0) : null,
      bestId: g.best?.id ?? null,
      worstId: g.worst?.id ?? null,
    },
    strategy: { unit: bd?.unit ?? "money", setups, best, worst, sides, sessions, bestSession },
    risk: {
      avgRiskPct: spread.overall?.mean ?? null,
      maxRiskPct: spread.overall?.max ?? null,
      consistency: spread.overall && spread.overall.n >= 3 ? spread.overall.consistency : null,
      overLimit: spread.overall?.over ?? 0,
      avgLeverage: meanOf(levs),
      maxLeverage: levs.length ? Math.max(...levs) : null,
      worstR: g.worstR,
      bigLosses: closed.filter((t) => fin(t.r) && t.r < -1.1).length,
      dayBreaches,
      longestLosing: streaks(closed.map((t) => t.result)).longestLoss,
    },
    psychology: {
      behaviors: brep.stats.map((s) => ({ key: s.key, label: BEHAVIOR_LABEL[s.key], count: s.count, net: s.g.net, excess: s.excess })),
      flaggedShare: closed.length ? brep.flagged / closed.length : null,
      emotions,
      mood: meanOf(moods),
      stress: meanOf(closed.map((t) => t.psych?.stress).filter(fin)),
      confidence: meanOf(closed.map((t) => t.psych?.confidence).filter(fin)),
      planRate: planned.length ? planned.filter((t) => t.followedPlan).length / planned.length : null,
    },
    mistakes: {
      rows: mrep.rows.slice(0, 6).map((r) => ({ tag: r.tag, n: r.n, excess: r.excess, auto: r.auto > 0 && r.manual === 0 })),
      leak: mrep.leak ? { tag: mrep.leak.tag, excess: mrep.leak.excess } : null,
      cleanShare: closed.length ? mrep.clean.n / closed.length : null,
    },
    goals: { discipline, streak, journalRate: list.length ? journalRate(list) : null, checklistRate: withList.length ? withList.filter((t) => t.complete).length / withList.length : null, ruleBreaks, rows: goalRows },
    compare: { prev, cur },
    trades: closed,
  };
}

/**
 * The coach's advice (P04): action items with evidence, what-if optimisation with an interval, the improvement plan
 * (top 3 → `GoalDraft`s for P08), the personal trading score and the behaviour profile ("Personal Trading
 * Intelligence"). Everything is computed from the journal; nothing is invented – an item without evidence is not
 * produced. Pure, deterministic.
 */
import type { AccountView } from "../account";
import type { DayNotes, EnrichedTrade, Settings } from "../types";
import type { GoalDraft, GoalMetric } from "../growth/goals";
import { aggregate } from "../agg";
import { breakdown } from "../analytics/breakdowns";
import { bootRuns, bootstrapCI, mean, sum, type Interval } from "../analytics/stats";
import { holdLabel, holdMs } from "../excursion";
import { disciplineAvg, disciplineDays, disciplineLimits } from "../insights/discipline";
import { edgeScore } from "../insights/edge";
import { bucketSummary, bySession, byWeekday } from "../insights/time";
import { riskSpread } from "../risk/perStrategy";
import { localDateKey, tradeTime } from "@/lib/dates";
import { pct0, r as fmtR, signed } from "@/lib/format";
import { BEHAVIOR_LABEL, type BehaviorEvent, type BehaviorKey } from "./events";
import { behaviorReport, type BehaviorReport, type BehaviorStat } from "./behaviors";
import { BEHAVIOR_ADVICE, GENERIC_TIPS, PRINCIPLES } from "./copy";
import type { EdgeCandidate, EdgeLabel, EdgeReport } from "./edges";
import { dec1, fin, hashSeed, median } from "./shared";

/* ------------------------------------------------------------------ what-if */

export interface WhatIf {
  /** "Ohne Revenge-Trades" / "Nur Breakout" */
  label: string;
  unit: "R" | "money";
  /** trades with a value (all / after) */
  n: number;
  nAfter: number;
  /** Σ and Ø of all trades / of the set after the change */
  total: number;
  totalAfter: number;
  mean: number | null;
  meanAfter: number | null;
  /** totalAfter − total */
  delta: number;
  /** 80 % bootstrap interval of `delta` */
  ci: Interval | null;
}

const val = (t: EnrichedTrade, unit: "R" | "money"): number | null => (unit === "R" ? (fin(t.r) ? t.r : null) : (t.pnl ?? 0));

/**
 * What-if of a rule over the closed trades: "skip" removes the matching trades, "only" keeps just them. The interval
 * is a seeded bootstrap of the removed (or kept) trades' sum – how sure the change in the total is.
 */
export function whatIf(closed: readonly EnrichedTrade[], match: (t: EnrichedTrade) => boolean, mode: "skip" | "only", unit: "R" | "money", label: string): WhatIf {
  const all = closed.map((t) => val(t, unit)).filter(fin);
  const hit: number[] = [];
  const miss: number[] = [];
  for (const t of closed) {
    const v = val(t, unit);
    if (v == null) continue;
    (match(t) ? hit : miss).push(v);
  }
  const total = sum(all);
  const after = mode === "skip" ? miss : hit;
  const changed = mode === "skip" ? hit : miss;
  const totalAfter = sum(after);
  const seed = hashSeed(`${label}|${mode}|${unit}|${closed.length}`);
  const sumCI = changed.length >= 2 ? bootstrapCI(changed, (s) => sum(s), { runs: bootRuns(changed.length), seed }) : null;
  return {
    label,
    unit,
    n: all.length,
    nAfter: after.length,
    total,
    totalAfter,
    mean: mean(all),
    meanAfter: mean(after),
    delta: totalAfter - total,
    ci: sumCI ? { lo: -sumCI.hi, hi: -sumCI.lo } : null,
  };
}

/* ------------------------------------------------------------------ recommendations */

export type RecommendationKind = "stop" | "focus" | "keep";

export interface Recommendation {
  id: string;
  kind: RecommendationKind;
  /** imperative headline */
  title: string;
  /** the evidence in one sentence */
  why: string;
  /** what it made (> 0) or cost (< 0) against the usual trade, in `unit` */
  impact: number;
  unit: "R" | "money";
  confidence: number;
  verdict: EdgeLabel;
  /** evidence trades (ids, newest first, ≤ 12) */
  evidence: string[];
  whatIf: WhatIf | null;
  goal: GoalDraft;
  behavior?: BehaviorKey;
}

export interface RecommendationInput {
  closed: readonly EnrichedTrade[];
  events: readonly BehaviorEvent[];
  edges: EdgeReport;
  /** trades of the account view incl. open ones (journaling rate) */
  list?: readonly EnrichedTrade[];
  currency: string;
}

const unitText = (v: number, unit: "R" | "money", cur: string): string => (unit === "R" ? fmtR(v) : `${signed(v, 0)} ${cur}`);
const newest = (ts: readonly EnrichedTrade[]): string[] => [...ts].sort((a, b) => +tradeTime(b) - +tradeTime(a)).slice(0, 12).map((t) => t.id);

/** Confidence of a behaviour cost: more events and a clearer cost = more confidence (capped at "Tendenz" without a test). */
function behaviorConfidence(s: BehaviorStat): { confidence: number; verdict: EdgeLabel } {
  const n = s.trades.length;
  const size = 1 - Math.exp(-n / 12);
  const explicit = s.events.some((e) => (e.note ?? "").includes("markiert"));
  const sev = s.maxSeverity / 3;
  const confidence = Math.round(100 * (0.5 * size + 0.3 * sev + 0.2 * (explicit ? 1 : 0.5)));
  return { confidence, verdict: n >= 8 && confidence >= 60 ? "klar" : n >= 3 ? "Tendenz" : "zu wenig Daten" };
}

function goalFor(behavior: BehaviorKey | null, title: string, why: string, ref: string, metric?: GoalMetric): GoalDraft {
  if (behavior === "ruleViolation") return { title, kind: "process", metric: "ruleBreaks", target: 0, comparator: "atMost", period: "week", source: { kind: "coach", ref }, why };
  if (behavior) return { title, kind: "process", metric: "behavior", target: 0, comparator: "atMost", period: "week", scope: { behavior }, source: { kind: "coach", ref }, why };
  return { title, kind: "process", metric: metric ?? "custom", target: 0, comparator: "atMost", period: "week", source: { kind: "coach", ref }, why };
}

/** Action items with evidence, strongest first ("trade the best, fuck the rest": the top few matter). */
export function recommendations(input: RecommendationInput): Recommendation[] {
  const { closed, events, edges, currency: cur } = input;
  const out: Recommendation[] = [];
  const unit = edges.unit;
  const rep: BehaviorReport = behaviorReport(events, closed);

  // behaviours that cost money
  for (const s of rep.stats) {
    if (s.trades.length < 3 || !(s.excess < 0)) continue;
    const { confidence, verdict } = behaviorConfidence(s);
    const ids = new Set(s.trades.map((t) => t.id));
    const cost = unit === "R" ? (s.excessR ?? s.sumR ?? 0) : s.excess;
    const wi = whatIf(closed, (t) => ids.has(t.id), "skip", unit, `Ohne ${s.label}`);
    const adv = BEHAVIOR_ADVICE[s.key];
    const why = `${s.label}: ${s.trades.length} Trades, ${pct0(s.g.winRate)} Win-Rate, ${unitText(cost, unit, cur)} gegenüber deinen sauberen Trades.`;
    out.push({ id: `behavior:${s.key}`, kind: "stop", title: adv.advice, why, impact: cost, unit, confidence, verdict, evidence: newest(s.trades), whatIf: wi, goal: goalFor(s.key, adv.goal, why, `behavior:${s.key}`), behavior: s.key });
  }

  // leaks: conditions to avoid
  for (const c of edges.leaks) {
    if (c.factors.some((f) => f.dim === "behavior")) continue;
    const ids = new Set(c.trades.map((t) => t.id));
    const wi = whatIf(closed, (t) => ids.has(t.id), "skip", unit, `Ohne „${c.label}“`);
    const why = `${c.label}: ${c.n} Trades, Ø ${unitText(c.mean, unit, cur)} statt ${unitText(c.restMean, unit, cur)} im Rest.`;
    const title = `Meiden: ${c.label}`;
    out.push({ id: `leak:${c.id}`, kind: "stop", title, why, impact: c.impact, unit, confidence: c.confidence, verdict: c.verdict, evidence: newest(c.trades), whatIf: wi, goal: goalFor(null, `${c.label} – auslassen`, why, `leak:${c.id}`) });
  }

  // edges: focus
  for (const c of edges.edges) {
    const ids = new Set(c.trades.map((t) => t.id));
    const wi = whatIf(closed, (t) => ids.has(t.id), "only", unit, `Nur „${c.label}“`);
    const why = `${c.label}: ${c.n} Trades, Ø ${unitText(c.mean, unit, cur)} statt ${unitText(c.restMean, unit, cur)} im Rest, ${pct0(c.winRate)} Win-Rate.`;
    out.push({ id: `edge:${c.id}`, kind: "focus", title: `Fokus: ${c.label}`, why, impact: c.impact, unit, confidence: c.confidence, verdict: c.verdict, evidence: newest(c.trades), whatIf: wi, goal: { title: `${c.label} – mehr davon`, kind: "process", metric: "expectancyR", target: Math.max(0, Math.round(c.mean * 10) / 10), comparator: "atLeast", period: "month", source: { kind: "coach", ref: `edge:${c.id}` }, why } });
  }

  // journaling: a coach is only as good as the journal
  const list = input.list ?? closed;
  if (list.length >= 5) {
    const rate = journalRate(list);
    if (rate < 0.6) {
      const why = `Nur ${pct0(rate)} deiner Trades haben ein Review (Notiz, Psyche, Tags oder Bewertung).`;
      out.push({ id: "journal", kind: "keep", title: "Jeden Trade mit zwei Sätzen reviewen", why, impact: 0, unit, confidence: 70, verdict: "klar", evidence: newest(list.filter((t) => !reviewed(t))), whatIf: null, goal: { title: "Jeden Trade mit Review abschließen", kind: "process", metric: "journalRate", target: 0.9, comparator: "atLeast", period: "week", source: { kind: "coach", ref: "journal" }, why } });
    }
  }

  const strength = (r: Recommendation) => (r.confidence / 100) * Math.max(Math.abs(r.impact), r.id === "journal" ? 0.01 : 0) + (r.verdict === "klar" ? 1e-6 : 0);
  return out.sort((a, b) => strength(b) - strength(a) || b.confidence - a.confidence || (a.id < b.id ? -1 : 1));
}

/** Top 3 actions as goal drafts for P08 (`addGoalFromDraft`), strongest first; only items with evidence. */
export function improvementPlan(recs: readonly Recommendation[], max = 3): Recommendation[] {
  const seen = new Set<string>();
  const out: Recommendation[] = [];
  for (const r of recs) {
    if (r.verdict === "zu wenig Daten") continue;
    const k = r.goal.title;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

/* ------------------------------------------------------------------ journaling */

/** The trade has a review: notes, a post-trade note, psych, tags or a rating. */
export function reviewed(t: EnrichedTrade): boolean {
  return !!(t.notes ?? "").trim() || !!(t.psych?.postNote ?? "").trim() || !!(t.psych?.flags?.length || t.psych?.stress || t.psych?.confidence) || !!t.tags?.length || t.rating != null;
}

/** Share of trades with a review. */
export function journalRate(list: readonly EnrichedTrade[]): number {
  return list.length ? list.filter(reviewed).length / list.length : 0;
}

/* ------------------------------------------------------------------ trading score */

export interface ScorePart {
  key: "edge" | "discipline" | "risk" | "journal";
  label: string;
  /** 0–100, `null` = not enough data */
  value: number | null;
  weight: number;
  detail: string;
}

export interface TradingScore {
  /** weighted mean of the available parts, `null` without any */
  score: number | null;
  label: "Stark" | "Solide" | "Ausbaufähig" | "Kritisch" | "Zu wenig Daten";
  parts: ScorePart[];
  /** the part with the most weighted points left */
  weakest: ScorePart | null;
  n: number;
}

export interface ScoreInput {
  view: Pick<AccountView, "closed" | "list" | "g" | "maxDD" | "dd">;
  settings: Settings & { discipline?: unknown };
  days?: DayNotes;
  now: number;
}

export const SCORE_MIN_TRADES = 10;

/** Personal trading score: Edge (Edge-Score), Disziplin (Ø of 30 days), Risiko-Konstanz (P05 spread), Journaling. */
export function tradingScore(input: ScoreInput): TradingScore {
  const { view, settings, now } = input;
  const n = view.closed.length;
  const parts: ScorePart[] = [];
  const edge = n >= SCORE_MIN_TRADES ? edgeScore({ closed: view.closed, g: view.g, maxDD: view.maxDD, dd: view.dd }) : null;
  parts.push({ key: "edge", label: "Edge", value: edge?.score ?? null, weight: 0.35, detail: edge?.score != null ? `Edge-Score aus PF, Payoff, Drawdown, Win-Rate (${n} Trades)` : `ab ${SCORE_MIN_TRADES} Trades` });
  const days = disciplineDays({ list: view.list, settings, notes: input.days });
  const today = new Date(now);
  const from = localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29));
  const disc = disciplineAvg(days, from, localDateKey(today));
  parts.push({ key: "discipline", label: "Disziplin", value: disc == null ? null : Math.round(disc), weight: 0.25, detail: disc == null ? "keine Handelstage in 30 Tagen" : "Ø Tages-Score der letzten 30 Tage" });
  const spread = riskSpread(view.closed, settings, "setup", disciplineLimits(settings).maxLossTradePct);
  const ov = spread.overall;
  const riskV = ov && ov.n >= 5 ? Math.round(100 * ov.consistency * (1 - ov.over / ov.n)) : null;
  parts.push({ key: "risk", label: "Risiko-Konstanz", value: riskV, weight: 0.2, detail: riskV == null ? "zu wenige Trades mit Stop" : `Risiko pro Trade gleichmäßig, ${ov!.over} über der Grenze` });
  const jr = view.list.length >= 3 ? Math.round(journalRate(view.list) * 100) : null;
  parts.push({ key: "journal", label: "Journaling", value: jr, weight: 0.2, detail: jr == null ? "zu wenige Trades" : "Anteil der Trades mit Review" });
  const avail = parts.filter((p) => p.value != null);
  const w = avail.reduce((s, p) => s + p.weight, 0);
  const score = avail.length && n >= 3 ? Math.round(avail.reduce((s, p) => s + p.value! * p.weight, 0) / w) : null;
  const label: TradingScore["label"] = score == null ? "Zu wenig Daten" : score >= 75 ? "Stark" : score >= 55 ? "Solide" : score >= 35 ? "Ausbaufähig" : "Kritisch";
  let weakest: ScorePart | null = null;
  for (const p of avail) if (!weakest || (100 - p.value!) * p.weight > (100 - weakest.value!) * weakest.weight) weakest = p;
  return { score, label, parts, weakest: weakest && weakest.value! < 100 ? weakest : null, n };
}

/* ------------------------------------------------------------------ behaviour profile */

export interface ProfileTrait {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: "win" | "loss" | "fg" | "mute";
}

export interface BehaviorProfile {
  /** one line ("Long-lastiger Daytrader, stark in London") */
  headline: string;
  traits: ProfileTrait[];
  n: number;
}

export const PROFILE_MIN_TRADES = 10;

/** Personal Trading Intelligence: style, direction, best session / day / setup, risk style, strengths, weaknesses. */
export function behaviorProfile(input: { closed: readonly EnrichedTrade[]; list: readonly EnrichedTrade[]; settings: Settings; events: readonly BehaviorEvent[]; edges: EdgeReport; currency: string }): BehaviorProfile {
  const { closed, settings, events, edges, currency: cur } = input;
  const n = closed.length;
  if (n < PROFILE_MIN_TRADES) return { headline: "", traits: [], n };
  const traits: ProfileTrait[] = [];

  const holds = closed.map((t) => holdMs({ date: t.date, exitDate: t.exitDate, createdAt: t.createdAt })).filter(fin);
  const hm = holds.length >= 5 ? median(holds) : null;
  const style = hm == null ? null : hm < 60 * 60_000 ? "Scalper" : hm < 24 * 3600_000 ? "Daytrader" : "Swingtrader";
  if (style) traits.push({ id: "style", label: "Stil", value: style, detail: `Haltedauer im Median ${holdLabel(hm)}`, tone: "fg" });

  const longs = closed.filter((t) => t.side !== "short").length;
  const longShare = longs / n;
  const dir = longShare >= 0.65 ? "Long-lastig" : longShare <= 0.35 ? "Short-lastig" : "Beidseitig";
  traits.push({ id: "side", label: "Richtung", value: dir, detail: `${pct0(longShare)} Long`, tone: "fg" });

  const sess = bucketSummary(bySession(closed), 5);
  if (sess.best) traits.push({ id: "session", label: "Beste Session", value: sess.best.label, detail: `${signed(sess.best.g.net, 0)} ${cur} · ${pct0(sess.best.g.winRate)} Win-Rate (${sess.best.g.n})`, tone: sess.best.g.net > 0 ? "win" : "fg" });
  const wd = bucketSummary(byWeekday(closed), 5);
  if (wd.worst && wd.worst.g.net < 0) traits.push({ id: "weekday", label: "Schwächster Tag", value: wd.worst.label, detail: `${signed(wd.worst.g.net, 0)} ${cur} (${wd.worst.g.n} Trades)`, tone: "loss" });

  const bd = breakdown(closed, "setup", { settings });
  if (bd.best) traits.push({ id: "setup", label: "Stärkstes Setup", value: bd.best.label, detail: `Ø ${bd.unit === "R" ? fmtR(bd.best.expR.mean) : `${signed(bd.best.exp.mean, 0)} ${cur}`} · ${bd.best.g.n} Trades`, tone: "win" });

  const spread = riskSpread(closed, settings, "setup", disciplineLimits(settings as Settings & { discipline?: unknown }).maxLossTradePct);
  if (spread.overall && spread.overall.n >= 5) {
    const ov = spread.overall;
    traits.push({ id: "risk", label: "Risiko pro Trade", value: `${dec1(ov.mean * 100)} %`, detail: ov.consistency >= 0.7 ? "sehr gleichmäßig" : ov.consistency >= 0.4 ? "schwankt etwas" : "schwankt stark", tone: ov.consistency >= 0.7 ? "win" : ov.consistency >= 0.4 ? "fg" : "loss" });
  }

  const perDay = new Map<string, number>();
  for (const t of input.list) perDay.set(localDateKey(tradeTime(t)), (perDay.get(localDateKey(tradeTime(t))) ?? 0) + 1);
  const tempo = perDay.size ? input.list.length / perDay.size : 0;
  traits.push({ id: "tempo", label: "Tempo", value: `${dec1(tempo)} Trades/Tag`, detail: `an ${perDay.size} Handelstagen`, tone: "fg" });

  const top = edges.edges[0];
  if (top) traits.push({ id: "edge", label: "Deine Edge", value: top.label, detail: `Ø ${edges.unit === "R" ? fmtR(top.mean) : `${signed(top.mean, 0)} ${cur}`} · Konfidenz ${top.confidence}`, tone: "win" });
  const rep = behaviorReport(events, closed);
  const worst = rep.worst;
  if (worst) traits.push({ id: "weakness", label: "Teuerstes Muster", value: worst.label, detail: `${worst.trades.length}× · ${signed(worst.excess, 0)} ${cur}`, tone: "loss" });
  const emo = closed.filter((t) => ["FOMO", "Gierig", "Revenge"].includes(t.emotion)).length / n;
  if (closed.some((t) => t.emotion)) traits.push({ id: "emotion", label: "Emotionale Einstiege", value: pct0(emo), detail: "FOMO, Gierig oder Revenge", tone: emo > 0.2 ? "loss" : emo > 0.1 ? "fg" : "win" });

  const headline = [style ? `${dir === "Beidseitig" ? "" : `${dir}er `}${style}` : dir, sess.best ? `stark in ${sess.best.label}` : null].filter(Boolean).join(", ");
  return { headline, traits, n };
}

/* ------------------------------------------------------------------ weekly lesson · tips */

export interface WeeklyLesson {
  lines: string[];
  /** word of the lesson marked by `TactileHighlight` (contained in one of the lines) */
  highlight: string;
  /** "data": from the journal of the last 7 days; "principle": a rotating principle */
  source: "data" | "principle";
}

/** The lesson of the week: the most expensive behaviour of the last 7 days, else the best edge, else a principle. */
export function weeklyLesson(input: { closed: readonly EnrichedTrade[]; events: readonly BehaviorEvent[]; edges: EdgeReport; now: number; currency: string }): WeeklyLesson {
  const { now, closed, events } = input;
  const recent = closed.filter((t) => +tradeTime(t) > now - 7 * 86_400_000 && +tradeTime(t) <= now);
  const rep = behaviorReport(events, recent);
  const w = rep.worst;
  if (w && w.trades.length >= 2) {
    const name = BEHAVIOR_LABEL[w.key];
    const cost = input.edges.unit === "R" && w.sumR != null ? fmtR(w.sumR) : `${signed(w.g.net, 0)} ${input.currency}`;
    return { lines: [`${name} kostete dich`, `diese Woche ${cost}.`, BEHAVIOR_ADVICE[w.key].advice], highlight: name.split(" ")[0]!, source: "data" };
  }
  const e = input.edges.edges.find((c) => c.verdict === "klar") ?? input.edges.edges[0];
  if (e && e.verdict !== "zu wenig Daten") {
    const word = e.factors[0]!.label;
    return { lines: ["Deine Edge:", `${e.label}.`, "Mehr davon, weniger vom Rest."], highlight: word.split(" ")[0]!, source: "data" };
  }
  const week = Math.floor(now / (7 * 86_400_000));
  const p = PRINCIPLES[week % PRINCIPLES.length]!;
  return { lines: [...p.lines], highlight: p.highlight, source: "principle" };
}

/** Short tips for the rotating `TextMorph` (≤ 28 characters each), from the journal when possible. */
export function coachTips(input: { recs: readonly Recommendation[]; profile: BehaviorProfile }): string[] {
  const tips: string[] = [];
  for (const r of input.recs.slice(0, 4)) {
    if (r.behavior) tips.push(BEHAVIOR_ADVICE[r.behavior].goal);
    else if (r.kind === "focus") tips.push(r.title.replace("Fokus: ", "Fokus "));
  }
  const s = input.profile.traits.find((t) => t.id === "session");
  if (s) tips.push(`${s.value} ist deine Session`);
  const clean = [...new Set(tips.map((t) => (t.length > 28 ? `${t.slice(0, 27)}…` : t)))];
  return clean.length >= 2 ? clean.slice(0, 5) : [...clean, ...GENERIC_TIPS].slice(0, 5);
}

/** Helper for the views: aggregate of trades by id list. */
export function aggOfIds(closed: readonly EnrichedTrade[], ids: readonly string[]) {
  const set = new Set(ids);
  return aggregate(closed.filter((t) => set.has(t.id)));
}

export type { EdgeCandidate };

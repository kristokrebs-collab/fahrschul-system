/**
 * Wochenexperiment (F37): the coach's strongest recommendation as ONE testable hypothesis for the next week – with a
 * target value ("Sollwert"), a minimum sample and an automatic reading in the report of that week: erfüllt /
 * nicht erfüllt / zu wenig Daten. Pure, deterministic, no I/O; the numbers come from the journal, never from a model.
 *
 * What is tested is the BEHAVIOUR ("keine Revenge-Trades", "jeder Trade mit Review", "kein Trade im Muster X"), not the
 * profit: one week is far too short to prove that a change pays – the cost estimate behind the recommendation stays an
 * assumption and is labelled as one. A recommendation without a natural target value (a "Fokus" edge) is not turned
 * into an experiment; the next measurable one of the plan is proposed instead.
 *
 * Storage: the versioned passthrough key `settings.weekExperiment` (like `settings.coach` / `settings.keyLevels`: kept by
 * `normalizeSettings`, the backup and the cloud `merge3`; every writer returns a NEW settings object, all other keys
 * untouched):
 *
 *   { v: 1, experiments: Experiment[] (newest first, ≤ 12, `id` → merged per id), declined: string[] (≤ 40) }
 *
 * Nothing is ever accepted automatically: `withExperiment` is called by the user's click only.
 */
import type { EnrichedTrade, Settings } from "../types";
import type { AccountScope } from "../account";
import { DIMENSIONS, bucketLabel, isDimensionKey, type DimensionKey } from "../analytics/dimensions";
import { triggerOf } from "../coach/behaviors";
import { BEHAVIOR_KEYS, BEHAVIOR_LABEL, type BehaviorKey } from "../coach/behaviorKeys";
import type { BehaviorEvent } from "../coach/events";
import { improvementPlan, reviewed, type Recommendation } from "../coach/recommendations";
import { pct0 } from "@/lib/format";
import { tradeTime } from "@/lib/dates";
import { goalActual } from "./build";
import { contains, periodFromKey, periodOf, shiftPeriod, type ReportPeriod } from "./periods";

export const EXPERIMENT_KEY = "weekExperiment";
export const EXPERIMENT_VERSION = 1;
export const EXPERIMENTS_MAX = 12;
export const DECLINED_MAX = 40;
/** Trades the week needs before a verdict means anything (fewer = „zu wenig Daten“). */
export const EXPERIMENT_MIN_TRADES = 5;
/** Recommendations of the plan looked through for the first measurable one. */
export const PLAN_LOOKAHEAD = 5;

export type ExperimentMeasure =
  | { kind: "behavior"; behavior: BehaviorKey }
  | { kind: "ruleBreaks" }
  | { kind: "journalRate" }
  | { kind: "avoid"; factors: { dim: DimensionKey; key: string; label: string }[] };

export interface Experiment {
  /** `<week key>|<recommendation id>` */
  id: string;
  v: 1;
  recId: string;
  /** the recommendation's imperative headline */
  title: string;
  /** one sentence: what is tested */
  hypothesis: string;
  /** the evidence behind the recommendation (an assumption about cost, not part of the test) */
  why: string;
  measure: ExperimentMeasure;
  comparator: "atLeast" | "atMost";
  target: number;
  minTrades: number;
  /** the week the experiment applies to (the week AFTER the report it was proposed in) */
  weekKey: string;
  /** the report week it came from */
  sourceWeek: string;
  /** account view the numbers were taken from */
  acc: AccountScope;
  /** the same measure in the source week (`value` null = not measurable there) */
  baseline: { n: number; value: number | null };
  /** evidence trades of the recommendation (ids, newest first) */
  evidence: string[];
  /** ISO – set when the user accepted */
  acceptedAt: string;
}

export interface ExperimentState {
  experiments: Experiment[];
  declined: string[];
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown, max = 400): string | null => (typeof v === "string" && v.trim() ? v.slice(0, max) : null);
const ACCS = new Set(["all", "makro", "scalp"]);

function measureOf(v: unknown): ExperimentMeasure | null {
  const o = obj(v);
  if (o.kind === "ruleBreaks" || o.kind === "journalRate") return { kind: o.kind };
  if (o.kind === "behavior" && typeof o.behavior === "string" && (BEHAVIOR_KEYS as readonly string[]).includes(o.behavior)) return { kind: "behavior", behavior: o.behavior as BehaviorKey };
  if (o.kind === "avoid" && Array.isArray(o.factors)) {
    const factors = o.factors
      .map((f) => {
        const x = obj(f);
        return isDimensionKey(x.dim) && typeof x.key === "string" && x.key.length <= 60 ? { dim: x.dim, key: x.key, label: str(x.label, 80) ?? x.key } : null;
      })
      .filter((f): f is { dim: DimensionKey; key: string; label: string } => f !== null)
      .slice(0, 3);
    return factors.length ? { kind: "avoid", factors } : null;
  }
  return null;
}

/** A stored experiment, or null when it lacks a required field (a newer version's entry is not repaired). */
function experimentOf(v: unknown): Experiment | null {
  const o = obj(v);
  const measure = measureOf(o.measure);
  const id = str(o.id, 80);
  const weekKey = str(o.weekKey, 16);
  if (!measure || !id || !weekKey || periodFromKey(weekKey)?.kind !== "week" || o.v !== EXPERIMENT_VERSION) return null;
  if ((o.comparator !== "atLeast" && o.comparator !== "atMost") || !fin(o.target)) return null;
  const b = obj(o.baseline);
  return {
    id,
    v: 1,
    recId: str(o.recId, 120) ?? id,
    title: str(o.title) ?? "Experiment",
    hypothesis: str(o.hypothesis, 600) ?? "",
    why: str(o.why, 600) ?? "",
    measure,
    comparator: o.comparator,
    target: o.target,
    minTrades: fin(o.minTrades) && o.minTrades >= 1 ? Math.min(50, Math.floor(o.minTrades)) : EXPERIMENT_MIN_TRADES,
    weekKey,
    sourceWeek: str(o.sourceWeek, 16) ?? "",
    acc: ACCS.has(String(o.acc)) ? (o.acc as AccountScope) : "all",
    baseline: { n: fin(b.n) ? Math.max(0, Math.floor(b.n)) : 0, value: fin(b.value) ? b.value : null },
    evidence: Array.isArray(o.evidence) ? o.evidence.filter((x): x is string => typeof x === "string").slice(0, 12) : [],
    acceptedAt: str(o.acceptedAt, 40) ?? "",
  };
}

/** The experiment settings of `settings` (sanitised; a broken key reads as empty). */
export function experimentStateOf(settings: object): ExperimentState {
  const raw = obj((settings as Record<string, unknown>)[EXPERIMENT_KEY]);
  const seen = new Set<string>();
  const experiments: Experiment[] = [];
  for (const e of Array.isArray(raw.experiments) ? raw.experiments : []) {
    const x = experimentOf(e);
    if (x && !seen.has(x.id)) {
      seen.add(x.id);
      experiments.push(x);
    }
  }
  const declined = Array.isArray(raw.declined) ? [...new Set(raw.declined.filter((x): x is string => typeof x === "string" && x.length <= 80))].slice(0, DECLINED_MAX) : [];
  return { experiments: experiments.slice(0, EXPERIMENTS_MAX), declined };
}

function write(settings: Settings, patch: (state: ExperimentState) => ExperimentState): Settings {
  const raw = obj((settings as unknown as Record<string, unknown>)[EXPERIMENT_KEY]);
  const next = patch(experimentStateOf(settings));
  // unknown keys of the root survive; entries this version cannot read are dropped from the list only by a write of ours
  return { ...settings, [EXPERIMENT_KEY]: { ...raw, v: EXPERIMENT_VERSION, experiments: next.experiments.slice(0, EXPERIMENTS_MAX), declined: next.declined.slice(0, DECLINED_MAX) } } as Settings;
}

/** The user accepted: stores `e` (one experiment per week – an older one of that week is replaced) and clears a decline. */
export function withExperiment(settings: Settings, e: Experiment): Settings {
  return write(settings, (s) => ({
    experiments: [e, ...s.experiments.filter((x) => x.id !== e.id && x.weekKey !== e.weekKey)],
    declined: s.declined.filter((d) => d !== e.id),
  }));
}

/** The user declined the proposal `id` (it is not offered again for that week). */
export function withExperimentDeclined(settings: Settings, id: string): Settings {
  const s = experimentStateOf(settings);
  if (s.declined.includes(id)) return settings;
  return write(settings, (x) => ({ ...x, declined: [id, ...x.declined] }));
}

/** The user withdrew the declining (or the accepted experiment: `remove`). */
export function withoutExperiment(settings: Settings, id: string): Settings {
  const s = experimentStateOf(settings);
  if (!s.declined.includes(id) && !s.experiments.some((x) => x.id === id)) return settings;
  return write(settings, (x) => ({ experiments: x.experiments.filter((e) => e.id !== id), declined: x.declined.filter((d) => d !== id) }));
}

/* ------------------------------------------------------------------ measuring */

/** Trades of `list` that fall into the week (by entry time). */
export const tradesInWeek = (list: readonly EnrichedTrade[], week: Pick<ReportPeriod, "from" | "to">): EnrichedTrade[] => list.filter((t) => contains(week, +tradeTime(t)));

export interface MeasureCtx {
  settings: Settings;
  events: readonly BehaviorEvent[];
}

const matchesFactors = (t: EnrichedTrade, factors: { dim: DimensionKey; key: string }[], settings: Settings): boolean => factors.every((f) => DIMENSIONS[f.dim].keys(t, { settings }).includes(f.key));

/** The value of the measure over the trades of one week (`null` = not measurable) and the trades that count against the target. */
export function measureWeek(measure: ExperimentMeasure, trades: readonly EnrichedTrade[], ctx: MeasureCtx): { value: number | null; flagged: EnrichedTrade[] } {
  const closed = trades.filter((t) => t.result !== "open");
  const gctx = { closed, list: trades, events: ctx.events, settings: ctx.settings };
  const ids = new Set(trades.map((t) => t.id));
  const byId = new Map(trades.map((t) => [t.id, t]));
  switch (measure.kind) {
    case "behavior": {
      const hit = new Set(ctx.events.filter((e) => e.key === measure.behavior && ids.has(triggerOf(e))).map((e) => triggerOf(e)));
      return { value: goalActual("behavior", { behavior: measure.behavior }, gctx), flagged: [...hit].map((id) => byId.get(id)!).filter(Boolean) };
    }
    case "ruleBreaks": {
      const hit = new Set(ctx.events.filter((e) => e.key === "ruleViolation" && ids.has(triggerOf(e))).map((e) => triggerOf(e)));
      return { value: goalActual("ruleBreaks", undefined, gctx), flagged: [...hit].map((id) => byId.get(id)!).filter(Boolean) };
    }
    case "journalRate":
      return { value: trades.length ? goalActual("journalRate", undefined, gctx) : null, flagged: trades.filter((t) => !reviewed(t)) };
    case "avoid": {
      const hit = trades.filter((t) => matchesFactors(t, measure.factors, ctx.settings));
      return { value: trades.length ? hit.length : null, flagged: hit };
    }
  }
}

/* ------------------------------------------------------------------ texts */

/** „Revenge-Trades“, „Setup: Fade“ … – what the measure counts. */
export function measureNoun(m: ExperimentMeasure): string {
  switch (m.kind) {
    case "behavior":
      return BEHAVIOR_LABEL[m.behavior];
    case "ruleBreaks":
      return "Regelverstöße";
    case "journalRate":
      return "Trades mit Review";
    case "avoid":
      return m.factors.map((f) => f.label).join(" + ");
  }
}

/** „0“, „≥ 90 %“ — the target value as the trader reads it. */
export function targetText(e: Pick<Experiment, "measure" | "comparator" | "target">): string {
  const rate = e.measure.kind === "journalRate";
  const v = rate ? pct0(e.target) : String(Math.round(e.target * 100) / 100).replace(".", ",");
  if (rate) return `${e.comparator === "atLeast" ? "mindestens" : "höchstens"} ${v}`;
  return e.target === 0 && e.comparator === "atMost" ? "0" : `${e.comparator === "atLeast" ? "mindestens" : "höchstens"} ${v}`;
}

/** The value as the trader reads it („2 von 9 Trades“ / „60 %“). */
export function valueText(m: ExperimentMeasure, value: number | null, n: number): string {
  if (value == null) return "–";
  if (m.kind === "journalRate") return pct0(value);
  return `${Math.round(value)} von ${n} Trade${n === 1 ? "" : "s"}`;
}

function targetSentence(m: ExperimentMeasure, minTrades: number, e: Pick<Experiment, "comparator" | "target" | "measure">): string {
  const base = m.kind === "journalRate" ? `Anteil der Trades mit Review ${targetText(e)}` : `${measureNoun(m)}: ${targetText(e)}`;
  return `Nächste Woche: ${base} – bei mindestens ${minTrades} Trades.`;
}

/* ------------------------------------------------------------------ proposal */

export interface ExperimentProposal {
  /** unaccepted experiment, ready for `withExperiment` (its `acceptedAt` is filled in by the click) */
  experiment: Omit<Experiment, "acceptedAt">;
  /** the sentence „Nächste Woche: …“ */
  target: string;
  /** the recommendation that is skipped because it has no natural target value, if any came before */
  skipped: number;
  declined: boolean;
}

/** `dim=key&dim=key` (the edge ids) → factors with labels; `null` for anything unreadable or a behaviour factor. */
export function factorsOfId(id: string, settings: Settings): { dim: DimensionKey; key: string; label: string }[] | null {
  const out: { dim: DimensionKey; key: string; label: string }[] = [];
  for (const part of id.split("&")) {
    const at = part.indexOf("=");
    if (at < 1) return null;
    const dim = part.slice(0, at);
    const key = part.slice(at + 1);
    if (!isDimensionKey(dim) || !key) return null;
    out.push({ dim, key, label: `${DIMENSIONS[dim].label}: ${bucketLabel(DIMENSIONS[dim], key, { settings })}` });
  }
  return out.length ? out : null;
}

/** The measure and the natural target of a recommendation; `null` when it has none (a „Fokus“ edge). */
export function measureForRecommendation(r: Recommendation, settings: Settings): { measure: ExperimentMeasure; comparator: "atLeast" | "atMost"; target: number } | null {
  if (r.behavior) return { measure: r.behavior === "ruleViolation" ? { kind: "ruleBreaks" } : { kind: "behavior", behavior: r.behavior }, comparator: "atMost", target: 0 };
  if (r.id === "journal") return { measure: { kind: "journalRate" }, comparator: "atLeast", target: r.goal.metric === "journalRate" && fin(r.goal.target) ? r.goal.target : 0.9 };
  if (r.id.startsWith("leak:")) {
    const factors = factorsOfId(r.id.slice(5), settings);
    return factors ? { measure: { kind: "avoid", factors }, comparator: "atMost", target: 0 } : null;
  }
  return null;
}

export interface ProposeInput {
  recs: readonly Recommendation[];
  settings: Settings;
  events: readonly BehaviorEvent[];
  /** the account view's trades (open ones included) */
  list: readonly EnrichedTrade[];
  acc: AccountScope;
  /** the report week the proposal is made in */
  sourceWeek: ReportPeriod;
}

/** Id of the experiment a recommendation would become in `weekKey`. */
export const experimentId = (weekKey: string, recId: string): string => `${weekKey}|${recId}`;

/**
 * ONE hypothesis for the week after `sourceWeek`: the first measurable recommendation of the improvement plan. `null`
 * when the plan holds nothing measurable (too few trades, only „Fokus“ edges).
 */
export function proposeExperiment(input: ProposeInput): ExperimentProposal | null {
  const { settings, sourceWeek } = input;
  const weekKey = shiftPeriod(sourceWeek, 1).key;
  const plan = improvementPlan(input.recs, PLAN_LOOKAHEAD);
  const state = experimentStateOf(settings);
  let skipped = 0;
  for (const r of plan) {
    const m = measureForRecommendation(r, settings);
    if (!m) {
      skipped++;
      continue;
    }
    const id = experimentId(weekKey, r.id);
    const base = measureWeek(m.measure, tradesInWeek(input.list, sourceWeek), { settings, events: input.events });
    const sourceN = tradesInWeek(input.list, sourceWeek).length;
    const experiment: Omit<Experiment, "acceptedAt"> = {
      id,
      v: 1,
      recId: r.id,
      title: r.title,
      hypothesis: hypothesisOf(m.measure, m.comparator, m.target),
      why: r.why,
      measure: m.measure,
      comparator: m.comparator,
      target: m.target,
      minTrades: EXPERIMENT_MIN_TRADES,
      weekKey,
      sourceWeek: sourceWeek.key,
      acc: input.acc,
      baseline: { n: sourceN, value: base.value },
      evidence: r.evidence.slice(0, 12),
    };
    return { experiment, target: targetSentence(m.measure, EXPERIMENT_MIN_TRADES, { ...m }), skipped, declined: state.declined.includes(id) };
  }
  return null;
}

function hypothesisOf(m: ExperimentMeasure, comparator: "atLeast" | "atMost", target: number): string {
  switch (m.kind) {
    case "behavior":
      return `Ich kann ${BEHAVIOR_LABEL[m.behavior]} in einer Woche ${target === 0 ? "ganz vermeiden" : `auf höchstens ${target} begrenzen`}.`;
    case "ruleBreaks":
      return "Ich kann eine Woche ohne Regelverstoß handeln.";
    case "journalRate":
      return `Ich kann ${pct0(target)} meiner Trades der Woche mit einem Review abschließen.`;
    case "avoid":
      return `Ich kann ${comparator === "atMost" && target === 0 ? "die Trades im Muster" : "Trades im Muster"} „${m.factors.map((f) => f.label).join(" + ")}“ eine Woche lang auslassen.`;
  }
}

/* ------------------------------------------------------------------ evaluation */

export type ExperimentStatus = "erfüllt" | "nicht erfüllt" | "zu wenig Daten" | "läuft";

export interface ExperimentResult {
  status: ExperimentStatus;
  /** value of the measure in the week (`null` = not measurable) */
  actual: number | null;
  /** all trades of the week in the account view */
  n: number;
  minTrades: number;
  /** the week has ended */
  complete: boolean;
  /** one sentence: the reading with its numbers */
  text: string;
  /** trades behind the reading: those that count against the target (newest first) */
  flagged: EnrichedTrade[];
  /** the week's trades the experiment looked at, for the „zu wenig Daten“ case */
  week: ReportPeriod;
}

/** Reads an experiment against the journal. `list` must be the trades of the experiment's account view. */
export function evaluateExperiment(e: Experiment, ctx: { list: readonly EnrichedTrade[]; settings: Settings; events: readonly BehaviorEvent[]; now: number }): ExperimentResult {
  const week = periodFromKey(e.weekKey)!;
  const trades = tradesInWeek(ctx.list, week);
  const n = trades.length;
  const complete = week.to <= ctx.now;
  const { value, flagged } = measureWeek(e.measure, trades, ctx);
  const sorted = [...flagged].sort((a, b) => +tradeTime(b) - +tradeTime(a));
  const met = value == null ? null : e.comparator === "atLeast" ? value >= e.target : value <= e.target;
  const noun = measureNoun(e.measure);
  const reading = e.measure.kind === "journalRate" ? `Anteil mit Review ${valueText(e.measure, value, n)} (Soll ${targetText(e)})` : `${noun}: ${valueText(e.measure, value, n)} (Soll ${targetText(e)})`;
  let status: ExperimentStatus;
  let text: string;
  if (!complete) {
    status = "läuft";
    text = `Die Woche läuft noch – bisher ${reading}. Das Urteil fällt nach Wochenende, ab ${e.minTrades} Trades.`;
  } else if (value == null || n < e.minTrades) {
    status = "zu wenig Daten";
    text = `Nur ${n} Trade${n === 1 ? "" : "s"} in der Woche, für ein Urteil braucht es mindestens ${e.minTrades}. Gelesen: ${reading}. Weder bestätigt noch widerlegt.`;
  } else if (met) {
    status = "erfüllt";
    text = `${reading} bei ${n} Trades – erfüllt. Eine Woche zeigt, dass es machbar war, nicht dass es sich auszahlt.`;
  } else {
    status = "nicht erfüllt";
    text = `${reading} bei ${n} Trades – nicht erfüllt.`;
  }
  return { status, actual: value, n, minTrades: e.minTrades, complete, text, flagged: sorted, week };
}

/** The experiment accepted for a week (if any). */
export const experimentForWeek = (settings: object, weekKey: string): Experiment | null => experimentStateOf(settings).experiments.find((e) => e.weekKey === weekKey) ?? null;

export type ExperimentPhase = "geplant" | "läuft" | "beendet";

export interface CurrentExperiment {
  experiment: Experiment;
  week: ReportPeriod;
  phase: ExperimentPhase;
}

/** Days after its week an experiment still counts as „current“ (the report that reads it is written then). */
export const CURRENT_GRACE_DAYS = 14;

/** The accepted experiments that matter at `now`: the running week, the planned ones, the last finished one (≤ 14 days). */
export function currentExperiments(settings: object, now: number): CurrentExperiment[] {
  const all = experimentStateOf(settings).experiments.map((experiment) => ({ experiment, week: periodFromKey(experiment.weekKey)! }));
  const running = all.filter((x) => x.week.from <= now && now < x.week.to).map((x): CurrentExperiment => ({ ...x, phase: "läuft" }));
  const planned = all.filter((x) => x.week.from > now).sort((a, b) => a.week.from - b.week.from).map((x): CurrentExperiment => ({ ...x, phase: "geplant" }));
  const past = all.filter((x) => x.week.to <= now && now - x.week.to < CURRENT_GRACE_DAYS * 86_400_000).sort((a, b) => b.week.from - a.week.from).slice(0, 1).map((x): CurrentExperiment => ({ ...x, phase: "beendet" }));
  return [...running, ...planned, ...past];
}

/* ------------------------------------------------------------------ overview (assistant) */

export interface ExperimentOverviewItem {
  experiment: Experiment;
  phase: ExperimentPhase;
  week: ReportPeriod;
  /** the reading; `null` for a planned experiment whose week has not begun */
  result: ExperimentResult | null;
}

export interface ExperimentOverview {
  items: ExperimentOverviewItem[];
  /** an unaccepted hypothesis for the running week (made from the last finished week), `null` when there is none */
  proposal: ExperimentProposal | null;
  /** the report that holds the accept button */
  proposalReport: ReportPeriod | null;
}

export interface OverviewInput {
  settings: Settings;
  events: readonly BehaviorEvent[];
  now: number;
  /** the trades of the account view a proposal is made from */
  list: readonly EnrichedTrade[];
  acc: AccountScope;
  /** computed on demand (the coach's analysis is not cheap) */
  recs: () => readonly Recommendation[];
  /** the trades of an experiment's own account view */
  listOf: (acc: AccountScope) => readonly EnrichedTrade[];
}

/** What is stored and what could be proposed — read-only, changes nothing. */
export function experimentOverview(input: OverviewInput): ExperimentOverview {
  const { settings, events, now } = input;
  const items = currentExperiments(settings, now).map(
    ({ experiment, phase, week }): ExperimentOverviewItem => ({
      experiment,
      phase,
      week,
      result: phase === "geplant" ? null : evaluateExperiment(experiment, { list: input.listOf(experiment.acc), settings, events, now }),
    }),
  );
  // a proposal for the running week, made from the last finished one – only when that week has trades and nothing is accepted yet
  const running = periodOf("week", now);
  const source = shiftPeriod(running, -1);
  const hasTrades = tradesInWeek(input.list, source).some((t) => t.result !== "open");
  const taken = items.some((i) => i.experiment.weekKey === running.key);
  const proposal = hasTrades && !taken ? proposeExperiment({ recs: input.recs(), settings, events, list: input.list, acc: input.acc, sourceWeek: source }) : null;
  return { items, proposal, proposalReport: proposal ? source : null };
}

/**
 * Persönlicher Monatsnutzen (F60): „Was hat dir das Journal diesen Monat gebracht?“ – only what the journal and its local
 * traces can PROVE, counted. Pure, deterministic; every number is a count or a share of recorded things.
 *
 * What is counted, and from where:
 *   geprüfte Einstiege   trades of the month that carry a stored Einstiegs-Check snapshot / a Box-zu-Box context from the moment of entry
 *   Alarme               signals the archive recorded in the month (entries / other events) and the lines the Zustellprotokoll sent
 *   Regeln               trades with a complete / incomplete setup checklist, logged rule violations, trades that followed / did not follow the plan
 *   Verlustlimit         days of the month whose loss broke the day limit (the report's count), trades above the per-trade limit
 *   Reviews              the share of the month's trades that have a review
 *   Experimente          the accepted weekly experiments of the month's weeks, each read against the journal
 *   Check-ins            days of the month with a daily check-in
 * What is NOT claimed, on purpose: no avoided rule violations (nobody can count what did not happen), no money „saved“, no
 * estimate of what an alert earned or a rule prevented, no cause for any change. A trace that does not reach back to the month's
 * start (the signal archive and the Zustellprotokoll are short and local) is flagged as incomplete instead of read as „none“.
 */
import type { EnrichedTrade, Settings } from "../types";
import type { DayNotes } from "../types";
import type { BehaviorEvent } from "../coach/events";
import type { DeliveryRecord } from "../keylevels/delivery";
import type { SignalEvent } from "../missed/archive";
import { checkinOf } from "../psych/checkin";
import { parseSignalSnapshot } from "../signals/snapshot";
import { tradeTime } from "@/lib/dates";
import { reviewed } from "../coach/recommendations";
import type { Report } from "./build";
import { evaluateExperiment, experimentStateOf, type ExperimentStatus } from "./experiment";
import { contains, periodFromKey, type ReportPeriod } from "./periods";

export interface TraceCoverage {
  /** the trace holds something from before the period's start (so a zero is a real zero) */
  complete: boolean;
  /** oldest entry of the trace (ms), `null` = empty */
  oldest: number | null;
}

export interface BenefitExperiment {
  id: string;
  title: string;
  week: string;
  status: ExperimentStatus;
  text: string;
}

export interface MonthBenefit {
  period: ReportPeriod;
  /** no trade in the month and nothing recorded */
  empty: boolean;
  trades: number;
  entries: { checked: number; boxContext: number };
  alerts: {
    /** signals (entries with a direction) / other events the archive recorded in the month */
    signals: number;
    context: number;
    /** lines the Zustellprotokoll sent in the month, by source */
    sent: number;
    sentSignal: number;
    sentBox: number;
    sentKey: number;
    archive: TraceCoverage;
    log: TraceCoverage;
  };
  rules: {
    checklistTrades: number;
    checklistComplete: number;
    checklistIncomplete: number;
    violations: number;
    planTrades: number;
    planFollowed: number;
    planNotFollowed: number;
  };
  limits: { dayBreaches: number; overLimit: number };
  review: { trades: number; reviewed: number; rate: number | null };
  experiments: { items: BenefitExperiment[]; met: number; missed: number; thin: number; running: number };
  checkins: { days: number };
}

export interface BenefitInput {
  report: Report;
  /** every enriched trade of the account view */
  list: readonly EnrichedTrade[];
  settings: Settings;
  events: readonly BehaviorEvent[];
  days?: DayNotes;
  signals: readonly SignalEvent[];
  log: readonly DeliveryRecord[];
  now: number;
}

/** What the statement block says in every case (shown under the figures). */
export const BENEFIT_LIMITS = [
  "Gezählt wird nur, was protokolliert ist. Regelverstöße, die du vermieden hast, lassen sich nicht zählen – es gibt nichts, was man dafür protokollieren könnte.",
  "Keine Geldbeträge „gespart“ und keine Schätzung, was ein Alarm oder eine Regel gebracht hätte; keine Ursache für Veränderungen.",
  "Alarme laufen nur bei offener App; das Signalarchiv und das Zustellprotokoll liegen nur auf diesem Gerät und sind kurz – reichen sie nicht bis zum Monatsanfang, steht es dabei.",
] as const;

const coverage = (oldest: number | null, from: number): TraceCoverage => ({ oldest, complete: oldest != null && oldest <= from });

/** Day keys (`YYYY-MM-DD`) of the days of `p` that carry a daily check-in. */
function checkinDays(days: DayNotes | undefined, p: Pick<ReportPeriod, "from" | "to">): number {
  if (!days) return 0;
  let n = 0;
  for (const [key, note] of Object.entries(days)) {
    const ms = new Date(`${key}T12:00:00`).getTime();
    if (Number.isFinite(ms) && contains(p, ms) && checkinOf(note)) n++;
  }
  return n;
}

/** The month's benefit. `report.period` should be a month; any period works. */
export function monthBenefit(input: BenefitInput): MonthBenefit {
  const { report, list, settings, events, now } = input;
  const p = report.period;
  const inPeriod = list.filter((t) => contains(p, +tradeTime(t)));
  const ids = new Set(inPeriod.map((t) => t.id));
  const signals = input.signals.filter((e) => contains(p, e.at));
  const sentLines = input.log.filter((r) => r.outcome === "sent" && contains(p, r.at));
  const checklist = inPeriod.filter((t) => t.complete != null);
  const plan = inPeriod.filter((t) => t.followedPlan != null);
  const reviewedN = inPeriod.filter(reviewed).length;
  const violations = events.filter((e) => e.key === "ruleViolation" && ids.has(e.tradeIds[e.tradeIds.length - 1]!)).length;
  const items: BenefitExperiment[] = [];
  for (const e of experimentStateOf(settings).experiments) {
    const wk = periodFromKey(e.weekKey);
    // a week belongs to the month it starts in (ISO weeks do not nest in months)
    if (!wk || !contains(p, wk.from)) continue;
    const r = evaluateExperiment(e, { list, settings, events, now });
    items.push({ id: e.id, title: e.title, week: wk.short, status: r.status, text: r.text });
  }
  items.sort((a, b) => a.week.localeCompare(b.week));
  const entries = { checked: inPeriod.filter((t) => parseSignalSnapshot(t.signal) != null).length, boxContext: inPeriod.filter((t) => t.boxSnap != null).length };
  const oldestSignal = input.signals.length ? Math.min(...input.signals.map((e) => e.at)) : null;
  const oldestLog = input.log.length ? Math.min(...input.log.map((r) => r.at)) : null;
  const checkins = checkinDays(input.days, p);
  return {
    period: p,
    empty: inPeriod.length === 0 && signals.length === 0 && sentLines.length === 0 && checkins === 0,
    trades: inPeriod.length,
    entries,
    alerts: {
      signals: signals.filter((e) => e.entry && e.side).length,
      context: signals.filter((e) => !(e.entry && e.side)).length,
      sent: sentLines.length,
      sentSignal: sentLines.filter((r) => r.source === "signal").length,
      sentBox: sentLines.filter((r) => r.source === "box").length,
      sentKey: sentLines.filter((r) => r.source === "key").length,
      archive: coverage(oldestSignal, p.from),
      log: coverage(oldestLog, p.from),
    },
    rules: {
      checklistTrades: checklist.length,
      checklistComplete: checklist.filter((t) => t.complete).length,
      checklistIncomplete: checklist.filter((t) => !t.complete).length,
      violations,
      planTrades: plan.length,
      planFollowed: plan.filter((t) => t.followedPlan).length,
      planNotFollowed: plan.filter((t) => !t.followedPlan).length,
    },
    limits: { dayBreaches: report.risk.dayBreaches, overLimit: report.risk.overLimit },
    review: { trades: inPeriod.length, reviewed: reviewedN, rate: inPeriod.length ? reviewedN / inPeriod.length : null },
    experiments: {
      items,
      met: items.filter((x) => x.status === "erfüllt").length,
      missed: items.filter((x) => x.status === "nicht erfüllt").length,
      thin: items.filter((x) => x.status === "zu wenig Daten").length,
      running: items.filter((x) => x.status === "läuft").length,
    },
    checkins: { days: checkins },
  };
}

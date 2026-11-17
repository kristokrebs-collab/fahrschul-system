/**
 * Strategiefilter (F43): how do the trades behave in the PHASES around the appointments of the calendar? A trade belongs to
 * a phase by the time of its ENTRY, decided by the same rules as the calendar (Funding grid, Deribit expiry, NYSE session,
 * Fed list). For every phase the sample inside is set against the sample outside: n, hit rate, Ø R – with the sample size,
 * the 80 % intervals the Auswertung uses everywhere, and the multiple-test correction across all phases looked at. A
 * difference is an observation with numbers, never a cause; with few trades the honest answer is "zu wenig".
 *
 * A phase the data cannot judge (the FOMC list ends in 2027) is `null` for that trade: it counts neither inside nor outside.
 * Pure; the clock never enters (a trade's time is its own).
 */
import { benjaminiHochberg, proportionDiff, significanceOf, welch, wilsonCI, type Interval, type ProportionDiff, type Significance, type TwoSample } from "../analytics/stats";
import { isFomcDecisionDay } from "./fomc";
import { FUNDING_INTERVAL, isExpiryDayUtc, isWeekendUtc } from "./rules";
import { usDayKey, usSession } from "./usMarket";
import { HOUR } from "./types";

export type PhaseId = "fundingPre" | "fundingPost" | "expiryDay" | "fomcDay" | "usOpenHour" | "weekend";

export interface PhaseDef {
  id: PhaseId;
  label: string;
  /** what "inside" means, exactly */
  rule: string;
}

export const PHASE_DEFS: readonly PhaseDef[] = [
  { id: "fundingPre", label: "0–2 h vor Funding", rule: "Einstieg in den zwei Stunden vor einer Funding-Abrechnung (06:00–08:00, 14:00–16:00, 22:00–24:00 UTC)." },
  { id: "fundingPost", label: "0–4 h nach Funding", rule: "Einstieg in den vier Stunden ab einer Funding-Abrechnung (00:00–04:00, 08:00–12:00, 16:00–20:00 UTC)." },
  { id: "expiryDay", label: "Verfallstag", rule: "Einstieg am UTC-Tag eines Monats- oder Quartalsverfalls (letzter Freitag des Monats)." },
  { id: "fomcDay", label: "FOMC-Tag", rule: "Einstieg am New Yorker Kalendertag einer FOMC-Entscheidung (Liste der Fed, 2021–2027)." },
  { id: "usOpenHour", label: "US-Open-Stunde", rule: "Einstieg in der ersten Stunde der US-Börse (09:30–10:30 Uhr New Yorker Zeit, nur Handelstage)." },
  { id: "weekend", label: "Wochenende", rule: "Einstieg am Samstag oder Sonntag (UTC)." },
];

export const PHASE_LABEL: Readonly<Record<PhaseId, string>> = Object.fromEntries(PHASE_DEFS.map((d) => [d.id, d.label])) as Record<PhaseId, string>;

export type Membership = Record<PhaseId, boolean | null>;

/** Which phases the instant `ms` lies in (`null` = the data cannot say). */
export function phaseMembership(ms: number): Membership {
  const r = ((ms % FUNDING_INTERVAL) + FUNDING_INTERVAL) % FUNDING_INTERVAL;
  const key = usDayKey(ms);
  const session = usSession(key);
  return {
    fundingPre: r >= FUNDING_INTERVAL - 2 * HOUR,
    fundingPost: r < 4 * HOUR,
    expiryDay: isExpiryDayUtc(ms),
    fomcDay: isFomcDecisionDay(key),
    usOpenHour: session ? ms >= session.open && ms < session.open + HOUR : false,
    weekend: isWeekendUtc(ms),
  };
}

/** One trade as the phase analysis needs it: when it was entered, how it ended. */
export interface PhaseTrade {
  id: string;
  /** entry time, ms UTC */
  at: number;
  /** result in R, `null` without a stop */
  r: number | null;
  result: "win" | "loss" | "be";
}

export interface PhaseGroup {
  n: number;
  wins: number;
  /** wins ÷ n */
  hit: number | null;
  hitCI: Interval | null;
  /** trades with an R value */
  nR: number;
  avgR: number | null;
}

export interface PhaseRow {
  def: PhaseDef;
  inside: PhaseGroup;
  outside: PhaseGroup;
  /** trades this phase cannot judge */
  unknown: number;
  /** Ø R inside − outside, with its test (needs two R values on each side) */
  dR: TwoSample | null;
  /** hit rate inside − outside */
  dHit: ProportionDiff | null;
  /** the p-value the verdict is based on: Ø R if both sides have R values, else the hit rate */
  p: number | null;
  /** corrected for the number of phases looked at (Benjamini-Hochberg) */
  q: number | null;
  verdict: Significance;
}

export interface PhaseReport {
  total: PhaseGroup;
  rows: PhaseRow[];
  /** phases with at least one trade inside – the number of comparisons the correction counts */
  tests: number;
  /** below this many trades on the smaller side the verdict is "zu wenig" */
  minN: number;
}

export const PHASE_MIN_N = 10;

function groupOf(trades: readonly PhaseTrade[]): PhaseGroup {
  const n = trades.length;
  const wins = trades.filter((t) => t.result === "win").length;
  const rs = trades.map((t) => t.r).filter((r): r is number => r != null && Number.isFinite(r));
  return { n, wins, hit: n ? wins / n : null, hitCI: n ? wilsonCI(wins, n) : null, nR: rs.length, avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null };
}

const rValues = (trades: readonly PhaseTrade[]): number[] => trades.map((t) => t.r).filter((r): r is number => r != null && Number.isFinite(r));

/** Splits the trades by every phase and tests inside against outside. */
export function analyzePhases(trades: readonly PhaseTrade[], minN: number = PHASE_MIN_N): PhaseReport {
  const member = trades.map((t) => ({ t, m: phaseMembership(t.at) }));
  const rows: PhaseRow[] = PHASE_DEFS.map((def) => {
    const inside: PhaseTrade[] = [];
    const outside: PhaseTrade[] = [];
    let unknown = 0;
    for (const { t, m } of member) {
      const v = m[def.id];
      if (v === null) unknown++;
      else (v ? inside : outside).push(t);
    }
    const rin = rValues(inside);
    const rout = rValues(outside);
    const dR = rin.length >= 2 && rout.length >= 2 ? welch(rin, rout) : null;
    const gi = groupOf(inside);
    const go = groupOf(outside);
    const dHit = gi.n && go.n ? proportionDiff(gi.wins, gi.n, go.wins, go.n) : null;
    return { def, inside: gi, outside: go, unknown, dR, dHit, p: dR ? dR.p : dHit ? dHit.p : null, q: null, verdict: "wenig" as Significance };
  });
  const tested = rows.filter((r) => r.inside.n > 0 && r.p != null);
  const fdr = benjaminiHochberg(tested.map((r) => r.p));
  tested.forEach((r, i) => {
    r.q = fdr.q[i] ?? null;
  });
  for (const r of rows) r.verdict = significanceOf(r.p, r.q, Math.min(r.inside.n, r.outside.n), minN);
  return { total: groupOf(trades), rows, tests: tested.length, minN };
}

/** Closed journal trades → phase trades (entry time from the wall clock in `sourceZone`; trades without a parsable time are dropped and counted). */
export function toPhaseTrades<T extends { id: string; date: string; r: number | null; result: string }>(trades: readonly T[], parse: (wall: string) => number): { trades: PhaseTrade[]; skipped: number } {
  const out: PhaseTrade[] = [];
  let skipped = 0;
  for (const t of trades) {
    if (t.result !== "win" && t.result !== "loss" && t.result !== "be") continue;
    const at = parse(t.date);
    if (!Number.isFinite(at)) {
      skipped++;
      continue;
    }
    out.push({ id: t.id, at, r: t.r, result: t.result });
  }
  return { trades: out, skipped };
}

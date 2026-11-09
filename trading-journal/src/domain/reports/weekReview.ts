/**
 * Wochenreview (F37): the facts of one week-report in four findings – the result after costs, the setups, the
 * discipline and the uncertainty of all of it – each with the trades behind it (ids, so the view can open them). Pure;
 * everything is read from the `Report` the builder made (and the behaviour events), nothing is estimated here and no
 * cause is claimed: a finding is an observation with its sample.
 */
import type { EnrichedTrade, Settings } from "../types";
import { DIMENSIONS } from "../analytics/dimensions";
import { meanCI, type Interval } from "../analytics/stats";
import { triggerOf } from "../coach/behaviors";
import type { BehaviorEvent } from "../coach/events";
import { tradeTime } from "@/lib/dates";
import { pct0, r as fmtR, signed } from "@/lib/format";
import type { Report } from "./build";

/** Under this many closed trades a week says next to nothing about the trader's edge. */
export const REVIEW_THIN_N = 10;
/** Under this many it says nothing at all. */
export const REVIEW_MIN_N = 5;
/** Evidence trades listed per group. */
export const REVIEW_EVIDENCE_MAX = 6;

export type ReviewTone = "win" | "loss" | "fg" | "mute";

export interface EvidenceGroup {
  label: string;
  /** trade ids, newest first (≤ `REVIEW_EVIDENCE_MAX`) */
  ids: string[];
  /** how many trades the group has in total */
  total: number;
}

export interface ReviewFinding {
  id: "result" | "setups" | "discipline" | "uncertainty";
  title: string;
  /** the one line that matters */
  headline: string;
  lines: string[];
  tone: ReviewTone;
  /** closed trades the finding rests on */
  n: number;
  evidence: EvidenceGroup[];
}

export interface WeekReview {
  n: number;
  level: "leer" | "zu wenig" | "dünn" | "tragfähig";
  findings: ReviewFinding[];
  /** 80 % interval of the mean net per trade (money) / of the mean R, `null` below 3 values */
  netCi: Interval | null;
  rCi: Interval | null;
}

export interface WeekReviewInput {
  report: Report;
  events: readonly BehaviorEvent[];
  settings: Settings;
}

const money = (v: number | null | undefined, cur: string): string => (v == null || !Number.isFinite(v) ? "–" : `${signed(v, 0)} ${cur}`);
const newestIds = (ts: readonly EnrichedTrade[]): EvidenceGroup["ids"] => [...ts].sort((a, b) => +tradeTime(b) - +tradeTime(a)).slice(0, REVIEW_EVIDENCE_MAX).map((t) => t.id);
const group = (label: string, ts: readonly EnrichedTrade[]): EvidenceGroup => ({ label, ids: newestIds(ts), total: ts.length });
const byId = (ts: readonly EnrichedTrade[], id: string | null): EnrichedTrade[] => ts.filter((t) => t.id === id);

/** Review of the week of `input.report` (any report kind works; the view shows it for weeks). */
export function weekReview(input: WeekReviewInput): WeekReview {
  const { report: r, events, settings } = input;
  const cur = r.currency;
  const closed = r.trades;
  const n = closed.length;
  const g = r.performance.g;
  const level: WeekReview["level"] = n === 0 ? "leer" : n < REVIEW_MIN_N ? "zu wenig" : n < REVIEW_THIN_N ? "dünn" : "tragfähig";
  const nets = closed.map((t) => t.pnl ?? 0);
  const rs = closed.map((t) => t.r).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const netCi = n >= 3 ? meanCI(nets) : null;
  const rCi = rs.length >= 3 ? meanCI(rs) : null;
  const findings: ReviewFinding[] = [];
  if (n === 0) return { n, level, findings, netCi, rCi };

  // 1. result after costs
  const costs = g.fees + g.funding;
  const lines: string[] = [`Vor Kosten ${money(g.gross, cur)}, Gebühren ${money(-g.fees || 0, cur)}, Funding ${money(-g.funding || 0, cur)} – nach Kosten ${money(g.net, cur)} aus ${n} Trade${n === 1 ? "" : "s"}.`];
  if (g.winRate != null) lines.push(`Win-Rate ${pct0(g.winRate)}${g.avgR != null ? `, Ø ${fmtR(g.avgR)} pro Trade mit Stop (${g.rN})` : ""}${r.performance.sumR != null ? `, Summe ${fmtR(r.performance.sumR)}` : ""}.`);
  if (costs > 0 && g.gross !== 0) lines.push(`Kosten: ${pct0(Math.abs(costs / g.gross))} des Ergebnisses vor Kosten.`);
  const resultEv: EvidenceGroup[] = [];
  if (r.performance.bestId) resultEv.push(group("Bester Trade", byId(closed, r.performance.bestId)));
  if (r.performance.worstId && r.performance.worstId !== r.performance.bestId) resultEv.push(group("Schwächster Trade", byId(closed, r.performance.worstId)));
  findings.push({ id: "result", title: "Ergebnis nach Kosten", headline: `${money(g.net, cur)} nach Gebühren und Funding`, lines, tone: g.net > 0 ? "win" : g.net < 0 ? "loss" : "fg", n, evidence: resultEv });

  // 2. setups
  const s = r.strategy;
  const ctx = { settings };
  const withSetup = (key: string): EnrichedTrade[] => closed.filter((t) => DIMENSIONS.setup.keys(t, ctx).includes(key));
  const setupEv: EvidenceGroup[] = [];
  const setupLines: string[] = [];
  const rows = s.setups.filter((x) => x.key !== "__none");
  if (rows.length) setupLines.push(`${rows.length} Setup${rows.length === 1 ? "" : "s"} gehandelt: ${rows.slice(0, 4).map((x) => `${x.label} ${x.n}×`).join(", ")}${rows.length > 4 ? " …" : ""}.`);
  if (s.best) {
    setupLines.push(`Stärkstes: ${s.best.label} ${money(s.best.net, cur)} bei ${s.best.n} Trade${s.best.n === 1 ? "" : "s"}.`);
    setupEv.push(group(s.best.label, withSetup(s.best.key)));
  }
  if (s.worst) {
    setupLines.push(`Schwächstes: ${s.worst.label} ${money(s.worst.net, cur)} bei ${s.worst.n} Trade${s.worst.n === 1 ? "" : "s"}.`);
    setupEv.push(group(s.worst.label, withSetup(s.worst.key)));
  }
  const noSetup = s.setups.find((x) => x.key === "__none");
  if (noSetup) setupLines.push(`${noSetup.n} Trade${noSetup.n === 1 ? "" : "s"} ohne Setup.`);
  if (!setupLines.length) setupLines.push("Keine Setups an den Trades dieser Woche.");
  if (rows.length && rows.every((x) => x.n < 3)) setupLines.push("Jedes Setup hat weniger als 3 Trades – ein Vergleich der Setups trägt nicht.");
  findings.push({ id: "setups", title: "Setups", headline: s.best ? `Stärkstes Setup: ${s.best.label}` : rows.length ? "Kein Setup im Plus" : "Keine Setups", lines: setupLines, tone: s.best ? "win" : "mute", n, evidence: setupEv });

  // 3. discipline
  const ids = new Set(closed.map((t) => t.id));
  const broke = closed.filter((t) => events.some((e) => e.key === "ruleViolation" && triggerOf(e) === t.id));
  const offPlan = closed.filter((t) => t.followedPlan === false && !broke.some((b) => b.id === t.id));
  const flagged = new Set(events.filter((e) => ids.has(triggerOf(e)) && e.key !== "ruleViolation").map((e) => triggerOf(e)));
  const gl = r.goals;
  const discLines: string[] = [];
  discLines.push(`Disziplin Ø ${gl.discipline == null ? "–" : Math.round(gl.discipline)}${gl.streak ? `, ${gl.streak} ${gl.streak === 1 ? "Tag" : "Tage"} in Folge gut` : ""}.`);
  discLines.push(`${gl.ruleBreaks} Regelverstoß${gl.ruleBreaks === 1 ? "" : "e"}${r.risk.dayBreaches ? `, ${r.risk.dayBreaches} Tag${r.risk.dayBreaches === 1 ? "" : "e"} über dem Tageslimit` : ""}; ${flagged.size} Trade${flagged.size === 1 ? "" : "s"} mit einem Verhaltensmuster.`);
  if (r.psychology.planRate != null) discLines.push(`Plan befolgt bei ${pct0(r.psychology.planRate)} der Trades mit Angabe.`);
  const discEv: EvidenceGroup[] = [];
  if (broke.length) discEv.push(group("Regelverstöße", broke));
  if (flagged.size) discEv.push(group("Verhaltensmuster", closed.filter((t) => flagged.has(t.id))));
  if (offPlan.length) discEv.push(group("Plan nicht befolgt", offPlan));
  findings.push({
    id: "discipline",
    title: "Disziplin",
    headline: gl.discipline == null ? "Keine Disziplin-Daten" : gl.ruleBreaks === 0 && !flagged.size ? "Keine Regelverstöße, keine Muster" : `${gl.ruleBreaks} Regelverstoß${gl.ruleBreaks === 1 ? "" : "e"}, ${flagged.size} Muster`,
    lines: discLines,
    tone: gl.ruleBreaks > 0 || flagged.size > 0 ? "loss" : gl.discipline != null && gl.discipline >= 70 ? "win" : "fg",
    n,
    evidence: discEv,
  });

  // 4. uncertainty
  const unc: string[] = [];
  if (level === "zu wenig") unc.push(`Nur ${n} Trade${n === 1 ? "" : "s"}: Das Ergebnis dieser Woche sagt über dein Handeln nichts Belastbares – Zufall erklärt es genauso gut.`);
  else if (level === "dünn") unc.push(`${n} Trades sind eine dünne Grundlage (ab ${REVIEW_THIN_N} wird sie tragfähiger).`);
  else unc.push(`${n} Trades: genug für eine Tendenz, nicht für einen Beweis.`);
  if (netCi) unc.push(`Ø Netto pro Trade ${money(g.net / n, cur)}, 80 %-Intervall ${money(netCi.lo, cur)} … ${money(netCi.hi, cur)}${netCi.lo <= 0 && netCi.hi >= 0 ? " – schließt 0 ein: von Zufall nicht zu unterscheiden" : ""}.`);
  if (rCi && g.avgR != null) unc.push(`Ø R ${fmtR(g.avgR)}, 80 %-Intervall ${fmtR(rCi.lo)} … ${fmtR(rCi.hi)} (${rs.length} Trades mit Stop).`);
  if (s.worst && s.worst.n < 3) unc.push(`Das schwächste Setup hat nur ${s.worst.n} Trade${s.worst.n === 1 ? "" : "s"} – kein Urteil über das Setup.`);
  findings.push({ id: "uncertainty", title: "Unsicherheit", headline: level === "tragfähig" ? "Tendenz, kein Beweis" : level === "dünn" ? "Dünne Datenlage" : "Zu wenig Trades", lines: unc, tone: "mute", n, evidence: [] });

  return { n, level, findings, netCi, rCi };
}

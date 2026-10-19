/**
 * "Erkenntnisse" – rule-based Zella Insights (no AI, deterministic, offline). Each candidate splits the closed trades
 * into a group G and the rest C of the same universe:
 *   impact = Σ P&L(G) − n(G) · Ø P&L(C)        (what G cost or earned against your usual trade)
 * A candidate is shown when n(G) ≥ 5 and n(C) ≥ 5 and (|Win-Rate(G) − Win-Rate(C)| ≥ 10 pp or |impact| ≥ 1 % of the
 * capital). "klar" when C's win rate lies outside the 80 % Wilson interval of G's, else "Tendenz". Ranked by |impact|.
 */
import type { EnrichedTrade } from "../types";
import { aggregate, type Agg } from "../agg";
import { leverageOverRule } from "../derive";
import { tradeTime } from "@/lib/dates";
import { pct0, r as fmtR, signed } from "@/lib/format";
import { accountOf, dayKeyOf, wilson } from "./shared";
import { snapOf } from "./signal";
import { sessionOf, type SessionKey } from "./time";

export const FINDING_MIN_N = 5;
export const FINDING_MIN_DWIN = 0.1;
export const FINDING_MIN_IMPACT_PCT = 0.01;
/** A trade entered within this many minutes after a losing trade's entry counts as a possible revenge trade. */
export const REVENGE_MINUTES = 60;
/** More trades than this on one day = overtrading day. */
export const OVERTRADING_PER_DAY = 4;

export type FindingKey =
  | "tilt"
  | "revenge"
  | "weekend"
  | `session-${Exclude<SessionKey, "weekend">}`
  | "overtrading"
  | "leverage"
  | "noStop"
  | "checklist"
  | "emotion"
  | "plan"
  | "zone"
  | "strong"
  | "short"
  | "conviction";

export interface Finding {
  key: FindingKey;
  /** plain-German headline ("Traden am Wochenende kostet dich 840 USDT") */
  title: string;
  /** numbers behind it ("31 % Win-Rate (n 12) statt 52 % · Ø −0,40 R") */
  detail: string;
  impact: number;
  tone: "win" | "loss";
  confidence: "klar" | "Tendenz";
  group: Agg;
  rest: Agg;
  trades: EnrichedTrade[];
}

interface Candidate {
  key: FindingKey;
  subject: string;
  group: EnrichedTrade[];
  rest: EnrichedTrade[];
}

const SESSION_SUBJECT: Record<Exclude<SessionKey, "weekend">, string> = {
  asia: "Die Asien-Session",
  london: "Die London-Session",
  ny: "Die New-York-Session",
  late: "Die späte Session (21–24 UTC)",
};

function split(universe: readonly EnrichedTrade[], key: FindingKey, subject: string, pred: (t: EnrichedTrade) => boolean): Candidate {
  const group: EnrichedTrade[] = [];
  const rest: EnrichedTrade[] = [];
  for (const t of universe) (pred(t) ? group : rest).push(t);
  return { key, subject, group, rest };
}

/** All candidate splits of the closed trades (time-ordered). */
export function findingCandidates(closed: readonly EnrichedTrade[]): Candidate[] {
  const sorted = [...closed].sort((a, b) => +tradeTime(a) - +tradeTime(b));
  const out: Candidate[] = [];

  // tilt: the previous two closed trades were both losses
  const tiltIds = new Set<string>();
  for (let i = 2; i < sorted.length; i++) if (sorted[i - 1]!.result === "loss" && sorted[i - 2]!.result === "loss") tiltIds.add(sorted[i]!.id);
  out.push(split(sorted.slice(2), "tilt", "Weitertraden nach 2 Verlusten in Folge", (t) => tiltIds.has(t.id)));

  // revenge: entered ≤ 60 min after a losing trade's entry
  const revengeIds = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const gap = (+tradeTime(sorted[i]!) - +tradeTime(prev)) / 60000;
    if (prev.result === "loss" && gap >= 0 && gap <= REVENGE_MINUTES) revengeIds.add(sorted[i]!.id);
  }
  out.push(split(sorted.slice(1), "revenge", `Einstiege bis ${REVENGE_MINUTES} min nach einem Verlust`, (t) => revengeIds.has(t.id)));

  out.push(split(sorted, "weekend", "Traden am Wochenende", (t) => sessionOf(tradeTime(t)) === "weekend"));
  for (const s of ["asia", "london", "ny", "late"] as const) out.push(split(sorted, `session-${s}`, SESSION_SUBJECT[s], (t) => sessionOf(tradeTime(t)) === s));

  const perDay = new Map<string, number>();
  for (const t of sorted) perDay.set(dayKeyOf(t), (perDay.get(dayKeyOf(t)) ?? 0) + 1);
  out.push(split(sorted, "overtrading", `Tage mit mehr als ${OVERTRADING_PER_DAY} Trades`, (t) => (perDay.get(dayKeyOf(t)) ?? 0) > OVERTRADING_PER_DAY));

  out.push(split(sorted, "leverage", "Hebel über der Regel", (t) => leverageOverRule(t.leverage, accountOf(t))));
  out.push(split(sorted, "noStop", "Trades ohne Stop", (t) => !(t.stop && t.stop > 0)));
  out.push(split(sorted.filter((t) => t.complete !== null), "checklist", "Lücken in der Checkliste", (t) => t.complete === false));
  out.push(split(sorted.filter((t) => !!t.emotion), "emotion", "Emotionale Einstiege (FOMO, Gierig, Revenge)", (t) => ["FOMO", "Gierig", "Revenge"].includes(t.emotion)));
  out.push(split(sorted.filter((t) => t.followedPlan !== null), "plan", "Abweichen vom Plan", (t) => t.followedPlan === false));

  const snapped = sorted.filter((t) => snapOf(t) !== null);
  out.push(split(snapped, "zone", "Einstiege in der passenden Zone (Discount / Premium)", (t) => snapOf(t)!.zoneOk));
  out.push(split(snapped, "strong", "Starke Signale (Stärke 3–4)", (t) => snapOf(t)!.strength >= 3));

  out.push(split(sorted, "short", "Short-Trades", (t) => t.side === "short"));
  out.push(split(sorted.filter((t) => t.conviction != null), "conviction", "Hohe Überzeugung (4–5)", (t) => (t.conviction ?? 0) >= 4));
  return out;
}

const abs0 = (v: number): string => signed(Math.abs(v), 0).replace("+", "");

/** Top `limit` findings of the closed trades, ranked by |impact|. */
export function findings(closed: readonly EnrichedTrade[], opts: { capital: number; currency: string; limit?: number }): Finding[] {
  const { capital, currency, limit = 3 } = opts;
  const out: Finding[] = [];
  for (const c of findingCandidates(closed)) {
    if (c.group.length < FINDING_MIN_N || c.rest.length < FINDING_MIN_N) continue;
    const g = aggregate(c.group);
    const rest = aggregate(c.rest);
    const impact = g.net - g.n * (rest.exp ?? 0);
    const dWin = (g.winRate ?? 0) - (rest.winRate ?? 0);
    const big = capital > 0 && Math.abs(impact) >= FINDING_MIN_IMPACT_PCT * capital;
    if (!(Math.abs(dWin) >= FINDING_MIN_DWIN || big) || impact === 0) continue;
    const ci = wilson(g.wins, g.n);
    const wrRest = rest.winRate ?? 0;
    const confidence = wrRest < ci.lo || wrRest > ci.hi ? "klar" : "Tendenz";
    const title = impact < 0 ? `${c.subject} kostet dich ${abs0(impact)} ${currency}` : `${c.subject} bringt dir ${signed(impact, 0)} ${currency}`;
    const detail = `${pct0(g.winRate)} Win-Rate (n ${g.n}) statt ${pct0(rest.winRate)}${g.avgR != null ? ` · Ø ${fmtR(g.avgR)}` : ""}`;
    out.push({ key: c.key, title, detail, impact, tone: impact < 0 ? "loss" : "win", confidence, group: g, rest, trades: c.group });
  }
  out.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  return out.slice(0, limit);
}

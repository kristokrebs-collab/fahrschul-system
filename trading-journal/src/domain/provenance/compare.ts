/**
 * Mensch – Regelwerk – KI (F24): do the trader's own decisions, rule-based signals and AI suggestions end differently? One
 * group per `DecisionBy` of the CLOSED trades; per group the count with a sample word, the hit rate with its 80 % Wilson
 * interval and the mean R with its 80 % t-interval; then every pair of groups: the difference of the mean R (Welch) and of
 * the hit rate (Newcombe), the verdicts corrected over ALL tests of the card (Benjamini-Hochberg). Pure, deterministic.
 *
 * What this does NOT say, and the texts never pretend:
 *   - Nobody is „better“ or „worse“ unless a difference is „klar“ (corrected p ≤ 0,10) with at least 5 trades on each side –
 *     and even then it is a statement about THESE trades (other markets, other times, other sizes), not about the helper.
 *   - A difference is an observation, never a cause: what the trader chose to take from a signal is a selection, and the
 *     groups are not run on the same candles at the same times with the same size (an experiment would be). The card shows what
 *     differs (markets, period, long share) so the reader can judge.
 *   - A trade without a known decision is not counted anywhere; the count of those is part of the result.
 */
import { aggregate } from "../agg";
import { benjaminiHochberg, CI_LEVEL, finite, meanCI, proportionDiff, significanceOf, welch, wilsonCI, type Interval, type Significance } from "../analytics/stats";
import { sampleLevel, type SampleLevel } from "../missed/balance";
import type { DecisionBy, EnrichedTrade } from "../types";
import { pct0, signed } from "@/lib/format";
import { BASIS_LABEL, DECISION_BY, DECISION_LABEL, decisionOf, type DecisionBasis } from "./decision";

/** Fewest closed trades in a group before its figures are shown (below: the count only) and before a pair is compared. */
export const MIN_GROUP_N = 5;
export const INTERVAL_PCT = Math.round(CI_LEVEL * 100);

export interface DecisionGroup {
  by: DecisionBy;
  label: string;
  n: number;
  wins: number;
  losses: number;
  be: number;
  /** n ≥ `MIN_GROUP_N`: the figures below are shown */
  enough: boolean;
  winRate: number | null;
  winCI: Interval | null;
  avgR: number | null;
  /** trades with an R (a stop) */
  rN: number;
  rCI: Interval | null;
  level: SampleLevel;
  /** where the assignments of this group come from */
  basis: Record<DecisionBasis, number>;
  /** what differs between the groups (context, not a result) */
  markets: number;
  longShare: number | null;
  first: string | null;
  last: string | null;
}

export interface PairTest {
  /** difference a − b */
  diff: number | null;
  ci: Interval | null;
  p: number | null;
  q: number | null;
  verdict: Significance;
}

export interface DecisionPair {
  a: DecisionBy;
  b: DecisionBy;
  nA: number;
  nB: number;
  /** both sides have enough trades */
  comparable: boolean;
  avgR: PairTest;
  winRate: PairTest;
  /** one sentence in German, with the sample and the interval */
  text: string;
}

export interface DecisionReport {
  groups: DecisionGroup[];
  pairs: DecisionPair[];
  /** closed trades looked at */
  closed: number;
  /** … with a known decision / without */
  assigned: number;
  unassigned: number;
  /** how many groups have enough trades for figures */
  readable: number;
  /** a pair with a „klar“ verdict exists */
  anyClear: boolean;
  /** the headline sentence: what the trades allow to say */
  headline: string;
}

const EMPTY_BASIS = (): Record<DecisionBasis, number> => ({ set: 0, plan: 0, box: 0, inbox: 0, source: 0 });

const sR = (v: number | null): string => signed(v, 2);
const pp = (v: number | null): string => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))} Pkt.`);

function groupOf(by: DecisionBy, trades: readonly EnrichedTrade[], basis: Record<DecisionBasis, number>): DecisionGroup {
  const g = aggregate(trades);
  const enough = g.n >= MIN_GROUP_N;
  const rs = finite(trades.map((t) => t.r));
  const dates = trades.map((t) => (t.date || t.createdAt || "").slice(0, 10)).filter(Boolean).sort();
  const markets = new Set(trades.map((t) => (t.pair || "").toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean));
  const longs = trades.filter((t) => t.side === "long").length;
  return {
    by,
    label: DECISION_LABEL[by],
    n: g.n,
    wins: g.wins,
    losses: g.losses,
    be: g.be,
    enough,
    winRate: enough ? g.winRate : null,
    winCI: enough ? wilsonCI(g.wins, g.n) : null,
    avgR: enough && g.rN >= 2 ? g.avgR : null,
    rN: g.rN,
    rCI: enough && g.rN >= 2 ? meanCI(rs) : null,
    level: sampleLevel(g.n),
    basis,
    markets: markets.size,
    longShare: g.n ? longs / g.n : null,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
  };
}

function pairText(a: DecisionGroup, b: DecisionGroup, avgR: PairTest, win: PairTest, comparable: boolean): string {
  const head = `${a.label} gegen ${b.label} (${a.n} / ${b.n} Trades)`;
  if (!comparable) return `${head}: zu wenig Daten – ab ${MIN_GROUP_N} Trades je Seite wird verglichen.`;
  const word = (t: PairTest): string => (t.verdict === "klar" ? "klarer Unterschied" : t.verdict === "tendenz" ? "Tendenz" : t.verdict === "wenig" ? "zu wenig Daten" : "kein Unterschied zu erkennen");
  const parts: string[] = [];
  if (avgR.diff != null && avgR.ci) parts.push(`Ø R ${sR(avgR.diff)} (${INTERVAL_PCT} %-Spanne ${sR(avgR.ci.lo)} bis ${sR(avgR.ci.hi)} R): ${word(avgR)}`);
  else parts.push("Ø R: zu wenig Trades mit Stop");
  if (win.diff != null && win.ci) parts.push(`Trefferquote ${pp(win.diff)} (${pp(win.ci.lo)} bis ${pp(win.ci.hi)}): ${word(win)}`);
  return `${head}: ${parts.join("; ")}.`;
}

/** The comparison of the closed trades by the decision behind them. `inboxLinks` = signal event id by trade id (see `inboxLinksOf`). */
export function compareDecisions(closed: readonly EnrichedTrade[], inboxLinks?: ReadonlyMap<string, string>): DecisionReport {
  const buckets: Record<DecisionBy, EnrichedTrade[]> = { own: [], rules: [], ai: [] };
  const basis: Record<DecisionBy, Record<DecisionBasis, number>> = { own: EMPTY_BASIS(), rules: EMPTY_BASIS(), ai: EMPTY_BASIS() };
  let unassigned = 0;
  for (const t of closed) {
    const d = decisionOf(t, inboxLinks);
    if (!d) {
      unassigned++;
      continue;
    }
    buckets[d.by].push(t);
    basis[d.by][d.basis]++;
  }
  const groups = DECISION_BY.map((by) => groupOf(by, buckets[by], basis[by]));
  const byKey = new Map(groups.map((g) => [g.by, g]));

  // every pair, both tests; the verdicts are corrected over all tests that could be computed
  const raw = [] as { a: DecisionGroup; b: DecisionGroup; comparable: boolean; r: { diff: number; ci: Interval; p: number } | null; w: { diff: number; ci: Interval; p: number } | null }[];
  for (let i = 0; i < DECISION_BY.length; i++) {
    for (let j = i + 1; j < DECISION_BY.length; j++) {
      const a = byKey.get(DECISION_BY[i]!)!;
      const b = byKey.get(DECISION_BY[j]!)!;
      const comparable = a.enough && b.enough;
      let r: { diff: number; ci: Interval; p: number } | null = null;
      let w: { diff: number; ci: Interval; p: number } | null = null;
      if (comparable) {
        const ra = finite(buckets[a.by].map((t) => t.r));
        const rb = finite(buckets[b.by].map((t) => t.r));
        const te = welch(ra, rb);
        if (te) r = { diff: te.diff, ci: te.ci, p: te.p };
        const pd = proportionDiff(a.wins, a.n, b.wins, b.n);
        if (pd) w = { diff: pd.diff, ci: pd.ci, p: pd.p };
      }
      raw.push({ a, b, comparable, r, w });
    }
  }
  const ps: (number | null)[] = [];
  for (const x of raw) ps.push(x.r?.p ?? null, x.w?.p ?? null);
  const fdr = benjaminiHochberg(ps);

  const pairs: DecisionPair[] = raw.map((x, k) => {
    const qR = fdr.q[2 * k] ?? null;
    const qW = fdr.q[2 * k + 1] ?? null;
    const rN = Math.min(x.a.rN, x.b.rN);
    const avgR: PairTest = { diff: x.r?.diff ?? null, ci: x.r?.ci ?? null, p: x.r?.p ?? null, q: qR, verdict: x.r ? significanceOf(x.r.p, qR, rN, MIN_GROUP_N) : "wenig" };
    const winRate: PairTest = { diff: x.w?.diff ?? null, ci: x.w?.ci ?? null, p: x.w?.p ?? null, q: qW, verdict: x.w ? significanceOf(x.w.p, qW, Math.min(x.a.n, x.b.n), MIN_GROUP_N) : "wenig" };
    return { a: x.a.by, b: x.b.by, nA: x.a.n, nB: x.b.n, comparable: x.comparable, avgR, winRate, text: pairText(x.a, x.b, avgR, winRate, x.comparable) };
  });

  const readable = groups.filter((g) => g.enough).length;
  const clear = pairs.filter((p) => p.avgR.verdict === "klar" || p.winRate.verdict === "klar");
  const anyClear = clear.length > 0;
  let headline: string;
  if (closed.length === 0) headline = "Noch keine geschlossenen Trades.";
  else if (readable < 2) headline = `Für einen Vergleich braucht es mindestens zwei Herkünfte mit je ${MIN_GROUP_N} Trades – ${readable === 0 ? "noch keine hat genug" : "erst eine hat genug"}.`;
  else if (anyClear) {
    const p = clear[0]!;
    headline = `Zwischen „${DECISION_LABEL[p.a]}“ und „${DECISION_LABEL[p.b]}“ zeigt sich in diesen Trades ein klarer Unterschied – eine Beobachtung an dieser Stichprobe, keine Ursache und kein Urteil über Regelwerk oder KI.`;
  } else headline = "In diesen Trades lässt sich kein Unterschied zwischen den Herkünften belegen – die Stichprobe trägt weder ein „besser“ noch ein „schlechter“.";

  return { groups, pairs, closed: closed.length, assigned: closed.length - unassigned, unassigned, readable, anyClear, headline };
}

/** „aus dem Handelsplan 3 · von dir gesetzt 2“ – where the assignments of a group come from; empty when there are none. */
export function basisLine(g: Pick<DecisionGroup, "basis">): string {
  return (Object.keys(BASIS_LABEL) as DecisionBasis[])
    .filter((k) => g.basis[k] > 0)
    .map((k) => `${BASIS_LABEL[k]} ${g.basis[k]}`)
    .join(" · ");
}

/** Hit rate and mean R as the card writes them: „58 % (41–73 %)“, „+0,31 R (−0,10 bis +0,72)“; „–“ when not shown. */
export function winText(g: DecisionGroup): string {
  return g.winRate == null || !g.winCI ? "–" : `${pct0(g.winRate)} (${pct0(g.winCI.lo).replace(" %", "")}–${pct0(g.winCI.hi)})`;
}
export function rText(g: DecisionGroup): string {
  return g.avgR == null || !g.rCI ? "–" : `${sR(g.avgR)} R (${sR(g.rCI.lo)} bis ${sR(g.rCI.hi)})`;
}

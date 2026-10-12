/**
 * Comparisons (P03): period vs. period, account vs. account, setup vs. setup – the same key numbers on both sides
 * (`aggregate()`), the difference A − B with an 80 % interval and a test where one exists (win rate: Newcombe /
 * two-proportion z; Ø P&L and Ø R: Welch), and an honest verdict ("klar", "Tendenz", "offen", "zu wenig").
 */
import type { EnrichedTrade } from "../types";
import { aggregate, type Agg } from "../agg";
import { accountOf } from "../insights/shared";
import { tradeTime } from "@/lib/dates";
import { finite, proportionDiff, significanceOf, welch, type Interval, type Significance } from "./stats";

export const COMPARE_MIN_N = 5;

export type CompareKey = "n" | "winRate" | "exp" | "avgR" | "pf" | "net";

export interface CompareRow {
  key: CompareKey;
  label: string;
  a: number | null;
  b: number | null;
  /** a − b */
  delta: number | null;
  ci: Interval | null;
  p: number | null;
  verdict: Significance;
  /** the side that is better on this number (null = equal / unknown) */
  better: "a" | "b" | null;
}

export interface CompareSide {
  label: string;
  trades: EnrichedTrade[];
  g: Agg;
}

export interface Comparison {
  a: CompareSide;
  b: CompareSide;
  rows: CompareRow[];
}

const LABELS: Record<CompareKey, string> = { n: "Trades", winRate: "Win-Rate", exp: "Ø P&L pro Trade", avgR: "Ø R", pf: "Profit-Faktor", net: "Netto" };

const better = (a: number | null, b: number | null): "a" | "b" | null => (a == null || b == null || a === b ? null : a > b ? "a" : "b");

/** Compares two trade sets. */
export function compareSets(a: readonly EnrichedTrade[], b: readonly EnrichedTrade[], labels: [string, string]): Comparison {
  const ga = aggregate(a);
  const gb = aggregate(b);
  const minN = Math.min(ga.n, gb.n);
  const rows: CompareRow[] = [];
  rows.push({ key: "n", label: LABELS.n, a: ga.n, b: gb.n, delta: ga.n - gb.n, ci: null, p: null, verdict: "offen", better: null });
  const wr = proportionDiff(ga.wins, ga.n, gb.wins, gb.n);
  rows.push({
    key: "winRate",
    label: LABELS.winRate,
    a: ga.winRate,
    b: gb.winRate,
    delta: wr?.diff ?? null,
    ci: minN >= COMPARE_MIN_N ? (wr?.ci ?? null) : null,
    p: wr?.p ?? null,
    verdict: significanceOf(wr?.p, null, minN, COMPARE_MIN_N),
    better: better(ga.winRate, gb.winRate),
  });
  const pa = a.map((t) => t.pnl ?? 0);
  const pb = b.map((t) => t.pnl ?? 0);
  const we = welch(pa, pb);
  rows.push({
    key: "exp",
    label: LABELS.exp,
    a: ga.exp,
    b: gb.exp,
    delta: ga.exp != null && gb.exp != null ? ga.exp - gb.exp : null,
    ci: minN >= COMPARE_MIN_N ? (we?.ci ?? null) : null,
    p: we?.p ?? null,
    verdict: significanceOf(we?.p, null, minN, COMPARE_MIN_N),
    better: better(ga.exp, gb.exp),
  });
  const ra = finite(a.map((t) => t.r));
  const rb = finite(b.map((t) => t.r));
  const wr2 = welch(ra, rb);
  const minR = Math.min(ra.length, rb.length);
  rows.push({
    key: "avgR",
    label: LABELS.avgR,
    a: ga.avgR,
    b: gb.avgR,
    delta: ga.avgR != null && gb.avgR != null ? ga.avgR - gb.avgR : null,
    ci: minR >= COMPARE_MIN_N ? (wr2?.ci ?? null) : null,
    p: wr2?.p ?? null,
    verdict: significanceOf(wr2?.p, null, minR, COMPARE_MIN_N),
    better: better(ga.avgR, gb.avgR),
  });
  const pfA = ga.pf;
  const pfB = gb.pf;
  rows.push({
    key: "pf",
    label: LABELS.pf,
    a: pfA,
    b: pfB,
    delta: pfA != null && pfB != null && Number.isFinite(pfA) && Number.isFinite(pfB) ? pfA - pfB : null,
    ci: null,
    p: null,
    verdict: minN < COMPARE_MIN_N ? "wenig" : "offen",
    better: better(pfA, pfB),
  });
  rows.push({ key: "net", label: LABELS.net, a: ga.net, b: gb.net, delta: ga.net - gb.net, ci: null, p: null, verdict: minN < COMPARE_MIN_N ? "wenig" : "offen", better: better(ga.net, gb.net) });
  return { a: { label: labels[0], trades: [...a], g: ga }, b: { label: labels[1], trades: [...b], g: gb }, rows };
}

// ── splits ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type PeriodPreset = "week" | "month" | "30d" | "90d" | "year";
export const PERIOD_LABELS: Record<PeriodPreset, string> = { week: "Woche", month: "Monat", "30d": "30 Tage", "90d": "90 Tage", year: "Jahr" };

export interface PeriodSplit {
  a: EnrichedTrade[];
  b: EnrichedTrade[];
  labels: [string, string];
  /** [from, to) of A and B (ms) */
  ranges: [[number, number], [number, number]];
}

/** Current period (A) vs. the one before (B), local time; rolling presets end at `now`. */
export function periodSplit(closed: readonly EnrichedTrade[], preset: PeriodPreset, now: number): PeriodSplit {
  const d = new Date(now);
  let aFrom: number;
  let bFrom: number;
  const aTo = now + 1;
  let labels: [string, string];
  if (preset === "week") {
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    aFrom = +s;
    bFrom = +new Date(s.getFullYear(), s.getMonth(), s.getDate() - 7);
    labels = ["Diese Woche", "Letzte Woche"];
  } else if (preset === "month") {
    aFrom = +new Date(d.getFullYear(), d.getMonth(), 1);
    bFrom = +new Date(d.getFullYear(), d.getMonth() - 1, 1);
    labels = ["Dieser Monat", "Letzter Monat"];
  } else if (preset === "year") {
    aFrom = +new Date(d.getFullYear(), 0, 1);
    bFrom = +new Date(d.getFullYear() - 1, 0, 1);
    labels = [`${d.getFullYear()}`, `${d.getFullYear() - 1}`];
  } else {
    const days = preset === "30d" ? 30 : 90;
    aFrom = now - days * 86_400_000;
    bFrom = aFrom - days * 86_400_000;
    labels = [`Letzte ${days} Tage`, `${days} Tage davor`];
  }
  const inRange = (t: EnrichedTrade, from: number, to: number) => {
    const ms = +tradeTime(t);
    return ms >= from && ms < to;
  };
  return {
    a: closed.filter((t) => inRange(t, aFrom, aTo)),
    b: closed.filter((t) => inRange(t, bFrom, aFrom)),
    labels,
    ranges: [
      [aFrom, aTo],
      [bFrom, aFrom],
    ],
  };
}

/** Makro vs. Scalp (pass ALL closed trades, not an account view). */
export function accountSplit(closed: readonly EnrichedTrade[]): { a: EnrichedTrade[]; b: EnrichedTrade[]; labels: [string, string] } {
  return { a: closed.filter((t) => accountOf(t) === "makro"), b: closed.filter((t) => accountOf(t) === "scalp"), labels: ["Makro", "Scalp"] };
}

/** Setup vs. setup (a trade with both counts on both sides). */
export function setupSplit(closed: readonly EnrichedTrade[], idA: string, idB: string, names: [string, string]): { a: EnrichedTrade[]; b: EnrichedTrade[]; labels: [string, string] } {
  return { a: closed.filter((t) => (t.setups ?? []).includes(idA)), b: closed.filter((t) => (t.setups ?? []).includes(idB)), labels: names };
}

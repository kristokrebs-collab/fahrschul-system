/**
 * "Gewinner vs. Verlierer" (Tradezella Win vs Loss report): the winners' habits next to the losers'. The three
 * comparable rows with the largest normalised difference are highlighted – that is where winners and losers differ.
 */
import type { EnrichedTrade, Setup } from "../types";
import { aggregate, type Agg } from "../agg";
import { DASH, isFin, n1, pct0, r as fmtR, signed } from "@/lib/format";
import { manualMistakes } from "./mistakes";
import { mean, mode } from "./shared";
import { snapOf } from "./signal";

export type CompareKey = "n" | "exp" | "avgR" | "conviction" | "plan" | "checklist" | "signal" | "long" | "leverage" | "emotion" | "setup" | "mistake";

export interface CompareRow {
  key: CompareKey;
  label: string;
  /** label for narrow cards */
  short: string;
  win: string;
  loss: string;
  /** numeric values for the comparison (`null` = no data / text row) */
  winV: number | null;
  lossV: number | null;
  /** normalised difference 0…1 (text rows: `TEXT_DIFF` when different, 0 when equal) */
  diff: number;
  highlight: boolean;
}

export interface WinLossReport {
  winners: Agg;
  losers: Agg;
  rows: CompareRow[];
}

const share = (list: readonly EnrichedTrade[], pred: (t: EnrichedTrade) => boolean | null): number | null => {
  let k = 0;
  let n = 0;
  for (const t of list) {
    const v = pred(t);
    if (v === null) continue;
    n++;
    if (v) k++;
  }
  return n ? k / n : null;
};

/** |a − b| relative to the larger magnitude (ratios: plain difference). */
function normDiff(a: number | null, b: number | null, ratio: boolean): number {
  if (a == null || b == null) return 0;
  if (ratio) return Math.min(1, Math.abs(a - b));
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m > 0 ? Math.min(1, Math.abs(a - b) / m) : 0;
}

/** Weight of a differing text row (most frequent emotion / setup / mistake) against numeric differences. */
export const TEXT_DIFF = 0.3;

const SHORT: Readonly<Record<CompareKey, string>> = {
  n: "Anzahl",
  exp: "Ø P&L",
  avgR: "Ø R",
  conviction: "Überzeugung",
  plan: "Plan befolgt",
  checklist: "Checkliste",
  signal: "Signal-Score",
  long: "Long",
  leverage: "Ø Hebel",
  emotion: "Gefühl",
  setup: "Grundlage",
  mistake: "Fehler",
};

/** Rows that are allowed to be highlighted (count and P&L differ by definition). */
const COMPARABLE: ReadonlySet<CompareKey> = new Set(["conviction", "plan", "checklist", "signal", "long", "leverage", "emotion", "setup", "mistake"]);

export function winnersVsLosers(closed: readonly EnrichedTrade[], setups: readonly Pick<Setup, "id" | "name">[], currency: string): WinLossReport {
  const W = closed.filter((t) => (t.pnl || 0) > 0);
  const L = closed.filter((t) => (t.pnl || 0) < 0);
  const gw = aggregate(W);
  const gl = aggregate(L);
  const setupName = new Map(setups.map((s) => [s.id, s.name]));

  const num = (key: CompareKey, label: string, f: (list: readonly EnrichedTrade[]) => number | null, show: (v: number | null) => string, ratio = false): CompareRow => {
    const a = f(W);
    const b = f(L);
    return { key, label, short: SHORT[key], win: show(a), loss: show(b), winV: a, lossV: b, diff: normDiff(a, b, ratio), highlight: false };
  };
  const txt = (key: CompareKey, label: string, f: (list: readonly EnrichedTrade[]) => string | null): CompareRow => {
    const a = f(W);
    const b = f(L);
    return { key, label, short: SHORT[key], win: a ?? DASH, loss: b ?? DASH, winV: null, lossV: null, diff: a && b && a !== b ? TEXT_DIFF : 0, highlight: false };
  };

  const rows: CompareRow[] = [
    num("n", "Anzahl", (l) => l.length, (v) => String(v ?? 0)),
    num("exp", "Ø P&L", (l) => aggregate(l).exp, (v) => (v == null ? DASH : `${signed(v, 0)} ${currency}`)),
    num("avgR", "Ø R", (l) => aggregate(l).avgR, (v) => fmtR(v)),
    num("conviction", "Ø Überzeugung", (l) => mean(l.filter((t) => t.conviction != null).map((t) => t.conviction as number)), (v) => (v == null ? DASH : `${n1(v)} / 5`)),
    num("plan", "Plan befolgt", (l) => share(l, (t) => (t.followedPlan === null ? null : t.followedPlan)), pct0, true),
    num("checklist", "Checkliste komplett", (l) => share(l, (t) => t.complete), pct0, true),
    num("signal", "Ø Signal-Score", (l) => mean(l.map(snapOf).filter((s) => s !== null).map((s) => s!.score)), (v) => (v == null ? DASH : String(Math.round(v)))),
    num("long", "Long-Anteil", (l) => share(l, (t) => t.side !== "short"), pct0, true),
    num("leverage", "Ø Hebel", (l) => mean(l.filter((t) => isFin(t.leverage) && (t.leverage as number) > 0).map((t) => t.leverage as number)), (v) => (v == null ? DASH : `${n1(v)}×`)),
    txt("emotion", "Häufigstes Gefühl", (l) => mode(l.map((t) => t.emotion || ""))),
    txt("setup", "Häufigste Grundlage", (l) => mode(l.flatMap((t) => (t.setups || []).map((id) => setupName.get(id) ?? "")))),
    txt("mistake", "Häufigster Fehler", (l) => mode(l.flatMap((t) => manualMistakes(t)))),
  ];
  // normalised difference of the scale rows (conviction 1…5, signal 0…100) on their own range
  for (const r of rows) {
    if (r.key === "conviction" && r.winV != null && r.lossV != null) r.diff = Math.min(1, Math.abs(r.winV - r.lossV) / 4);
    if (r.key === "signal" && r.winV != null && r.lossV != null) r.diff = Math.min(1, Math.abs(r.winV - r.lossV) / 100);
  }
  if (W.length && L.length) {
    const top = rows
      .filter((r) => COMPARABLE.has(r.key) && r.diff > 0)
      .sort((a, b) => b.diff - a.diff)
      .slice(0, 3);
    for (const r of top) r.highlight = true;
  }
  return { winners: gw, losers: gl, rows };
}

/**
 * Ergebnisbeleg (F57) – the reading side. PURE and alias-free (relative imports only): the public proof page, the
 * builder's preview and the tests use the very same functions.
 *
 * A proof is the COMPLETE list of the closed trades of a period (`SharedProof.trades`). Every figure below is computed
 * from that list, never stored beside it – so the headline cannot disagree with what the reader can scroll through, and
 * a loss that is in the list is in every figure. Nothing is capped or smoothed (the ranking caps R at ±10; a proof shows
 * what happened).
 */
import type { ProofBasis, ProofTrade, SharedProof } from "./contract";
import { originClassOf, type OriginClass, type OriginKind } from "./metrics";

/** Fewest scored trades before the figures are anything but a first look (the page says so below it). */
export const PROOF_MIN_SAMPLE = 30;

export interface ProofFigures {
  /** Trades in the list. */
  n: number;
  /** Trades with an R value. */
  scored: number;
  /** Closed trades the list holds without an R value (counted, not scored). */
  noR: number;
  wins: number;
  losses: number;
  flat: number;
  sumR: number;
  expectancyR: number | null;
  /** 0–100, among the scored trades. */
  winRate: number | null;
  best: number | null;
  worst: number | null;
  /** ΣR without the single best trade – what is left if the luckiest trade had not happened. */
  sumWithoutBest: number | null;
  profitFactor: number | null;
  /** Deepest drop of the running R sum (≥ 0). */
  maxDrawdownR: number;
  /** Indices into `curve` of the peak and the trough of that drop (null without a drop). */
  drawdownSpan: [number, number] | null;
  /** Longest run of losing trades in a row. */
  longestLosing: number;
  /** Running R sum: `curve[0] = 0`, then one value per scored trade. */
  curve: number[];
  costs: {
    /** Trades whose costs are known / not known. */
    known: number;
    unknown: number;
    /** Σ of the known costs in R (positive = paid). */
    sumR: number;
    avgR: number | null;
  };
  origins: Record<OriginKind, number>;
  /** The data class of the whole list. */
  dataClass: OriginClass | null;
  /** Calendar days from the first to the last entry day (0 for one day), null without trades. */
  spanDays: number | null;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number, d: number): number => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
const dayMs = (d: string): number => Date.parse(`${d}T00:00:00Z`);

/** All figures of a proof, computed from its list. */
export function proofFigures(p: Pick<SharedProof, "trades">): ProofFigures {
  const rs: number[] = [];
  const origins: Record<OriginKind, number> = { api: 0, csv: 0, manual: 0, auto: 0 };
  let costSum = 0;
  let known = 0;
  let unknown = 0;
  for (const [, r, cost, origin] of p.trades) {
    origins[origin]++;
    if (fin(r)) rs.push(r);
    if (fin(cost)) {
      known++;
      costSum += cost;
    } else unknown++;
  }
  const n = p.trades.length;
  const scored = rs.length;
  const sum = rs.reduce((a, b) => a + b, 0);
  const wins = rs.filter((r) => r > 0).length;
  const losses = rs.filter((r) => r < 0).length;
  const grossWin = rs.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const grossLoss = -rs.filter((r) => r < 0).reduce((a, b) => a + b, 0);
  const best = scored ? Math.max(...rs) : null;
  const worst = scored ? Math.min(...rs) : null;

  const curve = [0];
  let cum = 0;
  let peakAt = 0;
  let span: [number, number] | null = null;
  let dd = 0;
  for (let i = 0; i < rs.length; i++) {
    cum += rs[i]!;
    curve.push(cum);
    if (cum > curve[peakAt]!) peakAt = i + 1;
    if (curve[peakAt]! - cum > dd + 1e-12) {
      dd = curve[peakAt]! - cum;
      span = [peakAt, i + 1];
    }
  }

  let streak = 0;
  let longest = 0;
  for (const r of rs) {
    streak = r < 0 ? streak + 1 : 0;
    if (streak > longest) longest = streak;
  }

  const first = p.trades[0]?.[0];
  const last = p.trades[n - 1]?.[0];
  return {
    n,
    scored,
    noR: n - scored,
    wins,
    losses,
    flat: scored - wins - losses,
    sumR: round(sum, 2),
    expectancyR: scored ? round(sum / scored, 2) : null,
    winRate: scored ? round((wins / scored) * 100, 1) : null,
    best,
    worst,
    sumWithoutBest: scored >= 2 && best != null ? round(sum - best, 2) : null,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : null,
    maxDrawdownR: round(dd, 2),
    drawdownSpan: span,
    longestLosing: longest,
    curve,
    costs: { known, unknown, sumR: round(costSum, 2), avgR: known ? round(costSum / known, 3) : null },
    origins,
    dataClass: originClassOf(origins),
    spanDays: first && last ? Math.round((dayMs(last) - dayMs(first)) / 86_400_000) : null,
  };
}

/* ------------------------------------------------------------------ the earlier version (Fortschreibung) */

export interface ProofContinuity {
  /** Entries of the earlier version that fall into this proof's period (the ones that must still be here). */
  expected: number;
  /** Of those, found again with the same day, R, costs and origin. */
  kept: number;
  /** Entries of the earlier version that are NOT in this proof although its period covers them. */
  missing: ProofTrade[];
  /** Entries of the earlier version before this proof's start (the period begins later – not a removal). */
  outside: number;
  /** Entries that are new in this proof. */
  added: number;
  /** This proof ends before the earlier one did. */
  endsEarlier: boolean;
  /** This proof shows a selection (one Grundlage) where the earlier one showed every trade. */
  narrowed: boolean;
  /** `true` when nothing of the earlier version was taken out and neither the end nor the scope shrank. */
  intact: boolean;
}

const keyOf = (t: ProofTrade): string => `${t[0]}|${t[1] ?? "-"}|${t[2] ?? "-"}|${t[3]}`;

/**
 * Compares a proof with the earlier version it says it continues. Entries match one to one (the same day, R, costs and
 * origin); an entry of the earlier version that is missing here is a removal – unless it lies before this proof's start
 * (a shorter period is shown as such, not as a removal).
 */
export function compareProofs(prev: SharedProof, next: SharedProof): ProofContinuity {
  const have = new Map<string, number>();
  for (const t of next.trades) have.set(keyOf(t), (have.get(keyOf(t)) ?? 0) + 1);
  let expected = 0;
  let kept = 0;
  let outside = 0;
  const missing: ProofTrade[] = [];
  for (const t of prev.trades) {
    if (t[0] < next.from) {
      outside++;
      continue;
    }
    expected++;
    const k = keyOf(t);
    const left = have.get(k) ?? 0;
    if (left > 0) {
      have.set(k, left - 1);
      kept++;
    } else missing.push(t);
  }
  const added = [...have.values()].reduce((a, b) => a + b, 0);
  const endsEarlier = next.to < prev.to;
  const narrowed = prev.scope.only == null && next.scope.only != null;
  return { expected, kept, missing, outside, added, endsEarlier, narrowed, intact: missing.length === 0 && !endsEarlier && !narrowed };
}

/* ------------------------------------------------------------------ words */

export const BASIS_LABEL: Readonly<Record<ProofBasis, string>> = { live: "Echtgeld", demo: "Demo- / Papierkonto", sim: "Nachgestellt (Backtest, Replay)" };
export const BASIS_HINT: Readonly<Record<ProofBasis, string>> = {
  live: "Die Trader:in gibt an, dass diese Trades mit echtem Geld gehandelt wurden. Die App kann das nicht prüfen.",
  demo: "Die Trader:in gibt an, dass es ein Demo- oder Papierkonto war – kein echtes Geld im Spiel.",
  sim: "Nachgestellte Ergebnisse (Backtest, Replay, Übung): keine Trades am echten Markt.",
};


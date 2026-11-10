/**
 * Ergebnisbeleg (F57) – the writing side: turns the journal into a `SharedProof` on the device (nothing leaves until the
 * trader creates the link; the server re-validates the same strict schema). PURE (relative imports only).
 *
 * What goes in: EVERY closed trade whose entry day lies in the period – wins, losses, break-evens, trades without an R
 * value – in time order. The only selection the trader may make is ONE Grundlage (setup); then the proof says so and
 * names how many closed trades the period holds in all. There is no way to leave single trades out.
 *
 * Costs in R: fees and funding ÷ the risk of the trade (the distance to the stop). They are already inside the trade's R
 * when the journal derived the P&L itself; for a trade with a hand-entered P&L (`pnlManual`) the app cannot know, so its
 * costs stay `null` ("nicht bekannt") rather than a guess.
 */
import type { EnrichedTrade, Setup } from "../domain/types";
import { effectiveFees, fillStats } from "../domain/fills";
import { PROOF_MAX_DAYS, PROOF_MAX_TRADES, SharedProofSchema, proofProblem, type ProofBasis, type ProofTrade, type SharedProof } from "./contract";
import { originOf } from "./metrics";

export interface ProofOptions {
  /** The strategy's name as the trader states it (1–60 characters). */
  strategy: string;
  basis: ProofBasis;
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  to: string;
  /** Show only the trades of this Grundlage (the proof then says how many trades the period holds in all). */
  setupId?: string | null;
  /** Token of the earlier version this proof continues. */
  prev?: string | null;
}

export type ProofBuild =
  | { ok: true; payload: SharedProof }
  | { ok: false; reason: "strategy" | "range" | "empty" | "tooMany"; /** trades the period holds (for `tooMany`) */ count?: number };

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number, d: number): number => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
const dayMs = (d: string): number => Date.parse(`${d}T00:00:00Z`);

/** Costs of a trade in R, or `null` when they are not known / cannot be put on the R scale. */
export function costInR(t: Pick<EnrichedTrade, "fees" | "fundingFees" | "fills" | "pnlManual" | "risk">): number | null {
  if (fin(t.pnlManual)) return null; // a hand-entered P&L: whether it is net of costs is the trader's secret
  if (!fin(t.risk) || !(t.risk > 0)) return null;
  const feesKnown = fin(t.fees) || fillStats(t.fills ?? undefined).feesKnown;
  const fundingKnown = fin(t.fundingFees);
  if (!feesKnown && !fundingKnown) return null;
  const money = (feesKnown ? effectiveFees(t) : 0) + (fundingKnown ? (t.fundingFees as number) : 0);
  return Math.max(-100, Math.min(100, round(money / t.risk, 3)));
}

/** The trade as one list entry. */
function entryOf(t: EnrichedTrade): ProofTrade {
  return [t.date.slice(0, 10), fin(t.r) ? Math.max(-100, Math.min(100, round(t.r, 2))) : null, costInR(t), originOf(t.origin)];
}

/** Builds the proof, or says why it cannot be built. Never drops a trade to make it fit. */
export function buildProof(trades: readonly EnrichedTrade[], setups: readonly Pick<Setup, "id" | "name">[], o: ProofOptions): ProofBuild {
  const strategy = o.strategy.trim().slice(0, 60);
  if (!strategy) return { ok: false, reason: "strategy" };
  const a = dayMs(o.from);
  const b = dayMs(o.to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a > PROOF_MAX_DAYS * 86_400_000) return { ok: false, reason: "range" };

  const inPeriod = trades
    .filter((t) => t.status === "closed" && /^\d{4}-\d{2}-\d{2}/.test(t.date ?? "") && t.date.slice(0, 10) >= o.from && t.date.slice(0, 10) <= o.to)
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const setup = o.setupId ? setups.find((s) => s.id === o.setupId) : undefined;
  if (o.setupId && !setup) return { ok: false, reason: "empty" };
  const chosen = setup ? inPeriod.filter((t) => (t.setups ?? []).includes(setup.id)) : inPeriod;
  if (!chosen.length) return { ok: false, reason: "empty" };
  if (chosen.length > PROOF_MAX_TRADES) return { ok: false, reason: "tooMany", count: chosen.length };

  const payload: SharedProof = {
    v: 1,
    kind: "proof",
    strategy,
    basis: o.basis,
    from: o.from,
    to: o.to,
    scope: { only: setup ? setup.name.trim().slice(0, 40) || "Grundlage" : null, inPeriod: inPeriod.length, open: trades.filter((t) => t.status === "open").length },
    trades: chosen.map(entryOf),
    ...(o.prev ? { prev: o.prev } : {}),
  };
  // belt and braces, like the other redactions: anything the server would refuse throws here, on the device
  const parsed = SharedProofSchema.parse(payload);
  const problem = proofProblem(parsed);
  if (problem) return { ok: false, reason: "range" };
  return { ok: true, payload: parsed };
}

/** The first and last closed-trade day of the journal (for "seit dem ersten Trade"), or null. */
export function journalSpan(trades: readonly Pick<EnrichedTrade, "status" | "date">[]): { first: string; last: string } | null {
  let first = "";
  let last = "";
  for (const t of trades) {
    if (t.status !== "closed" || !/^\d{4}-\d{2}-\d{2}/.test(t.date ?? "")) continue;
    const d = t.date.slice(0, 10);
    if (!first || d < first) first = d;
    if (!last || d > last) last = d;
  }
  return first ? { first, last } : null;
}

/** `YYYY-MM-DD` of `now` minus `days` (local calendar, like the journal's dates). */
export function dayAgo(now: Date, days: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

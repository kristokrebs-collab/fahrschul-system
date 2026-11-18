/**
 * Learning from the user (pure). Two signals, both about KINDS of steps ("Schwelle verschieben", "Trend-Filter" …), never about
 * a number or a single idea:
 *
 *   – the user's decisions: a proposal that is saved or sent to the live test counts as ACCEPTED for each kind it contains, a
 *     rejected one as REJECTED;
 *   – the live check: a proposal whose live test later confirmed the expectation counts as GOOD for each of its kinds, one that
 *     stayed below it as BAD.
 *
 * Each signal is a Beta(1,1) posterior mean, (k + 1) ÷ (n + 2), so a kind without history sits at 0.5 and a few decisions move
 * it only a little. The weight of a kind in the search is  0.3 + 1.4 × mix  (mix = mean of the signals that have data; 0.5
 * without any) – between 0.3 and 1.7, so no kind ever disappears and the search keeps exploring. A proposal with several kinds
 * credits each of them (a rough attribution – the cards say so).
 */
import { MUTATION_KINDS, type MutationKind } from "./types";

export interface KindStats {
  acc: number;
  rej: number;
  good: number;
  bad: number;
}

export type LearnMap = Partial<Record<MutationKind, KindStats>>;

export const MIN_WEIGHT = 0.3;
export const MAX_WEIGHT = 1.7;

export const emptyKind = (): KindStats => ({ acc: 0, rej: 0, good: 0, bad: 0 });
const posterior = (k: number, n: number): number => (k + 1) / (n + 2);

/** Weight of a kind in the search; 1 without history. */
export function weightOf(s: KindStats | undefined): number {
  if (!s) return 1;
  const user = s.acc + s.rej;
  const live = s.good + s.bad;
  const parts: number[] = [];
  if (user > 0) parts.push(posterior(s.acc, user));
  if (live > 0) parts.push(posterior(s.good, live));
  const mix = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0.5;
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, 0.3 + 1.4 * mix));
}

export function weightsOf(map: LearnMap): Record<MutationKind, number> {
  const out = {} as Record<MutationKind, number>;
  for (const k of MUTATION_KINDS) out[k] = weightOf(map[k]);
  return out;
}

function bump(map: LearnMap, kinds: readonly MutationKind[], field: keyof KindStats): LearnMap {
  const out: LearnMap = { ...map };
  for (const k of new Set(kinds)) out[k] = { ...(out[k] ?? emptyKind()), [field]: (out[k]?.[field] ?? 0) + 1 };
  return out;
}

/** The user saved a proposal or started it as a challenger (accepted), or rejected it. */
export const recordDecision = (map: LearnMap, kinds: readonly MutationKind[], accepted: boolean): LearnMap => bump(map, kinds, accepted ? "acc" : "rej");

/** The live check confirmed (good) or did not confirm (bad) the expectation of a proposal. */
export const recordOutcome = (map: LearnMap, kinds: readonly MutationKind[], good: boolean): LearnMap => bump(map, kinds, good ? "good" : "bad");

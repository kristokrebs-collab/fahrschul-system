/**
 * "Was habe ich gelernt?" (pure): what the optimiser has learned from the user's decisions and from the live checks, as
 * numbers with their sample size – nothing is said where the sample is too small.
 *
 *   per kind of step   proposals accepted / rejected, live confirmed / below, the weight the search gives it now
 *   own proposals      share accepted; share of the live-tested proposals that were confirmed (80 % interval)
 *   prediction         how often the live test matched the expectation of the test windows, and by how many percentage
 *                      points per 30 days the result differed on average
 *
 * Everything is read from `settings.evolve` (the cumulative counters), so it does not depend on the trimmed proposal list.
 */
import { wilsonCI, type Interval } from "../analytics/stats";
import type { EvolveSettings } from "./config";
import { weightOf } from "./learn";
import { FILTER_KINDS, KIND_LABEL, MUTATION_KINDS, type MutationKind } from "./types";

/** Fewest user decisions / live verdicts before a rate is stated. */
export const MIN_DECISIONS = 5;
export const MIN_LIVE_VERDICTS = 3;
/** Fewest decisions or verdicts of one kind before a sentence about it. */
export const MIN_KIND = 3;

export interface Rate {
  k: number;
  n: number;
  p: number;
  ci: Interval;
}

export interface KindRow {
  kind: MutationKind;
  label: string;
  acc: number;
  rej: number;
  good: number;
  bad: number;
  weight: number;
  /** a sentence, or null when the sample is too small to say anything */
  note: string | null;
}

export interface LearnedSummary {
  proposed: number;
  decided: number;
  accepted: number;
  rejected: number;
  /** share of the decided proposals that were accepted; null under `MIN_DECISIONS` */
  acceptRate: Rate | null;
  /** live-tested proposals with a verdict */
  live: { n: number; confirmed: number; below: number; rate: Rate | null };
  /** prediction against outcome: average (actual − expected) in percentage points per 30 days; null without verdicts */
  match: { n: number; confirmed: number; avgDevPct: number | null };
  kinds: KindRow[];
  filters: KindRow[];
  /** earlier trials over all strategies (weighted) */
  trials: number;
  strategies: number;
  /** true when there is nothing at all to show yet */
  empty: boolean;
  notes: string[];
}

const rate = (k: number, n: number, min: number): Rate | null => (n >= min ? { k, n, p: k / n, ci: wilsonCI(k, n) } : null);
const pct = (v: number): string => `${Math.round(v * 100)} %`;

function kindNote(acc: number, rej: number, good: number, bad: number): string | null {
  const parts: string[] = [];
  if (acc + rej >= MIN_KIND) parts.push(`von ${acc + rej} Entscheidungen hast du ${acc} angenommen (${pct(acc / (acc + rej))})`);
  if (good + bad >= MIN_KIND) parts.push(`von ${good + bad} Live-Urteilen waren ${good} bestätigt (${pct(good / (good + bad))})`);
  return parts.length ? parts.join("; ") + "." : null;
}

export function learnedSummary(cfg: EvolveSettings): LearnedSummary {
  const s = cfg.stats;
  const decided = s.accepted + s.rejected;
  const verdicts = s.confirmed + s.below;
  const row = (kind: MutationKind): KindRow => {
    const k = cfg.learn[kind];
    const acc = k?.acc ?? 0;
    const rej = k?.rej ?? 0;
    const good = k?.good ?? 0;
    const bad = k?.bad ?? 0;
    return { kind, label: KIND_LABEL[kind], acc, rej, good, bad, weight: weightOf(k), note: kindNote(acc, rej, good, bad) };
  };
  const kinds = MUTATION_KINDS.map(row).filter((r) => r.acc + r.rej + r.good + r.bad > 0).sort((a, b) => b.acc + b.rej + b.good + b.bad - (a.acc + a.rej + a.good + a.bad));
  const trials = Object.values(cfg.lineages).reduce((a, l) => a + l.trials, 0);
  const notes: string[] = [];
  if (decided < MIN_DECISIONS) notes.push(`Bisher ${decided} Entscheidung${decided === 1 ? "" : "en"} – ab ${MIN_DECISIONS} nennt der Optimierer Quoten, vorher wären sie Zufall.`);
  if (verdicts < MIN_LIVE_VERDICTS) notes.push(`Bisher ${verdicts} Live-Urteil${verdicts === 1 ? "" : "e"} – ab ${MIN_LIVE_VERDICTS} steht hier, wie oft die Vorhersage stimmte.`);
  return {
    proposed: s.proposed,
    decided,
    accepted: s.accepted,
    rejected: s.rejected,
    acceptRate: rate(s.accepted, decided, MIN_DECISIONS),
    live: { n: verdicts, confirmed: s.confirmed, below: s.below, rate: rate(s.confirmed, verdicts, MIN_LIVE_VERDICTS) },
    match: { n: s.devN, confirmed: s.confirmed, avgDevPct: s.devN >= MIN_LIVE_VERDICTS ? s.devSum / s.devN : null },
    kinds,
    filters: FILTER_KINDS.map(row).filter((r) => r.acc + r.rej + r.good + r.bad > 0),
    trials,
    strategies: Object.keys(cfg.lineages).length,
    empty: !s.proposed && !decided && !verdicts && !trials,
    notes,
  };
}

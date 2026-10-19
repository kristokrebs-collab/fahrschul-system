/**
 * The training history (F38) in numbers – always with their sample size. No score, no points, nothing from P&L: three
 * facts per round (recognised the situation like the journal, kept the rules, wrote a reflection) counted over the rounds
 * that could be judged, and the plain statement when that is too little to say anything.
 */
import type { TrainingRound } from "./model";

/** Under this many judged rounds a rate is shown with "zu wenig für eine Aussage". */
export const MIN_SAMPLE = 10;

export interface TrainingStats {
  rounds: number;
  /** "Liegt mein Setup vor?" answered Ja / Nein (Unsicher is counted apart) and matched the journal's tag */
  recognition: { answered: number; hit: number; unsure: number };
  /** entries with a checklist: every rule ticked and a sane stop */
  rules: { judged: number; followed: number };
  /** rounds with a written reflection after the reveal */
  reflection: { rounds: number; done: number };
}

export function trainingStats(rounds: readonly TrainingRound[], setupId?: string | null): TrainingStats {
  const list = setupId ? rounds.filter((r) => r.setupId === setupId) : rounds;
  const s: TrainingStats = { rounds: list.length, recognition: { answered: 0, hit: 0, unsure: 0 }, rules: { judged: 0, followed: 0 }, reflection: { rounds: 0, done: 0 } };
  for (const r of list) {
    if (r.recognized === null) s.recognition.unsure++;
    else {
      s.recognition.answered++;
      if (r.recognized) s.recognition.hit++;
    }
    if (r.rules.followed !== null) {
      s.rules.judged++;
      if (r.rules.followed) s.rules.followed++;
    }
    if (r.revealedAt) {
      s.reflection.rounds++;
      if (r.reflection && r.reflection.note.trim()) s.reflection.done++;
    }
  }
  return s;
}

/** "n = 7 – zu wenig für eine Aussage (ab 10)" / "n = 14". */
export function sampleLine(n: number): string {
  return n < MIN_SAMPLE ? `n = ${n} · zu wenig für eine Aussage (ab ${MIN_SAMPLE})` : `n = ${n}`;
}

/** A rate as "7 von 9", with the percentage only from `MIN_SAMPLE` judged rounds on. */
export function rateText(hit: number, n: number): string {
  if (n === 0) return "–";
  const share = n >= MIN_SAMPLE ? ` (${Math.round((hit / n) * 100)} %)` : "";
  return `${hit} von ${n}${share}`;
}

/** One dot strip entry per round: the three marks (`null` = not judged). */
export interface RoundMarks {
  id: string;
  recognized: boolean | null;
  rules: boolean | null;
  reflected: boolean;
}

/** The newest `k` rounds, oldest first, as marks. */
export function marksOf(rounds: readonly TrainingRound[], k = 24): RoundMarks[] {
  return rounds.slice(-k).map((r) => ({ id: r.id, recognized: r.recognized, rules: r.rules.followed, reflected: !!r.reflection && !!r.reflection.note.trim() }));
}

/** The setups with rounds, most practised first. */
export function practisedSetups(rounds: readonly TrainingRound[]): { setupId: string; n: number }[] {
  const count = new Map<string, number>();
  for (const r of rounds) count.set(r.setupId, (count.get(r.setupId) ?? 0) + 1);
  return [...count.entries()].map(([setupId, n]) => ({ setupId, n })).sort((a, b) => b.n - a.n || a.setupId.localeCompare(b.setupId));
}

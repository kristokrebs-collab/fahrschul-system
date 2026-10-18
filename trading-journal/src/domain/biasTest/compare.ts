/**
 * Comparing the two answers of a bias test (F62). Plain statements, no score: one test is one observation, never a
 * verdict on the trader. The mirrored chart shows the same data upside down, so a structure that reads bullish on the
 * original should read bearish on the mirror. Whether the two answers fit together is shown as a fact – and as a possible
 * contradiction to look at, not as "you are biased".
 */
import { DIRECTION_LABEL, isRevealed, type BiasAnswer, type BiasTest, type Direction } from "./model";

/**
 * - `mirrored`     opposite directions (Long ↔ Short): the structure decided the answer.
 * - `same`         the same direction on both pictures: a contradiction worth a look.
 * - `both-neutral` Neutral twice: consistent, but says nothing about a lean.
 * - `mixed`        Neutral once, a direction once.
 */
export type Relation = "mirrored" | "same" | "both-neutral" | "mixed";

export interface Comparison {
  relation: Relation;
  /** what a consistent second answer would have been (`neutral` stays `neutral`) */
  expectedSecond: Direction;
  /** one sentence naming the relation */
  headline: string;
  /** further plain observations (German) */
  points: string[];
}

export const mirrorDirection = (d: Direction): Direction => (d === "long" ? "short" : d === "short" ? "long" : "neutral");

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

export function relationOf(first: Direction, second: Direction): Relation {
  if (first === "neutral" && second === "neutral") return "both-neutral";
  if (first === "neutral" || second === "neutral") return "mixed";
  return first === second ? "same" : "mirrored";
}

/** Facts about two answers; never a number that ranks the trader. */
export function compareAnswers(first: BiasAnswer, second: BiasAnswer): Comparison {
  const relation = relationOf(first.direction, second.direction);
  const f = DIRECTION_LABEL[first.direction];
  const s = DIRECTION_LABEL[second.direction];
  const points: string[] = [];
  let headline: string;
  switch (relation) {
    case "mirrored":
      headline = `${f} auf dem Original, ${s} auf dem gespiegelten Chart: Die beiden Antworten passen zusammen.`;
      points.push("Die Richtung folgte der sichtbaren Struktur, nicht dem Wunsch nach einer Seite.");
      break;
    case "same":
      headline = `${f} auf dem Original und ${f} auf dem gespiegelten Chart: Das ist ein Widerspruch.`;
      points.push("Der gespiegelte Chart zeigt dieselben Daten kopfüber – eine Struktur, die oben Long ist, ist gespiegelt Short.");
      points.push(`Mögliche Lesarten: Die Richtung kam eher aus einer Vorannahme als aus der Struktur – oder deine Bedingungen sind nicht richtungsabhängig (z. B. ein Ausbruch in beide Richtungen). Das entscheidest du, nicht der Test.`);
      break;
    case "both-neutral":
      headline = "Zweimal Neutral: konsistent – ein Hinweis auf eine Neigung ergibt sich daraus nicht.";
      break;
    default:
      headline = `${f} auf dem Original, ${s} auf dem gespiegelten Chart: Eine Seite hast du als unklar bewertet.`;
      points.push("Prüfe, was auf der einen Sicht gefehlt hat, damit du dich festgelegt hättest.");
  }
  if (first.invalidation && second.invalidation && norm(first.invalidation) === norm(second.invalidation)) {
    points.push("Die Invalidation lautet in beiden Antworten gleich. Auf dem gespiegelten Chart liegt sie normalerweise auf der anderen Seite.");
  }
  if (first.conditions && second.conditions && norm(first.conditions) === norm(second.conditions)) {
    points.push("Die Bedingungen sind wortgleich notiert – hast du die zweite Antwort neu gedacht oder übernommen?");
  }
  return { relation, expectedSecond: mirrorDirection(first.direction), headline, points };
}

/** Samples below this carry no pattern; the summary says so instead of showing a lean. */
export const MIN_PATTERN_N = 10;

export interface BiasSummary {
  /** finished tests */
  n: number;
  /** unfinished tests (no second answer / not uncovered) */
  open: number;
  relations: Record<Relation, number>;
  /** first answers by direction (what the trader reads on the plain chart) */
  firstBy: Record<Direction, number>;
  /** outcome recorded for how many finished tests */
  withOutcome: number;
  /** honest line for the history header (German) */
  text: string;
}

/** Counts over the history – with the sample size and the caveat, without a score. */
export function summarize(tests: readonly BiasTest[]): BiasSummary {
  const relations: Record<Relation, number> = { mirrored: 0, same: 0, "both-neutral": 0, mixed: 0 };
  const firstBy: Record<Direction, number> = { long: 0, short: 0, neutral: 0 };
  let n = 0;
  let open = 0;
  let withOutcome = 0;
  for (const t of tests) {
    if (!isRevealed(t) || !t.second) {
      open += 1;
      continue;
    }
    n += 1;
    relations[relationOf(t.first.direction, t.second.direction)] += 1;
    firstBy[t.first.direction] += 1;
    if (t.outcome) withOutcome += 1;
  }
  let text: string;
  if (n === 0) text = open ? `${open} Test${open === 1 ? "" : "s"} noch nicht abgeschlossen.` : "Noch kein abgeschlossener Test.";
  else if (n < MIN_PATTERN_N) text = `${n} abgeschlossene${n === 1 ? "r" : ""} Test${n === 1 ? "" : "s"} – zu wenig, um ein Muster zu erkennen (ab ${MIN_PATTERN_N}). Jeder Test ist eine einzelne Beobachtung, keine Diagnose.`;
  else
    text = `${n} abgeschlossene Tests: ${relations.mirrored}× gespiegelt konsistent, ${relations.same}× gleiche Richtung auf beiden Sichten, ${relations["both-neutral"]}× zweimal Neutral, ${relations.mixed}× gemischt. Eine Häufung ist ein Anlass zum Hinsehen – keine Diagnose, keine Ursache.`;
  return { n, open, relations, firstBy, withOutcome, text };
}

/**
 * Optimierungs-/Scoring-Funktion für Terminvorschläge (Spec "Optimierung:
 * score only candidates that already passed the hard rules"). Diese Datei
 * bekommt AUSSCHLIESSLICH bereits hart geprüfte Kandidaten (siehe
 * `packages/scheduling` `checkBookingConflicts`) – sie enthält keine eigene
 * Konfliktprüfung und ist absichtlich rein/DB-unabhängig, damit sie
 * unit-testbar bleibt und nie zu einer "Black Box" wird: jeder Kandidat
 * bekommt score, reasons (positive Faktoren), downsides (negative Faktoren)
 * und dataAsOf zurück.
 *
 * Die Gewichtung der 13 Kriterien ist fachlich NICHT bestätigt (analog zur
 * Prüfungsreife-Gewichtung, siehe docs/fachliche-bestaetigungen.md Punkt 5/6)
 * – als benannte, klar sichtbare Konstante hinterlegt statt versteckt im
 * Code verteilt, damit sie vor einem echten Go-Live von der Fahrschule
 * bestätigt/korrigiert werden kann.
 */

export interface MatchingCandidate {
  candidateId: string;
  fahrlehrerId: string;
  fahrzeugId: string | null;
  beginnAt: Date;
  endeAt: Date;
  /** Tage bis zum nächsten Prüfungstermin des Schülers, null = keine Prüfung anstehend. */
  tageBisPruefung: number | null;
  /** Hat dieser Fahrlehrer den Schüler zuletzt gefahren (Kontinuität)? */
  istBisherigerFahrlehrer: boolean;
  /** Deckt dieser Termin das nächste offene Lernziel des Schülers ab? */
  deckLernziel: boolean;
  /** Liegt der Termin in einer eingetragenen Schüler-Wunschzeit? */
  matchtSchuelerwunsch: boolean;
  /** Minuten Anfahrt/Rückfahrt des Fahrlehrers ohne Schüler (Leerfahrt). */
  leerfahrtMinuten: number;
  /** Liegt der Termin im selben Standort-/Ortscluster wie die vorige Fahrt? */
  standortClusterMatch: boolean;
  /** 0..1 – wie lange wartet dieser Schüler bereits relativ zu anderen (höher = fairer, weil länger nicht bevorzugt). */
  fairnessScore: number;
  /** 0..1 – 1 = optimaler Lernabstand zur letzten Fahrstunde, 0 = zu kurz/zu lang. */
  lernabstandScore: number;
  /** Ist dies ein Krebs-Flex-Slot (kurzfristiger Ausgleich)? */
  istKrebsFlex: boolean;
  /** 0..1 geschätzte Wahrscheinlichkeit, dass der Schüler das Angebot annimmt. */
  annahmewahrscheinlichkeit: number;
  /** 0..1 – Fahrzeugauslastung in der betroffenen Woche (höher = besser genutzt). */
  fahrzeugauslastung: number;
  /** Geschätzter Deckungsbeitrag in Cent für diese Einheit. */
  deckungsbeitragCent: number;
  /** Würde dieser Termin den Fahrlehrer in Überstunden bringen? */
  verursachtUeberstunden: boolean;
}

/**
 * UNBESTÄTIGTE Gewichtung (siehe Modul-Kommentar). Summe ist bewusst nicht
 * 100 – die Normalisierung erfolgt in scoreCandidate() über die tatsächliche
 * Gewichtssumme, damit einzelne Gewichte unabhängig voneinander angepasst
 * werden können.
 */
export const UNBESTAETIGT_MATCHING_WEIGHTS = {
  pruefungstermin: 20,
  fahrlehrerkontinuitaet: 10,
  lernziel: 10,
  schuelerwunsch: 10,
  leerfahrt: 8,
  standortcluster: 6,
  fairnessVerteilung: 8,
  lernabstand: 8,
  krebsFlex: 4,
  annahmewahrscheinlichkeit: 8,
  fahrzeugauslastung: 4,
  deckungsbeitrag: 8,
  ueberstundenvermeidung: 6,
} as const;

export interface ScoredCandidate {
  candidateId: string;
  score: number; // 0..100
  reasons: string[];
  downsides: string[];
  dataAsOf: Date;
}

const MAX_LEERFAHRT_MINUTEN_FUER_VOLLE_PUNKTE = 60;
const MAX_DECKUNGSBEITRAG_CENT_FUER_VOLLE_PUNKTE = 8000;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Bewertet EINEN Kandidaten, der die harten Regeln bereits bestanden hat.
 * `now` ist injizierbar für deterministische Tests.
 */
export function scoreCandidate(
  candidate: MatchingCandidate,
  weights: typeof UNBESTAETIGT_MATCHING_WEIGHTS = UNBESTAETIGT_MATCHING_WEIGHTS,
  now: Date = new Date(),
): ScoredCandidate {
  const reasons: string[] = [];
  const downsides: string[] = [];
  let weightedSum = 0;
  let weightTotal = 0;

  function add(weight: number, fraction01: number, positiveReason?: string, negativeReason?: string) {
    weightTotal += weight;
    weightedSum += weight * clamp01(fraction01);
    if (positiveReason && fraction01 >= 0.66) reasons.push(positiveReason);
    if (negativeReason && fraction01 <= 0.33) downsides.push(negativeReason);
  }

  // Prüfungstermin: je näher, desto dringender/wichtiger dieser Slot.
  if (candidate.tageBisPruefung !== null) {
    const urgency = clamp01(1 - candidate.tageBisPruefung / 30);
    add(weights.pruefungstermin, urgency, "Naher Prüfungstermin", "Kein naher Prüfungstermin");
  } else {
    weightTotal += weights.pruefungstermin * 0.5;
  }

  add(
    weights.fahrlehrerkontinuitaet,
    candidate.istBisherigerFahrlehrer ? 1 : 0,
    "Bisheriger Fahrlehrer (Kontinuität)",
    "Fahrlehrerwechsel",
  );
  add(weights.lernziel, candidate.deckLernziel ? 1 : 0, "Deckt nächstes Lernziel ab", "Deckt kein offenes Lernziel ab");
  add(
    weights.schuelerwunsch,
    candidate.matchtSchuelerwunsch ? 1 : 0,
    "Liegt in Schüler-Wunschzeit",
    "Liegt außerhalb der Wunschzeit",
  );
  add(
    weights.leerfahrt,
    1 - clamp01(candidate.leerfahrtMinuten / MAX_LEERFAHRT_MINUTEN_FUER_VOLLE_PUNKTE),
    "Geringe Leerfahrt",
    "Hohe Leerfahrtzeit",
  );
  add(weights.standortcluster, candidate.standortClusterMatch ? 1 : 0, "Passt zum Standortcluster", "Standortwechsel nötig");
  add(weights.fairnessVerteilung, candidate.fairnessScore, "Faire Verteilung", "Schüler wurde zuletzt bevorzugt");
  add(weights.lernabstand, candidate.lernabstandScore, "Guter Lernabstand", "Ungünstiger Lernabstand");
  add(weights.krebsFlex, candidate.istKrebsFlex ? 1 : 0, "Krebs-Flex-Slot", undefined);
  add(
    weights.annahmewahrscheinlichkeit,
    candidate.annahmewahrscheinlichkeit,
    "Hohe erwartete Annahmewahrscheinlichkeit",
    "Niedrige erwartete Annahmewahrscheinlichkeit",
  );
  add(weights.fahrzeugauslastung, candidate.fahrzeugauslastung, "Gute Fahrzeugauslastung", "Fahrzeug bleibt unterausgelastet");
  add(
    weights.deckungsbeitrag,
    clamp01(candidate.deckungsbeitragCent / MAX_DECKUNGSBEITRAG_CENT_FUER_VOLLE_PUNKTE),
    "Guter Deckungsbeitrag",
    "Geringer Deckungsbeitrag",
  );
  add(
    weights.ueberstundenvermeidung,
    candidate.verursachtUeberstunden ? 0 : 1,
    undefined,
    "Würde Überstunden beim Fahrlehrer verursachen",
  );

  const score = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) : 0;

  return { candidateId: candidate.candidateId, score, reasons, downsides, dataAsOf: now };
}

export interface RankedResult {
  ranked: ScoredCandidate[];
  best: ScoredCandidate | null;
  alternatives: ScoredCandidate[];
  dataAsOf: Date;
}

/**
 * Sortiert bereits hart geprüfte Kandidaten nach Score (absteigend). Gibt
 * zusätzlich `alternatives` zurück (alle außer dem Besten), damit die
 * Büro-UI nie nur EINEN Vorschlag ohne Alternativen zeigt (Spec: "Show
 * score, reasons, downsides, data-as-of, alternatives in the UI").
 */
export function rankCandidates(
  candidates: MatchingCandidate[],
  weights: typeof UNBESTAETIGT_MATCHING_WEIGHTS = UNBESTAETIGT_MATCHING_WEIGHTS,
  now: Date = new Date(),
): RankedResult {
  const scored = candidates.map((c) => scoreCandidate(c, weights, now));
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  return {
    ranked,
    best: ranked[0] ?? null,
    alternatives: ranked.slice(1),
    dataAsOf: now,
  };
}

import { describe, expect, it } from "vitest";
import { rankCandidates, scoreCandidate, type MatchingCandidate } from "../score.js";

const NOW = new Date("2026-07-23T10:00:00.000Z");

function baseCandidate(overrides: Partial<MatchingCandidate> = {}): MatchingCandidate {
  return {
    candidateId: "c1",
    fahrlehrerId: "instructor-1",
    fahrzeugId: "vehicle-1",
    beginnAt: new Date("2026-07-24T09:00:00.000Z"),
    endeAt: new Date("2026-07-24T10:00:00.000Z"),
    tageBisPruefung: null,
    istBisherigerFahrlehrer: false,
    deckLernziel: false,
    matchtSchuelerwunsch: false,
    leerfahrtMinuten: 60,
    standortClusterMatch: false,
    fairnessScore: 0.5,
    lernabstandScore: 0.5,
    istKrebsFlex: false,
    annahmewahrscheinlichkeit: 0.5,
    fahrzeugauslastung: 0.5,
    deckungsbeitragCent: 0,
    verursachtUeberstunden: false,
    ...overrides,
  };
}

describe("scoreCandidate", () => {
  it("gives a strictly higher score to a candidate that is strong on every criterion", () => {
    const weak = scoreCandidate(baseCandidate(), undefined, NOW);
    const strong = scoreCandidate(
      baseCandidate({
        tageBisPruefung: 2,
        istBisherigerFahrlehrer: true,
        deckLernziel: true,
        matchtSchuelerwunsch: true,
        leerfahrtMinuten: 0,
        standortClusterMatch: true,
        fairnessScore: 1,
        lernabstandScore: 1,
        annahmewahrscheinlichkeit: 1,
        fahrzeugauslastung: 1,
        deckungsbeitragCent: 8000,
        verursachtUeberstunden: false,
      }),
      undefined,
      NOW,
    );
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.score).toBeGreaterThanOrEqual(90);
  });

  it("lists positive factors as reasons and negative factors as downsides", () => {
    const result = scoreCandidate(
      baseCandidate({ istBisherigerFahrlehrer: true, verursachtUeberstunden: true }),
      undefined,
      NOW,
    );
    expect(result.reasons).toContain("Bisheriger Fahrlehrer (Kontinuität)");
    expect(result.downsides).toContain("Würde Überstunden beim Fahrlehrer verursachen");
  });

  it("stamps dataAsOf with the injected clock (no hidden freshness claim)", () => {
    const result = scoreCandidate(baseCandidate(), undefined, NOW);
    expect(result.dataAsOf).toEqual(NOW);
  });

  it("keeps the score within 0..100 for an all-worst-case candidate", () => {
    const result = scoreCandidate(
      baseCandidate({
        leerfahrtMinuten: 999,
        fairnessScore: 0,
        lernabstandScore: 0,
        annahmewahrscheinlichkeit: 0,
        fahrzeugauslastung: 0,
        verursachtUeberstunden: true,
      }),
      undefined,
      NOW,
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe("rankCandidates", () => {
  it("sorts candidates by score descending and returns the rest as alternatives", () => {
    const a = baseCandidate({ candidateId: "a", fairnessScore: 0.1 });
    const b = baseCandidate({ candidateId: "b", fairnessScore: 0.9, istBisherigerFahrlehrer: true });
    const result = rankCandidates([a, b], undefined, NOW);
    expect(result.best?.candidateId).toBe("b");
    expect(result.alternatives.map((c) => c.candidateId)).toEqual(["a"]);
    expect(result.ranked).toHaveLength(2);
  });

  it("returns null best and no alternatives for an empty candidate list", () => {
    const result = rankCandidates([], undefined, NOW);
    expect(result.best).toBeNull();
    expect(result.alternatives).toEqual([]);
  });
});

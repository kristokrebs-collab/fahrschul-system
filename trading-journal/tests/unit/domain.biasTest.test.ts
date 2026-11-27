/**
 * F62 bias-test records (`src/domain/biasTest`): defensive reading, versioned passthrough storage in
 * `settings.biasTests` (older data intact, unknown keys kept), the three-way merge across devices, the order guarantees
 * (a second answer only once, an outcome only after the reveal) and the plain comparison – facts, never a score.
 */
import { describe, expect, it } from "vitest";
import {
  BIAS_TESTS_MAX,
  BIAS_TESTS_VERSION,
  EMPTY_DRAFT,
  MIN_PATTERN_N,
  answerOfDraft,
  biasTestOf,
  biasTestsOf,
  compareAnswers,
  draftGaps,
  isOpen,
  isRevealed,
  mirrorDirection,
  newBiasTest,
  relationOf,
  summarize,
  withBiasPatch,
  withBiasTest,
  withOutcome,
  withSecondAnswer,
  withoutOpenBiasTest,
  type BiasAnswer,
  type BiasContext,
  type BiasTest,
  type Direction,
} from "@/domain/biasTest";
import type { Settings } from "@/domain/types";
import { DEFAULT_MIRROR_LAYERS } from "@/chart/mirror";
import { merge3 } from "@/store/merge3";

const BASE = { currency: "USDT", pair: "BTC/USDT", startDate: "2026-01-01", mistakes: [] } as unknown as Settings;
const T0 = Date.parse("2026-10-12T08:00:00Z");
const ctx: BiasContext = { surface: "markt", symbol: "BTCUSDT", interval: "4h", anchorMs: T0 - 3_600_000 };
const ans = (direction: Direction, at = T0, conditions = "Schluss über der Box", invalidation = "zurück in die Box"): BiasAnswer => ({ direction, conditions, invalidation, at: new Date(at).toISOString() });
const mk = (id: string, first: Direction, at = T0): BiasTest => newBiasTest({ id, context: ctx, blind: { hideName: true, hidePosition: false, hidePnl: false, neutralColors: true }, layers: DEFAULT_MIRROR_LAYERS, rsiMirrored: false, first: ans(first, at) });

describe("answers", () => {
  it("a draft needs a direction and conditions; long / short also an invalidation", () => {
    expect(draftGaps(EMPTY_DRAFT)).toHaveLength(2);
    expect(draftGaps({ direction: "long", conditions: "x", invalidation: "" })).toHaveLength(1);
    expect(draftGaps({ direction: "neutral", conditions: "keine klare Struktur", invalidation: "" })).toEqual([]);
    expect(draftGaps({ direction: "short", conditions: " ", invalidation: "y" })).toHaveLength(1);
  });
  it("answerOfDraft stamps the time and trims; an incomplete draft gives nothing", () => {
    expect(answerOfDraft({ direction: "long", conditions: "  A  ", invalidation: " B " }, T0)).toEqual({ direction: "long", conditions: "A", invalidation: "B", at: new Date(T0).toISOString() });
    expect(answerOfDraft({ direction: null, conditions: "A", invalidation: "B" }, T0)).toBeNull();
  });
});

describe("records", () => {
  it("newBiasTest: created at the first answer's time, version 1, no second answer, open", () => {
    const t = mk("bt_1", "long");
    expect(t.createdAt).toBe(t.first.at);
    expect(t.v).toBe(BIAS_TESTS_VERSION);
    expect(t.second).toBeUndefined();
    expect(isOpen(t)).toBe(true);
    expect(isRevealed(t)).toBe(false);
  });

  it("withSecondAnswer: once, with the reveal time; a second call is refused", () => {
    const t = mk("bt_1", "long");
    const done = withSecondAnswer(t, ans("short", T0 + 60_000))!;
    expect(done.second?.direction).toBe("short");
    expect(done.revealedAt).toBe(done.second!.at);
    expect(isRevealed(done)).toBe(true);
    expect(withSecondAnswer(done, ans("long", T0 + 120_000))).toBeNull();
    // the first answer is never touched
    expect(done.first).toEqual(t.first);
  });

  it("withOutcome only for a finished test; the trader's own words", () => {
    const t = mk("bt_1", "long");
    expect(withOutcome(t, "up", "", T0)).toBeNull();
    const done = withSecondAnswer(t, ans("short", T0 + 60_000))!;
    const o = withOutcome(done, "down", "  fiel unter die Box ", T0 + 86_400_000)!;
    expect(o.outcome).toEqual({ value: "down", note: "fiel unter die Box", at: new Date(T0 + 86_400_000).toISOString() });
  });

  it("biasTestOf reads defensively: junk is dropped, unknown keys survive, an outcome without a reveal is ignored", () => {
    expect(biasTestOf(null)).toBeNull();
    expect(biasTestOf({ id: "x" })).toBeNull();
    expect(biasTestOf({ id: "x", first: { direction: "up", at: "2026-01-01T00:00:00Z" }, context: { anchorMs: 1 } })).toBeNull();
    const raw = { ...mk("bt_9", "short"), futureField: { a: 1 }, outcome: { value: "up", note: "", at: new Date(T0).toISOString() }, layers: { boxes: false, junk: 3 } };
    const t = biasTestOf(raw)!;
    expect((t as unknown as { futureField: unknown }).futureField).toEqual({ a: 1 });
    expect(t.outcome).toBeUndefined();
    expect(t.layers.boxes).toBe(false);
    expect(t.layers.rsi).toBe(true);
    expect(t.blind.neutralColors).toBe(true);
  });
});

describe("settings.biasTests (passthrough, versioned)", () => {
  it("withBiasTest keeps every other key and unknown keys inside biasTests; replaces by id", () => {
    const s0 = { ...BASE, growth: { goals: [] }, biasTests: { v: 1, tests: [], extra: "keep" } } as unknown as Settings;
    const s1 = withBiasTest(s0, mk("bt_1", "long"));
    expect((s1 as unknown as { growth: unknown }).growth).toEqual({ goals: [] });
    expect((s1 as unknown as { biasTests: { extra: string; v: number } }).biasTests.extra).toBe("keep");
    expect((s1 as unknown as { biasTests: { v: number } }).biasTests.v).toBe(BIAS_TESTS_VERSION);
    expect(biasTestsOf(s1)).toHaveLength(1);
    const s2 = withBiasTest(s1, withSecondAnswer(mk("bt_1", "long"), ans("short", T0 + 1))!);
    expect(biasTestsOf(s2)).toHaveLength(1);
    expect(biasTestsOf(s2)[0]!.second?.direction).toBe("short");
    // the input object is never mutated
    expect(biasTestsOf(s0)).toHaveLength(0);
  });

  it("older data is intact: a journal without the key reads as no tests; a broken key too", () => {
    expect(biasTestsOf(BASE)).toEqual([]);
    expect(biasTestsOf({ biasTests: "kaputt" })).toEqual([]);
    expect(biasTestsOf({ biasTests: { tests: [1, null, { id: "z" }] } })).toEqual([]);
  });

  it("withBiasPatch merges into a stored test and leaves a missing id alone", () => {
    const s1 = withBiasTest(BASE, mk("bt_1", "long"));
    expect(withBiasPatch(s1, "nope", { x: 1 })).toBe(s1);
    const s2 = withBiasPatch(s1, "bt_1", { note: "n" });
    expect((biasTestsOf(s2)[0] as unknown as { note: string }).note).toBe("n");
  });

  it("only an unfinished test can be discarded", () => {
    const open = withBiasTest(BASE, mk("bt_1", "long"));
    expect(biasTestsOf(withoutOpenBiasTest(open, "bt_1"))).toEqual([]);
    const done = withBiasTest(open, withSecondAnswer(mk("bt_1", "long"), ans("short", T0 + 1))!);
    expect(withoutOpenBiasTest(done, "bt_1")).toBe(done);
  });

  it("keeps the most recent BIAS_TESTS_MAX; unfinished tests are never dropped", () => {
    let s = BASE;
    for (let i = 0; i < BIAS_TESTS_MAX + 5; i++) {
      const t = withSecondAnswer(mk(`bt_${i}`, "long", T0 + i * 1000), ans("short", T0 + i * 1000 + 1))!;
      s = withBiasTest(s, t);
    }
    s = withBiasTest(s, mk("bt_open", "long", T0 - 10_000));
    const ids = biasTestsOf(s).map((t) => t.id);
    expect(ids).toHaveLength(BIAS_TESTS_MAX);
    expect(ids).toContain("bt_open");
    expect(ids).not.toContain("bt_0");
  });

  it("two devices merge per id (cloud settings row / local adapter): an outcome here and a new test there both survive", () => {
    const done = withSecondAnswer(mk("bt_1", "long"), ans("short", T0 + 1))!;
    const base = withBiasTest(BASE, done);
    const mine = withBiasTest(base, withOutcome(done, "down", "", T0 + 5)!);
    const theirs = withBiasTest(base, mk("bt_2", "short", T0 + 100));
    const merged = merge3(base, mine, theirs) as Settings;
    const tests = biasTestsOf(merged);
    expect(tests.map((t) => t.id).sort()).toEqual(["bt_1", "bt_2"]);
    expect(tests.find((t) => t.id === "bt_1")?.outcome?.value).toBe("down");
  });
});

describe("compareAnswers", () => {
  it("opposite directions fit together", () => {
    const c = compareAnswers(ans("long"), ans("short"));
    expect(c.relation).toBe("mirrored");
    expect(c.headline).toContain("passen zusammen");
    expect(c.expectedSecond).toBe("short");
  });
  it("the same direction on both pictures is shown plainly as a contradiction – without blaming the trader", () => {
    const c = compareAnswers(ans("long", T0, "A", "B"), ans("long", T0 + 1, "C", "D"));
    expect(c.relation).toBe("same");
    expect(c.headline).toContain("Widerspruch");
    expect(c.points.join(" ")).toContain("entscheidest du");
    expect(JSON.stringify(c)).not.toMatch(/Score|voreingenommen|Bias-Wert/i);
  });
  it("neutral combinations", () => {
    expect(compareAnswers(ans("neutral", T0, "x", ""), ans("neutral", T0, "y", "")).relation).toBe("both-neutral");
    expect(compareAnswers(ans("neutral", T0, "x", ""), ans("short")).relation).toBe("mixed");
    expect(relationOf("short", "neutral")).toBe("mixed");
  });
  it("copied wording is pointed out as a question, not a verdict", () => {
    const c = compareAnswers(ans("long", T0, "gleich", "gleich"), ans("short", T0 + 1, "Gleich ", "GLEICH"));
    expect(c.points.length).toBe(3);
  });
  it("mirrorDirection is an involution", () => {
    for (const d of ["long", "short", "neutral"] as const) expect(mirrorDirection(mirrorDirection(d))).toBe(d);
  });
});

describe("summarize", () => {
  const finished = (i: number, a: Direction, b: Direction): BiasTest => withSecondAnswer(mk(`bt_${i}`, a, T0 + i * 1000), ans(b, T0 + i * 1000 + 1))!;
  it("says plainly when there is nothing or too little", () => {
    expect(summarize([]).text).toBe("Noch kein abgeschlossener Test.");
    expect(summarize([mk("o", "long")]).text).toContain("noch nicht abgeschlossen");
    const few = summarize([finished(1, "long", "long"), finished(2, "long", "short")]);
    expect(few.n).toBe(2);
    expect(few.text).toContain("zu wenig");
    expect(few.text).toContain(`ab ${MIN_PATTERN_N}`);
  });
  it("counts at the minimum sample, with the caveat and no score", () => {
    const list = Array.from({ length: MIN_PATTERN_N }, (_, i) => finished(i, "long", i % 2 ? "short" : "long"));
    const s = summarize(list);
    expect(s.n).toBe(MIN_PATTERN_N);
    expect(s.relations.same).toBe(5);
    expect(s.relations.mirrored).toBe(5);
    expect(s.firstBy.long).toBe(MIN_PATTERN_N);
    expect(s.text).toContain("keine Diagnose");
  });
});

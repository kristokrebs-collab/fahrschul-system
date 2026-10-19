/**
 * F38 Lernmodus (`src/domain/training`): the stored rounds (passthrough key, per-id merge), the decision rules (gaps,
 * stop, checklist), the cases (no candle from the entry on is ever visible; a deterministic queue) and the history
 * numbers with their sample size. Nothing here may depend on the profit of a case.
 */
import { describe, expect, it } from "vitest";
import { merge3 } from "@/store/merge3";
import type { Settings, Trade } from "@/domain/types";
import {
  buildQueue,
  carriesSetup,
  caseEligible,
  caseInterval,
  caseWindow,
  decisionAt,
  decisionGaps,
  decisionOfDraft,
  EMPTY_DECISION,
  LOOKBACK_BARS,
  marksOf,
  MIN_SAMPLE,
  MIN_VISIBLE_BARS,
  planOutcome,
  poolOf,
  practisedSetups,
  prng,
  rateText,
  ruleResult,
  sampleLine,
  stopCheck,
  trainingRoundOf,
  trainingRoundsOf,
  trainingStats,
  visibleBars,
  withoutRound,
  withReflection,
  withReveal,
  withRoundPatch,
  withTrainingRound,
  TRAINING_MAX,
  type DecisionDraft,
  type TrainingRound,
} from "@/domain/training";

const STEP = 3_600_000;
const T0 = Date.UTC(2026, 5, 1);
const settings = (extra: Record<string, unknown> = {}): Settings => ({ currency: "€", setups: [], rules: [], ...extra }) as unknown as Settings;

function bars(n: number, up = 0.1): { time: number; open: number; high: number; low: number; close: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + i * up;
    return { time: T0 + i * STEP, open: base, high: base + 0.5, low: base - 0.5, close: base + 0.05 };
  });
}

const trade = (id: string, setups: string[], over: Partial<Trade> = {}): Trade =>
  ({ id, side: "long", status: "closed", date: "2026-06-02T10:00", exitDate: "2026-06-02T14:00", pair: "BTC/USDT", timeframe: "1h", entry: 100, stop: 99, target: null, exit: 101, size: 100, leverage: 1, fees: 0, pnlManual: null, setups, checks: {}, conviction: null, followedPlan: null, emotion: "", reason: "", notes: "", chart: "", pnl: 10, r: 1, createdAt: "2026-06-02T10:00:00Z", updatedAt: "2026-06-02T10:00:00Z", ...over }) as Trade;

function round(id: string, over: Partial<TrainingRound> = {}): TrainingRound {
  const at = "2026-06-10T10:00:00.000Z";
  return {
    id,
    v: 1,
    createdAt: at,
    updatedAt: at,
    setupId: "s1",
    tradeId: "t1",
    positive: true,
    interval: "1h",
    anchorMs: T0,
    blind: true,
    decision: { action: "long", recognition: "yes", stop: 99, reason: "Retest hält", checks: { "s1:c1": true }, at },
    rules: { checked: 1, total: 1, stopOk: true, followed: true },
    recognized: true,
    ...over,
  };
}

describe("stored rounds", () => {
  it("reads a round, recomputes `recognized` from the decision and the journal's tag (never trusts a stored verdict)", () => {
    const r = trainingRoundOf({ ...round("a"), recognized: false });
    expect(r?.recognized).toBe(true);
    expect(trainingRoundOf({ ...round("a"), positive: false })?.recognized).toBe(false);
    const unsure = round("b");
    unsure.decision = { ...unsure.decision, recognition: "unsure" };
    expect(trainingRoundOf(unsure)?.recognized).toBeNull();
    const no = round("c", { positive: false });
    no.decision = { ...no.decision, recognition: "no" };
    expect(trainingRoundOf(no)?.recognized).toBe(true);
  });

  it("drops what cannot be read and keeps unknown keys; a stop on a 'wait' decision is dropped", () => {
    expect(trainingRoundOf(null)).toBeNull();
    expect(trainingRoundOf({ id: "x" })).toBeNull();
    expect(trainingRoundOf({ ...round("x"), tradeId: "" })).toBeNull();
    expect(trainingRoundOf({ ...round("x"), anchorMs: "no" })).toBeNull();
    const kept = trainingRoundOf({ ...round("k"), future: "keep me", decision: { ...round("k").decision, extra: 1, action: "wait", stop: 99 } });
    expect((kept as unknown as { future: string }).future).toBe("keep me");
    expect((kept!.decision as unknown as { extra: number }).extra).toBe(1);
    expect(kept!.decision.stop).toBeNull();
  });

  it("a reflection without a reveal is ignored", () => {
    const withRef = { ...round("r"), reflection: { verdict: "surprised", note: "x", at: "2026-06-10T11:00:00.000Z" } };
    expect(trainingRoundOf(withRef)?.reflection).toBeUndefined();
    expect(trainingRoundOf({ ...withRef, revealedAt: "2026-06-10T10:30:00.000Z" })?.reflection?.verdict).toBe("surprised");
  });

  it("writes a NEW settings object, keeps every other key and the unknown keys inside `training`", () => {
    const s0 = settings({ other: { a: 1 }, training: { v: 1, rounds: [], note: "mine" } });
    const frozen = JSON.stringify(s0);
    const s1 = withTrainingRound(s0, round("a"));
    expect(JSON.stringify(s0)).toBe(frozen);
    expect((s1 as unknown as { other: unknown }).other).toEqual({ a: 1 });
    expect((s1 as unknown as { training: { note: string } }).training.note).toBe("mine");
    expect(trainingRoundsOf(s1).map((r) => r.id)).toEqual(["a"]);
    // replacing merges, so unknown keys of the stored round survive
    const withUnknown = withRoundPatch(s1, "a", { custom: 7 });
    const again = withTrainingRound(withUnknown, round("a", { blind: false }));
    const raw = (again as unknown as { training: { rounds: Record<string, unknown>[] } }).training.rounds[0]!;
    expect(raw.custom).toBe(7);
    expect(raw.blind).toBe(false);
  });

  it("reads nothing from a journal without the key or with a broken one", () => {
    expect(trainingRoundsOf(settings())).toEqual([]);
    expect(trainingRoundsOf(settings({ training: "x" }))).toEqual([]);
    expect(trainingRoundsOf(settings({ training: { rounds: [1, null, { id: 3 }] } }))).toEqual([]);
  });

  it("the reveal is stamped once; a reflection needs the reveal and keeps the first reveal time", () => {
    let s = withTrainingRound(settings(), round("a"));
    expect(withReflection(s, "a", "surprised", "zu früh", 1)).toBe(s);
    s = withReveal(s, "a", Date.parse("2026-06-10T10:05:00Z"));
    const first = trainingRoundsOf(s)[0]!.revealedAt;
    expect(first).toBe("2026-06-10T10:05:00.000Z");
    expect(withReveal(s, "a", Date.parse("2026-06-11T10:05:00Z"))).toBe(s);
    s = withReflection(s, "a", "surprised", "  zu früh eingestiegen  ", Date.parse("2026-06-10T10:09:00Z"));
    const r = trainingRoundsOf(s)[0]!;
    expect(r.reflection).toMatchObject({ verdict: "surprised", note: "zu früh eingestiegen" });
    expect(r.revealedAt).toBe(first);
    expect(withReveal(settings(), "missing", 1)).toEqual(settings());
  });

  it("removes a round, caps the list, and merges two devices per id (cloud / local adapter)", () => {
    let s = withTrainingRound(settings(), round("a"));
    s = withTrainingRound(s, round("b", { createdAt: "2026-06-11T10:00:00.000Z" }));
    expect(trainingRoundsOf(withoutRound(s, "a")).map((r) => r.id)).toEqual(["b"]);
    expect(withoutRound(s, "zzz")).toBe(s);

    let big = settings();
    for (let i = 0; i < TRAINING_MAX + 3; i++) big = withTrainingRound(big, round(`r${i}`, { createdAt: new Date(T0 + i * 1000).toISOString() }));
    const kept = trainingRoundsOf(big);
    expect(kept).toHaveLength(TRAINING_MAX);
    expect(kept[0]!.id).toBe("r3");

    const base = withTrainingRound(settings(), round("a"));
    const mine = withReveal(base, "a", Date.parse("2026-06-10T10:05:00Z"));
    const theirs = withTrainingRound(base, round("b", { createdAt: "2026-06-12T10:00:00.000Z" }));
    const merged = merge3(base, mine, theirs) as Settings;
    const rounds = trainingRoundsOf(merged);
    expect(rounds.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rounds[0]!.revealedAt).toBeTruthy();
  });
});

describe("decision rules", () => {
  const items = [
    { id: "g:1", text: "Stopp gesetzt" },
    { id: "s1:c1", text: "Retest hält" },
  ];
  const draft = (over: Partial<DecisionDraft>): DecisionDraft => ({ ...EMPTY_DECISION, checks: {}, ...over });

  it("lists what is missing, in German, until the decision is complete", () => {
    expect(decisionGaps(draft({}), 100)).toHaveLength(3);
    expect(decisionGaps(draft({ recognition: "yes", action: "wait", reason: "kein Retest" }), 100)).toEqual([]);
    expect(decisionGaps(draft({ recognition: "yes", action: "long", reason: "x", stop: "" }), 100)[0]).toContain("Stopp-Kurs");
    expect(decisionGaps(draft({ recognition: "yes", action: "long", reason: "  ", stop: "99" }), 100)).toEqual(["Begründung notieren – in einem Satz."]);
  });

  it("checks the stop against the last close: side, floor, German decimal comma", () => {
    expect(stopCheck("long", "99,5", 100)).toMatchObject({ ok: true, stop: 99.5 });
    expect(stopCheck("long", "101", 100).why).toContain("unter den Kurs");
    expect(stopCheck("short", "99", 100).why).toContain("über den Kurs");
    expect(stopCheck("long", "99.99", 100).why).toContain("praktisch auf dem Kurs");
    expect(stopCheck("long", "abc", 100).ok).toBe(false);
    expect(stopCheck("wait", "", 100)).toEqual({ ok: true, stop: null, why: null });
  });

  it("an entry follows the rules only with EVERY item ticked and a sane stop; waiting is never judged", () => {
    const all = { "g:1": true, "s1:c1": true };
    expect(ruleResult("long", "99", 100, items, all)).toMatchObject({ checked: 2, total: 2, stopOk: true, followed: true, gaps: [] });
    const gap = ruleResult("long", "99", 100, items, { "g:1": true });
    expect(gap.followed).toBe(false);
    expect(gap.gaps).toEqual(["Einstieg trotz offener Regel: Retest hält"]);
    expect(ruleResult("long", "101", 100, items, all)).toMatchObject({ stopOk: false, followed: false });
    expect(ruleResult("wait", "", 100, items, {})).toMatchObject({ followed: null, stopOk: null });
    expect(ruleResult("wait", "", 100, items, all).gaps[0]).toContain("kein Regelverstoß");
    expect(ruleResult("short", "101", 100, [], {})).toMatchObject({ total: 0, followed: null, stopOk: true });
  });

  it("builds the decision to store with the time, only ticked rules, and no stop when waiting", () => {
    const now = Date.parse("2026-06-10T10:00:00Z");
    const d = decisionOfDraft(draft({ recognition: "yes", action: "long", stop: "99,5", reason: " Retest ", checks: { "g:1": true, "s1:c1": false } }), 100, now)!;
    expect(d).toEqual({ action: "long", recognition: "yes", stop: 99.5, reason: "Retest", checks: { "g:1": true }, at: "2026-06-10T10:00:00.000Z" });
    expect(decisionOfDraft(draft({ recognition: "unsure", action: "wait", stop: "50", reason: "r" }), 100, now)!.stop).toBeNull();
    expect(decisionOfDraft(draft({ action: "long" }), 100, now)).toBeNull();
  });
});

describe("cases", () => {
  it("the picture ends at the last candle that closed before the entry – no candle from the entry on is visible", () => {
    const b = bars(200);
    const entryMs = b[120]!.time + 10 * 60_000; // inside candle 120
    const d = decisionAt(b, entryMs, STEP)!;
    expect(d.entryIdx).toBe(120);
    expect(d.visible).toBe(120);
    expect(d.anchorMs).toBe(b[119]!.time);
    const shown = visibleBars(b, d);
    expect(shown).toHaveLength(LOOKBACK_BARS);
    expect(Math.max(...shown.map((x) => x.time))).toBe(b[119]!.time);
    expect(shown.every((x) => x.time + STEP <= entryMs)).toBe(true);
    // an entry exactly at a candle's open: the candle before is the last one seen
    expect(decisionAt(b, b[130]!.time, STEP)!.anchorMs).toBe(b[129]!.time);
  });

  it("too little history, or an entry outside the candles, is no case", () => {
    const b = bars(200);
    expect(decisionAt(b, b[MIN_VISIBLE_BARS - 1]!.time + 1, STEP)).toBeNull();
    expect(decisionAt(b, b[MIN_VISIBLE_BARS]!.time + 1, STEP)).not.toBeNull();
    expect(decisionAt(b, T0 - STEP, STEP)).toBeNull();
    expect(decisionAt(b, T0 + 500 * STEP, STEP)).toBeNull();
  });

  it("window, interval and eligibility", () => {
    const t = trade("a", []);
    const w = caseWindow(t, "1h", Date.UTC(2026, 11, 1));
    expect(w.from).toBeLessThan(new Date(t.date).getTime() - LOOKBACK_BARS * STEP);
    expect(w.to).toBeGreaterThan(new Date(t.exitDate!).getTime());
    expect(caseWindow(t, "1h", new Date(t.date).getTime() + 1000).to).toBe(new Date(t.date).getTime() + 1000); // never into the future
    expect(caseInterval(trade("a", [], { timeframe: "4h" }))).toBe("4h");
    expect(caseInterval(trade("a", [], { timeframe: "3D" }))).toBe("15m");
    expect(caseEligible(t)).toBe(true);
    expect(caseEligible(trade("a", [], { status: "open" }))).toBe(false);
    expect(caseEligible(trade("a", [], { entry: null }))).toBe(false);
    expect(carriesSetup(trade("a", ["s1"]), "s1")).toBe(true);
  });

  it("the plan is replayed AFTER the reveal on the real candles from the next open, with the trader's stop", () => {
    const b = bars(200, 0.1);
    const d = decisionAt(b, b[120]!.time + 60_000, STEP)!;
    const long = planOutcome("long", b[120]!.open - 1, b, d, STEP, b[130]!.time + 60_000)!;
    expect(long.status).toBe("ok");
    expect(long.exitReason).toBe("end");
    expect(long.r!).toBeGreaterThan(0);
    const short = planOutcome("short", b[120]!.open + 0.2, b, d, STEP, null)!;
    expect(short.exitReason).toBe("stop"); // a rising market runs through the short's stop
    expect(planOutcome("long", 1, [], d, STEP, null)).toBeNull();
  });
});

describe("session queue", () => {
  const trades = [
    ...Array.from({ length: 6 }, (_, i) => trade(`p${i}`, ["s1"])),
    ...Array.from({ length: 5 }, (_, i) => trade(`n${i}`, ["s2"])),
    trade("open", ["s1"], { status: "open" }),
  ];

  it("mixes two thirds situations of the setup with others, is deterministic for a seed and ignores open trades", () => {
    const q = buildQueue({ trades, setupId: "s1", rounds: [], seed: 7 });
    expect(q).toHaveLength(6);
    expect(q.filter((c) => c.positive)).toHaveLength(4);
    expect(q.some((c) => c.tradeId === "open")).toBe(false);
    expect(buildQueue({ trades, setupId: "s1", rounds: [], seed: 7 })).toEqual(q);
    expect(buildQueue({ trades, setupId: "s1", rounds: [], seed: 8 })).not.toEqual(q);
    for (const c of q) expect(c.positive).toBe(carriesSetup(trades.find((t) => t.id === c.tradeId)!, "s1"));
  });

  it("only the setup's own situations when the journal has no others; an empty queue without any", () => {
    expect(buildQueue({ trades: trades.filter((t) => t.setups.includes("s1")), setupId: "s1", rounds: [], seed: 1 }).every((c) => c.positive)).toBe(true);
    expect(buildQueue({ trades: [], setupId: "s1", rounds: [], seed: 1 })).toEqual([]);
    expect(poolOf(trades, "s1")).toEqual({ positive: 6, other: 5 });
  });

  it("cases not practised yet come before those practised, and a given trade leads", () => {
    const rounds = ["p0", "p1", "p2", "p3"].map((id, i) => round(`r${i}`, { tradeId: id, createdAt: new Date(T0 + i * 1000).toISOString() }));
    const q = buildQueue({ trades: trades.filter((t) => t.setups.includes("s1")), setupId: "s1", rounds, seed: 3, size: 4 });
    // the two never practised and the two practised longest ago
    expect(q.map((c) => c.tradeId).sort()).toEqual(["p0", "p1", "p4", "p5"]);
    const led = buildQueue({ trades, setupId: "s1", rounds, seed: 3, firstTradeId: "n2" });
    expect(led[0]).toEqual({ tradeId: "n2", positive: false });
    expect(new Set(led.map((c) => c.tradeId)).size).toBe(led.length);
    expect(buildQueue({ trades, setupId: "s1", rounds, seed: 3, firstTradeId: "open" })[0]!.tradeId).not.toBe("open");
  });

  it("the seeded generator repeats and stays in [0, 1)", () => {
    const a = prng(5);
    const b = prng(5);
    for (let i = 0; i < 20; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("history numbers", () => {
  it("counts recognition, rules and reflection with their own denominators – profit never enters", () => {
    const rs: TrainingRound[] = [
      round("1"),
      round("2", { positive: false }), // said yes, journal says no → miss
      round("3", { rules: { checked: 1, total: 2, stopOk: true, followed: false } }),
      round("4", { rules: { checked: 0, total: 0, stopOk: null, followed: null } }),
      { ...round("5"), decision: { ...round("5").decision, recognition: "unsure" } , recognized: null, revealedAt: "2026-06-10T10:30:00.000Z", reflection: { verdict: "surprised", note: "zu früh", at: "2026-06-10T10:31:00.000Z" } },
      round("6", { setupId: "s2" }),
    ];
    const read = rs.map((r) => trainingRoundOf(r)!);
    const all = trainingStats(read);
    expect(all.rounds).toBe(6);
    expect(all.recognition).toEqual({ answered: 5, hit: 4, unsure: 1 });
    expect(all.rules).toEqual({ judged: 5, followed: 4 });
    expect(all.reflection).toEqual({ rounds: 1, done: 1 });
    expect(trainingStats(read, "s2").rounds).toBe(1);
    expect(trainingStats(read, "none").rounds).toBe(0);
  });

  it("states the sample honestly", () => {
    expect(sampleLine(3)).toContain("zu wenig für eine Aussage");
    expect(sampleLine(MIN_SAMPLE)).toBe("n = 10");
    expect(rateText(0, 0)).toBe("–");
    expect(rateText(3, 4)).toBe("3 von 4");
    expect(rateText(8, 10)).toBe("8 von 10 (80 %)");
  });

  it("marks per round and the practised setups", () => {
    const read = [round("a"), round("b", { setupId: "s2" }), round("c", { setupId: "s2" })].map((r) => trainingRoundOf(r)!);
    expect(marksOf(read, 2).map((m) => m.id)).toEqual(["b", "c"]);
    expect(marksOf(read)[0]).toEqual({ id: "a", recognized: true, rules: true, reflected: false });
    expect(practisedSetups(read)).toEqual([
      { setupId: "s2", n: 2 },
      { setupId: "s1", n: 1 },
    ]);
  });
});

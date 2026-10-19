import { describe, expect, it } from "vitest";
import { DEFAULT_MARKET } from "@/domain/defaults";
import { scenario } from "@/domain/trigger";
import { blankKeyLevel, buildDayPlan, evaluateLevel, legacyKeyLevels, KEY_TF_MS, planChange, resolveConflict, type EvalCandle, type KeyLevel, type LevelEntry, type PlanMemory, type Precedence } from "@/domain/keylevels";

const H4 = KEY_TF_MS["4h"];
const D1 = KEY_TF_MS["1D"];
const T0 = Date.UTC(2026, 9, 1);

const candle = (t: number, ms: number, c: number, closed = true): EvalCandle => ({ time: t, open: c, high: c + 1, low: c - 1, close: c, closed, closeTime: t + ms - 1 });
/** Entries for levels, each judged on its own timeframe's last closed close. */
function entries(levels: KeyLevel[], closeByTf: Partial<Record<KeyLevel["tf"], number>>): LevelEntry[] {
  const now = T0 + 10 * D1 + 60_000;
  return levels.map((level) => {
    const ms = KEY_TF_MS[level.tf];
    const c = closeByTf[level.tf];
    const open = Math.floor(now / ms) * ms;
    const candles = c == null ? [] : [candle(open - ms, ms, c), candle(open, ms, c, false)];
    return { level, evaluation: evaluateLevel(level, candles, now) };
  });
}
const L = (over: Partial<KeyLevel> & { id: string; price: number }): KeyLevel => blankKeyLevel({ symbol: "BTCUSDT", name: over.id, since: null, ...over }, 0);

describe("buildDayPlan – the five fixed levels give scenario()'s plan", () => {
  const fixed = legacyKeyLevels(DEFAULT_MARKET);
  it.each([70_000, 75_499, 75_500, 84_499, 84_500, 85_000, 85_900, 85_901])("close4h %s", (close) => {
    const plan = buildDayPlan({ entries: entries(fixed, { "4h": close, "1W": 90_000 }), precedence: "higher" });
    const s = scenario(close, DEFAULT_MARKET)!.key;
    expect(plan.active).toBe(s === "bear" ? "short" : s);
    expect(plan.scenarios.map((x) => x.key)).toEqual(["range", "long", "short", "wait"]);
    expect(plan.scenarios.filter((x) => x.state === "active")).toHaveLength(1);
  });
  it("names the hard invalidation in the headline and carries the invalidation text", () => {
    const plan = buildDayPlan({ entries: entries(fixed, { "4h": 70_000 }), precedence: "higher" });
    expect(plan.headline).toContain("harte Invalidierung");
    const long = plan.scenarios.find((x) => x.key === "long")!;
    expect(long.trigger).toBe("4H-Schluss über 85.900");
    expect(long.invalidation).toBe("4H-Schluss unter 85.300");
    expect(plan.scenarios.find((x) => x.key === "short")!.invalidation).toBe("4H-Schluss über 85.300");
  });
});

describe("buildDayPlan – range, long, short, wait from own levels", () => {
  const lv = [
    L({ id: "lo", price: 80_000, direction: "below", tf: "4h", name: "Unter 80k" }),
    L({ id: "hi", price: 90_000, direction: "above", tf: "4h", name: "Über 90k" }),
  ];
  it("range while neither fired, with trigger, invalidation and the line that changes the plan", () => {
    const plan = buildDayPlan({ entries: entries(lv, { "4h": 85_000 }), precedence: "higher" });
    expect(plan.active).toBe("range");
    const range = plan.scenarios[0]!;
    expect(range.trigger).toContain("80.000");
    expect(range.trigger).toContain("90.000");
    expect(range.changes).toBe("Ein Schluss über 90.000 macht daraus Long, unter 80.000 Short.");
    expect(plan.scenarios[1]!.changes).toContain("Wird aktiv bei: 4H-Schluss über 90.000");
  });
  it("long when the long trigger closed", () => {
    const plan = buildDayPlan({ entries: entries(lv, { "4h": 91_000 }), precedence: "higher" });
    expect(plan.active).toBe("long");
    expect(plan.decidedBy).toBe("hi");
    expect(plan.scenarios[1]!.changes).toBe("Long ist vorbei bei: 4H-Schluss zurück unter 90.000.");
  });
  it("short when the short trigger closed; own invalidation beats the default", () => {
    const withInv = [lv[0]!, L({ id: "hi", price: 90_000, direction: "above", invalidation: 88_000 })];
    expect(buildDayPlan({ entries: entries(withInv, { "4h": 79_000 }), precedence: "higher" }).active).toBe("short");
    expect(buildDayPlan({ entries: entries(withInv, { "4h": 85_000 }), precedence: "higher" }).scenarios[1]!.invalidation).toBe("4H-Schluss unter 88.000");
  });
  it("a stop level is used as the invalidation of the trigger above it", () => {
    const withStop = [...lv, L({ id: "stop", price: 87_500, direction: "below", role: "stop", name: "Stützung" })];
    const long = buildDayPlan({ entries: entries(withStop, { "4h": 85_000 }), precedence: "higher" }).scenarios[1]!;
    expect(long.invalidation).toBe("4H-Schluss unter 87.500 (Stützung)");
  });
  it("only one side defined, or none: wait – never an invented range", () => {
    expect(buildDayPlan({ entries: entries([lv[1]!], { "4h": 85_000 }), precedence: "higher" })).toMatchObject({ active: "wait", reason: "none" });
    expect(buildDayPlan({ entries: [], precedence: "higher" })).toMatchObject({ active: "wait", reason: "none" });
  });
  it("no candles for the trigger timeframes: wait because of missing data, nothing confirmed", () => {
    const plan = buildDayPlan({ entries: entries(lv, {}), precedence: "higher" });
    expect(plan).toMatchObject({ active: "wait", reason: "data" });
    expect(plan.headline).toBe("Abwarten – Daten fehlen");
  });
  it("disabled and info levels are not part of the plan", () => {
    const off = [{ ...lv[1]!, enabled: false }, lv[0]!];
    expect(buildDayPlan({ entries: entries(off, { "4h": 95_000 }), precedence: "higher" }).active).toBe("wait");
    const info = [lv[0]!, L({ id: "hi", price: 90_000, direction: "above", role: "info" })];
    expect(buildDayPlan({ entries: entries(info, { "4h": 95_000 }), precedence: "higher" }).active).toBe("wait");
  });
  it("a running-break level that is only provisional arms its scenario but never activates it", () => {
    const run = [lv[0]!, L({ id: "hi", price: 90_000, direction: "above", kind: "running" })];
    const now = T0 + 10 * H4 + 60_000;
    const open = Math.floor(now / H4) * H4;
    const candles = [candle(open - H4, H4, 85_000), candle(open, H4, 90_500, false)];
    const es = run.map((level) => ({ level, evaluation: evaluateLevel(level, candles, now) }));
    const plan = buildDayPlan({ entries: es, precedence: "higher" });
    expect(plan.active).toBe("range");
    const long = plan.scenarios[1]!;
    expect(long.state).toBe("armed");
    expect(long.trigger).toContain("vorläufig");
  });
});

describe("buildDayPlan – timeframes disagree: the precedence decides", () => {
  const long1d = L({ id: "l1d", price: 80_000, direction: "above", tf: "1D", priority: 5 });
  const short1h = L({ id: "s1h", price: 90_000, direction: "below", tf: "1h", priority: 1 });
  // 1D closed above 80k (long fired), 1h closed below 90k (short fired)
  const es = (): LevelEntry[] => entries([long1d, short1h], { "1D": 85_000, "1h": 85_000 });
  const cases: [Precedence, string, string | null][] = [
    ["higher", "long", "l1d"],
    ["lower", "short", "s1h"],
    ["priority", "short", "s1h"],
    ["wait", "wait", null],
  ];
  it.each(cases)("%s → %s", (precedence, active, by) => {
    const plan = buildDayPlan({ entries: es(), precedence });
    expect(plan.active).toBe(active);
    expect(plan.decidedBy).toBe(by);
    expect(plan.precedenceNote).toBeTruthy();
    if (active === "wait") expect(plan.reason).toBe("conflict");
    else expect(plan.scenarios.find((s) => s.key === (active === "long" ? "short" : "long"))!.state).toBe("blocked");
  });
  it("a tie waits (same timeframe or same priority)", () => {
    const a = entries([L({ id: "a", price: 80_000, direction: "above", tf: "4h" }), L({ id: "b", price: 90_000, direction: "below", tf: "4h" })], { "4h": 85_000 });
    expect(resolveConflict([a[0]!], [a[1]!], "higher")).toBeNull();
    expect(buildDayPlan({ entries: a, precedence: "priority" }).active).toBe("wait");
  });
});

describe("planChange – report relevant changes, no spam", () => {
  const range = buildDayPlan({ entries: entries(legacyKeyLevels(DEFAULT_MARKET), { "4h": 85_000 }), precedence: "higher" });
  const long = buildDayPlan({ entries: entries(legacyKeyLevels(DEFAULT_MARKET), { "4h": 86_000 }), precedence: "higher" });
  const data = buildDayPlan({ entries: entries(legacyKeyLevels(DEFAULT_MARKET), {}), precedence: "higher" });
  const mem = (p: typeof range, at = 0): PlanMemory => ({ key: p.key, active: p.active, reason: p.reason, at });

  it("never on the first plan, never for the same plan", () => {
    expect(planChange(null, long, 1)).toBeNull();
    expect(planChange(mem(long), long, 1)).toBeNull();
  });
  it("range → long is announced with the trigger text", () => {
    const c = planChange(mem(range), long, 1)!;
    expect(c.title).toBe("Plan: Range → Long");
    expect(c.tone).toBe("win");
    expect(c.detail).toContain("85.900");
  });
  it("a feed hiccup (missing data) is not a plan change, in either direction", () => {
    expect(planChange(mem(long), data, 1)).toBeNull();
    expect(planChange(mem(data), long, 1)).toBeNull();
  });
  it("the same flip is not announced twice within 30 minutes (flip-flopping at a level)", () => {
    const recent = { from: "range" as const, to: "long" as const, at: 10 * 60_000 };
    expect(planChange(mem(range), long, 20 * 60_000, recent)).toBeNull();
    expect(planChange(mem(range), long, 41 * 60_000, recent)).not.toBeNull();
  });
});

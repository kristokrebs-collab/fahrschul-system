/**
 * The Top-Trader-Umschlag alarm replayed over a history (C3 – marks of the Wal-Karte): the SAME reading and the SAME engine as the
 * live alarm, fed point by point. First look silent, one event per jump, Vorwarnung before Bestätigung when the share runs toward
 * the line, a gap ends a run (the engine starts again after it), the repeat block marks a held-back event. Pure, no clock.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_COOLDOWN_MIN, DEFAULT_WHALE_PARAMS, replayWhale, stepAlerts, whaleReading, type AlertMemoryMap, type ReplayPoint } from "@/domain/alerts";

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 1);
const series = (longs: number[], step = H, t0 = T0): ReplayPoint[] => longs.map((l, i) => ({ t: t0 + i * step, longPct: l }));
const events = (m: ReturnType<typeof replayWhale>) => m.map((x) => `${x.event}@${(x.t - T0) / H}`);

describe("replayWhale: the rule of the alert engine, over a history", () => {
  it("the defaults are the engine's: Vorwarnung 3 Pkt., Bestätigung 2 Pkt., Hysterese 1 Pkt., Wiederholungssperre 6 Std.", () => {
    expect(DEFAULT_WHALE_PARAMS).toEqual({ warn: 3, confirm: 2, hyst: 1 });
    expect(DEFAULT_COOLDOWN_MIN).toBe(360);
  });

  it("a state that already holds fires nothing (the first look is silent)", () => {
    expect(replayWhale(series([55, 55, 56, 55, 57]), { symbol: "BTCUSDT" })).toEqual([]);
    expect(replayWhale(series([40, 40, 41, 40]), { symbol: "BTCUSDT" })).toEqual([]);
  });

  it("a share that runs toward the line gives a Vorwarnung, then the Bestätigung on the other side", () => {
    const marks = replayWhale(series([55, 55, 55, 54, 53, 52, 51, 50, 49, 48, 47]), { symbol: "BTCUSDT" });
    expect(events(marks)).toEqual(["red_warn@6", "red_confirm@9"]);
    expect(marks[0]).toMatchObject({ side: "red", level: "warn", label: "Rot-Vorwarnung", suppressed: false });
    expect(marks[1]).toMatchObject({ side: "red", level: "confirm", label: "Rot-Bestätigung" });
    // the distance (warning) and the margin (confirmation) the events fired with
    expect(marks[0]!.value).toBeCloseTo(3, 6);
    expect(marks[1]!.value).toBeCloseTo(2, 6);
  });

  it("the mirror image: a rising share gives Grün-Vorwarnung, then Grün-Bestätigung", () => {
    const marks = replayWhale(series([45, 45, 45, 46, 47, 48, 49, 50, 51, 52, 53]), { symbol: "BTCUSDT" });
    expect(events(marks)).toEqual(["green_warn@6", "green_confirm@9"]);
  });

  it("a jump straight over the line is ONE event (the Bestätigung), never a warning and then a confirmation", () => {
    const marks = replayWhale(series([55, 55, 55, 55, 55, 43, 43, 43]), { symbol: "BTCUSDT" });
    expect(events(marks)).toEqual(["red_confirm@5"]);
  });

  it("a gap ends a run: after it the first look is silent – nothing is dated inside the gap", () => {
    const left = series([55, 55, 55, 55, 55]);
    const right = series([43, 43, 43, 43, 43], H, T0 + 10 * H);
    const pts = [...left, ...right];
    expect(events(replayWhale(pts, { symbol: "BTCUSDT" }))).toEqual(["red_confirm@10"]);
    expect(replayWhale(pts, { symbol: "BTCUSDT", breaks: [5] })).toEqual([]);
    // the same reading before and after the gap: nothing changed in what is seen, nothing fires either way
    expect(replayWhale([...left, ...series([55, 55, 55], H, T0 + 10 * H)], { symbol: "BTCUSDT", breaks: [5] })).toEqual([]);
  });

  it("a run that restarts after a gap can still fire on what it sees next", () => {
    const pts = [...series([55, 55, 55]), ...series([55, 55, 43, 43], H, T0 + 10 * H)];
    expect(events(replayWhale(pts, { symbol: "BTCUSDT", breaks: [3] }))).toEqual(["red_confirm@12"]);
  });

  it("the repeat block marks an event the alarm would have held back (still shown, flagged)", () => {
    const half = 30 * 60_000;
    // 55 → 43 → 60 → 43 within 4,5 hours: the second Rot-Bestätigung falls inside the 6-hour block
    const marks = replayWhale(series([55, 55, 55, 43, 43, 43, 60, 60, 60, 43, 43], half), { symbol: "BTCUSDT" });
    expect(marks.map((m) => [m.event, m.suppressed])).toEqual([
      ["red_confirm", false],
      ["green_confirm", false],
      ["red_confirm", true],
    ]);
    // with no block at all it is delivered
    const free = replayWhale(series([55, 55, 55, 43, 43, 43, 60, 60, 60, 43, 43], half), { symbol: "BTCUSDT", cooldownMin: 0 });
    expect(free.map((m) => m.suppressed)).toEqual([false, false, false]);
  });

  it("is the live engine itself: stepping `whaleReading` + `stepAlerts` over the growing history gives the same events", () => {
    const longs = [55, 55, 54, 53, 52, 51, 50, 49, 48, 47, 49, 51, 53, 55, 57, 59, 53, 47];
    const pts = series(longs);
    const live: string[] = [];
    let memory: AlertMemoryMap = {};
    for (let i = 1; i < pts.length; i++) {
      const reading = whaleReading("BTCUSDT", pts.slice(0, i + 1).map((p) => ({ time: p.t, longPct: p.longPct })), DEFAULT_WHALE_PARAMS.confirm);
      const r = stepAlerts(memory, reading ? [reading] : [], { now: pts[i]!.t, userId: "x", params: { whale: DEFAULT_WHALE_PARAMS }, cooldownMs: DEFAULT_COOLDOWN_MIN * 60_000, maxAgeMs: { whale: Infinity }, quiet: () => false });
      memory = r.memory;
      for (const f of r.fires) live.push(`${f.event}@${(pts[i]!.t - T0) / H}`);
    }
    expect(live.length).toBeGreaterThan(2);
    expect(events(replayWhale(pts, { symbol: "BTCUSDT" }))).toEqual(live);
  });

  it("other thresholds move the marks (a stricter Bestätigung comes later)", () => {
    const pts = series([55, 55, 55, 54, 53, 52, 51, 50, 49, 48, 47, 46, 45]);
    const def = replayWhale(pts, { symbol: "BTCUSDT" });
    const strict = replayWhale(pts, { symbol: "BTCUSDT", params: { warn: 3, confirm: 4, hyst: 1 } });
    const at = (m: typeof def, level: string) => m.find((x) => x.level === level)?.t ?? 0;
    expect(at(strict, "confirm")).toBeGreaterThan(at(def, "confirm"));
  });

  it("copes with nothing, one point, and unordered lookback edges", () => {
    expect(replayWhale([], { symbol: "BTCUSDT" })).toEqual([]);
    expect(replayWhale(series([55]), { symbol: "BTCUSDT" })).toEqual([]);
    expect(replayWhale(series([55, 43]), { symbol: "BTCUSDT" })).toEqual([]);
  });
});

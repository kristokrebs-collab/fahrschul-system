import { describe, expect, it } from "vitest";
import {
  appendDelivery,
  blankKeyLevel,
  currentStage,
  decideDelivery,
  dedupeKey,
  DEFAULT_ALERT_SETTINGS,
  DEFAULT_LEVEL_ALERTS,
  DELIVERY_LOG_CAP,
  evaluateLevel,
  FRESH_MEMORY,
  KEY_TF_MS,
  observe,
  parseDeliveryLog,
  seedMemory,
  stageMessage,
  stepStages,
  type AlertMemory,
  type AlertStage,
  type DeliveryRecord,
  type EvalCandle,
  type KeyLevel,
  type Observation,
  type LevelStatus,
} from "@/domain/keylevels";

const obs = (status: LevelStatus, over: Partial<Observation> = {}): Observation => ({ status, kind: "close", within: false, broke: false, retestDone: false, ...over });
const rule = (over: Partial<typeof DEFAULT_LEVEL_ALERTS> = {}) => ({ ...DEFAULT_LEVEL_ALERTS, on: true, ...over });

/** Runs a sequence of observations and returns what fired, in order. */
function run(seq: Observation[], r = rule(), start: AlertMemory = FRESH_MEMORY): { fired: (AlertStage | null)[]; mem: AlertMemory } {
  let mem = start;
  const fired: (AlertStage | null)[] = [];
  seq.forEach((o, i) => {
    const res = stepStages(mem, o, r, i * 60_000);
    mem = res.mem;
    fired.push(res.fire);
  });
  return { fired, mem };
}

describe("currentStage", () => {
  it.each([
    [obs("waiting"), null],
    [obs("waiting", { within: true }), "prepare"],
    [obs("provisional"), "prepare"],
    [obs("confirmed"), "confirm"],
    [obs("confirmed", { retestDone: true }), "retest"],
    [obs("invalidated"), "invalid"],
    [obs("unknown", { within: true, broke: true }), null],
    // retest rule: the break is the confirmation, the retest is the trigger
    [obs("waiting", { kind: "retest", broke: true }), "confirm"],
    [obs("confirmed", { kind: "retest", broke: true, retestDone: true }), "retest"],
    [obs("waiting", { kind: "retest", within: true }), "prepare"],
  ] as const)("%j → %s", (o, stage) => expect(currentStage(o)).toBe(stage));
});

describe("stage order", () => {
  it("fires Vorbereitung → Bestätigung → Retest → Ungültigkeit once each, in order", () => {
    const { fired } = run([obs("waiting"), obs("waiting", { within: true }), obs("waiting", { within: true }), obs("confirmed"), obs("confirmed"), obs("confirmed", { retestDone: true }), obs("invalidated")]);
    expect(fired).toEqual([null, "prepare", null, "confirm", null, "retest", "invalid"]);
  });
  it("a jump straight to the confirmation sends one message, not two (no late Vorbereitung)", () => {
    const { fired } = run([obs("waiting"), obs("confirmed"), obs("waiting", { within: true })]);
    expect(fired).toEqual([null, "confirm", null]);
  });
  it("a lower stage never follows a higher one", () => {
    const { fired } = run([obs("confirmed"), obs("waiting", { within: true }), obs("confirmed")]);
    expect(fired).toEqual(["confirm", null, null]);
  });
  it("a stage that is switched off still advances the cycle silently", () => {
    const { fired } = run([obs("waiting", { within: true }), obs("confirmed"), obs("confirmed", { retestDone: true })], rule({ confirm: false }));
    expect(fired).toEqual(["prepare", null, "retest"]);
  });
  it("level alerts off: nothing fires, but turning them on later replays nothing", () => {
    const off = run([obs("confirmed")], rule({ on: false }));
    expect(off.fired).toEqual([null]);
    const later = run([obs("confirmed"), obs("confirmed", { retestDone: true })], rule(), off.mem);
    expect(later.fired).toEqual([null, "retest"]); // the confirmation is in the past; only the new stage counts
  });
  it("the first look only seeds: what is already true is never announced", () => {
    const mem = seedMemory(currentStage(obs("confirmed")));
    expect(run([obs("confirmed"), obs("confirmed", { retestDone: true })], rule(), mem).fired).toEqual([null, "retest"]);
    expect(seedMemory(null)).toEqual({ cycle: 0, reached: 0, fired: {}, ever: {} });
  });
});

describe("one-shot vs recurring", () => {
  const cycle = [obs("waiting", { within: true }), obs("confirmed"), obs("invalidated")];
  it("one-shot: each stage at most once, ever", () => {
    const first = run(cycle);
    expect(first.fired).toEqual(["prepare", "confirm", "invalid"]);
    // the level confirms and fails again: nothing more is sent
    const again = run([obs("confirmed"), obs("invalidated"), obs("waiting", { within: true }), obs("confirmed")], rule(), first.mem);
    expect(again.fired).toEqual([null, null, null, null]);
  });
  it("recurring: a new cycle after the price went away again", () => {
    const { fired, mem } = run([...cycle, obs("waiting"), obs("waiting", { within: true }), obs("confirmed")], rule({ recurring: true }));
    // invalidated stays until the level confirms again; `waiting` (never triggered) re-arms the cycle
    expect(fired.slice(0, 3)).toEqual(["prepare", "confirm", "invalid"]);
    expect(fired[3]).toBeNull();
    expect(fired[4]).toBe("prepare");
    expect(fired[5]).toBe("confirm");
    expect(mem.cycle).toBe(1);
  });
  it("recurring: leaving `invalidated` starts the next cycle, so the next confirmation alerts again", () => {
    const { fired } = run([obs("confirmed"), obs("invalidated"), obs("confirmed"), obs("invalidated")], rule({ recurring: true }));
    expect(fired).toEqual(["confirm", "invalid", "confirm", "invalid"]);
  });
  it("recurring: staying near the level does not re-arm (no repeat while the price hovers)", () => {
    const { fired } = run([obs("waiting", { within: true }), obs("waiting", { within: true }), obs("waiting", { within: true })], rule({ recurring: true }));
    expect(fired).toEqual(["prepare", null, null]);
  });
});

describe("delivery: dedupe, active hours, channels", () => {
  const base = { levelId: "k1", stage: "confirm" as const, cycle: 0, now: new Date(2026, 9, 18, 12, 0).getTime() };
  const sent = (over: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
    id: "d1",
    at: base.now - 5 * 60_000,
    source: "key",
    levelId: "k1",
    title: "x",
    detail: "",
    stage: "confirm",
    basis: "close",
    channels: ["toast"],
    outcome: "sent",
    dedupeKey: dedupeKey("k1", 0, "confirm"),
    ...over,
  });
  const cfg = { ...DEFAULT_ALERT_SETTINGS, cooldownMin: 30 };

  it("sends when nothing speaks against it", () => {
    expect(decideDelivery(base, cfg, [])).toEqual({ send: true, outcome: "sent", channels: ["toast"] });
  });
  it("the same level, cycle and stage is never sent twice", () => {
    expect(decideDelivery(base, cfg, [sent({ at: base.now - 3 * 3_600_000 })]).outcome).toBe("duplicate");
  });
  it("the cooldown also covers a new cycle of the same level and stage", () => {
    const rec = sent({ dedupeKey: dedupeKey("k1", 0, "confirm") });
    expect(decideDelivery({ ...base, cycle: 1 }, cfg, [rec]).outcome).toBe("duplicate"); // 5 min ago, cooldown 30
    expect(decideDelivery({ ...base, cycle: 1 }, cfg, [{ ...rec, at: base.now - 31 * 60_000 }]).outcome).toBe("sent");
    expect(decideDelivery({ ...base, cycle: 1 }, { ...cfg, cooldownMin: 0 }, [rec]).outcome).toBe("sent");
  });
  it("another stage or another level is not a duplicate; suppressed records do not block", () => {
    expect(decideDelivery({ ...base, stage: "retest" }, cfg, [sent()]).outcome).toBe("sent");
    expect(decideDelivery({ ...base, levelId: "k2" }, cfg, [sent()]).outcome).toBe("sent");
    expect(decideDelivery(base, cfg, [sent({ outcome: "hours" })]).outcome).toBe("sent");
  });
  it("outside the active hours nothing is sent", () => {
    const hours = { on: true, from: "13:00", to: "20:00" };
    expect(decideDelivery(base, { ...cfg, hours }, [])).toMatchObject({ send: false, outcome: "hours" });
    expect(decideDelivery({ ...base, now: new Date(2026, 9, 18, 14, 0).getTime() }, { ...cfg, hours }, []).send).toBe(true);
  });
  it("without a channel nothing is sent – and the log says so", () => {
    expect(decideDelivery(base, { ...cfg, channels: { toast: false, system: false } }, [])).toMatchObject({ send: false, outcome: "channels", channels: [] });
  });
  it("the existing signal / box alerts in the log never suppress a key-level alert", () => {
    expect(decideDelivery(base, cfg, [sent({ source: "signal" })]).outcome).toBe("sent");
  });
});

describe("Zustellprotokoll", () => {
  const rec = (i: number): DeliveryRecord => ({ id: `d${i}`, at: i, source: "key", levelId: "k", title: `t${i}`, detail: "", stage: "prepare", basis: null, channels: ["toast"], outcome: "sent", dedupeKey: `k|${i}|prepare` });
  it("is capped, newest first", () => {
    let log: DeliveryRecord[] = [];
    for (let i = 0; i < DELIVERY_LOG_CAP + 25; i++) log = appendDelivery(log, rec(i));
    expect(log).toHaveLength(DELIVERY_LOG_CAP);
    expect(log[0]!.id).toBe(`d${DELIVERY_LOG_CAP + 24}`);
    expect(log.at(-1)!.id).toBe("d25");
    expect(appendDelivery([rec(1), rec(2)], rec(3), 2).map((r) => r.id)).toEqual(["d3", "d1"]);
  });
  it("is read tolerantly: bad entries are dropped, the cap holds", () => {
    const stored = [rec(1), { id: 5 }, null, "x", { ...rec(2), outcome: "weird" }, { ...rec(3), channels: ["toast", "carrier-pigeon"] }];
    const out = parseDeliveryLog(stored);
    expect(out.map((r) => r.id)).toEqual(["d1", "d3"]);
    expect(out[1]!.channels).toEqual(["toast"]);
    expect(parseDeliveryLog("nope")).toEqual([]);
    expect(parseDeliveryLog(Array.from({ length: 300 }, (_, i) => rec(i)), 10)).toHaveLength(10);
  });
});

describe("observe + stageMessage on real evaluations", () => {
  const MS = KEY_TF_MS["4h"];
  const T0 = Date.UTC(2026, 9, 1);
  const bar = (i: number, c: number, closed = true): EvalCandle => ({ time: T0 + i * MS, open: c, high: c + 0.5, low: c - 0.5, close: c, closed, closeTime: T0 + (i + 1) * MS - 1 });
  const lvl = (over: Partial<KeyLevel> = {}): KeyLevel => blankKeyLevel({ id: "k1", symbol: "BTCUSDT", price: 100, since: T0, name: "Mein Level", ...over }, T0);
  const now = T0 + 3 * MS + 60_000;

  it("price within the prepare distance below the trigger → Vorbereitung; far away → no stage", () => {
    const l = lvl();
    const near = evaluateLevel(l, [bar(0, 99.7), bar(1, 99.6), bar(2, 99.6), bar(3, 99.6, false)], now);
    expect(currentStage(observe(l, near, { prepare: { mode: "pct", value: 0.5 } }))).toBe("prepare");
    const far = evaluateLevel(l, [bar(0, 90), bar(1, 90), bar(2, 90), bar(3, 90, false)], now);
    expect(currentStage(observe(l, far, { prepare: { mode: "pct", value: 0.5 } }))).toBeNull();
  });
  it("a price already beyond the trigger is not 'approaching'", () => {
    const l = lvl({ kind: "running" });
    const ev = evaluateLevel(l, [bar(0, 99), bar(1, 99), bar(2, 99), bar(3, 100.2, false)], now);
    expect(ev.status).toBe("provisional");
    expect(currentStage(observe(l, ev, { prepare: { mode: "pct", value: 0.5 } }))).toBe("prepare"); // provisional is the prepare stage
  });
  it("short side mirrors the approach", () => {
    const l = lvl({ direction: "below" });
    const ev = evaluateLevel(l, [bar(0, 100.3), bar(1, 100.4), bar(2, 100.4), bar(3, 100.4, false)], now);
    expect(currentStage(observe(l, ev, { prepare: { mode: "pct", value: 0.5 } }))).toBe("prepare");
  });
  it("messages say what happened, on which basis, in German", () => {
    const l = lvl();
    const prov = evaluateLevel(lvl({ kind: "running" }), [bar(0, 99), bar(1, 99), bar(2, 99), bar(3, 101, false)], now);
    expect(stageMessage(lvl({ kind: "running" }), "prepare", prov)).toMatchObject({ basis: "intrabar", title: "Vorläufig · Mein Level · BTCUSDT 4H" });
    const conf = evaluateLevel(l, [bar(0, 99), bar(1, 101), bar(2, 101), bar(3, 101, false)], now);
    expect(stageMessage(l, "confirm", conf)).toMatchObject({ basis: "close", title: "Bestätigt · Mein Level · BTCUSDT 4H" });
    expect(stageMessage(l, "invalid", conf).title).toBe("Ungültig · Mein Level · BTCUSDT 4H");
  });
});

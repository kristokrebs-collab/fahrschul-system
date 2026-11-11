/**
 * The shared watch core (`watch.ts`) and the e-mail alarm's state (`serverAlerts.ts`): the first look is silent, a stage
 * fires once, an edit starts over, the outbox folds bursts and honours the quiet rules, and the settings key keeps what
 * it does not own. The browser/server parity itself is `alerts.watch.parity.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  afterMail,
  armPatch,
  blankKeyLevel,
  DEFAULT_ALERT_SETTINGS,
  EMPTY_SERVER_ALERTS,
  liveSince,
  MAIL_MIN_GAP_MS,
  OUTBOX_CAP,
  OUTBOX_TTL_MS,
  parseWatchMems,
  planMail,
  queueFires,
  ruleText,
  sameServerState,
  sendBackoffMs,
  serverAlertsOf,
  serverWatchSet,
  stepWatch,
  unknownEvaluation,
  watchEntry,
  WATCH_LEVELS_MAX,
  withKeyLevels,
  withServerAlerts,
  type KeyLevel,
  type LevelEvaluation,
  type LevelStatus,
  type ServerAlertsCfg,
  type WatchEntry,
  type WatchFire,
} from "@/domain/keylevels";

const NOW = Date.UTC(2026, 9, 26, 9, 0);
const H = 3_600_000;
const MIN = 60_000;
const ON = { on: true, prepare: true, confirm: true, retest: true, invalid: true, recurring: false };
const lv = (id: string, over: Partial<KeyLevel> = {}): KeyLevel => blankKeyLevel({ id, symbol: "BTCUSDT", price: 100, name: id, since: NOW - 48 * H, alerts: ON, ...over }, NOW - 48 * H);
const ev = (status: LevelStatus, over: Partial<LevelEvaluation> = {}): LevelEvaluation => ({ ...unknownEvaluation("x"), status, reason: "Grund", trigger: 100, last: 99, broke: status === "confirmed", ...over });
const entry = (level: KeyLevel, status: LevelStatus, over: Partial<LevelEvaluation> = {}, live = true): WatchEntry => watchEntry(level, ev(status, over), live, DEFAULT_ALERT_SETTINGS);

describe("stepWatch – the shared decision", () => {
  it("the first look only remembers where a level stands – nothing already true is announced", () => {
    const r = stepWatch({}, [entry(lv("a"), "confirmed")], NOW);
    expect(r.fires).toEqual([]);
    expect(r.dirty).toBe(true);
    expect(r.mems.a!.m.reached).toBe(2);
  });

  it("a higher stage fires once; the same stage again does not", () => {
    const seed = stepWatch({}, [entry(lv("a"), "waiting")], NOW).mems;
    const up = stepWatch(seed, [entry(lv("a"), "confirmed")], NOW + MIN);
    expect(up.fires.map((f) => [f.level.id, f.stage, f.cycle])).toEqual([["a", "confirm", 0]]);
    const again = stepWatch(up.mems, [entry(lv("a"), "confirmed")], NOW + 2 * MIN);
    expect(again.fires).toEqual([]);
    expect(again.dirty).toBe(false);
    expect(again.mems).toBe(up.mems);
  });

  it("a level without a verdict (unknown, other market, switched off) is never stepped; a removed level is forgotten", () => {
    const seed = stepWatch({}, [entry(lv("a"), "waiting"), entry(lv("b"), "waiting")], NOW).mems;
    const r = stepWatch(seed, [entry(lv("a"), "unknown"), entry(lv("c"), "confirmed", {}, false)], NOW + MIN);
    expect(r.fires).toEqual([]);
    expect(Object.keys(r.mems)).toEqual(["a"]); // b is gone from the list, c was never looked at
    const off = stepWatch(r.mems, [entry(lv("a", { enabled: false }), "confirmed")], NOW + 2 * MIN);
    expect(off.mems).toEqual({});
  });

  it("the five fixed levels never alert", () => {
    const fixed = lv("legacy:longTrigger", { legacy: "longTrigger" });
    const r = stepWatch({}, [entry(fixed, "confirmed")], NOW);
    expect(r.mems).toEqual({});
    expect(r.fires).toEqual([]);
  });

  it("an edit that changes the rule starts the level over (silent first look again)", () => {
    const seed = stepWatch({}, [entry(lv("a"), "waiting")], NOW).mems;
    const edited = stepWatch(seed, [entry(lv("a", { price: 101 }), "confirmed")], NOW + MIN);
    expect(edited.fires).toEqual([]);
    expect(edited.mems.a!.m.reached).toBe(2);
  });

  it("`live`: a level that counts from a time the watcher covers is announced at its first look", () => {
    const fresh = lv("a", { since: NOW - 5 * MIN });
    const silent = stepWatch({}, [entry(fresh, "confirmed")], NOW);
    expect(silent.fires).toEqual([]);
    const live = stepWatch({}, [entry(fresh, "confirmed")], NOW, { live: liveSince(NOW - H, NOW) });
    expect(live.fires.map((f) => f.stage)).toEqual(["confirm"]);
    // a level made long before the switch stays silent even with the option
    const old = stepWatch({}, [entry(lv("o"), "confirmed")], NOW, { live: liveSince(NOW - H, NOW) });
    expect(old.fires).toEqual([]);
    // after that first live look the level is stepped like any other
    expect(stepWatch(live.mems, [entry(fresh, "confirmed")], NOW + MIN, { live: liveSince(NOW - H, NOW) }).fires).toEqual([]);
  });

  it("a stage that is switched off still moves the cycle on silently", () => {
    const quiet = lv("a", { alerts: { ...ON, confirm: false } });
    const seed = stepWatch({}, [entry(quiet, "waiting")], NOW).mems;
    const r = stepWatch(seed, [entry(quiet, "confirmed")], NOW + MIN);
    expect(r.fires).toEqual([]);
    expect(r.mems.a!.m.reached).toBe(2);
  });

  it("parseWatchMems reads leniently", () => {
    expect(parseWatchMems(null)).toEqual({});
    expect(parseWatchMems({ a: { fp: "x", m: { cycle: 0, reached: 1 } }, b: { fp: 1 }, c: "no" })).toEqual({ a: { fp: "x", m: { cycle: 0, reached: 1, fired: {}, ever: {} } } });
  });
});

describe("settings.serverAlerts", () => {
  it("reads anything leniently and clamps the daily limit", () => {
    expect(serverAlertsOf(undefined)).toBe(EMPTY_SERVER_ALERTS);
    expect(serverAlertsOf({ email: "yes", maxPerDay: 9999 })).toMatchObject({ email: false, maxPerDay: 24 });
    expect(serverAlertsOf({ email: true, maxPerDay: 0 }).maxPerDay).toBe(1);
    expect(serverAlertsOf({ outbox: [{ id: "x" }, 5, null] }).outbox).toEqual([]);
    expect(serverAlertsOf({ fail: { at: 5, n: 0, code: "c" } }).fail).toEqual({ at: 5, n: 1, code: "c" });
  });

  it("writes only the patched keys and keeps every other key of the root; same object when nothing changes", () => {
    const raw = { v: 1, email: true, maxPerDay: 6, future: { x: 1 }, mem: { a: "kept" } };
    const same = withServerAlerts(raw, { email: true });
    expect(same).toBe(raw);
    const next = withServerAlerts(raw, { maxPerDay: 12 });
    expect(next).toEqual({ v: 1, email: true, maxPerDay: 12, future: { x: 1 }, mem: { a: "kept" } });
    expect(next).not.toBe(raw);
    const fresh = withServerAlerts(undefined, { email: true, armedAt: 5 });
    expect(fresh).toEqual({ v: 1, email: true, armedAt: 5 });
    expect(withServerAlerts({ maxPerDay: 3 }, { maxPerDay: 400 }).maxPerDay).toBe(24);
  });

  it("switching on clears the server's old state but keeps the day's mail count", () => {
    const stored = withServerAlerts({ v: 1, email: false, mails: { day: "2026-10-26", n: 2 }, mem: { a: {} }, outbox: [{ id: "old" }] }, armPatch(NOW));
    const cfg = serverAlertsOf(stored);
    expect(cfg).toMatchObject({ email: true, armedAt: NOW, mem: {}, outbox: [], mails: { day: "2026-10-26", n: 2 } });
  });

  it("the watch set: own levels with alerts on and a stage wanted, capped", () => {
    const own = [lv("a"), lv("b", { alerts: { ...ON, on: false } }), lv("c", { enabled: false }), lv("d", { alerts: { ...ON, prepare: false, confirm: false, retest: false, invalid: false } }), lv("e")];
    const set = serverWatchSet(withKeyLevels(undefined, { levels: own }));
    expect(set.levels.map((l) => l.id)).toEqual(["a", "e"]);
    const many = Array.from({ length: WATCH_LEVELS_MAX + 3 }, (_, i) => lv(`m${i}`));
    const capped = serverWatchSet(withKeyLevels(undefined, { levels: many }));
    expect(capped.levels).toHaveLength(WATCH_LEVELS_MAX);
    expect(capped.over).toHaveLength(3);
  });

  it("names the rule in plain German", () => {
    expect(ruleText(lv("a", { kind: "close", tf: "4h" }))).toBe("4H-Schluss über 100");
    expect(ruleText(lv("a", { kind: "touch", direction: "below" }))).toBe("Berührung von 100");
    expect(ruleText(lv("a", { kind: "closes", closes: 3, tf: "1D", direction: "below" }))).toBe("3 1D-Schlüsse in Folge unter 100");
    expect(ruleText(lv("a", { kind: "buffer", distance: { mode: "atr", value: 0.5 } }))).toContain("× ATR");
    expect(ruleText(lv("a", { kind: "retest" }))).toContain("danach Retest");
    expect(ruleText(lv("a", { kind: "running", tf: "1h" }))).toContain("laufende 1H-Kerze");
  });
});

describe("the outbox and the mail plan", () => {
  const fire = (id: string, stage: WatchFire["stage"] = "confirm", cycle = 0): WatchFire => ({ level: lv(id), stage, cycle, evaluation: ev("confirmed", { last: 104 }) });
  const base = (over: Partial<ServerAlertsCfg> = {}): ServerAlertsCfg => ({ ...EMPTY_SERVER_ALERTS, email: true, ...over });
  const local = { minutes: 10 * 60, day: "2026-10-26" };
  const open = { on: false, from: "08:00", to: "22:00" };

  it("queues a fire once with its text, rule and prices as they were", () => {
    const q = queueFires(base(), [fire("a"), fire("a")], NOW, 30);
    expect(q.outbox).toHaveLength(1);
    expect(q.outbox[0]).toMatchObject({ id: "a|0|confirm", at: NOW, symbol: "BTCUSDT", tf: "4h", rule: "4H-Schluss über 100", last: 104, price: 100 });
    expect(q.outbox[0]!.title).toContain("Bestätigt");
    expect(queueFires({ ...base(), ...q }, [fire("a")], NOW + MIN, 30).outbox).toHaveLength(1);
  });

  it("the cooldown folds a repeat of the same level and stage into a counter", () => {
    const first = queueFires(base(), [fire("a", "confirm", 0)], NOW, 30);
    const again = queueFires({ ...base(), ...first }, [fire("a", "confirm", 1)], NOW + 10 * MIN, 30);
    expect(again.outbox).toHaveLength(1);
    expect(again.notes.suppressed).toBe(1);
    const later = queueFires({ ...base(), ...first }, [fire("a", "confirm", 1)], NOW + 31 * MIN, 30);
    expect(later.outbox).toHaveLength(2);
    expect(queueFires({ ...base(), ...first }, [fire("a", "confirm", 1)], NOW + 10 * MIN, 0).outbox).toHaveLength(2);
  });

  it("an outbox over the cap loses its oldest entries and counts them", () => {
    const fires = Array.from({ length: OUTBOX_CAP + 4 }, (_, i) => fire(`l${i}`));
    const q = queueFires(base(), fires, NOW, 0);
    expect(q.outbox).toHaveLength(OUTBOX_CAP);
    expect(q.notes.dropped).toBe(4);
    expect(q.outbox[0]!.levelId).toBe("l4");
  });

  const withItems = (n = 1, over: Partial<ServerAlertsCfg> = {}) => base({ outbox: queueFires(base(), Array.from({ length: n }, (_, i) => fire(`l${i}`)), NOW, 0).outbox, ...over });

  it("mails everything that waits in ONE go when nothing holds it back", () => {
    const p = planMail(withItems(3), NOW + MIN, local, open);
    expect(p.hold).toBeNull();
    expect(p.send).toHaveLength(3);
  });

  it("holds back in this order: nothing, back-off, active hours, daily limit, gap", () => {
    expect(planMail(base(), NOW, local, open).hold).toBe("empty");
    const failed = withItems(1, { fail: { at: NOW, n: 1, code: "resend_auth" } });
    expect(planMail(failed, NOW + 29 * MIN, local, open).hold).toBe("backoff");
    expect(planMail(failed, NOW + 31 * MIN, local, open).hold).toBeNull();
    expect(planMail(withItems(1), NOW, { minutes: 23 * 60, day: local.day }, { on: true, from: "08:00", to: "22:00" }).hold).toBe("hours");
    expect(planMail(withItems(1, { maxPerDay: 2, mails: { day: local.day, n: 2 } }), NOW, local, open).hold).toBe("limit");
    expect(planMail(withItems(1, { maxPerDay: 2, mails: { day: "2026-10-25", n: 2 } }), NOW, local, open).hold).toBeNull(); // yesterday's count is gone
    expect(planMail(withItems(1, { lastMailAt: NOW - MAIL_MIN_GAP_MS + MIN }), NOW, local, open).hold).toBe("gap");
    expect(planMail(withItems(1, { lastMailAt: NOW - MAIL_MIN_GAP_MS }), NOW, local, open).hold).toBeNull();
  });

  it("drops what waited longer than 24 hours", () => {
    const p = planMail(withItems(2), NOW + OUTBOX_TTL_MS + MIN, local, open);
    expect(p).toMatchObject({ expired: 2, hold: "empty" });
    expect(p.fresh).toEqual([]);
  });

  it("after a mail: the mailed items leave, the day counts, the failure is forgotten, the notes reset", () => {
    const cfg = withItems(2, { fail: { at: NOW - H, n: 2, code: "x" }, notes: { suppressed: 3, dropped: 1 }, mails: { day: local.day, n: 1 } });
    const patch = afterMail(cfg, [cfg.outbox[0]!], NOW, local, { ok: true });
    expect(patch.outbox).toHaveLength(1);
    expect(patch).toMatchObject({ mails: { day: local.day, n: 2 }, lastMailAt: NOW, fail: null, notes: { suppressed: 0, dropped: 0 } });
    expect(afterMail(cfg, cfg.outbox, NOW, { ...local, day: "2026-10-27" }, { ok: true }).mails).toEqual({ day: "2026-10-27", n: 1 });
  });

  it("after a failed send: back-off 30 min, 2 h, then 6 h; the outbox stays", () => {
    const cfg = withItems(1);
    const one = afterMail(cfg, cfg.outbox, NOW, local, { ok: false, code: "resend_5xx" });
    expect(one).toEqual({ fail: { at: NOW, n: 1, code: "resend_5xx" } });
    expect(afterMail({ ...cfg, fail: one.fail! }, cfg.outbox, NOW, local, { ok: false, code: "resend_5xx" }).fail!.n).toBe(2);
    expect([1, 2, 3, 9].map(sendBackoffMs)).toEqual([30 * MIN, 2 * H, 6 * H, 6 * H]);
  });

  it("a quiet state compares equal (no write)", () => {
    expect(sameServerState(base(), base())).toBe(true);
    expect(sameServerState(base(), base({ problems: [{ id: "a", code: "symbol" }] }))).toBe(false);
  });
});

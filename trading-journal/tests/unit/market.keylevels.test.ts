/**
 * Schlüsselmarken live: candles per timeframe (30m/2h/3h resampled, never substituted), the status store on a fake
 * provider, the alert runtime (seed, stages, active hours, dedupe, reload, edits), the plan-change toast and the
 * Zustellprotokoll.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MARKET, defaultSettings } from "@/domain/defaults";
import { blankKeyLevel, DEFAULT_ALERT_SETTINGS, KEY_TF_MS, withKeyLevels, type KeyLevel, type KeyTf } from "@/domain/keylevels";
import type { Candle } from "@/market/types";

const fake = vi.hoisted(() => ({ p: null as unknown }));
vi.mock("@/market/marketStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market/marketStore")>();
  return { ...actual, getProvider: () => fake.p };
});

import { levelCandles } from "@/market/keylevels/candles";
import { __resetSignalArchive, getSignalArchive } from "@/market/signalArchive";
import { __resetDeliveryLog, clearDeliveryLog, getDeliveryLog, logExternalDelivery, recordDelivery } from "@/market/keylevels/deliveryLog";
import { __resetKeyLevelAlerts, KEYLEVEL_MEM_KEY, processKeyLevelView, processPlanView } from "@/market/keylevels/alerts";
import { __resetKeyLevels, computeKeyLevels, getKeyLevels } from "@/market/keylevels/store";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 1); // 00:00 UTC, aligned for every length that divides a day

const c = (time: number, ms: number, close: number, closed = true, over: Partial<Candle> = {}): Candle => ({ time, open: close, high: close + 0.5, low: close - 0.5, close, volume: 1, closed, closeTime: time + ms - 1, ...over });
const series = (n: number, ms: number, close: (i: number) => number, lastForming = false): Candle[] => Array.from({ length: n }, (_, i) => c(T0 + i * ms, ms, close(i), !(lastForming && i === n - 1)));

interface FakeFeeds {
  kline_15m?: Candle[];
  kline_1h?: Candle[];
  kline_4h?: Candle[];
  kline_1d?: Candle[];
  kline_1w?: Candle[];
}
function installProvider(feeds: FakeFeeds, o: { now: number; price: number | null; symbol?: string }): void {
  const stamped = (data: unknown) => ({ data, asOf: o.now, receivedAt: o.now, source: "binance", comparable: true });
  const stampedFeeds = Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, stamped(v)]));
  fake.p = {
    symbolInfo: { binance: o.symbol ?? "BTCUSDT" },
    serverNow: () => o.now,
    get: (feed: string) => stampedFeeds[feed],
    snapshot: () => (o.price == null ? {} : { aggTrade: stamped({ price: o.price }) }),
    getHealth: () => ({ feeds: {} }),
  };
}

function setLevels(levels: Partial<KeyLevel>[], extra: Record<string, unknown> = {}): KeyLevel[] {
  const full = levels.map((l, i) => blankKeyLevel({ id: `k${i + 1}`, symbol: "BTCUSDT", price: 100, name: `L${i + 1}`, since: T0, ...l }, T0));
  const s = useJournal.getState().settings;
  useJournal.setState({ settings: { ...s, market: { ...DEFAULT_MARKET, longTrigger: 0, longStop: 0, shortTrigger: 0, invalidation: 0, lowerHigh: 0 }, keyLevels: withKeyLevels(undefined, { levels: full, ...extra }) } as typeof s });
  return full;
}

const toasts = () => useUi.getState().toasts.map((t) => t.title);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  fake.p = null;
  localStorage.clear();
  __resetKeyLevels();
  __resetKeyLevelAlerts();
  __resetDeliveryLog();
  __resetSignalArchive();
  useUi.setState({ toasts: [] });
  useJournal.setState({ settings: defaultSettings() });
});
afterEach(() => {
  vi.useRealTimers();
  __resetKeyLevels();
});

describe("levelCandles – the timeframe's own candles, nothing substituted", () => {
  const p = (feeds: FakeFeeds) => {
    installProvider(feeds, { now: T0 + 40 * H, price: 100 });
    return fake.p as Parameters<typeof levelCandles>[0];
  };
  it("2h and 3h are built from 1h (epoch-aligned, closed only when the last source candle closed)", () => {
    const h1 = series(7, H, (i) => 100 + i, true); // 0..6h, the 7th (06:00) is forming
    const two = levelCandles(p({ kline_1h: h1 }), "2h")!;
    expect(two.map((x) => x.time)).toEqual([T0, T0 + 2 * H, T0 + 4 * H, T0 + 6 * H]);
    expect(two.map((x) => x.closed)).toEqual([true, true, true, false]);
    expect(two[1]).toMatchObject({ open: 102, high: 103.5, low: 101.5, close: 103 });
    const three = levelCandles(p({ kline_1h: h1 }), "3h")!;
    expect(three.map((x) => x.time)).toEqual([T0, T0 + 3 * H, T0 + 6 * H]);
    expect(three.map((x) => x.closed)).toEqual([true, true, false]);
  });
  it("30m comes from 15m; 4h, 1D and 1W are read straight from their feeds", () => {
    const m15 = series(6, 15 * 60_000, (i) => 100 + i);
    expect(levelCandles(p({ kline_15m: m15 }), "30m")!).toHaveLength(3);
    const h4 = series(3, 4 * H, (i) => 10 + i);
    expect(levelCandles(p({ kline_4h: h4 }), "4h")).toBe(h4);
  });
  it("a missing or empty source feed gives null – the level then reads unknown, never another timeframe", () => {
    const prov = p({ kline_1h: series(5, H, () => 100) });
    for (const tf of ["30m", "4h", "1D", "1W"] as KeyTf[]) expect(levelCandles(prov, tf)).toBeNull();
    expect(levelCandles(p({ kline_4h: [] }), "4h")).toBeNull();
  });
});

describe("computeKeyLevels – status on real candles", () => {
  const now = T0 + 10 * KEY_TF_MS["4h"] + 60_000;
  const h4 = (closes: number[], formingLast = true): Candle[] => closes.map((cl, i) => c(T0 + i * KEY_TF_MS["4h"], KEY_TF_MS["4h"], cl, !(formingLast && i === closes.length - 1)));

  it("evaluates own levels of the live symbol; another symbol is listed but not judged; the market off → idle", () => {
    setLevels([{ kind: "close" }, { id: "x", symbol: "ETHUSDT" }, { id: "w", tf: "1W" }]);
    installProvider({ kline_4h: h4([...Array(9).fill(95), 101, 99.5]) }, { now, price: 101 });
    computeKeyLevels(true);
    const v = getKeyLevels();
    expect(v.state).toBe("ok");
    const by = Object.fromEntries(v.entries.map((e) => [e.level.id, e]));
    expect(by.k1!.evaluation.status).toBe("confirmed"); // the last CLOSED 4h candle closed at 101 > 100
    expect(by.x!.evaluation).toMatchObject({ status: "unknown", reason: expect.stringContaining("ETHUSDT") });
    expect(by.x!.live).toBe(false);
    expect(by.w!.evaluation).toMatchObject({ status: "unknown", reason: expect.stringContaining("1W-Kerzen") }); // no weekly feed: not judged
    expect(v.plan.active).toBe("long"); // the long trigger closed; the other-symbol and weekly levels do not count
    expect(v.tf.find((t) => t.tf === "4h")!.ok).toBe(true);

    fake.p = null;
    computeKeyLevels(true);
    expect(getKeyLevels().state).toBe("idle");
    expect(getKeyLevels().entries.every((e) => e.evaluation.status === "unknown")).toBe(true);
  });

  it("the five fixed levels are part of the list (derived, behaviour of scenario())", () => {
    const s = useJournal.getState().settings;
    useJournal.setState({ settings: { ...s, market: { ...DEFAULT_MARKET }, keyLevels: undefined } as typeof s });
    installProvider({ kline_4h: h4([...Array(9).fill(85_000), 86_000, 85_000]), kline_1w: series(3, KEY_TF_MS["1W"], () => 90_000) }, { now, price: 85_000 });
    computeKeyLevels(true);
    const v = getKeyLevels();
    expect(v.entries.filter((e) => e.level.legacy).map((e) => [e.level.legacy, e.evaluation.status])).toEqual([
      ["longTrigger", "confirmed"],
      ["longStop", "waiting"],
      ["shortTrigger", "waiting"],
      ["invalidation", "waiting"],
      ["lowerHigh", "waiting"], // no weekly candle has closed yet at "now"
    ]);
    expect(v.plan.active).toBe("long");
  });
});

describe("alert runtime", () => {
  const MS4 = KEY_TF_MS["4h"];
  const now0 = T0 + 12 * MS4 + 60_000;
  const closes = (last: number, formingClose: number) => [...Array(11).fill(95), last, formingClose].map((cl, i, a) => c(T0 + i * MS4, MS4, cl, i < a.length - 1));
  const feed = (last: number, forming: number, now = now0, price = forming) => {
    installProvider({ kline_4h: closes(last, forming) }, { now, price });
    computeKeyLevels(true);
    return getKeyLevels();
  };
  const alertOn = { alerts: { on: true, prepare: true, confirm: true, retest: false, invalid: true, recurring: false } };

  it("the first look only seeds: a level that is already confirmed announces nothing, not even after a reload", () => {
    setLevels([{ ...alertOn }]);
    processKeyLevelView(feed(101, 101), now0);
    expect(toasts()).toEqual([]);
    expect(getDeliveryLog()).toHaveLength(0);
    __resetKeyLevelAlerts(); // reload: memory comes back from storage
    processKeyLevelView(feed(101, 101), now0 + 60_000);
    expect(toasts()).toEqual([]);
  });

  it("Vorbereitung → Bestätigung: each once, toast + protocol line, none twice", () => {
    setLevels([{ ...alertOn, price: 100 }]);
    processKeyLevelView(feed(95, 95), now0); // seed (far away)
    processKeyLevelView(feed(95, 99.7), now0 + 1000); // within 0.5 %
    expect(toasts()).toEqual(["Vorbereitung · L1 · BTCUSDT 4H"]);
    processKeyLevelView(feed(95, 99.8), now0 + 2000); // still near: no second one
    processKeyLevelView(feed(101, 101, now0 + MS4), now0 + MS4); // the candle closed beyond
    expect(toasts()).toEqual(["Vorbereitung · L1 · BTCUSDT 4H", "Bestätigt · L1 · BTCUSDT 4H"]);
    processKeyLevelView(feed(101, 102, now0 + MS4 + 1000), now0 + MS4 + 1000);
    expect(toasts()).toHaveLength(2);
    const log = getDeliveryLog();
    expect(log.map((r) => [r.stage, r.outcome, r.basis])).toEqual([
      ["confirm", "sent", "close"],
      ["prepare", "sent", "intrabar"],
    ]);
    expect(log.every((r) => r.channels.join() === "toast")).toBe(true);
    // F32: the confirmation is archived as an entry-like hit of the own level (the preparation is not)
    expect(getSignalArchive()).toEqual([expect.objectContaining({ source: "key", kind: "confirm", entry: true, side: "long", symbol: "BTCUSDT", tf: "4h", ref: "k1" })]);
  });

  it("a reload in the middle of a cycle continues without repeating a stage", () => {
    setLevels([{ ...alertOn }]);
    processKeyLevelView(feed(95, 95), now0);
    processKeyLevelView(feed(95, 99.7), now0 + 1000);
    expect(toasts()).toHaveLength(1);
    __resetKeyLevelAlerts();
    processKeyLevelView(feed(95, 99.7), now0 + 2000);
    expect(toasts()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(KEYLEVEL_MEM_KEY)!)).toHaveProperty("k1");
  });

  it("outside the active hours nothing is shown, and the protocol says why", () => {
    const local = (h: number) => new Date(2026, 9, 18, h, 0).getTime();
    setLevels([{ ...alertOn }], { alerts: { ...DEFAULT_ALERT_SETTINGS, hours: { on: true, from: "08:00", to: "10:00" } } });
    processKeyLevelView(feed(95, 95), local(12));
    processKeyLevelView(feed(95, 99.7), local(12) + 1000);
    expect(toasts()).toEqual([]);
    expect(getDeliveryLog().map((r) => [r.stage, r.outcome, r.channels])).toEqual([["prepare", "hours", []]]);
  });

  it("no channel switched on: held back and logged, not silently dropped", () => {
    setLevels([{ ...alertOn }], { alerts: { ...DEFAULT_ALERT_SETTINGS, channels: { toast: false, system: false } } });
    processKeyLevelView(feed(95, 95), now0);
    processKeyLevelView(feed(95, 99.7), now0 + 1000);
    expect(toasts()).toEqual([]);
    expect(getDeliveryLog()[0]).toMatchObject({ outcome: "channels" });
  });

  it("the cooldown suppresses the same level and stage of a new cycle (recurring) as a Dublette", () => {
    setLevels([{ ...alertOn, alerts: { ...alertOn.alerts, recurring: true, confirm: false, invalid: false } }]);
    processKeyLevelView(feed(95, 95), now0);
    processKeyLevelView(feed(95, 99.7), now0 + 1000); // Vorbereitung #1
    processKeyLevelView(feed(95, 96), now0 + 2000); // away → new cycle
    processKeyLevelView(feed(95, 99.7), now0 + 3000); // Vorbereitung #2, inside the 30-minute cooldown
    expect(toasts()).toHaveLength(1);
    expect(getDeliveryLog().map((r) => r.outcome)).toEqual(["duplicate", "sent"]);
  });

  it("editing the level's rule starts it over (a silent first look), a switched-off level forgets", () => {
    setLevels([{ ...alertOn }]);
    processKeyLevelView(feed(95, 95), now0);
    processKeyLevelView(feed(95, 99.7), now0 + 1000);
    expect(toasts()).toHaveLength(1);
    setLevels([{ ...alertOn, price: 99.9 }]); // edited price: new fingerprint
    processKeyLevelView(feed(95, 99.7), now0 + 2000); // seeds (it is "prepare" right now) – no repeat
    expect(toasts()).toHaveLength(1);
    setLevels([{ ...alertOn, enabled: false }]);
    processKeyLevelView(feed(95, 99.7), now0 + 3000);
    expect(JSON.parse(localStorage.getItem(KEYLEVEL_MEM_KEY) ?? "{}")).not.toHaveProperty("k1");
  });

  it("the fixed levels never alert", () => {
    const s = useJournal.getState().settings;
    useJournal.setState({ settings: { ...s, market: { ...DEFAULT_MARKET }, keyLevels: undefined } as typeof s });
    installProvider({ kline_4h: closes(85_000, 85_000).map((x) => ({ ...x, close: x.close + 85_000, open: x.open + 85_000, high: x.high + 85_000, low: x.low + 85_000 })) }, { now: now0, price: 85_000 });
    computeKeyLevels(true);
    processKeyLevelView(getKeyLevels(), now0);
    installProvider({ kline_4h: closes(86_500, 86_500) }, { now: now0 + MS4, price: 86_500 });
    computeKeyLevels(true);
    processKeyLevelView(getKeyLevels(), now0 + MS4);
    expect(toasts()).toEqual([]);
    expect(getDeliveryLog()).toHaveLength(0);
  });
});

describe("plan-change toast", () => {
  const MS4 = KEY_TF_MS["4h"];
  const now0 = T0 + 12 * MS4 + 60_000;
  const view = (last: number) => {
    installProvider({ kline_4h: [...Array(11).fill(95), last, last].map((cl, i, a) => c(T0 + i * MS4, MS4, cl, i < a.length - 1)) }, { now: now0, price: last });
    computeKeyLevels(true);
    return getKeyLevels();
  };
  const lo = { id: "lo", price: 90, direction: "below" as const, name: "Unten" };
  const hi = { id: "hi", price: 100, direction: "above" as const, name: "Oben" };

  it("remembers the first plan, announces range → long once, never twice", () => {
    setLevels([lo, hi]);
    processPlanView(view(95), now0);
    expect(toasts()).toEqual([]);
    processPlanView(view(101), now0 + 1000);
    expect(toasts()).toEqual(["Plan: Range → Long"]);
    processPlanView(view(102), now0 + 2000);
    expect(toasts()).toHaveLength(1);
    expect(getDeliveryLog()[0]).toMatchObject({ source: "key", levelId: null, stage: null, outcome: "sent" });
  });

  it("is quiet for users without an own level (the old behaviour stays identical) until they switch it on", () => {
    const s = useJournal.getState().settings;
    useJournal.setState({ settings: { ...s, market: { ...DEFAULT_MARKET, longTrigger: 100, shortTrigger: 90, longStop: 0, invalidation: 0, lowerHigh: 0 }, keyLevels: undefined } as typeof s });
    processPlanView(view(95), now0);
    processPlanView(view(101), now0 + 1000);
    expect(toasts()).toEqual([]);
  });

  it("a feed gap (no candles) is no plan change", () => {
    setLevels([lo, hi]);
    processPlanView(view(95), now0);
    installProvider({}, { now: now0, price: 95 });
    computeKeyLevels(true);
    processPlanView(getKeyLevels(), now0 + 1000);
    processPlanView(view(95), now0 + 2000);
    expect(toasts()).toEqual([]);
  });
});

describe("Zustellprotokoll", () => {
  it("keeps the newest 200, survives a reload and can be cleared", () => {
    for (let i = 0; i < 230; i++) recordDelivery({ source: "key", levelId: "k", title: `t${i}`, detail: "", stage: "prepare", basis: null, channels: ["toast"], outcome: "sent", dedupeKey: `k|${i}|prepare` });
    expect(getDeliveryLog()).toHaveLength(200);
    expect(getDeliveryLog()[0]!.title).toBe("t229");
    __resetDeliveryLog();
    expect(getDeliveryLog()).toHaveLength(200);
    clearDeliveryLog();
    expect(getDeliveryLog()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem("tj2-keylevel-log")!)).toEqual([]);
  });
  it("shows the existing signal and box alerts as log lines", () => {
    logExternalDelivery("signal", "Starker Long-Einstieg", "Score 80");
    logExternalDelivery("box", "Ausbruch ↑", "Schluss über 90.000");
    expect(getDeliveryLog().map((r) => [r.source, r.outcome])).toEqual([["box", "sent"], ["signal", "sent"]]);
  });
});

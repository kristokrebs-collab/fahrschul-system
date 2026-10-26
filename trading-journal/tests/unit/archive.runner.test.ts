/**
 * Archive clock (F26): first tick after the start delay (or when the previous tick's interval is up), the status after a
 * tick, "no symbol", an error that does not stop the clock, the wake-up of a tab with an overdue tick, and the stop.
 * The timer is a manual queue, so nothing depends on the real clock.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TickRecord } from "@/domain/archive";
import type { Collector } from "@/market/archive/collector";
import { openArchiveDb, type ArchiveDb } from "@/market/archive/db";
import { RESUME_DELAY_MS, START_DELAY_MS, startArchiveRunner, type RunnerDeps } from "@/market/archive/runner";
import { __resetArchiveStore, getArchiveStatus, setArchiveCfg } from "@/market/archive/store";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 26, 2, 0, 0);

interface Timer {
  id: number;
  at: number;
  fn: () => void;
}

let now: number;
let timers: Timer[];
let nextId: number;
let db: ArchiveDb;
let closed: boolean;
let tickCalls: Array<{ symbols: readonly string[] }>;
let tickImpl: () => Promise<{ record: TickRecord; written: number; paused: "quota" | null }>;
let last: number | null;

const fakeCollector = (): Collector =>
  ({
    resume: async () => undefined,
    get lastTickAt() {
      return last;
    },
    tick: async (_cfg: unknown, symbols: readonly string[]) => {
      tickCalls.push({ symbols });
      return tickImpl();
    },
  }) as unknown as Collector;

const deps = (over: Partial<RunnerDeps> = {}): Partial<RunnerDeps> => ({
  open: async () => {
    const real = db;
    return { ...real, close: () => void (closed = true) } as ArchiveDb;
  },
  collector: () => fakeCollector(),
  now: () => now,
  setTimer: (fn, ms) => {
    const t = { id: nextId++, at: now + ms, fn };
    timers.push(t);
    return t.id;
  },
  clearTimer: (h) => void (timers = timers.filter((t) => t.id !== h)),
  observed: () => ["BTCUSDT", "ETHUSDT"],
  liveSymbol: () => "BTCUSDT",
  retain: () => () => undefined,
  startDelayMs: START_DELAY_MS,
  ...over,
});

/** Runs the earliest timer (time jumps to it). */
async function fire(): Promise<void> {
  const t = [...timers].sort((a, b) => a.at - b.at)[0]!;
  timers = timers.filter((x) => x !== t);
  now = Math.max(now, t.at);
  t.fn();
  await vi.waitFor(() => expect(getArchiveStatus().state).not.toBe("ticking"));
}
const settle = () => vi.waitFor(() => expect(timers.length).toBeGreaterThan(0));

beforeEach(async () => {
  localStorage.clear();
  __resetArchiveStore();
  db = await openArchiveDb({ factory: new IDBFactory(), name: "t-runner" });
  now = T0;
  timers = [];
  nextId = 1;
  closed = false;
  tickCalls = [];
  last = null;
  tickImpl = async () => ({ record: { t: now, iv: 10, route: "direct", res: { BTCUSDT: "ok" }, states: false }, written: 11, paused: null });
});
afterEach(() => db.close());

describe("archive runner", () => {
  it("waits the start delay for the first tick and reports 'idle' with the next time", async () => {
    setArchiveCfg({ on: true, picked: ["BTCUSDT"] });
    const stop = startArchiveRunner(deps());
    await settle();
    expect(getArchiveStatus()).toMatchObject({ state: "idle", nextTickAt: T0 + START_DELAY_MS });
    stop();
  });

  it("a previous tick 3 minutes ago at a 10-minute interval: next tick in 7 minutes", async () => {
    setArchiveCfg({ on: true, picked: ["BTCUSDT"] });
    last = T0 - 3 * MIN;
    const stop = startArchiveRunner(deps());
    await settle();
    // 3 min ago + 10 min = 7 min from now – later than the 15 s start delay
    expect(getArchiveStatus().nextTickAt).toBe(T0 + 7 * MIN);
    stop();
  });

  it("an overdue previous tick still waits the start delay", async () => {
    setArchiveCfg({ on: true, picked: ["BTCUSDT"] });
    last = T0 - 3 * 60 * MIN;
    const stop = startArchiveRunner(deps());
    await settle();
    expect(getArchiveStatus().nextTickAt).toBe(T0 + START_DELAY_MS);
    stop();
  });

  it("ticks with the chosen symbols, publishes the result and schedules the next tick one interval after the start", async () => {
    setArchiveCfg({ on: true, picked: ["ETHUSDT", "SOLUSDT"] });
    const stop = startArchiveRunner(deps());
    await settle();
    await fire();
    expect(tickCalls).toEqual([{ symbols: ["ETHUSDT", "SOLUSDT"] }]);
    const st = getArchiveStatus();
    expect(st).toMatchObject({ state: "idle", ticks: 1, lastTickAt: T0 + START_DELAY_MS, lastRes: { BTCUSDT: "ok" }, route: "direct" });
    expect(st.rev).toBe(1);
    // the tick took no time in this test → the next one is a full interval away
    expect(st.nextTickAt).toBe(T0 + START_DELAY_MS + 10 * MIN);
    stop();
  });

  it("automatic choice = the observed symbols", async () => {
    setArchiveCfg({ on: true });
    const stop = startArchiveRunner(deps());
    await settle();
    await fire();
    expect(tickCalls[0]!.symbols).toEqual(["BTCUSDT", "ETHUSDT"]);
    stop();
  });

  it("says so when there is no symbol and keeps the clock", async () => {
    setArchiveCfg({ on: true, picked: [] });
    const stop = startArchiveRunner(deps());
    await settle();
    await fire();
    expect(tickCalls).toEqual([]);
    expect(getArchiveStatus()).toMatchObject({ state: "empty" });
    expect(getArchiveStatus().detail).toContain("Kein Symbol");
    expect(timers.length).toBe(1);
    stop();
  });

  it("an error in a tick shows its message and the clock goes on", async () => {
    setArchiveCfg({ on: true, picked: ["BTCUSDT"] });
    tickImpl = async () => {
      throw new Error("Platte kaputt");
    };
    const stop = startArchiveRunner(deps());
    await settle();
    await fire();
    expect(getArchiveStatus()).toMatchObject({ state: "error", detail: "Platte kaputt" });
    expect(timers.length).toBe(1);
    stop();
  });

  it("a paused tick (browser storage nearly full) shows the quota state", async () => {
    setArchiveCfg({ on: true, picked: ["BTCUSDT"] });
    tickImpl = async () => ({ record: { t: now, iv: 10, route: "direct", res: { BTCUSDT: "quota" }, states: false }, written: 0, paused: "quota" });
    const stop = startArchiveRunner(deps());
    await settle();
    await fire();
    expect(getArchiveStatus().state).toBe("quota");
    stop();
  });

  it("does not tick when the switch went off meanwhile", async () => {
    setArchiveCfg({ on: true, picked: ["BTCUSDT"] });
    const stop = startArchiveRunner(deps());
    await settle();
    setArchiveCfg({ on: false });
    await fire().catch(() => undefined);
    expect(tickCalls).toEqual([]);
    stop();
  });

  it("a tab that wakes up with an overdue tick runs it after a short pause", async () => {
    setArchiveCfg({ on: true, picked: ["BTCUSDT"] });
    const stop = startArchiveRunner(deps());
    await settle();
    now = T0 + 2 * 60 * MIN; // slept past the planned time
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getArchiveStatus().nextTickAt).toBe(now + RESUME_DELAY_MS);
    stop();
  });

  it("stop clears the clock, closes the database and reports 'off'", async () => {
    setArchiveCfg({ on: true, picked: ["BTCUSDT"] });
    const stop = startArchiveRunner(deps());
    await settle();
    stop();
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(timers).toEqual([]);
    expect(getArchiveStatus().state).toBe("off");
  });

  it("without IndexedDB the status says so", async () => {
    setArchiveCfg({ on: true });
    const stop = startArchiveRunner(deps({ open: () => openArchiveDb({ factory: null }) }));
    await vi.waitFor(() => expect(getArchiveStatus().state).toBe("unavailable"));
    stop();
  });
});

/**
 * F32 Automatische Auswertung: the idle runner (`signalAuto.ts`) with a FAKE scheduler, clock and environment and a mocked
 * history source. It reads only what is missing (final outcomes are skipped), at most 20 signals / 3 markets per run with a
 * wait between runs, holds back in a background tab / with data saving / low battery / offline and says why, stops a run in
 * flight when the tab goes to the background, turns a failed load into „nicht auswertbar“ (never a result) and reads an open
 * signal again only with a newer candle.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SignalEvent } from "@/domain/missed";
import { __resetAuto, __setAutoDeps, AUTO_BG_RUNS, AUTO_GAP_MS, AUTO_PAGE_WAIT_MS, AUTO_RECHECK_MS, pauseReason, requestAutoOutcomes, retainAuto, type AutoEnv } from "@/views/coach/signalAuto";
import { __resetOutcomes, computeOutcomes, getAttempts, getOutcomeState, OUTCOME_CACHE_KEY } from "@/views/coach/signalOutcomes";
import { H, signalEvent } from "./missed.fixtures";

const M15 = 900_000;
const START = new Date(2026, 2, 6, 12, 7).getTime();

const loadLabData = vi.fn();
vi.mock("@/views/labor/historySource", () => ({
  loadLabData: (req: unknown) => loadLabData(req),
  loadErrorKind: (e: unknown) => (e as { kind?: string })?.kind ?? "failed",
}));

/** A manual scheduler: `later` queues, `next()` advances the fake clock to the earliest task and runs it. */
class Fake {
  now = START;
  tasks: { at: number; cb: () => void; live: boolean }[] = [];
  env: AutoEnv = { hidden: false, saveData: false, batteryLow: false, offline: false };
  events: SignalEvent[] = [];
  watcher: (() => void) | null = null;
  unwatched = 0;
  later = (cb: () => void, ms: number) => {
    const t = { at: this.now + ms, cb, live: true };
    this.tasks.push(t);
    return () => void (t.live = false);
  };
  get pending(): number {
    return this.tasks.filter((t) => t.live).length;
  }
  /** wait (ms) until the next queued task */
  get nextIn(): number | null {
    const live = this.tasks.filter((t) => t.live);
    return live.length ? Math.min(...live.map((t) => t.at)) - this.now : null;
  }
  /** runs the earliest queued task and waits until the run it started is over */
  async next(): Promise<void> {
    const live = this.tasks.filter((t) => t.live).sort((a, b) => a.at - b.at);
    const t = live[0];
    if (!t) throw new Error("nothing queued");
    t.live = false;
    this.now = Math.max(this.now, t.at);
    t.cb();
    await vi.waitFor(() => expect(getOutcomeState().auto.phase).not.toBe("running"));
    await new Promise((r) => setTimeout(r, 0));
  }
}

let fake: Fake;
const ev = (key: string, ago: number, over: Partial<SignalEvent> = {}): SignalEvent => signalEvent({ key, at: fake.now - ago, symbol: "BTCUSDT", stop: 95, target: 110, ...over });

/** Quiet 15m candles over the asked span: every signal reads as „noch offen“; `WIN…` markets reach the target at once. */
function candles(req: { symbol: string; from: number; to: number; intervals: string[] }) {
  const win = req.symbol.startsWith("WIN");
  const out: { t: number; o: number; h: number; l: number; c: number }[] = [];
  const iv = req.intervals[0] === "1h" ? 3_600_000 : M15;
  for (let t = req.from; t + iv <= Math.min(req.to, fake.now); t += iv) out.push({ t: t / 1000, o: 100, h: win ? 111 : 102, l: 99, c: 100 });
  return { data: { [req.intervals[0]!]: out }, funding: null, pages: 1, viaProxy: false };
}

beforeEach(() => {
  fake = new Fake();
  localStorage.removeItem(OUTCOME_CACHE_KEY);
  __resetOutcomes();
  loadLabData.mockReset();
  loadLabData.mockImplementation(async (req: Parameters<typeof candles>[0]) => candles(req));
  __setAutoDeps({
    now: () => fake.now,
    later: fake.later,
    env: () => fake.env,
    archive: () => fake.events,
    watch: (cb) => {
      fake.watcher = cb;
      return () => void (fake.unwatched += 1);
    },
  });
});

describe("pauseReason", () => {
  it("names why the app holds back, in German; nothing means it may run", () => {
    expect(pauseReason({ hidden: false, saveData: false, batteryLow: false, offline: false })).toBeNull();
    expect(pauseReason({ hidden: true, saveData: false, batteryLow: false, offline: false })).toBe("die App ist im Hintergrund");
    expect(pauseReason({ hidden: false, saveData: true, batteryLow: false, offline: false })).toBe("der Datensparmodus ist an");
    expect(pauseReason({ hidden: false, saveData: false, batteryLow: true, offline: false })).toBe("der Akku ist schwach");
    expect(pauseReason({ hidden: false, saveData: false, batteryLow: false, offline: true })).toBe("du bist offline");
  });
});

describe("the automatic run", () => {
  it("does nothing – no timer, no request – when the archive is empty or every outcome is final", async () => {
    requestAutoOutcomes("page");
    expect(fake.pending).toBe(0);
    expect(getOutcomeState().auto.phase).toBe("idle");

    // two signals, both decided: the click-equivalent run has put them into the final cache
    const a = ev("a", 5 * H, { symbol: "WINUSDT" });
    const b = ev("b", 6 * H, { symbol: "WINUSDT" });
    fake.events = [a, b];
    await computeOutcomes(fake.events, fake.now);
    expect(getOutcomeState().outcomes.get(a.id)!.kind).toBe("target");
    loadLabData.mockClear();
    __resetOutcomes(); // a reload
    requestAutoOutcomes("page");
    expect(fake.pending).toBe(0);
    expect(loadLabData).not.toHaveBeenCalled();
    expect(getOutcomeState().outcomes.get(a.id)!.kind).toBe("target"); // shown from the cache at once
  });

  it("reads only what is missing, in an idle moment after the page wait, and skips the final results", async () => {
    const done = ev("done", 8 * H, { symbol: "WINUSDT" });
    await computeOutcomes([done], fake.now); // final and cached
    __resetOutcomes();
    loadLabData.mockClear();
    const missing = ev("missing", 5 * H, { symbol: "ETHUSDT" });
    fake.events = [done, missing];

    requestAutoOutcomes("page");
    expect(getOutcomeState().auto.phase).toBe("queued");
    expect(fake.nextIn).toBe(AUTO_PAGE_WAIT_MS);
    expect(loadLabData).not.toHaveBeenCalled(); // nothing before the idle moment
    await fake.next();

    expect(loadLabData).toHaveBeenCalledTimes(1);
    expect(loadLabData.mock.calls[0]![0]).toMatchObject({ symbol: "ETHUSDT", intervals: ["15m"], funding: false });
    expect(getOutcomeState().outcomes.get(done.id)!.kind).toBe("target");
    expect(getOutcomeState().outcomes.get(missing.id)!.kind).toBe("open");
    expect(getOutcomeState()).toMatchObject({ via: "auto", status: "done" });
    expect(getOutcomeState().auto.phase).toBe("idle");
    expect(fake.pending).toBe(0); // nothing else due, no page held open: no more timers
  });

  it("several callers in a row become ONE queued run", () => {
    fake.events = [ev("a", 5 * H)];
    requestAutoOutcomes("page");
    requestAutoOutcomes("page");
    requestAutoOutcomes("page");
    expect(fake.pending).toBe(1);
  });

  it("at most 20 signals per run, then a wait between the runs", async () => {
    fake.events = Array.from({ length: 25 }, (_, i) => ev(`m${i}`, (i + 2) * H));
    const release = retainAuto(); // a page is open: the run goes on until nothing is due
    requestAutoOutcomes("page");
    await fake.next();
    expect(Object.keys(Object.fromEntries(getOutcomeState().outcomes))).toHaveLength(20);
    expect(loadLabData).toHaveBeenCalledTimes(1); // one market, one load for the whole batch
    expect(getOutcomeState().auto.phase).toBe("queued");
    expect(fake.nextIn).toBe(AUTO_GAP_MS); // not before the wait
    await fake.next();
    expect(getOutcomeState().outcomes.size).toBe(25);
    expect(getOutcomeState().auto.phase).toBe("idle");
    release();
  });

  it("at most 3 markets per run", async () => {
    const syms = ["AAAUSDT", "BBBUSDT", "CCCUSDT", "DDDUSDT"];
    fake.events = syms.map((s, i) => ev(`s${i}`, (i + 2) * H, { symbol: s }));
    const release = retainAuto();
    requestAutoOutcomes("page");
    await fake.next();
    expect(loadLabData.mock.calls.map((c) => (c[0] as { symbol: string }).symbol)).toEqual(["AAAUSDT", "BBBUSDT", "CCCUSDT"]);
    await fake.next();
    expect(loadLabData.mock.calls.map((c) => (c[0] as { symbol: string }).symbol)).toContain("DDDUSDT");
    release();
  });

  it("without a page open it stops after the runs of the start trigger; with one it goes on", async () => {
    fake.events = Array.from({ length: 100 }, (_, i) => ev(`b${i}`, (i + 2) * H));
    requestAutoOutcomes("start");
    expect(fake.nextIn).toBe(0);
    for (let run = 0; run < AUTO_BG_RUNS; run++) await fake.next();
    expect(getOutcomeState().outcomes.size).toBe(AUTO_BG_RUNS * 20);
    expect(fake.pending).toBe(0); // 40 signals still wait; the next page opening or app start takes them
    expect(getOutcomeState().auto.phase).toBe("idle");
  });

  it("the last page to close cancels a run that has not started", () => {
    fake.events = [ev("a", 5 * H)];
    const release = retainAuto();
    requestAutoOutcomes("page");
    expect(fake.pending).toBe(1);
    release();
    expect(fake.pending).toBe(0);
    expect(getOutcomeState().auto.phase).toBe("idle");
  });
});

describe("holding back", () => {
  it.each([
    [{ hidden: true }, "die App ist im Hintergrund"],
    [{ saveData: true }, "der Datensparmodus ist an"],
    [{ batteryLow: true }, "der Akku ist schwach"],
    [{ offline: true }, "du bist offline"],
  ] as [Partial<AutoEnv>, string][])("%j: nothing is requested, the reason is shown, and it resumes by itself", async (flag, why) => {
    fake.events = [ev("a", 5 * H)];
    fake.env = { ...fake.env, ...flag };
    requestAutoOutcomes("page");
    expect(getOutcomeState().auto).toEqual({ phase: "paused", why });
    expect(fake.pending).toBe(0);
    expect(loadLabData).not.toHaveBeenCalled();
    // the browser lifts the reason
    fake.env = { hidden: false, saveData: false, batteryLow: false, offline: false };
    fake.watcher!();
    expect(getOutcomeState().auto.phase).toBe("queued");
    await fake.next();
    expect(loadLabData).toHaveBeenCalledTimes(1);
    expect(getOutcomeState().outcomes.size).toBe(1);
  });

  it("a run in flight stops when the tab goes to the background: what it read stays, the rest waits, no error", async () => {
    const a = ev("a", 6 * H, { symbol: "WINUSDT" });
    const b = ev("b", 5 * H, { symbol: "ETHUSDT" });
    fake.events = [a, b];
    let proceed: () => void = () => undefined;
    loadLabData.mockImplementation(
      (req: Parameters<typeof candles>[0]) =>
        new Promise((resolve) => {
          proceed = () => resolve(candles(req));
        }),
    );
    requestAutoOutcomes("page");
    const running = fake.next();
    await vi.waitFor(() => expect(loadLabData).toHaveBeenCalledTimes(1));
    expect(getOutcomeState().auto.phase).toBe("running");
    fake.env = { ...fake.env, hidden: true };
    fake.watcher!(); // the tab goes away while the first market loads
    proceed();
    await running;
    expect(loadLabData).toHaveBeenCalledTimes(1); // the second market was never asked
    expect(getOutcomeState().outcomes.get(a.id)!.kind).toBe("target");
    expect(getOutcomeState().outcomes.has(b.id)).toBe(false);
    expect(getOutcomeState().error).toBeNull();
    expect(getOutcomeState().auto).toEqual({ phase: "paused", why: "die App ist im Hintergrund" });
    expect(getAttempts().has(b.id)).toBe(false);

    // shown again: it picks up the signal it never read
    fake.env = { ...fake.env, hidden: false };
    loadLabData.mockImplementation(async (req: Parameters<typeof candles>[0]) => candles(req));
    fake.watcher!();
    await fake.next();
    expect(getOutcomeState().outcomes.get(b.id)!.kind).toBe("open");
  });

  it("does not start while the click is reading; it tries again a little later", async () => {
    fake.events = [ev("a", 5 * H)];
    let release: () => void = () => undefined;
    loadLabData.mockImplementationOnce(
      (req: Parameters<typeof candles>[0]) =>
        new Promise((resolve) => {
          release = () => resolve(candles(req));
        }),
    );
    const click = computeOutcomes(fake.events, fake.now, { via: "manual" });
    await vi.waitFor(() => expect(loadLabData).toHaveBeenCalledTimes(1));
    requestAutoOutcomes("page");
    fake.now += AUTO_PAGE_WAIT_MS;
    // the queued task fires while the click is still running: it re-queues instead of overlapping
    const t = fake.tasks.find((x) => x.live)!;
    t.live = false;
    t.cb();
    expect(fake.pending).toBe(1);
    expect(loadLabData).toHaveBeenCalledTimes(1);
    release();
    await click;
  });
});

describe("failures and open signals", () => {
  it("a failed load becomes „nicht auswertbar“ with the reason – never a result – and is retried only after 30 minutes", async () => {
    const e = ev("down", 5 * H);
    fake.events = [e];
    loadLabData.mockRejectedValue(Object.assign(new Error("x"), { kind: "blocked" }));
    const release = retainAuto();
    requestAutoOutcomes("page");
    await fake.next();
    const o = getOutcomeState().outcomes.get(e.id)!;
    expect(o).toMatchObject({ kind: "unusable", r: null });
    expect(o.reason).toContain("nicht erreichbar");
    expect(getOutcomeState().error).toContain("1 Signal ohne Marktdaten");
    expect(JSON.parse(localStorage.getItem(OUTCOME_CACHE_KEY)!).items).toEqual({}); // never stored as a result
    expect(loadLabData).toHaveBeenCalledTimes(1);
    // not asked again at once: the next look is the 15-minute check of the open page, and it finds nothing due
    expect(fake.nextIn).toBe(AUTO_RECHECK_MS);
    await fake.next();
    expect(loadLabData).toHaveBeenCalledTimes(1);
    // after 30 minutes the network is back
    loadLabData.mockImplementation(async (req: Parameters<typeof candles>[0]) => candles(req));
    fake.now += 31 * 60_000;
    requestAutoOutcomes("page");
    await fake.next();
    expect(getOutcomeState().outcomes.get(e.id)!.kind).toBe("open");
    release();
  });

  it("an open signal is read again only when a newer candle exists – and a page that stays open looks every 15 minutes", async () => {
    const e = ev("o", 5 * H);
    fake.events = [e];
    const release = retainAuto();
    requestAutoOutcomes("page");
    await fake.next();
    expect(getOutcomeState().outcomes.get(e.id)!.kind).toBe("open");
    expect(loadLabData).toHaveBeenCalledTimes(1);
    expect(fake.nextIn).toBe(AUTO_RECHECK_MS); // nothing due, but the page is open: look again later
    // a fresh request in the same candle: nothing to read
    requestAutoOutcomes("page");
    expect(getOutcomeState().auto.phase).toBe("idle");
    // 16 minutes on: a newer candle has closed → the look at the 15-minute mark reads it again
    await fake.next();
    expect(loadLabData).toHaveBeenCalledTimes(2);
    expect(getAttempts().get(e.id)!.at).toBe(fake.now);
    release();
    expect(fake.pending).toBe(0); // the last page closed: no more timers
  });

  it("a signal too fresh to have a closed candle is not read yet", () => {
    fake.events = [ev("fresh", 60_000)];
    requestAutoOutcomes("page");
    expect(fake.pending).toBe(0);
    expect(loadLabData).not.toHaveBeenCalled();
  });

  it("„Neu berechnen“ (the click) forces the open ones at once – the automatic rule does not apply to it", async () => {
    const e = ev("o", 5 * H);
    fake.events = [e];
    await computeOutcomes(fake.events, fake.now);
    expect(loadLabData).toHaveBeenCalledTimes(1);
    await computeOutcomes(fake.events, fake.now + 60_000); // one minute later, no new candle
    expect(loadLabData).toHaveBeenCalledTimes(2);
  });
});

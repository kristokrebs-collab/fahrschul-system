/**
 * „Börsenhistorie nachladen“ (F26/F07), the run: a fake Binance (the documented shapes of openInterestHist, the three ratios,
 * fundingRate and markPriceKlines, answering by `startTime` / `endTime` / `limit` like the exchange) on fake-indexeddb.
 * What lands in the store (own `…Hist` series, values as given, collected rows untouched), the windows and the pacing, the
 * route fallback to the proxy, a cancelled run, a rate limit, an unreachable exchange, a half-failed dataset, the storage
 * quota, the collector's ring leaving the loaded rows alone, and the controller (one run at a time, the log).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { backfillRange, type ArchivePoint, type BackfillRun } from "@/domain/archive";
import { DEFAULT_ARCHIVE_CFG } from "@/domain/archive";
import { BACKFILL_GAP_MS, runBackfill, type BackfillDeps, type BackfillProgress } from "@/market/archive/backfill";
import { __resetBackfillLog, getBackfillLog, lastRunFor } from "@/market/archive/backfillLog";
import { __resetBackfill, cancelBackfill, getBackfillState, startBackfill } from "@/market/archive/backfillStore";
import { Collector, type CollectorDeps } from "@/market/archive/collector";
import { openArchiveDb, type ArchiveDb } from "@/market/archive/db";
import { binanceRest, BINANCE_REST } from "@/market/sources/binance";
import { proxyRest } from "@/market/sources/proxy";
import { STEP, host, longAt, net, oiAt, pathOf, type Net } from "./archive.backfill.harness";

const MIN = 60_000;
const H = 60 * MIN;
/** 2026-10-26 12:03:00 UTC */
const NOW = Date.UTC(2026, 9, 26, 12, 3, 0);

const net0 = (): Net => net();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let db: ArchiveDb;
let direct: Net;
let proxy: Net;
let online = true;
let est: { usage: number; quota: number } | null;
let sleeps: number[];

function deps(over: Partial<BackfillDeps> = {}): BackfillDeps {
  return {
    db,
    rest: () => binanceRest({ base: BINANCE_REST, fetch: host(direct, "direct", NOW), now: () => NOW }),
    proxy: () => proxyRest({ fetch: host(proxy, "proxy", NOW), now: () => NOW }),
    now: () => NOW,
    sleep: async (ms) => void sleeps.push(ms),
    online: () => online,
    estimate: async () => est,
    ...over,
  };
}

const count = async (series: string, symbol = "BTCUSDT"): Promise<number> => (await db.overview()).find((r) => r.series === series && r.symbol === symbol)?.count ?? 0;

beforeEach(async () => {
  db = await openArchiveDb({ factory: new IDBFactory(), name: "t-backfill" });
  direct = net0();
  proxy = net0();
  online = true;
  est = null;
  sleeps = [];
  localStorage.clear();
  __resetBackfill();
});

describe("a full run (7 days, one symbol)", () => {
  it("stores the six datasets as their own series with the values as the exchange gave them", async () => {
    const reports: BackfillProgress[] = [];
    const run = await runBackfill(deps(), { symbols: ["BTCUSDT"], days: 7, onProgress: (p) => reports.push(p) });
    expect(run.end).toBe("done");
    expect(run.route).toBe("direct");
    expect(run.symbols).toEqual(["BTCUSDT"]);
    const { from, to } = backfillRange(7, NOW);
    // 7 d: 2 016 five-minute points per dataset (12:05 … 12:00 a week later), 21 settlements (every 8 h at 00/08/16 UTC)
    expect(await count("oiHist")).toBe(2016);
    expect(await count("lsAccHist")).toBe(2016);
    expect(await count("lsTopPosHist")).toBe(2016);
    expect(await count("lsTopAccHist")).toBe(2016);
    expect(await count("fundingHist")).toBe(21);
    // the mark price: candles open from `from` on, stamped with their END; the one that has not closed (open 11:55 → closes 12:00 − 1 ms … still closed at 12:03; the 12:00 one is forming) is dropped
    const marks = await db.range("markHist", "BTCUSDT", 0, NOW + H);
    expect(marks[0]!.t).toBe(from + STEP);
    expect(marks[marks.length - 1]!.t).toBe(to); // the candle opening 11:55 ends 12:00; the candle opening 12:00 is still forming at 12:03 and is not taken
    expect(run.points).toBe(2016 * 4 + 21 + marks.length);
    // nothing but the loaded rows exist: the collected series are untouched
    expect((await db.overview()).every((r) => r.series.endsWith("Hist"))).toBe(true);
    // a value as the exchange gave it, and the percent conversion of the ratio
    const oi = (await db.range("oiHist", "BTCUSDT", from, from))[0]!;
    expect(oi.d).toEqual({ oi: oiAt(from), value: oiAt(from) * 80_000 });
    const ls = (await db.range("lsAccHist", "BTCUSDT", to, to))[0]!;
    expect(ls.d.long).toBeCloseTo(longAt(to, "global"), 9);
    expect(ls.d.short).toBeCloseTo(100 - longAt(to, "global"), 9);
    const fund = await db.range("fundingHist", "BTCUSDT", 0, NOW);
    expect(fund[0]!.d).toEqual({ rate: 0.0001 });
    // progress: it started at 0 of 23 and ended at 23 of 23
    expect(reports[0]).toMatchObject({ state: "running", requestsDone: 0, requestsTotal: 23 });
    expect(reports[reports.length - 1]).toMatchObject({ state: "done", requestsDone: 23, requestsTotal: 23 });
    expect(run.res.BTCUSDT).toEqual({ fundingHist: "ok", markHist: "ok", oiHist: "ok", lsAccHist: "ok", lsTopPosHist: "ok", lsTopAccHist: "ok" });
  });

  it("asks in windows within the documented limits, one request at a time, with a pause between the requests", async () => {
    await runBackfill(deps(), { symbols: ["BTCUSDT"], days: 7 });
    expect(direct.calls).toHaveLength(23);
    expect(direct.calls.filter((c) => c.endsWith("openInterestHist"))).toHaveLength(5);
    expect(direct.calls.filter((c) => c.endsWith("markPriceKlines"))).toHaveLength(2);
    expect(direct.calls.filter((c) => c.endsWith("fundingRate"))).toHaveLength(1);
    expect(proxy.calls).toEqual([]);
    expect(sleeps).toHaveLength(22);
    expect(sleeps.every((ms) => ms === BACKFILL_GAP_MS)).toBe(true);
  });

  it("a second run over the same range writes the same keys (no duplicates) and a later run extends the row", async () => {
    await runBackfill(deps(), { symbols: ["BTCUSDT"], days: 7 });
    await runBackfill(deps(), { symbols: ["BTCUSDT"], days: 7 });
    expect(await count("oiHist")).toBe(2016);
    await runBackfill(deps({ now: () => NOW + 2 * H }), { symbols: ["BTCUSDT"], days: 7 });
    expect(await count("oiHist")).toBe(2016 + 24); // two more hours = 24 more steps
  });

  it("never touches what the collector wrote: a collected row stays exactly as it was", async () => {
    const mine: ArchivePoint = { series: "oi", symbol: "BTCUSDT", t: NOW - 10 * MIN, d: { oi: 777 } };
    await db.putPoints([mine, { series: "premium", symbol: "BTCUSDT", t: NOW, d: { mark: 1, index: 1, rate: 0.1, next: 0 } }]);
    await runBackfill(deps(), { symbols: ["BTCUSDT"], days: 7 });
    expect(await db.range("oi", "BTCUSDT", 0, NOW)).toEqual([mine]);
    expect(await count("premium")).toBe(1);
    expect(await count("oiHist")).toBe(2016);
  });

  it("only the exchange's holdings are stored: a stretch it does not hold stays a gap, nothing is filled", async () => {
    direct.holdsFrom = NOW - 2 * DAY_MS; // the exchange holds 2 days only
    const run = await runBackfill(deps(), { symbols: ["BTCUSDT"], days: 7 });
    expect(run.end).toBe("done");
    const times = await db.times("oiHist", "BTCUSDT");
    expect(times[0]).toBe(Math.ceil((NOW - 2 * DAY_MS) / STEP) * STEP);
    expect(times).toHaveLength(Math.floor((backfillRange(7, NOW).to - times[0]!) / STEP) + 1);
  });
});
const DAY_MS = 24 * H;

describe("routes and failures", () => {
  it("a 451 from Binance directly is retried through the EU proxy, and the rest of the run stays on it", async () => {
    direct.all = 451;
    const run = await runBackfill(deps(), { symbols: ["BTCUSDT"], days: 7 });
    expect(run.end).toBe("done");
    expect(run.route).toBe("proxy");
    expect(direct.calls).toHaveLength(1); // only the first request tried the direct way
    expect(proxy.calls).toHaveLength(23);
    expect(await count("oiHist")).toBe(2016);
  });

  it("a rate limit ends the run at once: what is stored stays, the rest is 'skipped', the reason is said", async () => {
    direct.status["/futures/data/openInterestHist"] = 429;
    proxy.status["/futures/data/openInterestHist"] = 429;
    const run = await runBackfill(deps(), { symbols: ["BTCUSDT", "ETHUSDT"], days: 7 });
    expect(run.end).toBe("failed");
    expect(run.res.BTCUSDT).toMatchObject({ fundingHist: "ok", markHist: "ok", oiHist: "rate_limited", lsAccHist: "skipped", lsTopPosHist: "skipped", lsTopAccHist: "skipped" });
    expect(run.res.ETHUSDT).toEqual({ fundingHist: "skipped", markHist: "skipped", oiHist: "skipped", lsAccHist: "skipped", lsTopPosHist: "skipped", lsTopAccHist: "skipped" });
    expect(await count("markHist")).toBeGreaterThan(0);
    expect(await count("oiHist")).toBe(0);
    expect(await count("fundingHist", "ETHUSDT")).toBe(0);
  });

  it("two failed windows in a row skip the rest of that dataset; the other datasets still load", async () => {
    direct.status["/futures/data/globalLongShortAccountRatio"] = 500;
    proxy.status["/futures/data/globalLongShortAccountRatio"] = 500;
    const run = await runBackfill(deps(), { symbols: ["BTCUSDT"], days: 7 });
    expect(run.end).toBe("done");
    expect(run.res.BTCUSDT!.lsAccHist).toBe("http_5xx");
    expect(run.res.BTCUSDT!.lsTopPosHist).toBe("ok");
    expect(direct.calls.filter((c) => c.endsWith("globalLongShortAccountRatio"))).toHaveLength(2);
    expect(await count("lsAccHist")).toBe(0);
    expect(await count("lsTopPosHist")).toBe(2016);
  });

  it("a dataset that came in part is 'partial:<reason>': the windows that came stay, the others are a gap", async () => {
    // the third window of the open-interest dataset fails once (and the proxy fails too), the next ones answer again
    let n = 0;
    const base = host(direct, "direct", NOW);
    const flaky = async (input: string): Promise<Response> => {
      if (pathOf(input) === "/futures/data/openInterestHist" && ++n === 3) return json({ code: -1 }, 500);
      return base(input);
    };
    const run = await runBackfill(deps({ rest: () => binanceRest({ base: BINANCE_REST, fetch: flaky, now: () => NOW }), proxy: () => null }), { symbols: ["BTCUSDT"], days: 7 });
    expect(run.res.BTCUSDT!.oiHist).toBe("partial:http_5xx");
    expect(await count("oiHist")).toBe(2016 - 480);
  });

  it("an exchange that cannot be reached at all ends the run after three datasets in a row – it does not ask 100 times", async () => {
    direct.all = 451;
    proxy.all = 451;
    const run = await runBackfill(deps(), { symbols: ["BTCUSDT", "ETHUSDT"], days: 30 });
    expect(run.end).toBe("failed");
    expect(run.res.BTCUSDT!.fundingHist).toBe("blocked_451");
    expect(run.res.BTCUSDT!.lsAccHist).toBe("skipped");
    expect(run.res.ETHUSDT!.oiHist).toBe("skipped");
    expect(direct.calls.length + proxy.calls.length).toBeLessThan(12);
    expect(run.points).toBe(0);
  });

  it("offline ends the run at once", async () => {
    online = false;
    const run = await runBackfill(deps(), { symbols: ["BTCUSDT"], days: 7 });
    expect(run.end).toBe("failed");
    expect(run.res.BTCUSDT!.fundingHist).toBe("offline");
    expect(direct.calls).toEqual([]);
  });

  it("a nearly full browser storage stops the run with the reason; what was stored stays", async () => {
    let calls = 0;
    const run = await runBackfill(deps({ estimate: async () => (++calls > 3 ? { usage: 95, quota: 100 } : { usage: 10, quota: 100 }) }), { symbols: ["BTCUSDT"], days: 7 });
    expect(run.end).toBe("failed");
    expect(Object.values(run.res.BTCUSDT!)).toContain("quota");
    expect(await count("fundingHist")).toBe(21);
  });

  it("no symbol: nothing is asked", async () => {
    const run = await runBackfill(deps(), { symbols: [], days: 7 });
    expect(run.end).toBe("failed");
    expect(direct.calls).toEqual([]);
  });
});

describe("cancel", () => {
  it("stops between requests: the points so far stay, the rest is 'skipped', the dataset in progress is 'partial:cancelled'", async () => {
    const ctrl = new AbortController();
    let slept = 0;
    // fundingHist 1 request + markHist 2 + oiHist 5 → cancel after the 5th pause (the 6th request is the 3rd of the open interest)
    const run = await runBackfill(deps({ sleep: async () => void (++slept === 5 && ctrl.abort()) }), { symbols: ["BTCUSDT"], days: 7, signal: ctrl.signal });
    expect(run.end).toBe("cancelled");
    expect(run.res.BTCUSDT).toMatchObject({ fundingHist: "ok", markHist: "ok", oiHist: "partial:cancelled", lsAccHist: "skipped" });
    expect(await count("oiHist")).toBe(480 * 2);
    expect(await count("lsAccHist")).toBe(0);
    expect(direct.calls).toHaveLength(5);
  });
});

describe("the collector's ring leaves the loaded rows alone", () => {
  const collectorDeps = (): CollectorDeps => ({ db, rest: () => binanceRest({ fetch: host(direct, "d", NOW), now: () => NOW }), proxy: () => null, now: () => NOW, sleep: async () => undefined, online: () => true, readStates: () => [], estimate: async () => null });

  it("the loaded rows are not counted into the share: 8 collected rows of 7 000 points stay whole at 10 MB (counted, the share would be 5 448)", async () => {
    // 10 MB / 131 B (mean of the nine collected series) / 8 rows = 9 534 → the row cap 8 640 rules; with the six loaded rows counted
    // too it would be 10 MB / 131 B / 14 = 5 448 and the collected rows would lose points
    await runBackfill(deps(), { symbols: ["BTCUSDT"], days: 7 });
    const t0 = NOW - 7000 * MIN;
    const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LTCUSDT"];
    for (const symbol of symbols) await db.putPoints(Array.from({ length: 7000 }, (_, i): ArchivePoint => ({ series: "oi", symbol, t: t0 + i * MIN, d: { oi: i } })));
    const removed = await new Collector(collectorDeps()).trim(10);
    expect(removed).toBe(0);
    expect(await count("oi", "DOGEUSDT")).toBe(7000);
    expect(await count("oiHist")).toBe(2016);
    expect(await count("markHist")).toBeGreaterThan(2000);
  }, 60_000);

  it("a collected row beyond its own cap is trimmed, the loaded rows are not", async () => {
    await runBackfill(deps(), { symbols: ["BTCUSDT"], days: 7 });
    const t0 = NOW - 9000 * MIN;
    await db.putPoints(Array.from({ length: 9000 }, (_, i): ArchivePoint => ({ series: "oi", symbol: "BTCUSDT", t: t0 + i * MIN, d: { oi: i } })));
    const removed = await new Collector(collectorDeps()).trim(100);
    expect(removed).toBe(9000 - 8640);
    expect(await count("oi")).toBe(8640);
    expect(await count("oiHist")).toBe(2016);
  }, 60_000);
});

describe("the controller", () => {
  const over = () => ({ open: async () => db, deps: () => deps() });
  const runOnce = async (): Promise<BackfillRun | null> => startBackfill(["BTCUSDT"], 7, { open: async () => openArchiveDb({ factory: new IDBFactory(), name: "t-backfill-ctl" }), deps: (d) => deps({ db: d }) });

  it("runs one load, keeps its progress, writes the log (newest first) and says which symbols it has data for", async () => {
    const run = await runOnce();
    expect(run?.end).toBe("done");
    expect(getBackfillState()).toMatchObject({ phase: "idle", error: null });
    expect(getBackfillState().progress).toMatchObject({ state: "done", requestsDone: 23 });
    expect(getBackfillLog()).toHaveLength(1);
    expect(getBackfillLog()[0]).toMatchObject({ days: 7, symbols: ["BTCUSDT"], end: "done" });
    expect(lastRunFor("BTCUSDT")?.t).toBe(NOW);
    expect(lastRunFor("ETHUSDT")).toBeNull();
    // the log survives a reload of the module state
    __resetBackfillLog();
    expect(getBackfillLog()).toHaveLength(1);
  });

  it("ignores a second start while one is running, and cancel ends the running one", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const first = startBackfill(["BTCUSDT"], 7, { ...over(), deps: () => deps({ sleep: async () => gate }) });
    await new Promise((r) => setTimeout(r, 20));
    expect(getBackfillState().phase).toBe("running");
    expect(await startBackfill(["BTCUSDT"], 7, over())).toBeNull();
    cancelBackfill();
    release();
    const run = await first;
    expect(run?.end).toBe("cancelled");
    expect(getBackfillState().phase).toBe("idle");
  });

  it("says why it could not start when the browser has no storage", async () => {
    const run = await startBackfill(["BTCUSDT"], 7, { open: async () => Promise.reject(new Error("x")), deps: () => deps() });
    expect(run).toBeNull();
    expect(getBackfillState()).toMatchObject({ phase: "idle", error: "Das Archiv kann in diesem Browser nicht gespeichert werden." });
  });

  it("a run needs no switch: the collector's configuration is not touched", async () => {
    expect(DEFAULT_ARCHIVE_CFG.on).toBe(false);
    await runOnce();
    expect(localStorage.getItem("tj2-archive-cfg")).toBeNull();
  });
});

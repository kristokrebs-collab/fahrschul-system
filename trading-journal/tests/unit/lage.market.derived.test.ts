/**
 * Live Lage (src/market/lage.ts) when the just-closed day's 1D candle has not arrived (the daily feed is REST-only:
 * the 00:00:20 poll and its retries failed): the day is built from its 24 closed 1H candles and used for the Lage and
 * the gate until the 1D candle arrives; without all 24 the honest status stays, and a close missing for over an hour
 * after 00:00 UTC means no Lage, no gate ("keine Daten") — never yesterday's state silently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/lage/btcusdt-2026-10-08.json";
import { computeLage, dailyFromHourly, lageGate, lageKey, type LageSettings } from "@/domain/lage";
import type { Bar } from "@/domain/signals";
import type { Candle, FeedHealth, Stamped } from "@/market/types";

interface Series {
  sec: number;
  t0: number;
  n: number;
  h: number[];
  l: number[];
  c: number[];
}
const F = fixture as unknown as Record<"1D" | "4h" | "1h_oct", Series>;
const candles = (s: Series, now: number): Candle[] =>
  s.c.map((c, i) => {
    const time = (s.t0 + i * s.sec) * 1000;
    return { time, open: i ? s.c[i - 1]! : c, high: s.h[i]!, low: s.l[i]!, close: c, volume: 1, closed: time + s.sec * 1000 <= now };
  });
const toBar = (c: Candle): Bar => ({ t: c.time / 1000, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume });

const DAY = 86_400_000;
const D7 = Date.parse("2026-10-07T00:00:00Z");
const MIDNIGHT = D7 + DAY; // the 07.10. close
const NOW = MIDNIGHT + 30 * 60_000; // 00:30 UTC on 08.10.
const PRICE = 81_356.2;
const GATE: LageSettings = { on: true, mode: "block" };

const feeds: Record<string, Stamped<Candle[]> | undefined> = {};
const feedSubs = new Map<string, Set<() => void>>();
const stamp = (data: Candle[], at = Date.now()): Stamped<Candle[]> => ({ data, asOf: at, receivedAt: at, source: "binance", comparable: true });
const tick = (f: string, data: Candle[]): void => {
  feeds[f] = stamp(data);
  for (const cb of feedSubs.get(f) ?? []) cb();
};

let dailyHealth: FeedHealth;
const provider = {
  symbol: "BTCUSDT",
  serverNow: () => Date.now(),
  getHealth: () => ({ feeds: { kline_1d: dailyHealth } }),
  onHealth: () => () => undefined,
};

vi.mock("@/market/marketStore", () => ({
  getProvider: () => provider,
  useProvider: () => provider,
  getFeed: (f: string) => feeds[f],
  subscribeFeed: (f: string, cb: () => void) => {
    let s = feedSubs.get(f);
    if (!s) feedSubs.set(f, (s = new Set()));
    s.add(cb);
    return () => s.delete(cb);
  },
}));

const { retainLage, getLage, __resetLage, LAGE_DERIVED_TEXT, LAGE_NO_CLOSE_TEXT } = await import("@/market/lage");
const { priceMv } = await import("@/market/motionValues");

/** The real days (closed) and the 07.10. as the 23:00:20 poll left it: forming, close of 23:00 (never read). */
const realDaily = (): Candle[] => candles(F["1D"], NOW);
const failedDailyPage = (): Candle[] => {
  const all = realDaily();
  return [...all.slice(0, -1), { ...all.at(-1)!, close: 84_000, high: 85_598.22, low: 84_000, closed: false }];
};
const hourly = (): Candle[] => candles(F["1h_oct"], NOW).filter((c) => c.time <= NOW);
const h4 = (): Candle[] => candles(F["4h"], NOW).filter((c) => c.time <= NOW);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetLage();
  dailyHealth = { feed: "kline_1d", state: "stale", source: "binance", consecutiveFailures: 2, reason: "network", nextRefreshAt: NOW + 60_000 };
  for (const k of Object.keys(feeds)) delete feeds[k];
  feeds.kline_1d = stamp(failedDailyPage(), MIDNIGHT - 3_600_000 + 20_000);
  feeds.kline_4h = stamp(h4());
  feeds.kline_1h = stamp(hourly());
  priceMv.set(PRICE);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => {
  __resetLage();
  vi.useRealTimers();
});

describe("dailyFromHourly", () => {
  it("equals the real 1D candles of the fixture (first open, max high, min low, last 1H close)", () => {
    const h1 = candles(F["1h_oct"], NOW).map(toBar);
    const days = candles(F["1D"], NOW).map(toBar);
    for (const day of ["2026-10-05", "2026-10-06", "2026-10-07"]) {
      const t = Date.parse(`${day}T00:00:00Z`);
      const real = days.find((b) => b.t * 1000 === t)!;
      const d = dailyFromHourly(h1, t, NOW)!;
      expect(d).toMatchObject({ t: t / 1000, o: real.o, h: real.h, l: real.l, c: real.c, v: 24 });
    }
    // not before the day closed, not with a hole, not without the full day
    expect(dailyFromHourly(h1, D7, MIDNIGHT - 1)).toBeNull();
    expect(dailyFromHourly(h1.filter((b) => b.t * 1000 !== D7 + 15 * 3_600_000), D7, NOW)).toBeNull();
    expect(dailyFromHourly(h1.filter((b) => b.t * 1000 < D7 + 23 * 3_600_000), D7, NOW)).toBeNull();
  });
});

describe("Lage without the just-closed 1D candle", () => {
  it("the poll failed: the day comes from its 24 closed 1H candles — the same Lage as with the real 1D candle", () => {
    const release = retainLage();
    const { lage, status } = getLage();
    expect(lage?.daily?.at).toBe(D7);
    expect(lage?.daily?.close).toBeCloseTo(83_321.81, 2);
    const reference = computeLage(realDaily().map(toBar), h4().map(toBar), PRICE, NOW, { h1: hourly().filter((c) => c.closed).map(toBar) });
    expect(lageKey(lage!)).toBe(lageKey(reference));
    expect(lage?.state).toBe(reference.state);
    // honest status: the derived close and why the 1D candle is missing
    expect(status.state).toBe("stale");
    expect(status.detail).toBe(`${LAGE_DERIVED_TEXT} · Netzwerk/CORS-Fehler · 2× in Folge`);
    release();
  });

  it("the real 1D candle replaces the derived day as soon as it arrives", () => {
    const release = retainLage();
    expect(getLage().lage?.daily?.close).toBeCloseTo(83_321.81, 2);
    dailyHealth = { ...dailyHealth, state: "live", consecutiveFailures: 0, reason: undefined };
    const page = realDaily();
    const real = { ...page.at(-1)!, close: 83_300, closed: true };
    tick("kline_1d", [...page.slice(0, -1), real, { ...real, time: MIDNIGHT, open: 83_300, close: 81_356.2, closed: false }]);
    const { lage, status } = getLage();
    expect(lage?.daily?.at).toBe(D7);
    expect(lage?.daily?.close).toBe(83_300);
    expect(status).toMatchObject({ state: "ok", detail: null, closedAt: MIDNIGHT });
    release();
  });

  it("without all 24 closed 1H candles: no derived day, yesterday's Lage with the honest status — and after 1 h no gate", async () => {
    // the 15:00 candle is missing (a hole the gap fill has not closed)
    feeds.kline_1h = stamp(hourly().filter((c) => c.time !== D7 + 15 * 3_600_000));
    const release = retainLage();
    const first = getLage();
    expect(first.lage?.daily?.at).toBe(D7 - DAY);
    expect(first.status).toMatchObject({ state: "stale", detail: "Netzwerk/CORS-Fehler · 2× in Folge" });
    expect(lageGate(first.lage, GATE).state).not.toBe("none");

    // 01:00:01 UTC: the close has been missing for over an hour → no Lage, no gate, the status says so
    await vi.advanceTimersByTimeAsync(MIDNIGHT + 3_600_000 + 1_000 - Date.now());
    priceMv.set(PRICE + 50);
    await vi.advanceTimersByTimeAsync(1_000);
    const later = getLage();
    expect(later.lage).toBeNull();
    expect(later.status.state).toBe("stale");
    expect(later.status.detail).toBe(`${LAGE_NO_CLOSE_TEXT} · Netzwerk/CORS-Fehler · 2× in Folge`);
    expect(lageGate(later.lage, GATE)).toMatchObject({ state: "none", counts: true, blocked: false });

    // the 1D candle arrives: the Lage is back
    tick("kline_1d", realDaily());
    expect(getLage().lage?.daily?.at).toBe(D7);
    release();
  });

  it("a 1H candle the exchange has not reported closed is not used", () => {
    // the 23:00 candle's final frame is missing (flagged forming) although the next one started
    feeds.kline_1h = stamp(hourly().map((c) => (c.time === MIDNIGHT - 3_600_000 ? { ...c, closed: false } : c)));
    const release = retainLage();
    expect(getLage().lage?.daily?.at).toBe(D7 - DAY);
    release();
  });
});

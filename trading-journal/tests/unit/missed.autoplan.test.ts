/**
 * F32 Automatische Auswertung (the rule): which archived signals the app reads next. Final outcomes are never read again, a
 * signal waits for the first closed candle after it, an open one is read again only with a newer candle (and not sooner than
 * 15 minutes after the last look), a failed load waits 30 minutes, a run takes at most 20 signals of at most 3 markets (the
 * newest first, per market within 30 days), and signals without a direction or market ride along for free.
 */
import { describe, expect, it } from "vitest";
import { AUTO_BAR_MS, AUTO_LIMITS, evaluateSignal, newestClosedBar, planAuto, unusable, type Attempt, type OutcomeBar, type SignalEvent, type SignalOutcome } from "@/domain/missed";
import { DAY, H, signalEvent } from "./missed.fixtures";

const NOW = new Date(2026, 2, 6, 12, 7).getTime(); // 12:07 → the newest closed 15m candle opened at 11:45
const NEWEST = newestClosedBar(NOW);
const ev = (key: string, at: number, over: Partial<SignalEvent> = {}): SignalEvent => signalEvent({ key, at, symbol: "BTCUSDT", stop: 95, target: 110, ...over });

/** A candle of the given kind of outcome, built by the real reading (so the fields are the real ones). */
const bar = (t: number, o: number, h: number, l: number): OutcomeBar => ({ time: t, open: o, high: h, low: l, close: o });
const outcomeOf = (e: SignalEvent, bars: OutcomeBar[], now = NOW): SignalOutcome => evaluateSignal(e, bars, { now, atrPct: 1, intervalMs: AUTO_BAR_MS });

const plan = (entries: SignalEvent[], outcomes: Record<string, SignalOutcome> = {}, attempts: Record<string, Attempt> = {}, now = NOW, limits = AUTO_LIMITS) =>
  planAuto({ entries, outcomes: new Map(Object.entries(outcomes)), attempts: new Map(Object.entries(attempts)), now }, limits);

describe("newestClosedBar", () => {
  it("is the open time of the newest candle that has closed", () => {
    expect(NEWEST).toBe(new Date(2026, 2, 6, 11, 45).getTime());
    // exactly on a boundary the candle that just opened is still running
    expect(newestClosedBar(new Date(2026, 2, 6, 12, 0).getTime())).toBe(new Date(2026, 2, 6, 11, 45).getTime());
  });
});

describe("planAuto", () => {
  it("a signal never read is due; final outcomes are never read again", () => {
    const fresh = ev("a", NOW - 5 * H);
    const won = ev("b", NOW - 6 * H);
    const lost = ev("c", NOW - 7 * H);
    const outcomes = {
      [won.id]: outcomeOf(won, [bar(won.at + AUTO_BAR_MS, 100, 111, 99)]),
      [lost.id]: outcomeOf(lost, [bar(lost.at + AUTO_BAR_MS, 100, 101, 94)]),
    };
    expect(outcomes[won.id]!.kind).toBe("target");
    expect(outcomes[lost.id]!.kind).toBe("stop");
    const p = plan([fresh, won, lost], outcomes);
    expect(p.batch.map((e) => e.key)).toEqual(["a"]);
    expect(p).toMatchObject({ due: 1, settled: 2, waiting: 0, fresh: 0 });
  });

  it("a signal waits for the first closed candle after it", () => {
    const tooFresh = ev("x", NOW - 60_000); // 12:06 – the 12:15 candle has not even opened
    const justOk = ev("y", NEWEST - 60_000); // 11:44 – the 11:45 candle opened after it and has closed? no: it closes at 12:00, so yes
    const p = plan([tooFresh, justOk]);
    expect(p.batch.map((e) => e.key)).toEqual(["y"]);
    expect(p.fresh).toBe(1);
  });

  it("an open signal is read again only with a newer candle, and not sooner than 15 minutes after the last look", () => {
    const e = ev("o", NOW - 5 * H);
    const open = outcomeOf(e, [bar(e.at + AUTO_BAR_MS, 100, 102, 99)]);
    expect(open.kind).toBe("open");
    // looked at 12:00 with the 11:45 candle as the newest: no newer candle yet at 12:07
    const sameCandle = plan([e], { [e.id]: open }, { [e.id]: { at: NOW - 7 * 60_000, newest: NEWEST, failed: false } });
    expect(sameCandle.batch).toEqual([]);
    expect(sameCandle.waiting).toBe(1);
    // an older look (the 11:30 candle was the newest) but only 7 minutes ago: a newer candle exists, the wait is not over
    const tooSoon = plan([e], { [e.id]: open }, { [e.id]: { at: NOW - 7 * 60_000, newest: NEWEST - AUTO_BAR_MS, failed: false } });
    expect(tooSoon.batch).toEqual([]);
    // 20 minutes ago with an older newest candle: due
    const due = plan([e], { [e.id]: open }, { [e.id]: { at: NOW - 20 * 60_000, newest: NEWEST - AUTO_BAR_MS, failed: false } });
    expect(due.batch.map((x) => x.key)).toEqual(["o"]);
  });

  it("an open outcome from an earlier session (no attempt in memory) counts by the candle it covered", () => {
    const e = ev("o", NOW - 5 * H);
    const open = outcomeOf(e, [bar(e.at + AUTO_BAR_MS, 100, 102, 99)]);
    expect(open.coveredUntil).toBe(e.at + AUTO_BAR_MS);
    // coveredUntil is long before the newest candle → due
    expect(plan([e], { [e.id]: open }).batch).toHaveLength(1);
    const current = { ...open, coveredUntil: NEWEST };
    expect(plan([e], { [e.id]: current }).batch).toHaveLength(0);
  });

  it("a failed load waits 30 minutes, an unusable reading waits for a newer candle", () => {
    const e = ev("f", NOW - 5 * H);
    const failedO = unusable("Die Marktdaten sind von hier aus gerade nicht erreichbar.");
    expect(plan([e], { [e.id]: failedO }, { [e.id]: { at: NOW - 10 * 60_000, newest: NEWEST, failed: true } }).batch).toEqual([]);
    expect(plan([e], { [e.id]: failedO }, { [e.id]: { at: NOW - 31 * 60_000, newest: NEWEST, failed: true } }).batch).toHaveLength(1);
    // read fine but unusable (no candles for the period): a newer candle is needed
    const noCandles = unusable("Für den Zeitraum nach dem Signal liegen keine Kerzen vor.");
    expect(plan([e], { [e.id]: noCandles }, { [e.id]: { at: NOW - 60 * 60_000, newest: NEWEST, failed: false } }).batch).toEqual([]);
    expect(plan([e], { [e.id]: noCandles }, { [e.id]: { at: NOW - 60 * 60_000, newest: NEWEST - AUTO_BAR_MS, failed: false } }).batch).toHaveLength(1);
  });

  it("signals without a direction or a market ride along for free and are settled once they have their reason", () => {
    const noMarket = ev("m", NOW - 5 * H, { symbol: "" });
    const noSide = ev("s", NOW - 5 * H, { side: null });
    const first = plan([noMarket, noSide]);
    expect(first.batch.map((e) => e.key).sort()).toEqual(["m", "s"]);
    const done = plan([noMarket, noSide], { [noMarket.id]: unusable("Der Markt des Signals ist nicht bekannt."), [noSide.id]: unusable("Das Signal hat keine Richtung.") });
    expect(done.batch).toEqual([]);
    expect(done.settled).toBe(2);
  });

  it("a run takes at most 20 signals, the newest first, and says how many are due in all", () => {
    const many = Array.from({ length: 30 }, (_, i) => ev(`e${i}`, NOW - (i + 2) * H));
    const p = plan(many);
    expect(p.batch).toHaveLength(20);
    expect(p.due).toBe(30);
    expect(p.batch[0]!.key).toBe("e0");
    expect(p.batch.map((e) => e.at)).toEqual([...p.batch.map((e) => e.at)].sort((a, b) => b - a));
  });

  it("at most 3 markets per run; the others follow later", () => {
    const syms = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"];
    const list = syms.map((s, i) => ev(`m${i}`, NOW - (i + 2) * H, { symbol: s }));
    const p = plan(list);
    expect(new Set(p.batch.map((e) => e.symbol)).size).toBe(3);
    expect(p.batch.map((e) => e.symbol)).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
    expect(p.due).toBe(5);
    // a signal of a market already in the run still fits
    const more = plan([...list, ev("again", NOW - 10 * H, { symbol: "ETHUSDT" })]);
    expect(more.batch.map((e) => e.key)).toContain("again");
  });

  it("per market only signals within 30 days of its newest one, so one candle load stays small", () => {
    const a = ev("new", NOW - 2 * H);
    const b = ev("mid", NOW - 20 * DAY);
    const c = ev("old", NOW - 60 * DAY);
    const p = plan([c, b, a]);
    expect(p.batch.map((e) => e.key)).toEqual(["new", "mid"]);
    expect(p.due).toBe(3);
  });

  it("nothing in the archive: nothing to do", () => {
    expect(plan([])).toMatchObject({ batch: [], due: 0, fresh: 0, waiting: 0, settled: 0 });
  });
});

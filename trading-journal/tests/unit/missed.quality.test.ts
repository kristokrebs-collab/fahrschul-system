/**
 * F27 Daten- und Alarmqualität: the presence trace (merged beats, share of open time, breaks, „unbekannt“ without a trace), the
 * delay between candle close and alert, the Zustellprotokoll counts, holes in the candle feed – and the beat of the market layer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliveryQuality,
  delayReport,
  durationText,
  findBarGaps,
  mergeSegments,
  OUTAGE_MIN_MS,
  PRESENCE_GAP_MS,
  presenceReport,
  qualityReport,
  SLOW_ALERT_MS,
} from "@/domain/missed";
import type { DeliveryRecord } from "@/domain/keylevels/delivery";
import { applyBeat, BEAT_MS, __resetPresence, beat, parsePresence, PRESENCE_CAP, PRESENCE_KEY, presenceSegments, startPresence } from "@/market/presence";
import { H, signalEvent } from "./missed.fixtures";

const MIN = 60_000;
const NOW = new Date(2026, 2, 20, 12).getTime();

const rec = (over: Partial<DeliveryRecord> & { at: number }): DeliveryRecord => ({ id: `d${over.at}`, source: "key", levelId: "l1", title: "t", detail: "", stage: "confirm", basis: "close", channels: ["toast"], outcome: "sent", dedupeKey: `k${over.at}`, ...over });

describe("presence", () => {
  it("merges beats closer than the gap into one stretch", () => {
    const m = mergeSegments([
      { a: 0, b: 60_000 },
      { a: 60_000 + PRESENCE_GAP_MS, b: 400_000 },
      { a: 400_000 + PRESENCE_GAP_MS + 1, b: 700_000 },
    ]);
    expect(m).toEqual([
      { a: 0, b: 400_000 },
      { a: 400_000 + PRESENCE_GAP_MS + 1, b: 700_000 },
    ]);
    expect(mergeSegments([{ a: 5, b: 1 }, { a: NaN, b: 3 }])).toEqual([]);
  });

  it("without any beat the share is unknown – never a guess", () => {
    expect(presenceReport([], NOW)).toMatchObject({ known: false, share: null, since: null, outages: [], running: false });
    // a trace that ended long before the window is no trace of the window
    expect(presenceReport([{ a: NOW - 90 * 24 * H, b: NOW - 80 * 24 * H }], NOW).known).toBe(false);
  });

  it("share of open time since the first beat, with the breaks (≥ 10 min) between the stretches", () => {
    const from = NOW - 10 * H;
    const segs = [
      { a: from, b: from + 4 * H }, // 4 h open
      { a: from + 6 * H, b: from + 6 * H + 5 * MIN }, // after a 2 h break
      { a: from + 6 * H + 5 * MIN + 5 * MIN, b: NOW }, // a 5 min hole: a reload, not an outage
    ];
    const p = presenceReport(segs, NOW);
    expect(p).toMatchObject({ known: true, since: from, spanMs: 10 * H, running: true, outageCount: 1 });
    expect(p.outages[0]).toMatchObject({ from: from + 4 * H, to: from + 6 * H, ms: 2 * H });
    // open = 4 h + 5 min + (NOW − from − 6 h − 10 min)
    expect(p.openMs).toBe(4 * H + 5 * MIN + (4 * H - 10 * MIN));
    expect(p.share).toBeCloseTo(p.openMs / (10 * H), 9);
    expect(p.outageMs).toBe(2 * H);
  });

  it("a stopped trace counts as closed since the last beat (an ongoing outage)", () => {
    const p = presenceReport([{ a: NOW - 5 * H, b: NOW - 3 * H }], NOW);
    expect(p.running).toBe(false);
    expect(p.outages).toEqual([{ from: NOW - 3 * H, to: NOW, ms: 3 * H }]);
    expect(p.share).toBeCloseTo(2 / 5, 9);
  });

  it("only the window counts", () => {
    const p = presenceReport([{ a: NOW - 60 * 24 * H, b: NOW }], NOW, 30 * 24 * H);
    expect(p.spanMs).toBe(30 * 24 * H);
    expect(p.share).toBe(1);
    expect(OUTAGE_MIN_MS).toBe(10 * MIN);
  });
});

describe("delayReport", () => {
  it("measures alert time minus candle close per source; events without a close are not guessed", () => {
    const close = NOW - 3 * H;
    const events = [
      signalEvent({ key: "a", at: close + 65_000, barClose: close }),
      signalEvent({ key: "b", at: close + 70_000, barClose: close }),
      signalEvent({ key: "c", at: close + 10 * MIN, barClose: close }),
      signalEvent({ key: "d", at: close + 5_000, barClose: close, source: "box", kind: "setup" }),
      signalEvent({ key: "e", at: close, barClose: null }),
      signalEvent({ key: "f", at: close - 1000, barClose: close }), // before the close: not a delay
      signalEvent({ key: "g", at: close + 3 * 86_400_000, barClose: close }), // days later: a stale event, not a delay
    ];
    const rows = delayReport(events, NOW - 30 * 24 * H);
    const entry = rows.find((r) => r.source === "entry")!;
    expect(entry).toMatchObject({ n: 3, median: 70_000, max: 10 * MIN, slow: 1, p90: null });
    expect(rows.find((r) => r.source === "box")).toMatchObject({ n: 1, median: 5000, slow: 0 });
    expect(rows.find((r) => r.source === "key")).toBeUndefined();
    expect(SLOW_ALERT_MS).toBe(5 * MIN);
  });

  it("the window cuts older events", () => {
    const e = signalEvent({ key: "old", at: NOW - 40 * 24 * H, barClose: NOW - 40 * 24 * H - 1000 });
    expect(delayReport([e], NOW - 30 * 24 * H)).toEqual([]);
  });
});

describe("deliveryQuality", () => {
  it("counts sent, duplicate, rejected times, no channel and repeated keys", () => {
    const log = [
      rec({ at: NOW - H, dedupeKey: "same" }),
      rec({ at: NOW - 2 * H, dedupeKey: "same" }), // sent twice under one key
      rec({ at: NOW - 3 * H, outcome: "duplicate" }),
      rec({ at: NOW - 4 * H, outcome: "hours" }),
      rec({ at: NOW - 5 * H, outcome: "hours" }),
      rec({ at: NOW - 6 * H, outcome: "channels" }),
      rec({ at: NOW - 7 * H, source: "signal", dedupeKey: "sig" }),
      rec({ at: NOW - 8 * H, source: "signal", dedupeKey: "sig" }), // log-only lines: the same text twice is no duplicate
      rec({ at: NOW - 40 * 24 * H }),
    ];
    const d = deliveryQuality(log, NOW - 30 * 24 * H);
    expect(d).toMatchObject({ lines: 8, sent: 4, duplicate: 1, hours: 2, channels: 1, repeated: 1, truncated: false });
    expect(d.oldest).toBe(NOW - 40 * 24 * H);
  });

  it("says when the 200-line log no longer reaches the window", () => {
    const log = Array.from({ length: 200 }, (_, i) => rec({ at: NOW - (i + 1) * MIN * 10 }));
    expect(deliveryQuality(log, NOW - 30 * 24 * H)).toMatchObject({ truncated: true });
    expect(deliveryQuality([], NOW - 30 * 24 * H)).toMatchObject({ lines: 0, oldest: null, truncated: false });
  });
});

describe("findBarGaps", () => {
  it("lists the missing candles between consecutive bars", () => {
    const t = (i: number) => i * H;
    expect(findBarGaps([t(0), t(1), t(2), t(3)], H)).toEqual([]);
    expect(findBarGaps([t(0), t(1), t(5), t(6), t(8)], H)).toEqual([
      { from: t(2), to: t(4), missing: 3 },
      { from: t(7), to: t(7), missing: 1 },
    ]);
    expect(findBarGaps([], H)).toEqual([]);
  });
});

describe("qualityReport", () => {
  it("assembles the traces; the gap check is carried through unchanged (null = not run)", () => {
    const rep = qualityReport({ now: NOW, events: [signalEvent({ key: "a", at: NOW - H })], log: [], presence: [{ a: NOW - 2 * H, b: NOW }], gaps: null });
    expect(rep).toMatchObject({ windowDays: 30, signals: 1, gaps: null });
    expect(rep.presence.share).toBe(1);
    expect(rep.delivery.lines).toBe(0);
  });
});

describe("durationText", () => {
  it("reads compactly", () => {
    expect([null, 40_000, 90_000, 5 * MIN, 2 * H + 5 * MIN, 3 * 24 * H + 4 * H].map(durationText)).toEqual(["–", "40 s", "1 Min 30 s", "5 Min", "2 Std 5 Min", "3 T 4 Std"]);
  });
});

describe("presence beat (market layer)", () => {
  beforeEach(() => {
    localStorage.removeItem(PRESENCE_KEY);
    __resetPresence();
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("a beat within the gap extends the stretch, a later one starts a new one", () => {
    beat(NOW);
    beat(NOW + 30_000);
    beat(NOW + 60_000);
    expect(presenceSegments()).toEqual([{ a: NOW, b: NOW + 60_000 }]);
    beat(NOW + 60_000 + PRESENCE_GAP_MS + 10_000); // the tab was shut in between
    expect(parsePresence(JSON.parse(localStorage.getItem(PRESENCE_KEY)!))).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(PRESENCE_KEY)!).v).toBe(1);
  });

  it("two tabs write their own stretches, the report merges them", () => {
    const one = applyBeat([], "t1", NOW);
    const two = applyBeat(one, "t2", NOW + 10_000);
    expect(two.map((s) => s.id).sort()).toEqual(["t1", "t2"]);
    expect(mergeSegments(applyBeat(two, "t1", NOW + 40_000))).toEqual([{ a: NOW, b: NOW + 40_000 }]);
  });

  it("is bounded in age and count", () => {
    const old = [{ id: "x", a: NOW - 60 * 24 * H, b: NOW - 60 * 24 * H + MIN }];
    expect(applyBeat(old, "t", NOW)).toHaveLength(1); // the 60-day-old stretch is gone
    const many = Array.from({ length: PRESENCE_CAP + 50 }, (_, i) => ({ id: `s${i}`, a: NOW - (i + 1) * 3600_000, b: NOW - (i + 1) * 3600_000 + MIN }));
    expect(applyBeat(many, "t", NOW).length).toBeLessThanOrEqual(PRESENCE_CAP);
  });

  it("reads garbage and other versions as empty", () => {
    for (const bad of [null, "x", [], { v: 2, segs: [{ id: "a", a: 1, b: 2 }] }, { v: 1, segs: "x" }]) expect(parsePresence(bad)).toEqual([]);
    expect(parsePresence({ v: 1, segs: [{ id: "a", a: 5, b: 2 }, { id: "b", a: 1, b: 2 }, null] })).toEqual([{ id: "b", a: 1, b: 2 }]);
  });

  it("the host beats at start and every interval, and stops", () => {
    const stop = startPresence();
    expect(presenceSegments()).toEqual([{ a: NOW, b: NOW }]);
    vi.advanceTimersByTime(BEAT_MS * 3);
    expect(presenceSegments()).toEqual([{ a: NOW, b: NOW + BEAT_MS * 3 }]);
    stop();
    vi.advanceTimersByTime(BEAT_MS * 5);
    expect(presenceSegments()).toEqual([{ a: NOW, b: NOW + BEAT_MS * 3 }]);
  });
});

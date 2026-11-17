import { describe, expect, it } from "vitest";
import { DEFAULT_MARKET } from "@/domain/defaults";
import { scenario } from "@/domain/trigger";
import { atrOf, blankKeyLevel, evaluateLevel, legacyKeyLevels, KEY_TF_MS, type EvalCandle, type KeyLevel, type TriggerKind } from "@/domain/keylevels";

const MS = KEY_TF_MS["4h"];
const T0 = Date.UTC(2026, 9, 1); // 4h aligned
const P = 100;

/** A 4h candle i (open time T0 + i·4h). */
function bar(i: number, o: number, h: number, l: number, c: number, closed = true): EvalCandle {
  return { time: T0 + i * MS, open: o, high: h, low: l, close: c, closed, closeTime: T0 + (i + 1) * MS - 1 };
}
/** Flat-ish closed candle that closes at `c` with a small range around it. */
const cl = (i: number, c: number, closed = true): EvalCandle => bar(i, c, c + 0.5, c - 0.5, c, closed);
/** The instant `min` minutes after the open of candle i. */
const at = (i: number, min = 30): number => T0 + i * MS + min * 60_000;

function level(over: Partial<KeyLevel> = {}): KeyLevel {
  return blankKeyLevel({ id: "k1", symbol: "BTCUSDT", price: P, since: T0, name: "Test", ...over }, T0);
}
const mirror = (c: EvalCandle): EvalCandle => ({ ...c, open: 2 * P - c.open, high: 2 * P - c.low, low: 2 * P - c.high, close: 2 * P - c.close });
const mirrorLevel = (l: KeyLevel): KeyLevel => ({ ...l, direction: "below", invalidation: l.invalidation == null ? null : 2 * P - l.invalidation });

describe("evaluateLevel – touch", () => {
  it("a wick that reaches the level confirms (high >= level), a miss waits", () => {
    expect(evaluateLevel(level({ kind: "touch" }), [bar(0, 98, 99.99, 97, 99), bar(1, 99, 99.5, 98, 99, false)], at(1)).status).toBe("waiting");
    const ev = evaluateLevel(level({ kind: "touch" }), [bar(0, 98, 100, 97, 99), cl(1, 98, false)], at(1));
    expect(ev.status).toBe("confirmed");
    expect(ev.basis).toBe("intrabar");
    expect(ev.events.some((e) => e.kind === "touch" && e.basis === "intrabar")).toBe(true);
  });
  it("the forming candle touching is a fact right away – not provisional", () => {
    const ev = evaluateLevel(level({ kind: "touch" }), [cl(0, 97), bar(1, 98, 100.2, 97.5, 99.5, false)], at(1));
    expect(ev.status).toBe("confirmed");
    expect(ev.basis).toBe("intrabar");
  });
  it("downward: the low reaches the level", () => {
    const ev = evaluateLevel(level({ kind: "touch", direction: "below" }), [bar(0, 102, 103, 100, 101), cl(1, 102, false)], at(1));
    expect(ev.status).toBe("confirmed");
  });
});

describe("evaluateLevel – running break (the only rule that is provisional)", () => {
  it("the forming candle beyond the level is provisional, confirmed only by the close", () => {
    const forming = evaluateLevel(level({ kind: "running" }), [cl(0, 98), bar(1, 99, 101.5, 98.8, 101, false)], at(1));
    expect(forming.status).toBe("provisional");
    expect(forming.basis).toBe("intrabar");
    expect(forming.events.at(-1)?.kind).toBe("provisional");
    const closed = evaluateLevel(level({ kind: "running" }), [cl(0, 98), bar(1, 99, 101.5, 98.8, 101), cl(2, 100.5, false)], at(2));
    expect(closed.status).toBe("confirmed");
    expect(closed.basis).toBe("close");
    // intrabar and close are logged apart
    expect(closed.events.map((e) => `${e.kind}:${e.basis}`)).toEqual(expect.arrayContaining(["provisional:intrabar", "confirmed:close"]));
  });
  it("a candle that went over intrabar but closed back is logged as unconfirmed and does not confirm", () => {
    const ev = evaluateLevel(level({ kind: "running" }), [cl(0, 98), bar(1, 99, 101, 98.5, 99.4), cl(2, 99, false)], at(2));
    expect(ev.status).toBe("waiting");
    expect(ev.events.some((e) => e.kind === "unconfirmed" && e.basis === "intrabar")).toBe(true);
  });
});

describe("evaluateLevel – single close", () => {
  it("is strict (close == level waits) and ignores the forming candle for the status", () => {
    expect(evaluateLevel(level({ kind: "close" }), [cl(0, 100)], at(1)).status).toBe("waiting");
    expect(evaluateLevel(level({ kind: "close" }), [cl(0, 100.01)], at(1)).status).toBe("confirmed");
    const ev = evaluateLevel(level({ kind: "close" }), [cl(0, 99), bar(1, 99, 102, 98.9, 101.5, false)], at(1));
    expect(ev.status).toBe("waiting");
    expect(ev.reason).toContain("Schluss steht aus");
  });
  it("confirmed → invalidated when a later close falls back; confirmed again by the next close", () => {
    const base = [cl(0, 101), cl(1, 99)];
    const ev = evaluateLevel(level({ kind: "close" }), [...base, cl(2, 98, false)], at(2));
    expect(ev.status).toBe("invalidated");
    expect(ev.events.map((e) => e.kind)).toEqual(["confirmed", "invalidated"]);
    expect(evaluateLevel(level({ kind: "close" }), [...base, cl(2, 101.5), cl(3, 101, false)], at(3)).status).toBe("confirmed");
  });
  it("the invalidation price kills a confirmed level even above the level", () => {
    const l = level({ kind: "close", invalidation: 99 });
    // closes at 98.5 are below the level (a close back anyway) – use a below-direction level with an invalidation above
    const d = level({ kind: "close", direction: "below", invalidation: 101 });
    const ev = evaluateLevel(d, [cl(0, 99), cl(1, 101.5), cl(2, 101, false)], at(2));
    expect(ev.status).toBe("invalidated");
    expect(ev.reason).toContain("Invalidierung");
    expect(l.invalidation).toBe(99);
  });
});

describe("evaluateLevel – N consecutive closes", () => {
  const l = level({ kind: "closes", closes: 3 });
  it("counts consecutive closes, a miss resets the count", () => {
    const a = evaluateLevel(l, [cl(0, 101), cl(1, 102), cl(2, 99), cl(3, 101), cl(4, 101.2, false)], at(4));
    expect(a.status).toBe("waiting");
    expect(a.progress).toEqual({ have: 1, need: 3 });
    expect(a.reason).toBe("1 von 3 4h-Schlüssen über 100.");
    const b = evaluateLevel(l, [cl(0, 101), cl(1, 102), cl(2, 103), cl(3, 99, false)], at(3));
    expect(b.status).toBe("confirmed");
    expect(b.progress).toEqual({ have: 3, need: 3 });
  });
  it("the forming candle is never counted", () => {
    expect(evaluateLevel(l, [cl(0, 101), cl(1, 102), cl(2, 103, false)], at(2)).status).toBe("waiting");
  });
});

describe("evaluateLevel – distance buffer", () => {
  it("percent: needs a close beyond level + buffer", () => {
    const l = level({ kind: "buffer", distance: { mode: "pct", value: 1 } });
    expect(evaluateLevel(l, [cl(0, 100.9)], at(1)).status).toBe("waiting");
    expect(evaluateLevel(l, [cl(0, 101)], at(1)).status).toBe("waiting"); // strict
    const ev = evaluateLevel(l, [cl(0, 101.1)], at(1));
    expect(ev.status).toBe("confirmed");
    expect(ev.trigger).toBeCloseTo(101, 9);
  });
  it("downward mirrors the buffer", () => {
    const l = level({ kind: "buffer", direction: "below", distance: { mode: "pct", value: 1 } });
    expect(evaluateLevel(l, [cl(0, 99.5)], at(1)).status).toBe("waiting");
    expect(evaluateLevel(l, [cl(0, 98.9)], at(1)).status).toBe("confirmed");
  });
  it("ATR: needs 15 closed candles, otherwise unknown – never confirmed", () => {
    const l = level({ kind: "buffer", distance: { mode: "atr", value: 1 } });
    expect(evaluateLevel(l, [cl(0, 110)], at(1)).status).toBe("unknown");
    const hist = Array.from({ length: 16 }, (_, i) => bar(i, 95, 96, 94, 95)); // ATR(14) = 2
    const ev = evaluateLevel(l, [...hist, cl(16, 103)], at(17));
    expect(atrOf(hist)).toBeCloseTo(2, 9);
    expect(ev.status).toBe("confirmed");
    // the threshold of a candle uses the ATR of the candle BEFORE it (2), not its own range
    expect(evaluateLevel(l, [...hist, bar(16, 101.9, 102.4, 101.8, 102.2)], at(17)).status).toBe("confirmed");
    expect(evaluateLevel(l, [...hist, cl(16, 101.5)], at(17)).status).toBe("waiting");
  });
});

describe("evaluateLevel – confirmed retest", () => {
  const l = level({ kind: "retest", distance: { mode: "pct", value: 0.3 } });
  it("break by close, then a candle that comes back to the level and closes beyond again", () => {
    const broke = evaluateLevel(l, [cl(0, 98), cl(1, 102), cl(2, 103, false)], at(2));
    expect(broke.status).toBe("waiting");
    expect(broke.awaitingRetest).toBe(true);
    expect(broke.broke).toBe(true);
    const retested = evaluateLevel(l, [cl(0, 98), cl(1, 102), bar(2, 103, 104, 100.2, 101.5), cl(3, 102, false)], at(3));
    expect(retested.status).toBe("confirmed");
    expect(retested.retest).toBe("done");
    expect(retested.events.map((e) => e.kind)).toEqual(["break", "retest"]);
  });
  it("a retest that does not come close enough (outside the tolerance) is not a retest", () => {
    expect(evaluateLevel(l, [cl(0, 98), cl(1, 102), bar(2, 103, 104, 100.5, 101.5), cl(3, 102, false)], at(3)).status).toBe("waiting");
  });
  it("a close back through the level before the retest takes the break back", () => {
    const ev = evaluateLevel(l, [cl(0, 98), cl(1, 102), cl(2, 99), cl(3, 99.5, false)], at(3));
    expect(ev.status).toBe("waiting");
    expect(ev.broke).toBe(false);
    expect(ev.events.some((e) => e.kind === "unconfirmed")).toBe(true);
  });
  it("the break candle itself is not its own retest", () => {
    expect(evaluateLevel(l, [bar(0, 98, 103, 99.9, 102), cl(1, 103, false)], at(1)).status).toBe("waiting");
  });
  it("after the confirmation a close back across invalidates", () => {
    const ev = evaluateLevel(l, [cl(0, 98), cl(1, 102), bar(2, 103, 104, 100.2, 101.5), cl(3, 99), cl(4, 99, false)], at(4));
    expect(ev.status).toBe("invalidated");
  });
});

describe("evaluateLevel – a retest after any confirmation (alert stage)", () => {
  it("a close level reports retest done when price came back to the level and closed beyond again", () => {
    const l = level({ kind: "close" });
    const ev = evaluateLevel(l, [cl(0, 98), cl(1, 102), bar(2, 103, 104, 100.1, 101), cl(3, 102, false)], at(3));
    expect(ev.status).toBe("confirmed");
    expect(ev.retest).toBe("done");
    expect(evaluateLevel(l, [cl(0, 98), cl(1, 102), cl(2, 103), cl(3, 104, false)], at(3)).retest).toBe("none");
  });
});

const KINDS: TriggerKind[] = ["touch", "running", "close", "closes", "buffer", "retest"];
const SERIES: Record<string, EvalCandle[]> = {
  quietBelow: [cl(0, 97), cl(1, 98), cl(2, 97.5, false)],
  breakAndHold: [cl(0, 97), cl(1, 102), cl(2, 103), cl(3, 104, false)],
  breakRetest: [cl(0, 97), cl(1, 102), bar(2, 103, 104, 100.1, 101.5), cl(3, 102, false)],
  failedBreak: [cl(0, 97), cl(1, 102), cl(2, 98), cl(3, 98.5, false)],
  wickOnly: [bar(0, 97, 101, 96, 98), cl(1, 98, false)],
  formingBeyond: [cl(0, 97), bar(1, 99, 102, 98.5, 101.8, false)],
};

describe("evaluateLevel – long and short are exact mirrors", () => {
  for (const kind of KINDS) {
    for (const [name, series] of Object.entries(SERIES)) {
      it(`${kind} · ${name}`, () => {
        const up = level({ kind, closes: 2, distance: { mode: "pct", value: 0.3 }, invalidation: 96 });
        const down = mirrorLevel(up);
        const now = at(series.length - 1);
        const a = evaluateLevel(up, series, now);
        const b = evaluateLevel(down, series.map(mirror), now);
        expect(b.status).toBe(a.status);
        expect(b.basis).toBe(a.basis);
        expect(b.retest).toBe(a.retest);
        expect(b.events.map((e) => `${e.kind}:${e.basis}`)).toEqual(a.events.map((e) => `${e.kind}:${e.basis}`));
      });
    }
  }
});

describe("evaluateLevel – unknown, no data, no lookahead", () => {
  it.each(KINDS)("%s: no candles → unknown, never confirmed", (kind) => {
    const ev = evaluateLevel(level({ kind }), [], at(1));
    expect(ev.status).toBe("unknown");
    expect(ev.basis).toBeNull();
  });
  it("stale candles are not judged", () => {
    const ev = evaluateLevel(level({ kind: "close" }), [cl(0, 105)], T0 + 20 * MS);
    expect(ev.status).toBe("unknown");
    expect(ev.reason).toContain("veraltet");
  });
  it("an unusable price is unknown", () => {
    expect(evaluateLevel(level({ price: 0 }), [cl(0, 105)], at(1)).status).toBe("unknown");
    expect(evaluateLevel(level({ price: Number.NaN }), [cl(0, 105)], at(1)).status).toBe("unknown");
  });
  it("candles after `now` do not exist (no lookahead): the result equals the one without them", () => {
    const l = level({ kind: "close" });
    const past = [cl(0, 97), cl(1, 98, false)];
    const future = [...past, cl(2, 120), cl(3, 130)];
    const a = evaluateLevel(l, past, at(1));
    const b = evaluateLevel(l, future, at(1));
    expect(b).toEqual(a);
    expect(b.status).toBe("waiting");
  });
  it("a candle flagged closed whose close time is still ahead of `now` counts as forming", () => {
    const early = { ...cl(1, 105), closeTime: T0 + 2 * MS - 1 };
    expect(evaluateLevel(level({ kind: "close" }), [cl(0, 97), early], at(1)).status).toBe("waiting");
    expect(evaluateLevel(level({ kind: "close" }), [cl(0, 97), early], T0 + 2 * MS).status).toBe("confirmed");
  });
  it("is deterministic and does not mutate its input (unsorted input is read in time order)", () => {
    const series = [cl(2, 101, false), cl(0, 97), cl(1, 102)];
    const copy = JSON.parse(JSON.stringify(series));
    const l = level({ kind: "close" });
    const a = evaluateLevel(l, series, at(2));
    const b = evaluateLevel(l, series, at(2));
    expect(a).toEqual(b);
    expect(series).toEqual(copy);
    expect(a.status).toBe("confirmed");
  });
});

describe("evaluateLevel – since (a level never confirms on candles that were there before it)", () => {
  it("candles opened before `since` are ignored", () => {
    const l = level({ kind: "close", since: T0 + 2 * MS });
    const ev = evaluateLevel(l, [cl(0, 105), cl(1, 106), cl(2, 99, false)], at(2));
    expect(ev.status).toBe("waiting");
    const after = evaluateLevel(l, [cl(0, 105), cl(1, 106), cl(2, 105), cl(3, 99, false)], at(3));
    expect(after.status).toBe("confirmed");
  });
  it("a level created inside the forming candle: only the price now counts for the running rule", () => {
    const l = level({ kind: "running", since: at(1, 60) });
    const ev = evaluateLevel(l, [cl(0, 97), bar(1, 95, 103, 94, 98, false)], at(1, 90));
    expect(ev.status).toBe("waiting"); // the wick to 103 happened before the level existed; the price now is 98
    const now = evaluateLevel(l, [cl(0, 97), bar(1, 95, 103, 94, 101, false)], at(1, 90));
    expect(now.status).toBe("provisional");
  });
});

describe("evaluateLevel – the five fixed levels behave like scenario()", () => {
  const fixed = legacyKeyLevels(DEFAULT_MARKET);
  const byKey = (k: string): KeyLevel => fixed.find((l) => l.legacy === k)!;

  it("derives the five levels from settings.market, none for an unset one", () => {
    expect(fixed.map((l) => l.legacy)).toEqual(["longTrigger", "longStop", "shortTrigger", "invalidation", "lowerHigh"]);
    expect(fixed.every((l) => l.since === null && l.kind === "close" && !l.alerts.on)).toBe(true);
    expect(legacyKeyLevels({ ...DEFAULT_MARKET, shortTrigger: 0, lowerHigh: 0 }).map((l) => l.legacy)).toEqual(["longTrigger", "longStop", "invalidation"]);
    expect(legacyKeyLevels({ ...DEFAULT_MARKET, longTrigger: 0, shortTrigger: 0, invalidation: 0, longStop: 0, lowerHigh: 0 })).toEqual([]);
  });

  it.each([70_000, 75_499.99, 75_500, 84_499, 84_500, 85_000, 85_900, 85_901, 90_000])("close4h %s: same verdict as scenario()", (close) => {
    const candles = [cl(0, 85_000), { time: T0 + MS, open: close, high: close + 1, low: close - 1, close, closed: true, closeTime: T0 + 2 * MS - 1 }, { ...cl(2, close + 5_000, false), high: close + 6_000 }];
    const now = at(2);
    const ev = (k: string) => evaluateLevel(byKey(k), candles, now).status === "confirmed";
    const s = scenario(close, DEFAULT_MARKET)!.key;
    expect(ev("longTrigger")).toBe(s === "long");
    expect(ev("shortTrigger")).toBe(s === "short" || s === "bear");
    expect(ev("invalidation")).toBe(s === "bear");
  });
});

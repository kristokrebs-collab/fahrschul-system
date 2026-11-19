import { describe, expect, it } from "vitest";
import { ATR_BARS, atrPct, caseOutcome, caseWindow, delayCandles, futureBars, hitOf, latestClosedAnchor, outcomeAt, snapToCandle, tally, visibleBars, type CaseBar } from "@/social/cases";
import { CASE_INTERVAL_MS, CreateCaseSchema, HypothesisSchema } from "@/social/contract";
import { CASES, DIRECTION_LABEL } from "@/social/caseStrings";

const H = CASE_INTERVAL_MS["1h"];
const T0 = Date.UTC(2026, 9, 1, 0, 0);

/** n flat-range candles: open = previous close, range 2 (ATR 2), closes given. */
function series(closes: number[], start = T0): CaseBar[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]!;
    return { time: start + i * H, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close };
  });
}

/** 20 warm-up candles at 100 (true range 2 → ATR 2 = 2 % of 100), then the anchor at index 19. */
const WARM = Array.from({ length: 20 }, () => 100);
const FRAME = { interval: "1h" as const, anchorMs: T0 + 19 * H, horizon: 6 };

describe("Chartfall: Fenster und Ausschnitte", () => {
  it("lädt Vorlauf (Sicht + ATR) und Horizont, die Sicht endet an der Ankerkerze", () => {
    const w = caseWindow(FRAME);
    expect(w.from).toBe(FRAME.anchorMs - (90 + ATR_BARS) * H);
    expect(w.to).toBe(FRAME.anchorMs + 6 * H);
    expect(outcomeAt(FRAME)).toBe(FRAME.anchorMs + 7 * H); // the 6th candle after the anchor closes one candle later
    const bars = series([...WARM, 101, 102, 103, 104, 105, 106, 107]);
    expect(visibleBars(bars, FRAME).at(-1)!.time).toBe(FRAME.anchorMs);
    expect(visibleBars(bars, FRAME, 5)).toHaveLength(5);
    expect(futureBars(bars, FRAME).map((b) => b.close)).toEqual([101, 102, 103, 104, 105, 106]); // not the 7th
  });

  it("rastet auf die Kerze der Börse", () => {
    const t = Date.UTC(2026, 9, 12, 10, 17);
    expect(snapToCandle("4h", t)).toBe(Date.UTC(2026, 9, 12, 8, 0));
    expect(snapToCandle("1d", t)).toBe(Date.UTC(2026, 9, 12, 0, 0));
    expect(snapToCandle("15m", t)).toBe(Date.UTC(2026, 9, 12, 10, 15));
    expect(latestClosedAnchor("4h", t)).toBe(Date.UTC(2026, 9, 12, 4, 0)); // 08:00 is still forming
    expect(latestClosedAnchor("1h", t)).toBe(Date.UTC(2026, 9, 12, 9, 0));
  });
});

describe("Chartfall: ATR", () => {
  it("mittlere Kerzenspanne in % des Ankerkurses; zu wenige Kerzen → null", () => {
    const bars = series(WARM);
    expect(atrPct(bars, 19)).toBeCloseTo(2, 10); // range 2 on a close of 100
    expect(atrPct(bars, 13)).toBeNull(); // needs 14 candles + the one before
    expect(atrPct(bars, 14)).toBeCloseTo(2, 10);
  });

  it("Lücken über Nacht (Schlusskurs der Vorkerze) zählen zur Spanne", () => {
    const bars = series([...Array.from({ length: 19 }, () => 100), 100]);
    bars[19] = { time: bars[19]!.time, open: 110, high: 111, low: 109, close: 110 }; // gap up of 10 from the previous close
    // 13 candles of range 2 and one of true range max(2, |111-100|, |109-100|) = 11 → mean 37/14
    expect(atrPct(bars, 19)).toBeCloseTo(((13 * 2 + 11) / 14 / 110) * 100, 10);
  });
});

describe("Chartfall: Ergebnis aus den öffentlichen Kerzen (caseOutcome)", () => {
  const NOW = FRAME.anchorMs + 100 * H;

  it("steigt: Endkurs über der Seitwärts-Zone", () => {
    // band = 0,5 × 2 % × √6 = 2,449 %; end at 105 = +5 %
    const bars = series([...WARM, 101, 102, 103, 104, 104.5, 105, 105]);
    const o = caseOutcome(bars, FRAME, NOW);
    expect(o.status).toBe("ready");
    if (o.status !== "ready") return;
    expect(o.ref).toBe(100);
    expect(o.end).toBe(105);
    expect(o.movePct).toBeCloseTo(5, 10);
    expect(o.bandPct).toBeCloseTo(0.5 * 2 * Math.sqrt(6), 10);
    expect(o.direction).toBe("up");
    expect(o.maxUpPct).toBeCloseTo(6, 10); // the high of the 105 candle is 106
    expect(o.maxDownPct).toBeCloseTo(-1, 10); // the first candle after the anchor opens at 100 and its low is 99
  });

  it("fällt und seitwärts", () => {
    const down = caseOutcome(series([...WARM, 99, 98, 97, 96, 95, 94, 94]), FRAME, NOW);
    expect(down.status === "ready" && down.direction).toBe("down");
    const flat = caseOutcome(series([...WARM, 100.5, 101, 101.5, 101, 101.5, 102, 102]), FRAME, NOW);
    expect(flat.status === "ready" && flat.direction).toBe("flat"); // +2 % is inside ±2,449 %
    const edge = caseOutcome(series([...WARM, 101, 101, 101, 101, 101, 102.449, 102.449]), FRAME, NOW);
    expect(edge.status === "ready" && edge.direction).toBe("flat");
    const over = caseOutcome(series([...WARM, 101, 101, 101, 101, 101, 102.5, 102.5]), FRAME, NOW);
    expect(over.status === "ready" && over.direction).toBe("up");
  });

  it("vor dem Ende der Strecke ist es offen, mit dem Zeitpunkt – kein Schätzen", () => {
    const bars = series([...WARM, 101, 102, 103]);
    const o = caseOutcome(bars, FRAME, FRAME.anchorMs + 3 * H);
    expect(o).toEqual({ status: "pending", readyAt: outcomeAt(FRAME) });
    // one tick before the last candle closes: still pending; at the close: the end candle must exist
    expect(caseOutcome(series([...WARM, 101, 102, 103, 104, 105, 106]), FRAME, outcomeAt(FRAME) - 1).status).toBe("pending");
    expect(caseOutcome(series([...WARM, 101, 102, 103, 104, 105, 106]), FRAME, outcomeAt(FRAME)).status).toBe("ready");
  });

  it("fehlt etwas in den Daten, steht der Grund da", () => {
    expect(caseOutcome(series([...WARM, 1, 2, 3, 4, 5, 6]).slice(0, 10), FRAME, NOW)).toEqual({ status: "unavailable", reason: "noAnchor" });
    const shifted = series(WARM, T0 + 1000);
    expect(caseOutcome(shifted, FRAME, NOW)).toEqual({ status: "unavailable", reason: "noAnchor" });
    expect(caseOutcome(series(WARM.slice(0, 10)), { ...FRAME, anchorMs: T0 + 9 * H }, NOW)).toEqual({ status: "unavailable", reason: "noAtr" });
    const gap = series([...WARM, 101, 102, 103, 104, 105, 106]);
    gap.splice(25, 1); // the 6th candle after the anchor is missing
    expect(caseOutcome(gap, FRAME, NOW)).toEqual({ status: "unavailable", reason: "gap" });
  });

  it("unabhängig von der Reihenfolge der Kerzen", () => {
    const bars = series([...WARM, 101, 102, 103, 104, 105, 110, 110]);
    const a = caseOutcome(bars, FRAME, NOW);
    const b = caseOutcome([...bars].reverse(), FRAME, NOW);
    expect(b).toEqual(a);
  });
});

describe("Chartfall: Treffer und Zählung", () => {
  const ready = { status: "ready" as const, ref: 100, end: 105, movePct: 5, bandPct: 2.4, atrPct: 2, direction: "up" as const, maxUpPct: 6, maxDownPct: 0 };

  it("hitOf urteilt nur bei bekanntem Ergebnis", () => {
    expect(hitOf({ direction: "up" }, ready)).toBe(true);
    expect(hitOf({ direction: "down" }, ready)).toBe(false);
    expect(hitOf({ direction: "up" }, { status: "pending", readyAt: 1 })).toBeNull();
    expect(hitOf({ direction: "up" }, { status: "unavailable", reason: "gap" })).toBeNull();
  });

  it("Zählung: Richtungen, Treffer und eine Quote erst ab 5 Hypothesen", () => {
    const h = (d: "up" | "down" | "flat") => ({ direction: d });
    const small = tally([h("up"), h("down"), h("up")], ready);
    expect(small).toEqual({ n: 3, up: 2, down: 1, flat: 0, hits: 2, judged: 3, hitRate: null });
    const five = tally([h("up"), h("up"), h("down"), h("flat"), h("up")], ready);
    expect(five).toMatchObject({ n: 5, hits: 3, judged: 5, hitRate: 60 });
    expect(tally([h("up")], { status: "pending", readyAt: 1 })).toMatchObject({ n: 1, hits: 0, judged: 0, hitRate: null });
    expect(tally([], ready).n).toBe(0);
  });

  it("Verzögerung: wie viele Kerzen der Verlauf schon weiter war, als die Hypothese gespeichert wurde", () => {
    const c = { interval: "4h" as const, anchorMs: Date.UTC(2026, 9, 12, 0, 0) };
    const at = (h: number) => ({ createdAt: new Date(Date.UTC(2026, 9, 12, h, 0)).toISOString() });
    expect(delayCandles(at(1), c)).toBe(0); // the anchor candle (00:00–04:00) was not even over
    expect(delayCandles(at(5), c)).toBe(0); // inside the first candle after the anchor
    expect(delayCandles(at(8), c)).toBe(1);
    expect(delayCandles(at(21), c)).toBe(4);
  });
});

describe("Chartfall: Vertrag und Texte", () => {
  it("ein Fall ist nur Börsendaten und eine Frage", () => {
    const base = { pair: "btcusdt", interval: "4h", anchorMs: Date.UTC(2026, 9, 12, 8, 0), horizon: 12 };
    expect(CreateCaseSchema.parse(base)).toMatchObject({ pair: "BTCUSDT", question: "", openHours: 24 });
    expect(CreateCaseSchema.safeParse({ ...base, notes: "Konto 20k" }).success).toBe(false);
    expect(CreateCaseSchema.safeParse({ ...base, interval: "1w" }).success).toBe(false);
    expect(CreateCaseSchema.safeParse({ ...base, horizon: 10 }).success).toBe(false);
    expect(CreateCaseSchema.safeParse({ ...base, anchorMs: 5 }).success).toBe(false);
    expect(CreateCaseSchema.safeParse({ ...base, pair: "BTC/USDT" }).success).toBe(false);
  });

  it("eine Hypothese: Richtung, Stufe, Grund – nichts weiter", () => {
    const ok = { direction: "flat", confidence: 50, reason: "Die Box hält noch." };
    expect(HypothesisSchema.safeParse(ok).success).toBe(true);
    expect(HypothesisSchema.safeParse({ ...ok, confidence: 75 }).success).toBe(false);
    expect(HypothesisSchema.safeParse({ ...ok, reason: "kurz" }).success).toBe(false);
    expect(HypothesisSchema.safeParse({ ...ok, size: 5 }).success).toBe(false);
  });

  it("die Regeln stehen im Text: einmal festhalten, Seitwärts als Festlegung, kein Rang", () => {
    expect(CASES.commitHint).toMatch(/nicht mehr ändern oder löschen/);
    expect(CASES.convention).toMatch(/Festlegung/);
    expect(CASES.convention).toMatch(/ATR 14/);
    expect(CASES.oneCase).toMatch(/nichts über Können/);
    expect(DIRECTION_LABEL).toEqual({ up: "Steigt", down: "Fällt", flat: "Seitwärts" });
    expect(CASES.hitRate(3, 4, null)).toMatch(/zu wenig für eine Quote/);
    expect(CASES.hitRate(3, 5, 60)).toMatch(/keine Wertung/);
  });
});

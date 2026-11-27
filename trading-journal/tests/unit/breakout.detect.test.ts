/**
 * Scanner „Wer bricht aus?“ – der Rechenkern (`@/domain/breakout`) auf den Festkerzen der Tests (`tests/e2e/mocks/breakout.ts`) und auf
 * von Hand gebauten Randfällen: die Regel (Spanne, erster Schluss außerhalb), Volumen-Faktor, Trend am EMA 50, die Note, der Abstand zur
 * Marke in Prozent und ATR, die Wahl der Sitzung (heute / gestern, Sommerzeit), die Rangfolge und die Vorbelegung des Rechners.
 */
import { describe, expect, it } from "vitest";
import { analyzeBreakout, BREAKOUT_RULES, BREAKOUT_SYMBOLS, calcPrefill, gradeOf, pickSession, rankReads, type BreakoutRead } from "@/domain/breakout";
import type { Candle } from "@/market/types";
import { BREAK_SLOT, BREAKOUT_EXPECT, BREAKOUT_NOW, BREAKOUT_OPEN, BREAKOUT_SCENARIOS, breakoutCandles, IV } from "../e2e/mocks/breakout";

const read = (symbol: string, now = BREAKOUT_NOW, candles: readonly Candle[] = breakoutCandles(symbol, now)): BreakoutRead => analyzeBreakout({ symbol, candles, sessionId: "newyork", now });

describe("Sitzung wählen", () => {
  it("New York 9:30 Ortszeit: im Winter 14:30 UTC, im Sommer 13:30 UTC; London 8:00 ist im Winter 8:00 UTC", () => {
    expect(pickSession("newyork", BREAKOUT_NOW).day.openMs).toBe(BREAKOUT_OPEN);
    expect(pickSession("newyork", Date.UTC(2026, 6, 14, 18, 0)).day.openMs).toBe(Date.UTC(2026, 6, 14, 13, 30));
    expect(pickSession("london", BREAKOUT_NOW).day.openMs).toBe(Date.UTC(2026, 10, 24, 8, 0));
    expect(pickSession("london", Date.UTC(2026, 6, 14, 18, 0)).day.openMs).toBe(Date.UTC(2026, 6, 14, 7, 0));
  });

  it("vor dem Ende der Spanne plus einer Kerze wird die Sitzung von gestern gelesen – und so benannt", () => {
    const early = BREAKOUT_OPEN + 34 * 60_000; // 30 min Spanne + 5 min Kerze sind noch nicht um
    const p = pickSession("newyork", early);
    expect(p.previousDay).toBe(true);
    expect(p.day.openMs).toBe(BREAKOUT_OPEN - 24 * 3_600_000);
    expect(pickSession("newyork", BREAKOUT_OPEN + 35 * 60_000)).toMatchObject({ previousDay: false });
    // vor Sitzungsbeginn ebenso
    expect(pickSession("newyork", BREAKOUT_OPEN - 60_000).previousDay).toBe(true);
  });
});

describe("Erkennung auf den Festkerzen", () => {
  it.each(Object.entries(BREAKOUT_EXPECT))("%s: Note, Richtung, Volumen-Faktor und Marke wie im Drehbuch", (symbol, exp) => {
    const r = read(symbol);
    expect(r.status).toBe("breakout");
    expect(r.grade).toBe(exp.grade);
    expect(r.side).toBe(exp.side);
    expect(r.volumeX).toBeCloseTo(exp.volumeX, 6);
    expect(r.level).toBeCloseTo(exp.level, 8);
    // Zeitpunkt = Schluss der Ausbruchskerze (Kerze 8 schließt 45 Minuten nach Beginn)
    expect(r.signal?.barClose).toBe(BREAKOUT_OPEN + (BREAK_SLOT + 1) * IV);
    expect(r.statusText).toBe(`${exp.side === "long" ? "Long" : "Short"}-Ausbruch um 16:15`);
    expect(r.reasons.breakout).toBe(true);
  });

  it("LTC: Abstand zur Marke in Prozent und ATR von Hand gerechnet; die Kerzen des Mini-Charts sind die geladenen", () => {
    const candles = breakoutCandles("LTCUSDT");
    const r = read("LTCUSDT", BREAKOUT_NOW, candles);
    const closed = candles.filter((c) => c.closed);
    const last = closed[closed.length - 1]!;
    expect(r.price).toBe(last.close);
    const level = 51.9 * 0.9985;
    // Short: der Abstand ist positiv, wenn der Kurs UNTER der Marke steht
    expect(r.distPct).toBeCloseTo(((level - last.close) / level) * 100, 8);
    expect(r.distPct!).toBeGreaterThan(0.3);
    // ATR 14 = einfacher Durchschnitt der letzten 14 True Ranges
    let sum = 0;
    for (let i = closed.length - 14; i < closed.length; i++) {
      const c = closed[i]!;
      const prev = closed[i - 1]!.close;
      sum += Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
    }
    expect(r.atr).toBeCloseTo(sum / 14, 10);
    expect(r.distAtr).toBeCloseTo((level - last.close) / (sum / 14), 8);
    // der Mini-Chart: echte, geschlossene Kerzen ab sechs Kerzen vor der Spanne – jede davon steht so in den geladenen Daten
    expect(r.preview.length).toBeGreaterThan(20);
    expect(r.preview[0]!.time).toBe(BREAKOUT_OPEN - 6 * IV);
    for (const c of r.preview) expect(candles).toContainEqual(c);
    expect(r.preview.every((c) => c.closed)).toBe(true);
    // 24-h-Änderung gegen den Schluss genau 24 Stunden davor
    const dayAgo = closed.find((c) => c.time === last.time - 86_400_000)!;
    expect(r.change24h).toBeCloseTo((last.close / dayAgo.close - 1) * 100, 10);
  });

  it("Gründe: Trend gegen die Richtung (DOGE) und Volumen unter 1,5× (XRP) stehen einzeln da", () => {
    expect(read("DOGEUSDT").reasons).toEqual({ breakout: true, volume: false, trend: false });
    expect(read("XRPUSDT").reasons).toEqual({ breakout: true, volume: false, trend: true });
    expect(read("SUIUSDT").reasons).toEqual({ breakout: true, volume: true, trend: true });
    expect(read("DOGEUSDT").why.join(" ")).toContain("gegen die Richtung");
    const why = read("LTCUSDT").why;
    expect(why.join(" ")).toContain("4,0× der Durchschnitt der 20 Kerzen davor");
    // die Uhrzeiten der Sätze sind die der Überschrift (Berlin, wenn keine Zone übergeben wird) – nicht die der Börse
    expect(why[0]).toBe("Spanne von 15:30 bis 16:00 Uhr: Hoch 51,978, Tief 51,822.");
    expect(why[1]).toMatch(/^Die Kerze 16:10 ist um 16:15 Uhr geschlossen\. Ihr Schluss 51,666 liegt unter dem Tief der Spanne \(51,822\), 0,30 % darüber hinaus\./);
    expect(analyzeBreakout({ symbol: "LTCUSDT", candles: breakoutCandles("LTCUSDT"), sessionId: "newyork", now: BREAKOUT_NOW, timeZone: "UTC" }).statusText).toBe("Short-Ausbruch um 15:15");
    expect(read("BTCUSDT").why[1]).toContain("Gesucht wird bis 19:30 Uhr");
  });

  it("in der Spanne: kein Ausbruch, keine Note, Abstand zur näheren Kante", () => {
    const r = read("BTCUSDT");
    expect(r.status).toBe("inside");
    expect(r.grade).toBeNull();
    expect(r.side).toBeNull();
    expect(r.signal).toBeNull();
    expect(r.statusText).toBe("In der Spanne – noch kein Ausbruch");
    expect(r.range).toMatchObject({ high: 76_000 * 1.0015, low: 76_000 * 0.9985 });
    expect(r.distPct!).toBeGreaterThan(0);
    expect(r.distPct!).toBeLessThan(0.3);
    expect(["high", "low"]).toContain(r.nearEdge);
    expect(calcPrefill(r)).toBeNull();
  });

  it("eine fehlende Kerze der Spanne: keine Daten – es wird nicht über die Lücke geraten", () => {
    const r = read("TONUSDT");
    expect(r.status).toBe("no-data");
    expect(r.statusText).toBe("Keine Kerzen für diese Sitzung");
    expect(r.range).toBeNull();
    expect(r.grade).toBeNull();
    expect(r.preview).toEqual([]);
    expect(r.why.join(" ")).toMatch(/fehlen 5-Minuten-Kerzen/);
  });

  it("keine Kerzen überhaupt: keine Daten, kein Preis", () => {
    const r = read("BTCUSDT", BREAKOUT_NOW, []);
    expect(r).toMatchObject({ status: "no-data", price: null, atr: null, change24h: null });
  });
});

describe("Randfälle der Regel", () => {
  const closedOnly = (symbol: string, now: number): Candle[] => breakoutCandles(symbol, now);

  it("die laufende Kerze zählt nie: eine Minute vor dem Schluss der Ausbruchskerze gibt es noch keinen Ausbruch", () => {
    const justBefore = BREAKOUT_OPEN + (BREAK_SLOT + 1) * IV - 60_000;
    const r = read("LTCUSDT", justBefore);
    expect(r.status).toBe("inside");
    expect(r.signal).toBeNull();
    // und mit ihrem Schluss ist er da
    expect(read("LTCUSDT", BREAKOUT_OPEN + (BREAK_SLOT + 1) * IV + 1000).status).toBe("breakout");
  });

  it("ein Docht über das Hoch ohne Schluss darüber ist kein Ausbruch; ein Schluss genau auf dem Hoch auch nicht", () => {
    const now = BREAKOUT_OPEN + 60 * 60_000 + 1000;
    const candles = closedOnly("BTCUSDT", now).map((c) => ({ ...c }));
    const high = 76_000 * 1.0015;
    const bar = candles.find((c) => c.time === BREAKOUT_OPEN + 7 * IV)!;
    bar.high = high * 1.01;
    expect(read("BTCUSDT", now, candles).status).toBe("inside");
    bar.close = high;
    expect(read("BTCUSDT", now, candles).status).toBe("inside");
    bar.close = high * 1.0001;
    const r = read("BTCUSDT", now, candles);
    expect(r).toMatchObject({ status: "breakout", side: "long" });
    expect(r.signal?.barOpen).toBe(BREAKOUT_OPEN + 7 * IV);
  });

  it("nach 240 Minuten ohne Schluss außerhalb: kein Ausbruch in dieser Sitzung", () => {
    const late = BREAKOUT_OPEN + 300 * 60_000;
    const r = read("BTCUSDT", late);
    expect(r.status).toBe("expired");
    expect(r.statusText).toBe("Kein Ausbruch in dieser Sitzung");
    expect(BREAKOUT_RULES.searchMinutes).toBe(240);
  });

  it("zu wenige Kerzen für EMA 50 und den Volumen-Schnitt: beides heißt „nicht bestimmbar“, die Note zählt nur, was feststeht", () => {
    // nur 5 Kerzen vor der Sitzung geladen: vor der Ausbruchskerze (Kerze 8) liegen 13 statt 20 Kerzen
    const candles = breakoutCandles("LTCUSDT").filter((c) => c.time >= BREAKOUT_OPEN - 5 * IV);
    const r = read("LTCUSDT", BREAKOUT_NOW, candles);
    expect(r.status).toBe("breakout");
    expect(r.reasons).toEqual({ breakout: true, volume: null, trend: null });
    expect(r.volumeX).toBeNull();
    expect(r.grade).toBe("C");
    expect(r.why.join(" ")).toContain("nicht bestimmbar");
  });

  it("Kurs fällt nach dem Ausbruch zurück in die Spanne: der Abstand ist negativ, der Rechner bekommt einen ATR-Stop", () => {
    const candles = breakoutCandles("BNBUSDT").map((c) => ({ ...c }));
    const p = BREAKOUT_SCENARIOS.BNBUSDT!.price;
    // die letzten geschlossenen Kerzen schließen unter dem Tief der Spanne (Long-Ausbruch ist gescheitert)
    for (const c of candles) if (c.time >= BREAKOUT_OPEN + 20 * IV) Object.assign(c, { open: p * 0.997, close: p * 0.997, high: p * 0.9975, low: p * 0.9965 });
    const r = read("BNBUSDT", BREAKOUT_NOW, candles);
    expect(r.status).toBe("breakout");
    expect(r.distPct!).toBeLessThan(0);
    expect(r.why).toContain("Der letzte Schluss liegt wieder innerhalb der Spanne.");
    const pre = calcPrefill(r)!;
    expect(pre.stopFrom).toBe("atr");
    expect(pre.stop).toBeCloseTo(r.price! - BREAKOUT_RULES.atrStop * r.atr!, 10);
    expect(pre.stop).toBeLessThan(pre.entry);
  });
});

describe("Note, Rangfolge, Vorbelegung", () => {
  it("die Note zählt Gründe: A+ braucht Volumen ab 2×, A ab 1,5× mit Trend, B einen von beiden, C nur den Ausbruch", () => {
    const g = (volume: boolean | null, trend: boolean | null, x: number | null) => gradeOf({ breakout: true, volume, trend }, x);
    expect(g(true, true, 2)).toBe("A+");
    expect(g(true, true, 1.99)).toBe("A");
    expect(g(true, false, 3)).toBe("B");
    expect(g(false, true, 1.2)).toBe("B");
    expect(g(false, false, 1)).toBe("C");
    expect(g(null, null, null)).toBe("C");
    expect(gradeOf({ breakout: false, volume: null, trend: null }, null)).toBeNull();
  });

  it("Rangfolge: meiste Gründe zuerst, bei gleicher Note das stärkere Volumen, ohne Ausbruch dahinter, ohne Kerzen zuletzt", () => {
    const ranked = rankReads(BREAKOUT_SYMBOLS.map((s) => read(s))).map((r) => r.symbol);
    expect(ranked.slice(0, 5)).toEqual(["LTCUSDT", "BNBUSDT", "SUIUSDT", "XRPUSDT", "DOGEUSDT"]);
    expect(ranked[ranked.length - 1]).toBe("TONUSDT");
    expect(ranked.slice(5, 11)).toEqual(["ADAUSDT", "AVAXUSDT", "BTCUSDT", "ETHUSDT", "LINKUSDT", "SOLUSDT"]);
  });

  it("Vorbelegung des Rechners: Einstieg = letzter Schluss, Stop = andere Seite der Spanne", () => {
    const r = read("LTCUSDT");
    expect(calcPrefill(r)).toEqual({ pair: "LTCUSDT", side: "short", entry: r.price, stop: r.range!.high, stopFrom: "range" });
    const b = read("BNBUSDT");
    expect(calcPrefill(b)).toEqual({ pair: "BNBUSDT", side: "long", entry: b.price, stop: b.range!.low, stopFrom: "range" });
  });
});

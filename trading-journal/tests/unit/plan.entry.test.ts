/**
 * Handelsplan · Einstiegs-Timer. Der Fall des Skills trader-entry (TSLA, Montag 19.10.2026, 5-Minuten-Kerzen, Range
 * 9:30–9:45 New Yorker Zeit): Hoch 362,18, Tief 354,47; die Kerze 10:10 schließt mit 364,18 über dem Hoch – Signal um
 * 10:15 zu 364,18, 0,55 % darüber. Dazu die Gegenproben: Docht, Schluss genau auf dem Niveau, offene Kerze, Short,
 * Volumenfilter, Lücke in den Daten, abgelaufen, Sommerzeit.
 */
import { describe, expect, it } from "vitest";
import { atrOf, closedUpTo, entryTimer, intervalText, sessionDay, validateTimeframe, MIN, type EntryInput } from "@/domain/plan";
import type { Candle } from "@/market/types";

const DAY = "2026-10-19";
const session = sessionDay("usstocks", DAY);
const OPEN = session.openMs; // 13:30 UTC = 9:30 EDT
const IV = 5 * MIN;
/** wall clock New York (EDT, UTC−4) of the day as an instant */
const et = (h: number, m: number): number => Date.UTC(2026, 9, 19, h + 4, m);

const vol = 100;
/** slot n = the candle that starts n × 5 min after the open */
const bar = (slot: number, o: number, h: number, l: number, c: number, v = vol, closed = true): Candle => ({ time: OPEN + slot * IV, open: o, high: h, low: l, close: c, volume: v, closed });

/** the skill's day: range bars 9:30 / 9:35 / 9:40, then quiet closes inside the range, the 10:10 bar breaks out */
function day(): Candle[] {
  return [
    bar(0, 355, 360.1, 354.47, 359, 300),
    bar(1, 359, 362.18, 358, 361, 100),
    bar(2, 361, 361.9, 359.5, 360.5, 100),
    bar(3, 360.5, 361.4, 359.8, 361.2),
    bar(4, 361.2, 361.6, 360.4, 360.9),
    bar(5, 360.9, 363.0, 360.5, 361.4), // wick above the range high, close inside
    bar(6, 361.4, 361.8, 360.9, 361.0),
    bar(7, 361, 361.9, 360.8, 361.68),
    bar(8, 361.7, 364.5, 361.5, 364.18, 180), // closes above 362.18
    bar(9, 364.2, 365.4, 363.9, 365.0),
  ];
}

const base = (over: Partial<EntryInput> = {}): EntryInput => ({
  symbol: "TSLA",
  candles: day(),
  intervalMs: IV,
  session,
  now: et(10, 20),
  orMinutes: 15,
  sides: "both",
  minVolumeX: null,
  tick: 0.01,
  ...over,
});

describe("Einstiegs-Timer · die Range", () => {
  it("die ersten 15 Minuten = die Kerzen 9:30, 9:35, 9:40: Hoch 362,18, Tief 354,47, Mitte 358,325", () => {
    const r = entryTimer(base()).range!;
    expect(r).toMatchObject({ high: 362.18, low: 354.47, bars: 3, of: 3, complete: true });
    expect(r.mid).toBeCloseTo(358.325, 10);
    expect(r.height).toBeCloseTo(7.71, 10);
    expect(r.avgVolume).toBeCloseTo((300 + 100 + 100) / 3, 10);
    expect(r.startMs).toBe(et(9, 30));
    expect(r.endMs).toBe(et(9, 45));
  });

  it("vor 9:45 entsteht sie noch: 2 von 3 Kerzen, kein Signal", () => {
    const res = entryTimer(base({ now: et(9, 42), candles: day().slice(0, 3).map((c, i) => (i === 2 ? { ...c, closed: false } : c)) }));
    expect(res.status).toBe("forming");
    expect(res.headline).toBe("Range entsteht: 2 von 3 Kerzen geschlossen – fertig um 09:45 Uhr.");
    expect(res.range).toMatchObject({ complete: false, bars: 2, high: 362.18, low: 354.47 });
    expect(res.signal).toBeNull();
    expect(res.reasons.join(" ")).toContain("läuft noch");
  });

  it("vor der Sitzung: noch nicht offen, mit der Berliner Uhrzeit", () => {
    const res = entryTimer(base({ now: et(9, 0), candles: [] }));
    expect(res.status).toBe("not-open");
    expect(res.headline).toBe("Die Sitzung beginnt um 09:30 Uhr UTC−4 (15:30 Uhr in Berlin).");
  });

  it("fehlt eine Kerze der Range, gibt es keine Range – statt zu schätzen", () => {
    const res = entryTimer(base({ candles: day().filter((_, i) => i !== 1) }));
    expect(res.status).toBe("no-data");
    expect(res.headline).toBe("Keine Daten für die Range: 2 von 3 Kerzen.");
    expect(res.reasons[0]).toContain("09:35");
    expect(res.signal).toBeNull();
  });
});

describe("Einstiegs-Timer · das Signal (erste geschlossene Kerze mit Schluss außerhalb)", () => {
  it("10:20 Uhr: die Kerze 10:10 hat um 10:15 über 362,18 geschlossen – Long zu 364,18, 0,55 % darüber, 5 Minuten alt, nicht zu alt", () => {
    const res = entryTimer(base());
    expect(res.status).toBe("triggered");
    expect(res.signal).toMatchObject({ side: "long", barOpen: et(10, 10), barClose: et(10, 15), price: 364.18, level: 362.18, ageMin: 5, late: false });
    expect(res.signal!.beyondPct).toBeCloseTo(2 / 362.18, 10);
    expect(res.headline).toBe("Signal Long: Schluss 364,18 um 10:15 Uhr über dem Hoch der Range.");
    expect(res.reasons[0]).toBe("Die Kerze 10:10 ist um 10:15 Uhr geschlossen. Ihr Schluss 364,18 liegt über dem Hoch der Range (362,18), 0,55 % darüber hinaus.");
    expect(res.reasons.join(" ")).toContain("nicht ein Docht");
    expect(res.reasons.at(-1)).toBe("Das Signal ist frisch (höchstens eine Kerze alt).");
  });

  it("der Docht der Kerze 10:00 über 362,18 (Hoch 363,0) löst nichts aus – nur der Schluss zählt", () => {
    const res = entryTimer(base());
    expect(res.signal!.barOpen).toBe(et(10, 10)); // nicht 10:00
  });

  it("ein Schluss genau auf dem Niveau ist nicht darüber", () => {
    const candles = day();
    candles[8] = bar(8, 361.7, 364.5, 361.5, 362.18, 180);
    const res = entryTimer(base({ candles: candles.slice(0, 9), now: et(10, 20) }));
    expect(res.status).toBe("waiting");
    expect(res.signal).toBeNull();
  });

  it("10:12 Uhr: die Kerze 10:10 läuft noch (bisher 364,18) und zählt nicht – Warten, 0,50 unter dem Hoch (−0,14 %)", () => {
    const candles = day().slice(0, 9).map((c, i) => (i === 8 ? { ...c, closed: false } : c));
    const res = entryTimer(base({ candles, now: et(10, 12) }));
    expect(res.status).toBe("waiting");
    expect(res.signal).toBeNull();
    expect(res.headline).toBe("Warten: letzter Schluss 361,68, 0,50 unter dem Range-Hoch und 7,21 über dem Range-Tief.");
    expect(res.reasons[0]).toBe("Letzter Schluss 361,68 (Kerze 10:05): 0,50 unter dem Range-Hoch 362,18 (−0,14 %) und 7,21 über dem Range-Tief 354,47 (+2,03 %).");
    expect(res.reasons[1]).toBe("Die Kerze 10:10 läuft noch (bisher 364,18) und schließt um 10:15 Uhr – sie zählt erst nach ihrem Schluss.");
    expect(res.forming).toMatchObject({ time: et(10, 10), closeMs: et(10, 15), price: 364.18 });
  });

  it("10:15:30 Uhr, aber die Daten halten die Kerze noch für offen: sie zählt erst, wenn sie nachgeladen ist", () => {
    const candles = day().slice(0, 9).map((c, i) => (i === 8 ? { ...c, closed: false } : c));
    const res = entryTimer(base({ candles, now: et(10, 15) + 30_000 }));
    expect(res.status).toBe("waiting");
    expect(res.stale).toContain("Die Kerze 10:10 ist laut Uhr geschlossen, die Daten halten sie noch nicht als geschlossen");
    expect(res.signal).toBeNull();
  });

  it("Short: der erste Schluss UNTER dem Tief 354,47", () => {
    const candles = day().slice(0, 4);
    candles.push(bar(4, 359.9, 360, 351.0, 352.5, 150));
    const res = entryTimer(base({ candles, now: et(10, 0) }));
    expect(res.signal).toMatchObject({ side: "short", barOpen: et(9, 50), barClose: et(9, 55), price: 352.5, level: 354.47 });
    expect(res.signal!.beyondPct).toBeCloseTo((354.47 - 352.5) / 354.47, 10);
    expect(res.headline).toBe("Signal Short: Schluss 352,50 um 09:55 Uhr unter dem Tief der Range.");
  });

  it("nur Long: ein Schluss unter dem Tief wird benannt, aber übergangen; der spätere Long-Ausbruch gilt", () => {
    const candles = day().slice(0, 4);
    candles.push(bar(4, 359.9, 360, 351.0, 352.5, 150)); // short close (ignored)
    candles.push(bar(5, 352.5, 363.5, 352.0, 363.0, 150)); // long close
    const res = entryTimer(base({ candles, now: et(10, 5), sides: "long" }));
    expect(res.signal).toMatchObject({ side: "long", price: 363, barClose: et(10, 0) });
    expect(res.reasons.join(" ")).toContain("Die Kerze 09:50 schloss unter dem Tief der Range – das ist nicht deine Richtung (nur Long).");
    // nur Short sieht den ersten Schluss unter dem Tief
    expect(entryTimer(base({ candles, now: et(10, 5), sides: "short" })).signal).toMatchObject({ side: "short", barClose: et(9, 55) });
  });

  it("Volumenfilter 1,0×: die Kerze 10:10 hat nur 0,60× des Range-Volumens und wird übergangen, die Kerze 10:15 (3,00×) gilt", () => {
    // Range-Durchschnitt 166,67; Kerze 10:10 mit 100 = 0,60×, die Kerze 10:15 mit 500 = 3,00×
    const candles = day();
    candles[8] = bar(8, 361.7, 364.5, 361.5, 364.18, 100);
    candles[9] = bar(9, 364.2, 365.4, 363.9, 365.0, 500);
    const res = entryTimer(base({ candles, now: et(10, 25), minVolumeX: 1 }));
    expect(res.signal).toMatchObject({ barOpen: et(10, 15), barClose: et(10, 20), price: 365 });
    expect(res.signal!.volumeX).toBeCloseTo(3, 10);
    expect(res.reasons.join(" ")).toContain("Die Kerze 10:10 schloss über dem Hoch, aber mit nur 0,60× dem Range-Volumen (verlangt: 1,00×) – übergangen.");
    // ohne Filter bleibt es die Kerze 10:10
    expect(entryTimer(base({ candles, now: et(10, 25) })).signal!.barOpen).toBe(et(10, 10));
  });

  it("ein Signal ist \"zu alt\", wenn die Kerze länger als eine Kerzenlänge zurückliegt", () => {
    const res = entryTimer(base({ now: et(10, 40) }));
    expect(res.signal).toMatchObject({ ageMin: 25, late: true });
    expect(res.reasons.at(-1)).toBe("Das Signal ist 25 Minuten alt – älter als eine Kerze. Ein später Einstieg ist ein anderer Trade.");
  });

  it("nach dem Ende der Sitzung ist es ein Rückblick", () => {
    const res = entryTimer(base({ now: et(17, 0) }));
    expect(res.past).toBe(true);
    expect(res.status).toBe("triggered");
    expect(res.reasons.at(-1)).toBe("Die Sitzung ist vorbei: Das ist ein Rückblick darauf, wie der Ablauf gewesen wäre.");
  });
});

describe("Einstiegs-Timer · Lücken, Ablauf, Sitzungstage", () => {
  it("eine fehlende Kerze VOR dem ersten Ausbruch: keine Daten, nicht raten", () => {
    const candles = day().filter((_, i) => i !== 6);
    const res = entryTimer(base({ candles, now: et(10, 20) }));
    expect(res.status).toBe("no-data");
    expect(res.headline).toBe("Eine Kerze fehlt in den Daten (10:00).");
  });

  it("ohne Ausbruch bis 15:30 Uhr: abgelaufen", () => {
    const quiet: Candle[] = day().slice(0, 3);
    for (let s = 3; s < 78; s++) quiet.push(bar(s, 360, 361, 359, 360.5)); // 9:45 … 15:55, alles innerhalb der Range
    const res = entryTimer(base({ candles: quiet, now: et(15, 31) }));
    expect(res.status).toBe("expired");
    expect(res.headline).toBe("Abgelaufen: bis 15:30 Uhr ist keine Kerze außerhalb der Range geschlossen.");
    // um 15:20 wartet es noch
    expect(entryTimer(base({ candles: quiet, now: et(15, 20) })).status).toBe("waiting");
  });

  it("Kerzen, die nach dem letzten Einstieg schließen, zählen nicht", () => {
    const candles: Candle[] = day().slice(0, 3);
    for (let s = 3; s < 72; s++) candles.push(bar(s, 360, 361, 359, 360.5)); // bis 15:30 ruhig
    candles.push(bar(72, 360, 366, 359, 365)); // 15:30–15:35 schließt über dem Hoch – zu spät
    const res = entryTimer(base({ candles, now: et(15, 40) }));
    expect(res.status).toBe("expired");
    expect(res.signal).toBeNull();
  });

  it("Samstag und Feiertag: keine Sitzung", () => {
    const sat = entryTimer(base({ session: sessionDay("usstocks", "2026-10-24"), now: Date.UTC(2026, 9, 24, 15, 0) }));
    expect(sat.status).toBe("closed");
    expect(sat.headline).toBe("Keine Sitzung am Sa 24.10.: Wochenende.");
    const holiday = entryTimer(base({ session: sessionDay("usstocks", "2026-11-26"), now: Date.UTC(2026, 10, 26, 15, 0) }));
    expect(holiday.headline).toBe("Keine Sitzung am Do 26.11.: Feiertag der US-Börse (Thanksgiving).");
  });

  it("am 13-Uhr-Schluss endet die Zeit für Einstiege um 12:30", () => {
    const s = sessionDay("usstocks", "2026-11-27");
    const candles: Candle[] = [];
    for (let k = 0; k < 40; k++) candles.push({ time: s.openMs + k * IV, open: 100, high: 101, low: 99, close: 100, volume: 10, closed: true }); // 9:30 … 12:50 (Schluss 12:55)
    const res = entryTimer(base({ session: s, candles, now: s.openMs + 200 * MIN }));
    expect(res.cutoffMs).toBe(s.openMs + 180 * MIN);
    expect(res.status).toBe("expired");
    expect(res.reasons.join(" ")).toContain("heute schließt die Börse schon um 13:00");
  });
});

describe("Einstiegs-Timer · Zeitrahmen und Zeitzonen", () => {
  it("1-Stunden-Kerzen passen nicht zu einem Beginn um 9:30 – gesagt statt gerechnet", () => {
    const msg = validateTimeframe(session, 60 * MIN, 15);
    expect(msg).toBe("Die Sitzung beginnt um 09:30 Uhr – 1-Stunden-Kerzen beginnen nicht zu dieser Uhrzeit. Wähle einen kleineren Zeitrahmen.");
    expect(entryTimer(base({ intervalMs: 60 * MIN })).status).toBe("invalid");
    expect(validateTimeframe(session, IV, 14)).toBe("Die Range (14 Minuten) ist kein Vielfaches der Kerzenlänge (5-Minuten-Kerzen).");
    expect(validateTimeframe(session, IV, 15)).toBeNull();
    expect(validateTimeframe(sessionDay("london", DAY), 60 * MIN, 60)).toBeNull(); // 8:00 London = volle Stunde
  });

  it("15-Minuten-Kerzen: die Range ist EINE Kerze", () => {
    const iv = 15 * MIN;
    const candles: Candle[] = [
      { time: OPEN, open: 355, high: 362.18, low: 354.47, close: 361, volume: 500, closed: true },
      { time: OPEN + iv, open: 361, high: 362, low: 360, close: 361.5, volume: 100, closed: true },
      { time: OPEN + 2 * iv, open: 361.5, high: 364.5, low: 361, close: 364.18, volume: 100, closed: true },
    ];
    const res = entryTimer(base({ candles, intervalMs: iv, now: et(10, 30) }));
    expect(res.range).toMatchObject({ bars: 1, of: 1, high: 362.18, low: 354.47 });
    expect(res.signal).toMatchObject({ side: "long", barClose: et(10, 15) });
  });

  it("Winterzeit: derselbe Ablauf am Montag 2.11.2026 beginnt 14:30 UTC und alle Uhrzeiten bleiben New Yorker Ortszeit", () => {
    const w = sessionDay("usstocks", "2026-11-02");
    const candles: Candle[] = [
      { time: w.openMs, open: 100, high: 102, low: 99, close: 101, volume: 100, closed: true },
      { time: w.openMs + IV, open: 101, high: 102, low: 100, close: 101.5, volume: 100, closed: true },
      { time: w.openMs + 2 * IV, open: 101.5, high: 101.9, low: 100.5, close: 101, volume: 100, closed: true },
      { time: w.openMs + 3 * IV, open: 101, high: 103.5, low: 100.9, close: 103, volume: 100, closed: true },
    ];
    expect(w.openMs).toBe(Date.UTC(2026, 10, 2, 14, 30));
    const res = entryTimer(base({ session: w, candles, now: w.openMs + 25 * MIN }));
    expect(res.signal).toMatchObject({ side: "long", price: 103, level: 102 });
    expect(res.headline).toBe("Signal Long: Schluss 103,00 um 09:50 Uhr über dem Hoch der Range.");
  });

  it("Krypto, London im Sommer: 8:00 Ortszeit = 07:00 UTC; die Kerzen davor zählen nicht zur Range", () => {
    const ldn = sessionDay("london", DAY);
    const mk = (k: number, o: number, h: number, l: number, c: number): Candle => ({ time: ldn.openMs + k * IV, open: o, high: h, low: l, close: c, volume: 10, closed: true });
    const candles = [
      { time: ldn.openMs - IV, open: 50, high: 500, low: 1, close: 60, volume: 10, closed: true }, // 06:55 UTC, vor der Sitzung
      mk(0, 100, 105, 99, 104),
      mk(1, 104, 106, 103, 105),
      mk(2, 105, 105.5, 102, 103),
      mk(3, 103, 108, 103, 107.5),
    ];
    const res = entryTimer(base({ session: ldn, candles, now: ldn.openMs + 25 * MIN }));
    expect(res.range).toMatchObject({ high: 106, low: 99 });
    expect(res.signal).toMatchObject({ side: "long", price: 107.5 });
    expect(res.headline).toContain("um 08:20 Uhr");
  });
});

describe("Bausteine: ATR, geschlossene Kerzen, Schreibweise", () => {
  it("ATR = einfacher Mittelwert der letzten 14 True Ranges; die erste Kerze nimmt Hoch − Tief", () => {
    // TRs: 4 (h−l der ersten), 6 (|h − prevClose|), 3
    const atr = atrOf([
      { high: 10, low: 6, close: 9 },
      { high: 15, low: 11, close: 12 }, // max(4, |15−9|=6, |11−9|=2) = 6
      { high: 13, low: 10, close: 11 }, // max(3, 1, 2) = 3
    ]);
    expect(atr).toEqual({ value: (4 + 6 + 3) / 3, bars: 3 });
    expect(atrOf([{ high: 2, low: 1, close: 1.5 }])).toBeNull(); // weniger als 3
    const many = Array.from({ length: 20 }, (_, i) => ({ high: 10 + i, low: 9 + i, close: 9.5 + i }));
    expect(atrOf(many)!.bars).toBe(14);
  });

  it("closedUpTo: nur geschlossene Kerzen, die bis zum Zeitpunkt enden, aufsteigend, je Zeit eine", () => {
    const list = [bar(1, 1, 2, 0, 1), bar(0, 1, 2, 0, 1), { ...bar(2, 1, 2, 0, 1), closed: false }, bar(1, 5, 6, 4, 5)];
    const r = closedUpTo(list, IV, OPEN + 3 * IV);
    expect(r.map((c) => c.time)).toEqual([OPEN, OPEN + IV]);
    expect(r[1]!.open).toBe(5); // die letzte Kerze derselben Zeit gewinnt
    expect(closedUpTo(list, IV, OPEN + IV).map((c) => c.time)).toEqual([OPEN]);
  });

  it("Kerzenlänge in Worten", () => {
    expect(intervalText(5 * MIN)).toBe("5-Minuten-Kerzen");
    expect(intervalText(60 * MIN)).toBe("1-Stunden-Kerzen");
    expect(intervalText(120 * MIN)).toBe("2-Stunden-Kerzen");
  });
});

/**
 * Eröffnungs-Range-Ausbruch (zweite Familie der Strategiesuche): jede Regel gegen eine HANDRECHNUNG auf gebauten Sitzungen
 * (Mittwoch 07.01.2026, New York 13:30 UTC, 5-Minuten-Kerzen): Range, Signal im 3-Stunden-Fenster, Gründe (Volumen-Faktor, Trend),
 * Note A+ / A / B / C, Einstieg zur Eröffnung der Folgekerze, Stop vor Ziel, Lücke über den Stop, Zeit-Stopp, Gebühren, kein Blick voraus.
 */
import { describe, expect, it } from "vitest";
import type { Bar } from "@/domain/backtest/types";
import { orbDays, orbDetect, orbNote, orbPrepare, orbSession, orbTrade, ORB_SPACE, type OrbCosts, type OrbParams } from "@/domain/lab/search/orb";

const T_OPEN = Date.UTC(2026, 0, 7, 13, 30) / 1000; // 07.01.2026 ist ein Mittwoch
const STEP = 300;
type Spec = [o: number, h: number, l: number, c: number, v: number];

/** 60 ruhige Kerzen vor der Eröffnung (Schluss 100, Volumen 100), dann die Sitzung; `rest` füllt bis zum Sitzungsende mit ruhigen Kerzen. */
function day(session: Spec[], opts: { fill?: Spec } = {}): Bar[] {
  const calm: Spec = [100, 100.5, 99.5, 100, 100];
  const all: Spec[] = [...Array.from({ length: 60 }, () => calm), ...session];
  while (all.length < 60 + 78) all.push(opts.fill ?? [100.4, 100.8, 100.0, 100.4, 100]);
  return all.map(([o, h, l, c, v], i) => ({ t: T_OPEN + (i - 60) * STEP, o, h, l, c, v }));
}

/** Range 15 min (3 Kerzen): Hoch 101,4, Tief 99,0; danach zwei ruhige Kerzen, dann der Ausbruch auf der Kerze mit Index 5 der Sitzung. */
const RANGE: Spec[] = [
  [100, 101.0, 99.2, 100.5, 100],
  [100.5, 101.4, 99.0, 100.2, 100],
  [100.2, 101.2, 99.5, 100.8, 100],
  [100.8, 101.0, 100.2, 100.6, 100], // Index 3: innerhalb
  [100.6, 101.1, 100.4, 100.9, 100], // Index 4: innerhalb
];
const BREAK_UP: Spec = [100.9, 102.4, 100.8, 102.0, 300]; // Index 5: Schluss 102 > 101,4, Volumen 3× des Schnitts der 20 davor (100)
const NO_COSTS: OrbCosts = { takerBps: 5, makerBps: 2, slippage: { kind: "none" } };
const P: OrbParams = { session: "ny", rangeMin: 15, volThr: 1.5, targetR: 2, stop: "range", trend: true };
const near = (a: number, b: number, d = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(d);

describe("Range, Signal, Gründe, Note (Handrechnung)", () => {
  const bars = day([...RANGE, BREAK_UP, [102.2, 103, 101.5, 102.8, 100]]);
  const prep = orbPrepare(bars);
  const d = orbDetect(prep, orbDays(prep, "ny")[0]!, "ny", 15)!;

  it("Range = Hoch/Tief der ersten 3 Kerzen; Signal = die erste Kerze mit Schluss außerhalb (Index 5, Long)", () => {
    expect(orbDays(prep, "ny")).toHaveLength(1);
    expect(d.high).toBe(101.4);
    expect(d.low).toBe(99.0);
    expect(d.signal).toMatchObject({ j: d.i0 + 5, dir: 1 });
    expect(d.iEnd - d.i0 + 1).toBe(78); // 13:30–20:00 UTC
  });

  it("Gründe: Volumen 300 ÷ Schnitt der 20 davor (100) = 3,0×; Kurs über der EMA 50 → Trend passt; Note A+", () => {
    near(d.volFactor!, 3.0);
    expect(d.trendOk).toBe(true);
    expect(orbNote(d.volFactor!, d.trendOk!, 1.5)).toBe("A+");
    const s = orbSession(prep, d.day, P, NO_COSTS);
    expect(s.note).toBe("A+");
    expect(s.counts).toBe(true);
  });

  it("Noten: A+ (≥ 2× und Trend) · A (≥ Schwelle und Trend) · B (eins von beiden) · C (keins)", () => {
    expect(orbNote(2, true, 1.25)).toBe("A+");
    expect(orbNote(1.9, true, 1.25)).toBe("A");
    expect(orbNote(1.3, true, 1.5)).toBe("B"); // Volumen unter der Schwelle, Trend passt
    expect(orbNote(1.6, false, 1.5)).toBe("B"); // Volumen reicht, Trend nicht
    expect(orbNote(1.0, false, 1.25)).toBe("C");
    expect(orbNote(2.5, false, 2)).toBe("B"); // 2× allein ist noch kein A+
  });

  it("Filter: die Variante handelt nur bei Volumen ≥ Schwelle (3,0× ≥ 2 → ja; Schwelle 2 bei Faktor 1,6 → nein) und passendem Trend", () => {
    expect(orbSession(prep, d.day, { ...P, volThr: 2 }, NO_COSTS).counts).toBe(true);
    const weak = orbPrepare(day([...RANGE, [100.9, 102.4, 100.8, 102.0, 160], [102.2, 103, 101.5, 102.8, 100]]));
    const dw = orbDetect(weak, orbDays(weak, "ny")[0]!, "ny", 15)!;
    near(dw.volFactor!, 1.6);
    expect(orbSession(weak, dw.day, { ...P, volThr: 2 }, NO_COSTS).counts).toBe(false);
    expect(orbSession(weak, dw.day, { ...P, volThr: 1.5 }, NO_COSTS).counts).toBe(true);
    expect(orbSession(weak, dw.day, { ...P, volThr: 1.5 }, NO_COSTS).note).toBe("A");
  });

  it("Short: Schluss unter dem Tief; Volumen 1,0× und Kurs unter der EMA → Note B (nur der Trend), die Variante mit Schwelle 1,25 handelt nicht", () => {
    const sh = orbPrepare(day([...RANGE, [100.9, 101.0, 98.2, 98.6, 100], [98.6, 99, 98.0, 98.5, 100]]));
    const ds = orbDetect(sh, orbDays(sh, "ny")[0]!, "ny", 15)!;
    expect(ds.signal).toMatchObject({ dir: -1 });
    near(ds.volFactor!, 1.0);
    expect(ds.trendOk).toBe(true);
    const s = orbSession(sh, ds.day, { ...P, volThr: 1.25, trend: false }, NO_COSTS);
    expect(s.note).toBe("B");
    expect(s.counts).toBe(false);
  });

  it("Signal nur innerhalb von 3 Stunden nach der Range: Kerze 3 + 35 ja, 3 + 36 nein; kein Signal vor dem Ende der Range", () => {
    const quiet: Spec = [100.4, 100.9, 100.0, 100.4, 100];
    const build = (at: number) => {
      const spec: Spec[] = [...RANGE.slice(0, 3)];
      while (spec.length < at) spec.push(quiet);
      spec.push([100.9, 102.4, 100.8, 102.0, 300]);
      const p = orbPrepare(day(spec));
      return orbDetect(p, orbDays(p, "ny")[0]!, "ny", 15)!;
    };
    expect(build(3 + 35).signal?.j).toBeDefined();
    expect(build(3 + 36).signal).toBeNull();
    // Ausbruch IN der Range (Kerze 1 schließt über dem Hoch der ersten Kerze) ist kein Signal
    const inRange = orbPrepare(day([[100, 100.5, 99.5, 100, 100], [100, 103, 99.5, 102.5, 300], [102.5, 102.6, 100, 100.6, 100], ...RANGE.slice(3)]));
    const di = orbDetect(inRange, orbDays(inRange, "ny")[0]!, "ny", 15)!;
    expect(di.high).toBe(103);
    expect(di.signal).toBeNull();
  });

  it("kein Blick voraus: Range, Signal und Gründe sind mit abgeschnittenen Kerzen (bis zur Ausbruchskerze) dieselben", () => {
    const cut = orbPrepare(bars.slice(0, 60 + 6));
    const dc = orbDetect(cut, orbDays(cut, "ny")[0]!, "ny", 15)!;
    expect(dc.signal?.j).toBe(d.signal!.j);
    expect(dc.volFactor).toBe(d.volFactor);
    expect(dc.trendOk).toBe(d.trendOk);
    expect(dc.high).toBe(d.high);
    // und nach dem Signal geändert Zukunft ändert nichts am Signal
    const other = bars.map((b, i) => (i > 60 + 5 ? { ...b, c: b.c * 1.3, h: b.h * 1.3 } : b));
    const po = orbPrepare(other);
    expect(orbDetect(po, orbDays(po, "ny")[0]!, "ny", 15)!.signal?.j).toBe(d.signal!.j);
  });
});

describe("Ausführung (Handrechnung, ohne Slippage)", () => {
  const run = (after: Spec[], over: Partial<OrbParams> = {}, fill?: Spec) => {
    const p = orbPrepare(day([...RANGE, BREAK_UP, ...after], { fill }));
    const s = orbSession(p, orbDays(p, "ny")[0]!, { ...P, ...over }, NO_COSTS);
    return s.trade;
  };
  const closed = (t: ReturnType<typeof run>) => {
    if (!t || t.state !== "closed") throw new Error("nicht geschlossen");
    return t;
  };

  it("Ziel: Einstieg zur Eröffnung der Folgekerze (102,2), Stop = Tief der Range (99,0), Risiko 3,2, Ziel 2 R = 108,6; Gebühr Taker + Maker", () => {
    const t = closed(run([[102.2, 103, 101.5, 102.8, 100], [103, 109, 102.5, 108, 100]]));
    expect(t.entry).toBe(102.2);
    expect(t.stop).toBe(99.0);
    near(t.risk, 3.2);
    near(t.target, 108.6);
    expect(t.exitKind).toBe("target");
    // brutto 2,0 R; Gebühr = 102,2 × 0,0005 + 108,6 × 0,0002 = 0,07282 → ÷ 3,2 = 0,0227563
    near(t.r, 2 - 0.07282 / 3.2, 1e-9);
    near(t.costR, 0.07282 / 3.2, 1e-9);
    expect(t.path[0]).toBeCloseTo((102.8 - 102.2) / 3.2, 9);
  });

  it("Stop: Tief 98,9 ≤ 99,0 → Füllung am Stop; Gebühr Taker auf beiden Seiten", () => {
    const t = closed(run([[102.2, 103, 98.9, 100, 100]]));
    expect(t.exitKind).toBe("stop");
    expect(t.exit).toBe(99.0);
    near(t.r, -1 - (102.2 * 0.0005 + 99 * 0.0005) / 3.2, 1e-9);
  });

  it("Stop vor Ziel: liegen beide in einer Kerze, gewinnt der Stop", () => {
    const t = closed(run([[102.2, 110, 98.9, 105, 100]]));
    expect(t.exitKind).toBe("stop");
    expect(t.r).toBeLessThan(-1);
  });

  it("Lücke über den Stop: die nächste Kerze eröffnet bei 98,5 (< Stop 99,0) → Füllung zur Eröffnung, schlechter als −1 R", () => {
    const t = closed(run([[102.2, 103, 101.5, 102.8, 100], [98.5, 99.5, 98.0, 99, 100]]));
    expect(t.exitKind).toBe("gap");
    expect(t.exit).toBe(98.5);
    near(t.r, (98.5 - 102.2) / 3.2 - (102.2 * 0.0005 + 98.5 * 0.0005) / 3.2, 1e-9);
    expect(t.r).toBeLessThan(-1.1);
  });

  it("Zeit-Stopp am Ende der Sitzung: Ausstieg zum Schluss der letzten Sitzungskerze (102,4)", () => {
    const t = closed(run([[102.2, 103, 101.5, 102.8, 100]], {}, [102.4, 103.0, 101.8, 102.4, 100]));
    expect(t.exitKind).toBe("time");
    expect(t.exit).toBe(102.4);
    near(t.r, (102.4 - 102.2) / 3.2 - (102.2 * 0.0005 + 102.4 * 0.0005) / 3.2, 1e-9);
  });

  it("Stop „Mitte“ (100,2 → Risiko 2,0) und „1,5 × ATR“ (Einstieg − 1,5 × ATR der Ausbruchskerze)", () => {
    const mid = closed(run([[102.2, 103, 101.5, 102.8, 100]], { stop: "mid", targetR: 1 }));
    near(mid.stop, 100.2);
    near(mid.risk, 2.0);
    near(mid.target, 104.2);
    const p = orbPrepare(day([...RANGE, BREAK_UP, [102.2, 103, 101.5, 102.8, 100]]));
    const d = orbDetect(p, orbDays(p, "ny")[0]!, "ny", 15)!;
    const atr = closed(orbTrade(p, d, "atr15", 2, NO_COSTS)).stop;
    near(atr, 102.2 - 1.5 * p.atr[d.signal!.j]!);
  });

  it("Short spiegelt: Stop = Hoch der Range, Ziel unten; Slippage verschlechtert Einstieg und Stop (gegen den Trader)", () => {
    const p = orbPrepare(day([...RANGE, [100.9, 101.0, 98.2, 98.6, 100], [98.5, 98.9, 95.0, 96, 100]]));
    const d = orbDetect(p, orbDays(p, "ny")[0]!, "ny", 15)!;
    const t = closed(orbTrade(p, d, "range", 1, NO_COSTS));
    expect(t.dir).toBe(-1);
    expect(t.stop).toBe(101.4);
    near(t.risk, 2.9);
    near(t.target, 98.5 - 2.9);
    expect(t.exitKind).toBe("target");
    const slip = closed(orbTrade(p, d, "range", 1, { ...NO_COSTS, slippage: { kind: "fixed", bps: 10 } }));
    expect(slip.r).toBeLessThan(t.r);
    expect(slip.costR).toBeGreaterThan(t.costR);
  });

  it("Ausbruchskerze ist die letzte Kerze: die Ausführung steht noch aus (pending), nichts wird erfunden", () => {
    const p = orbPrepare(day([...RANGE, BREAK_UP]).slice(0, 60 + 6));
    const d = orbDetect(p, orbDays(p, "ny")[0]!, "ny", 15)!;
    expect(orbTrade(p, d, "range", 2, NO_COSTS)).toEqual({ state: "pending" });
  });

  it("der Suchraum der Familie hat 540 Punkte", () => {
    const S = ORB_SPACE;
    expect(S.session.length * S.rangeMin.length * S.volThr.length * S.targetR.length * S.stop.length * S.trend.length).toBe(540);
  });
});

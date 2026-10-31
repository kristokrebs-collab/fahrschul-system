/**
 * Zeitmaschine · the small parts: statistics (against known values), the plan check and its reasons, the reading of typed
 * prices, the pool of real candles (time-of-day pools, holes, drift, today's volatility), the verdict rules of the skill and the
 * comparison of simulation and history.
 */
import { describe, expect, it } from "vitest";
import {
  buildPool,
  checkInput,
  checkPlan,
  compareOf,
  histogram,
  meanOf,
  orderKind,
  parsePrice,
  prob,
  quantile,
  quart,
  relativeOf,
  slotOf,
  slotsPerDay,
  tCrit95,
  targetROf,
  verdictOf,
  type Bar,
  type TmHistory,
  type TmSim,
} from "@/domain/timemachine";
import { input, latticeBars } from "./timemachine.helpers";

describe("Statistik", () => {
  it("Wilson-Intervall: bekannte Werte (k = 50 von n = 100 → 40,4 % … 59,6 %)", () => {
    const p = prob(50, 100);
    expect(p.p).toBe(0.5);
    expect(p.lo).toBeCloseTo(0.4038, 3);
    expect(p.hi).toBeCloseTo(0.5962, 3);
    // Randfälle: 0 von 10 hat eine obere Grenze, 10 von 10 eine untere; ohne Stichprobe das ganze Intervall
    expect(prob(0, 10).hi).toBeGreaterThan(0.25);
    expect(prob(10, 10).lo).toBeLessThan(0.75);
    expect(prob(0, 0)).toMatchObject({ n: 0, lo: 0, hi: 1 });
  });

  it("t-Intervall des Mittelwerts mit den Tabellenwerten (n = 5: t = 2,776), unter 2 Werten nichts", () => {
    expect(tCrit95(4)).toBe(2.776);
    expect(tCrit95(1000)).toBe(1.96);
    const m = meanOf([1, 2, 3, 4, 5])!;
    expect(m.mean).toBe(3);
    expect(m.sd).toBeCloseTo(Math.sqrt(2.5), 12);
    expect(m.hi - m.mean).toBeCloseTo(2.776 * (Math.sqrt(2.5) / Math.sqrt(5)), 9);
    expect(meanOf([1])).toBeNull();
    expect(meanOf([])).toBeNull();
  });

  it("Quantile und Quartile (Typ 7)", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quart([5, 1, 3, 2, 4])).toEqual({ n: 5, p25: 2, p50: 3, p75: 4 });
    expect(quart([])).toBeNull();
  });

  it("Histogramm: Kanten auf Vielfachen von 0,25 R, −1 R und das Ziel liegen auf Kanten, jede Zahl wird genau einmal gezählt", () => {
    const values = [-1.06, -1.06, -1.0, 0.1, 0.2, 2.1, 2.2, 2.3];
    const h = histogram(values, values.length, [-1, 2.15]);
    expect(h.width).toBe(0.25);
    expect(h.bins.reduce((a, b) => a + b.n, 0)).toBe(values.length);
    expect(h.bins[0]!.lo).toBe(-1.25);
    expect(h.bins.find((b) => b.lo === -1.25)!.n).toBe(2);
    expect(h.bins.find((b) => b.lo === -1)!.n).toBe(1);
    // weite Spannen bekommen breitere Bins, nie mehr als 44
    const wide = histogram([-1, 40], 2, [-1, 40]);
    expect(wide.bins.length).toBeLessThanOrEqual(44);
    expect(wide.width).toBeGreaterThan(0.25);
  });
});

describe("Plan", () => {
  const long = { side: "long" as const, entry: 100, stop: 98, target: 104 };
  it("gültige Pläne: R des Ziels aus der Geometrie", () => {
    expect(checkPlan(long)).toBeNull();
    expect(targetROf(long)).toBe(2);
    expect(checkPlan({ side: "short", entry: 100, stop: 102, target: 97 })).toBeNull();
    expect(targetROf({ side: "short", entry: 100, stop: 102, target: 97 })).toBe(1.5);
  });

  it("nennt den Grund, wenn der Plan keinen Sinn ergibt", () => {
    expect(checkPlan({ ...long, stop: 101 })?.why).toMatch(/Long muss der Stop unter dem Einstieg/);
    expect(checkPlan({ ...long, target: 99 })?.why).toMatch(/Long muss das Ziel über dem Einstieg/);
    expect(checkPlan({ side: "short", entry: 100, stop: 99, target: 95 })?.why).toMatch(/Short muss der Stop über dem Einstieg/);
    expect(checkPlan({ side: "short", entry: 100, stop: 103, target: 101 })?.why).toMatch(/Short muss das Ziel unter dem Einstieg/);
    expect(checkPlan({ ...long, entry: NaN })?.why).toMatch(/Zahlen größer 0/);
    expect(checkPlan({ ...long, stop: 99.99 })?.why).toMatch(/zu nah/);
  });

  it("checkInput: Zeitstopp, Läufe und Mindestzahl an Kerzen mit Zahlen im Text", () => {
    expect(checkInput(input())).toBeNull();
    expect(checkInput(input({ horizon: 1 }))?.why).toMatch(/Zeitstopp/);
    expect(checkInput(input({ runs: 10 }))?.why).toMatch(/Sitzungen/);
    expect(checkInput(input({ bars: latticeBars(50, 0.5) }))?.why).toMatch(/Nur 50 Kerzen – mindestens 200/);
    expect(checkInput(input({ bars: [] }))?.why).toMatch(/Keine Kerzen/);
    expect(checkInput({ ...input(), interval: "7m" as never })?.why).toMatch(/7m/);
  });

  it("getippte Preise: Komma, Punkt, Tausenderpunkt (näher am Bezug gewinnt)", () => {
    expect(parsePrice("64.250,5")).toBe(64250.5);
    expect(parsePrice("64250.5")).toBe(64250.5);
    expect(parsePrice("0,0312")).toBe(0.0312);
    expect(parsePrice("85.900", 86_000)).toBe(85_900);
    expect(parsePrice("1.234", 1.2)).toBe(1.234);
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice("")).toBeNull();
  });

  it("Auftragsart aus der Lage des Einstiegs zum Schlusskurs", () => {
    expect(orderKind("long", 100.02, 100, 1)).toBe("market");
    expect(orderKind("long", 98, 100, 1)).toBe("limit");
    expect(orderKind("long", 102, 100, 1)).toBe("stop");
    expect(orderKind("short", 102, 100, 1)).toBe("limit");
    expect(orderKind("short", 98, 100, 1)).toBe("stop");
  });

  it("relativeOf: Abstände in ATR, Lage in der Spanne", () => {
    const bars = latticeBars(300, 0.5);
    const last = bars.at(-1)!.c;
    const rel = relativeOf({ side: "long", entry: last, stop: last * 0.97, target: last * 1.06 }, bars, { kind: "range", lookback: 20 });
    if ("ok" in rel) throw new Error(rel.why);
    expect(rel.kind).toBe("market");
    expect(rel.stopAtr).toBeCloseTo((last * 0.03) / rel.atr, 9);
    expect(rel.targetAtr).toBeCloseTo((last * 0.06) / rel.atr, 9);
    expect(rel.rangePos).toBeGreaterThanOrEqual(0);
    expect(rel.rangePos).toBeLessThanOrEqual(1);
    const flat: Bar[] = Array.from({ length: 60 }, (_, i) => ({ t: i * 86_400, o: 100, h: 100, l: 100, c: 100 }));
    const bad = relativeOf({ side: "long", entry: 100, stop: 99, target: 102 }, flat, { kind: "close" });
    expect("ok" in bad && bad.why).toMatch(/ATR/);
  });
});

describe("Pool echter Kerzen", () => {
  it("Tageszeit: Slots, Fenster mit wachsendem Radius bis genug Kerzen da sind, Tageskerzen = ein Slot", () => {
    expect(slotsPerDay(3600)).toBe(24);
    expect(slotsPerDay(900)).toBe(96);
    expect(slotsPerDay(86_400)).toBe(1);
    expect(slotOf(3600 * 5 + 100, 3600, 24)).toBe(5);
    expect(slotOf(86_400 * 3 + 3600 * 5, 3600, 24)).toBe(5);
    // 1h-Kerzen: 60 Tage = 60 je Slot, Radius 2 genügt
    const hourly = latticeBars(24 * 60, 0.5, 3600);
    const p = buildPool(hourly, "1h", "keep");
    expect(p.slots).toBe(24);
    expect(Math.max(...p.radius)).toBe(2);
    expect(p.win[10]!.length).toBe(5 * 60);
    // 4h-Kerzen, nur 20 Tage = 20 je Slot: der Radius wächst, bis mindestens 30 Kerzen im Fenster sind
    const four = buildPool(latticeBars(6 * 20, 0.5, 14_400), "4h", "keep");
    expect(four.slots).toBe(6);
    expect(four.radius[0]).toBe(1);
    expect(four.win[0]!.length).toBeGreaterThanOrEqual(30);
    // Tageskerzen
    const daily = buildPool(latticeBars(300, 0.5), "1d", "keep");
    expect(daily.slots).toBe(1);
    expect(daily.win[0]!.length).toBe(300);
  });

  it("Lücken: nach einem Loch rechnet die Kerze gegen ihre eigene Eröffnung, ein Block endet an der Lücke", () => {
    const bars = latticeBars(300, 0.5);
    const holed = bars.map((b, i) => (i >= 150 ? { ...b, t: b.t + 5 * 86_400 } : b));
    const p = buildPool(holed, "1d", "keep");
    expect(p.n).toBe(300);
    // Kerze 150 liegt hinter dem Loch: ihr Verhältnis zur Eröffnung, nicht zum Schluss davor
    expect(p.ro[150]).toBe(1);
    expect(p.run[149]).toBe(1);
    expect(p.run[0]).toBe(150);
    expect(p.run[150]).toBe(150);
  });

  it("unbrauchbare Kerzen (≤ 0, Hoch unter Tief) werden weggelassen und gezählt", () => {
    const bars = latticeBars(260, 0.5);
    bars[10] = { ...bars[10]!, c: -1 };
    bars[20] = { ...bars[20]!, h: bars[20]!.l - 1 };
    const p = buildPool(bars, "1d", "keep");
    expect(p.dropped).toBe(2);
    expect(p.n).toBe(258);
  });

  it("Trend entfernen: der Drift der Historie fällt auf null", () => {
    const rising = latticeBars(400, 0.62);
    const keep = buildPool(rising, "1d", "keep");
    const zero = buildPool(rising, "1d", "zero");
    expect(keep.drift).toBeGreaterThan(0.002);
    let mean = 0;
    let n = 0;
    for (let i = 1; i < zero.n; i++) {
      mean += Math.log(zero.rc[i]!);
      n++;
    }
    expect(mean / n).toBeCloseTo(0, 10);
  });

  it("Schwankung wie heute: eine wilde Vergangenheit wird auf die ruhige Gegenwart heruntergerechnet, ohne Skalierung bleibt sie", () => {
    const bars: Bar[] = [];
    let p = 100;
    for (let i = 0; i < 400; i++) {
      const step = i < 300 ? 0.01 : 0.0025;
      const c = p * (1 + (i % 2 ? -step : step));
      bars.push({ t: 1_699_920_000 + i * 86_400, o: p, h: Math.max(p, c), l: Math.min(p, c), c });
      p = c;
    }
    const meanAbs = (pool: ReturnType<typeof buildPool>, from: number, to: number): number => {
      let s = 0;
      for (let i = from; i < to; i++) s += Math.abs(Math.log(pool.rc[i]!));
      return s / (to - from);
    };
    const raw = buildPool(bars, "1d", "keep", "history");
    const now = buildPool(bars, "1d", "keep", "now");
    expect(raw.scale).toBeNull();
    expect(meanAbs(raw, 50, 250)).toBeGreaterThan(0.009);
    // die frühe wilde Phase wird auf etwa die heutige Größe gebracht (Faktor an der Grenze ¼)
    expect(meanAbs(now, 50, 250)).toBeLessThan(0.003);
    expect(meanAbs(now, 330, 400)).toBeCloseTo(meanAbs(raw, 330, 400), 3);
    expect(now.scale!.min).toBe(0.25);
    expect(now.scale!.mean).toBeLessThan(1);
    // Hoch ≥ Eröffnung/Schluss und Tief ≤ beide bleiben nach der Skalierung erhalten
    for (let i = 0; i < now.n; i++) {
      expect(now.rh[i]!).toBeGreaterThanOrEqual(Math.max(now.ro[i]!, now.rc[i]!) - 1e-12);
      expect(now.rl[i]!).toBeLessThanOrEqual(Math.min(now.ro[i]!, now.rc[i]!) + 1e-12);
    }
  });
});

/** A simulation result with the figures the verdict reads. */
function simOf(p: { target: number; stop: number; n?: number; mean?: number; lo?: number; hi?: number; horizon?: number }): TmSim {
  const n = p.n ?? 10_000;
  const neither = n - p.target - p.stop;
  const mk = (k: number) => prob(k, n);
  return {
    runs: n,
    skipped: 0,
    horizon: p.horizon ?? 42,
    target: mk(p.target),
    stop: mk(p.stop),
    neither: mk(neither),
    moved: mk(0),
    expectancy: { n, mean: p.mean ?? 0, sd: 1, lo: p.lo ?? (p.mean ?? 0) - 0.02, hi: p.hi ?? (p.mean ?? 0) + 0.02 },
    costR: 0.05,
  } as unknown as TmSim;
}

describe("Urteil (die Regeln des Skills)", () => {
  it("1 R: fast gleich viele Ziele wie Stopps = „Nahe an einer Münze“", () => {
    const v = verdictOf(simOf({ target: 4200, stop: 4400 }), 1);
    expect(v.id).toBe("coin");
    expect(v.text).toMatch(/^Nahe an einer Münze/);
    expect(v.tone).toBe("mute");
  });

  it("2 R: ein Drittel reicht – 32 % von 74,6 % ist „Nahe am Break-even“, kein Verlierer (Beispiel aus dem Skill)", () => {
    // Ziel 24,1 %, Stop 50,5 % → 32,3 % der entschiedenen Läufe, Break-even bei 33,3 %
    const v = verdictOf(simOf({ target: 2410, stop: 5050 }), 2);
    expect(v.id).toBe("breakeven");
    expect(v.text).toMatch(/^Nahe am Break-even/);
    expect(v.decided!.needs).toBeCloseTo(1 / 3, 12);
    expect(v.decided!.share).toBeCloseTo(2410 / 7460, 12);
  });

  it("5 bis 15 Punkte neigt, ab 15 Punkten deutlich", () => {
    expect(verdictOf(simOf({ target: 5600, stop: 4400 }), 1).id).toBe("target"); // 56 % vs 50 %
    expect(verdictOf(simOf({ target: 4400, stop: 5600 }), 1).id).toBe("stop");
    expect(verdictOf(simOf({ target: 6800, stop: 3200 }), 1).id).toBe("strongTarget"); // 68 % vs 50 %
    expect(verdictOf(simOf({ target: 3000, stop: 7000 }), 1).id).toBe("strongStop");
  });

  it("über 40 % „weder noch“: eine Zusatzzeile; Erwartungswert gegen die Neigung: eine weitere", () => {
    const v = verdictOf(simOf({ target: 2000, stop: 1000, mean: -0.08 }), 1);
    expect(v.id).toMatch(/target|strongTarget/i);
    expect(v.lines.join(" ")).toMatch(/70 % der Läufe erreichten weder Ziel noch Stop/);
    expect(v.lines.join(" ")).toMatch(/zeigt in die andere Richtung/);
  });

  it("Erwartungswert, der sich von null nicht unterscheiden lässt, wird so genannt", () => {
    const v = verdictOf(simOf({ target: 4400, stop: 4600, mean: 0.01, lo: -0.03, hi: 0.05 }), 1);
    expect(v.lines.join(" ")).toMatch(/von null nicht unterscheiden/);
  });

  it("zu wenige entschiedene Läufe: keine Einschätzung", () => {
    const v = verdictOf(simOf({ target: 10, stop: 12 }), 1);
    expect(v.id).toBe("none");
    expect(v.text).toMatch(/reicht nicht/);
    expect(verdictOf(simOf({ target: 5, stop: 5, n: 50 }), 1).id).toBe("none");
  });
});

describe("Vergleich Simulation und echte Vorfälle", () => {
  const hist = (n: number, t: number, s: number, mean: number, lo: number, hi: number): TmHistory =>
    ({
      n,
      target: prob(t, n),
      stop: prob(s, n),
      neither: prob(n - t - s, n),
      moved: prob(0, n),
      expectancy: n >= 2 ? { n, mean, sd: 1, lo, hi } : null,
    }) as unknown as TmHistory;

  it("unter 20 Vorfällen kein Vergleich, mit dem Grund und der Zahl", () => {
    const c = compareOf(simOf({ target: 3300, stop: 6600, mean: 0 }), hist(12, 6, 4, 0.4, 0, 0.8));
    expect(c.status).toBe("unavailable");
    expect(c.warn).toBe(false);
    expect(c.reason).toMatch(/Nur 12 frühere Vorfälle/);
    expect(compareOf(simOf({ target: 3300, stop: 6600 }), hist(0, 0, 0, 0, 0, 0)).reason).toMatch(/keinen früheren Vorfall/);
  });

  it("Warnhinweis, wenn beide stark abweichen (außerhalb des Intervalls UND groß)", () => {
    // Simulation: Ziel zuerst 33 %, Stop 66 %; echt: 60 von 100 Ziel
    const c = compareOf(simOf({ target: 3300, stop: 6600, mean: -0.03 }), hist(100, 60, 35, 0.9, 0.6, 1.2));
    expect(c.status).toBe("ok");
    expect(c.warn).toBe(true);
    expect(c.text).toMatch(/^Warnung: Simulation und echte Vorfälle weichen stark/);
    expect(c.rows.find((r) => r.id === "target")!.off).toBe(true);
    expect(c.rows.find((r) => r.id === "expectancy")!.off).toBe(true);
  });

  it("kleine Abweichung oder breites Intervall: keine Warnung, aber der Hinweis, dass das nichts beweist", () => {
    const c = compareOf(simOf({ target: 3300, stop: 6600, mean: 0.02 }), hist(30, 11, 19, 0.05, -0.4, 0.5));
    expect(c.warn).toBe(false);
    expect(c.text).toMatch(/innerhalb ihrer Unsicherheit/);
    expect(c.text).toMatch(/beweist keine Gleichheit/);
  });
});

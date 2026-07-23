import { describe, expect, it } from "vitest";
import { berechneLinearenTrend, projeziere, type HistorischerUmsatzPunkt } from "../forecast.js";

function tag(n: number): Date {
  return new Date(2026, 0, 1 + n);
}

describe("Forecast: linearer Trend über echte historische Perioden", () => {
  it("erkennt einen perfekten linearen Anstieg (R²=1)", () => {
    const punkte: HistorischerUmsatzPunkt[] = [
      { periodeStart: tag(0), umsatzCent: 1_000 },
      { periodeStart: tag(1), umsatzCent: 1_100 },
      { periodeStart: tag(2), umsatzCent: 1_200 },
      { periodeStart: tag(3), umsatzCent: 1_300 },
    ];
    const trend = berechneLinearenTrend(punkte);
    expect(trend.steigungCentProTag).toBeCloseTo(100, 5);
    expect(trend.r2).toBeCloseTo(1, 5);
  });

  it("liefert flachen Trend (Steigung 0) bei konstantem Umsatz", () => {
    const punkte: HistorischerUmsatzPunkt[] = [
      { periodeStart: tag(0), umsatzCent: 5_000 },
      { periodeStart: tag(1), umsatzCent: 5_000 },
      { periodeStart: tag(2), umsatzCent: 5_000 },
    ];
    const trend = berechneLinearenTrend(punkte);
    expect(trend.steigungCentProTag).toBeCloseTo(0, 5);
  });

  it("konservativ <= Basis <= optimistisch, Basis > 0 bei positivem Trend", () => {
    const trend = berechneLinearenTrend([
      { periodeStart: tag(0), umsatzCent: 1_000 },
      { periodeStart: tag(1), umsatzCent: 1_050 },
      { periodeStart: tag(2), umsatzCent: 1_100 },
    ]);
    const result = projeziere(trend, 2, 28);
    expect(result.konservativCent).toBeLessThanOrEqual(result.basisCent);
    expect(result.basisCent).toBeLessThanOrEqual(result.optimistischCent);
    expect(result.horizont).toBe("4_wochen");
  });

  it("Szenario-Delta erhöht nur die optimistische Linie, nicht Basis/konservativ", () => {
    const trend = berechneLinearenTrend([
      { periodeStart: tag(0), umsatzCent: 1_000 },
      { periodeStart: tag(1), umsatzCent: 1_000 },
    ]);
    const ohne = projeziere(trend, 1, 28);
    const mit = projeziere(trend, 1, 28, [
      { name: "zusätzliche Fahrstunde/Tag", deltaCentProTag: 5_000, beschreibung: "1 zusätzliche gefüllte Fahrstunde/Tag" },
    ]);
    expect(mit.optimistischCent).toBeGreaterThan(ohne.optimistischCent);
    expect(mit.basisCent).toBe(ohne.basisCent);
    expect(mit.konservativCent).toBe(ohne.konservativCent);
  });

  it("niedrige Trendgüte (R² klein) -> Unsicherheit 'hoch'", () => {
    const trend = berechneLinearenTrend([
      { periodeStart: tag(0), umsatzCent: 1_000 },
      { periodeStart: tag(1), umsatzCent: 50 },
      { periodeStart: tag(2), umsatzCent: 3_000 },
      { periodeStart: tag(3), umsatzCent: 10 },
    ]);
    const result = projeziere(trend, 3, 28);
    expect(result.unsicherheit).toBe("hoch");
  });

  it("12-Wochen und Jahresende-Horizonte werden korrekt klassifiziert", () => {
    const trend = berechneLinearenTrend([
      { periodeStart: tag(0), umsatzCent: 1_000 },
      { periodeStart: tag(1), umsatzCent: 1_010 },
    ]);
    expect(projeziere(trend, 1, 84).horizont).toBe("12_wochen");
    expect(projeziere(trend, 1, 150).horizont).toBe("jahresende");
  });
});

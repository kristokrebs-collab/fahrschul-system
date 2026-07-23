/**
 * Forecast-Engine (bewusst einfach, dokumentiert, testbar): linearer Trend
 * über historische Perioden-Umsätze + Szenario-Deltas. Kein ML, keine
 * Blackbox – jede Zahl ist aus der Formel nachvollziehbar.
 */

export interface HistorischerUmsatzPunkt {
  periodeStart: Date;
  umsatzCent: number;
}

export interface TrendErgebnis {
  steigungCentProTag: number;
  basisCent: number; // Achsenabschnitt (Umsatz am ersten Datenpunkt-Tag)
  r2: number; // Bestimmtheitsmaß, für Datenqualität-Anzeige
}

/** Einfache lineare Regression (kleinste Quadrate) über Tage seit erstem Punkt. */
export function berechneLinearenTrend(punkte: HistorischerUmsatzPunkt[]): TrendErgebnis {
  if (punkte.length < 2) {
    return { steigungCentProTag: 0, basisCent: punkte[0]?.umsatzCent ?? 0, r2: 0 };
  }
  const sorted = [...punkte].sort((a, b) => a.periodeStart.getTime() - b.periodeStart.getTime());
  const t0 = sorted[0].periodeStart.getTime();
  const xs = sorted.map((p) => (p.periodeStart.getTime() - t0) / (1000 * 60 * 60 * 24));
  const ys = sorted.map((p) => p.umsatzCent);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const steigung = den === 0 ? 0 : num / den;
  const basis = meanY - steigung * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const vorhersage = basis + steigung * xs[i];
    ssRes += (ys[i] - vorhersage) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { steigungCentProTag: steigung, basisCent: basis, r2 };
}

export type ForecastHorizont = "4_wochen" | "12_wochen" | "jahresende";

export const HORIZONT_TAGE: Record<ForecastHorizont, number> = {
  "4_wochen": 28,
  "12_wochen": 84,
  jahresende: 0, // wird zur Laufzeit aus `heute` berechnet
};

export interface Szenario {
  name: string;
  deltaCentProTag: number; // z.B. zusätzliche gefüllte Fahrstunde/Tag * Ø-Preis
  beschreibung: string;
}

export interface ForecastResultat {
  horizont: ForecastHorizont;
  tage: number;
  konservativCent: number;
  basisCent: number;
  optimistischCent: number;
  annahmen: string[];
  unsicherheit: "niedrig" | "mittel" | "hoch";
}

/**
 * Projiziert den Trend `tage` Tage in die Zukunft und wendet
 * konservativ/Basis/optimistisch-Bänder an (±1 Standardfehler-Näherung über
 * r2, plus optionale Szenario-Deltas on top der Basis-Linie).
 */
export function projeziere(
  trend: TrendErgebnis,
  historieLetzterTag: number,
  tage: number,
  szenarien: Szenario[] = [],
): ForecastResultat {
  const basisTagesumsatz = trend.basisCent + trend.steigungCentProTag * (historieLetzterTag + tage);
  const basisCent = Math.max(0, Math.round(basisTagesumsatz * tage));

  const unsicherheitsfaktor = trend.r2 >= 0.7 ? 0.1 : trend.r2 >= 0.4 ? 0.25 : 0.4;
  const konservativCent = Math.max(0, Math.round(basisCent * (1 - unsicherheitsfaktor)));
  const szenarioDeltaCent = szenarien.reduce((sum, s) => sum + s.deltaCentProTag * tage, 0);
  const optimistischCent = Math.round(basisCent * (1 + unsicherheitsfaktor) + szenarioDeltaCent);

  const unsicherheit = trend.r2 >= 0.7 ? "niedrig" : trend.r2 >= 0.4 ? "mittel" : "hoch";

  const horizont: ForecastHorizont = tage <= 28 ? "4_wochen" : tage <= 84 ? "12_wochen" : "jahresende";

  return {
    horizont,
    tage,
    konservativCent,
    basisCent,
    optimistischCent,
    annahmen: [
      `linearer Trend aus historischen Perioden, R²=${trend.r2.toFixed(2)}`,
      `Unsicherheitsband ±${Math.round(unsicherheitsfaktor * 100)}% basierend auf Trendgüte`,
      ...szenarien.map((s) => `Szenario "${s.name}": ${s.beschreibung}`),
    ],
    unsicherheit,
  };
}

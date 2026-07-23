import { describe, expect, it } from "vitest";
import { berechneDeckungsbeitrag, berechneFahrzeugkosten } from "../fahrzeug-wirtschaftlichkeit.js";

describe("Fahrzeug-Vollkostenrechnung", () => {
  it("berechnet Fixkosten, variable Kosten, Vollkosten korrekt", () => {
    const result = berechneFahrzeugkosten({
      periodeTage: 30,
      einsatzstundenPeriode: 100,
      kilometerPeriode: 2_000,
      leasingRateCent: 60_000,
      versicherungCentProPeriode: 10_000,
      steuerCentProPeriode: 2_000,
      energieCentGesamt: 15_000,
      wartungCentGesamt: 5_000,
      reparaturenCentGesamt: 3_000,
      reifenCentGesamt: 1_000,
      ausfalltage: 3,
    });
    expect(result.fixkostenCent).toBe(72_000);
    expect(result.variableKostenCent).toBe(24_000);
    expect(result.vollkostenCent).toBe(96_000);
    expect(result.kostenJeStundeCent).toBe(960);
    expect(result.kostenJeKilometerCent).toBe(48);
    expect(result.ausfallkostenCent).toBe(7_200); // 72000/30*3
    expect(result.datenqualitaet).toBe("vollstaendig");
  });

  it("markiert Datenqualität als 'teilweise' wenn Einsatzstunden/Kilometer fehlen", () => {
    const result = berechneFahrzeugkosten({
      periodeTage: 30,
      einsatzstundenPeriode: 0,
      kilometerPeriode: 0,
      leasingRateCent: 60_000,
      versicherungCentProPeriode: 10_000,
      steuerCentProPeriode: 2_000,
      energieCentGesamt: 15_000,
      wartungCentGesamt: 0,
      reparaturenCentGesamt: 0,
      reifenCentGesamt: 0,
      ausfalltage: 0,
    });
    expect(result.kostenJeStundeCent).toBeNull();
    expect(result.kostenJeKilometerCent).toBeNull();
    expect(result.datenqualitaet).toBe("teilweise");
  });

  it("Deckungsbeitrag I = Umsatz - variable Kosten (ohne Fixkostenumlage)", () => {
    expect(berechneDeckungsbeitrag({ umsatzCent: 50_000, variableKostenCent: 20_000 })).toBe(30_000);
  });
});

import { describe, expect, it } from "vitest";
import {
  berechneOffeneForderung,
  nettoVonBrutto,
  summiereErbrachteLeistungInPeriode,
  summiereFakturiertenUmsatzInPeriode,
  summiereZahlungseingangInPeriode,
  type Faktura,
  type Leistung,
  type ZahlungBuchung,
} from "../umsatz-erkennung.js";

describe("Brutto/Netto", () => {
  it("berechnet Netto aus Brutto bei 19%", () => {
    expect(nettoVonBrutto(11_900, 0.19)).toBe(10_000);
  });
});

describe("Leistung vs. fakturierter Umsatz vs. Zahlungseingang (nie konfliert)", () => {
  const leistung: Leistung = { id: "l1", erbrachtAm: new Date("2026-06-28"), bruttoCent: 5_950, steuersatz: 0.19 };
  const faktura: Faktura = {
    id: "f1",
    leistungIds: ["l1"],
    fakturiertAm: new Date("2026-07-03"), // fällt in die Folgeperiode
    periodeVon: new Date("2026-07-01"),
    periodeBis: new Date("2026-07-31"),
    bruttoCent: 5_950,
    steuersatz: 0.19,
  };
  const zahlung: ZahlungBuchung = { id: "z1", rechnungId: "f1", eingegangenAm: new Date("2026-07-15"), bruttoCent: 5_950 };

  it("Leistung wird der Erbringungsperiode zugeordnet (Juni), nicht der Rechnungsperiode (Juli)", () => {
    const juni = summiereErbrachteLeistungInPeriode([leistung], new Date("2026-06-01"), new Date("2026-06-30"));
    expect(juni.bruttoCent).toBe(5_950);
    expect(juni.nettoCent).toBe(5_000);

    const juli = summiereErbrachteLeistungInPeriode([leistung], new Date("2026-07-01"), new Date("2026-07-31"));
    expect(juli.bruttoCent).toBe(0);
  });

  it("fakturierter Umsatz wird der Rechnungsperiode zugeordnet (Juli), nicht der Erbringungsperiode", () => {
    const juli = summiereFakturiertenUmsatzInPeriode([faktura], new Date("2026-07-01"), new Date("2026-07-31"));
    expect(juli.bruttoCent).toBe(5_950);
    const juni = summiereFakturiertenUmsatzInPeriode([faktura], new Date("2026-06-01"), new Date("2026-06-30"));
    expect(juni.bruttoCent).toBe(0);
  });

  it("Zahlungseingang zählt zur Zahlungsperiode (Bankwertstellung), unabhängig von Leistungs-/Fakturaperiode", () => {
    const juli = summiereZahlungseingangInPeriode([zahlung], new Date("2026-07-01"), new Date("2026-07-31"));
    expect(juli.bruttoCent).toBe(5_950);
  });

  it("offene Forderung = fakturiert - zugeordnet gezahlt, nur für unbezahlte Rechnungen", () => {
    const teilBezahlt = new Map([["f1", 2_000]]);
    const { forderungCent, anzahlOffen } = berechneOffeneForderung([faktura], teilBezahlt);
    expect(forderungCent).toBe(3_950);
    expect(anzahlOffen).toBe(1);

    const vollBezahlt = new Map([["f1", 5_950]]);
    const result2 = berechneOffeneForderung([faktura], vollBezahlt);
    expect(result2.forderungCent).toBe(0);
    expect(result2.anzahlOffen).toBe(0);
  });
});

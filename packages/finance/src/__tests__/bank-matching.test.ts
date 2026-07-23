import { describe, expect, it } from "vitest";
import { matchBatch, matchTransaktion, type BankTransaktion, type OffeneRechnung } from "../bank-matching.js";

function rechnung(overrides: Partial<OffeneRechnung> = {}): OffeneRechnung {
  return {
    id: "r1",
    rechnungsnummer: "RE-2026-0001",
    schuelerName: "Max Mustermann",
    standortId: "std-fulda",
    betragCent: 10_000,
    faelligAm: new Date("2026-06-01"),
    bereitsBezahltCent: 0,
    ...overrides,
  };
}

function tx(overrides: Partial<BankTransaktion> = {}): BankTransaktion {
  return {
    id: "tx1",
    amountCent: 10_000,
    bookedAt: new Date("2026-06-05"),
    reference: "Fahrstunden",
    counterparty: "Max Mustermann",
    ...overrides,
  };
}

describe("Bankabgleich-Kaskade", () => {
  it("1) Rechnungsnummer im Verwendungszweck -> sicher, autoBuchbar", () => {
    const r = rechnung();
    const t = tx({ reference: "Zahlung RE-2026-0001 Fahrschule" });
    const result = matchTransaktion(t, [r], new Set());
    expect(result.konfidenz).toBe("sicher");
    expect(result.grund).toBe("rechnungsnummer");
    expect(result.autoBuchbar).toBe(true);
    expect(result.rechnungIds).toEqual(["r1"]);
  });

  it("2) strukturierte Referenz (Rechnungs-UUID) -> sicher", () => {
    const r = rechnung({ id: "uuid-abc-123", rechnungsnummer: "RE-9999" });
    const t = tx({ reference: "SVWZ uuid-abc-123" });
    const result = matchTransaktion(t, [r], new Set());
    expect(result.konfidenz).toBe("sicher");
    expect(result.grund).toBe("strukturierte_referenz");
  });

  it("3) Name+Betrag+Zeitraum eindeutig -> wahrscheinlich, NICHT autoBuchbar", () => {
    const r = rechnung({ faelligAm: new Date("2026-06-10") });
    const t = tx({ reference: "Danke", bookedAt: new Date("2026-06-20") });
    const result = matchTransaktion(t, [r], new Set());
    expect(result.konfidenz).toBe("wahrscheinlich");
    expect(result.autoBuchbar).toBe(false);
  });

  it("3) Name+Betrag außerhalb Zeitraumtoleranz -> fällt durch zu manuell", () => {
    const r = rechnung({ faelligAm: new Date("2025-01-01") });
    const t = tx({ reference: "Danke", bookedAt: new Date("2026-06-20") });
    const result = matchTransaktion(t, [r], new Set());
    expect(result.grund).not.toBe("name_betrag_zeitraum");
  });

  it("Teilzahlung -> wahrscheinlich, Restbetrag korrekt, nicht autoBuchbar", () => {
    const r = rechnung({ betragCent: 20_000 });
    const t = tx({ reference: "RE-2026-0001 Anzahlung", amountCent: 5_000 });
    const result = matchTransaktion(t, [r], new Set());
    expect(result.grund).toBe("teilzahlung");
    expect(result.restCent).toBe(15_000);
    expect(result.autoBuchbar).toBe(false);
  });

  it("Überzahlung -> wahrscheinlich, negative Restdifferenz = Guthaben", () => {
    const r = rechnung({ betragCent: 10_000 });
    const t = tx({ reference: "RE-2026-0001", amountCent: 12_000 });
    const result = matchTransaktion(t, [r], new Set());
    expect(result.grund).toBe("ueberzahlung");
    expect(result.restCent).toBe(-2_000);
  });

  it("Sammelzahlung deckt mehrere Rechnungen desselben Zahlers exakt", () => {
    const r1 = rechnung({ id: "r1", betragCent: 4_000 });
    const r2 = rechnung({ id: "r2", betragCent: 6_000 });
    const t = tx({ reference: "Sammelüberweisung", amountCent: 10_000 });
    const result = matchTransaktion(t, [r1, r2], new Set());
    expect(result.grund).toBe("sammelzahlung");
    expect(result.rechnungIds.sort()).toEqual(["r1", "r2"]);
    expect(result.autoBuchbar).toBe(false);
  });

  it("Rücklastschrift (negativer Betrag) -> unklar, nie autoBuchbar", () => {
    const r = rechnung();
    const t = tx({ amountCent: -10_000, reference: "Rücklastschrift RE-2026-0001" });
    const result = matchTransaktion(t, [r], new Set());
    expect(result.grund).toBe("ruecklastschrift");
    expect(result.autoBuchbar).toBe(false);
  });

  it("Gutschrift -> unklar, kein automatischer Rechnungsbezug", () => {
    const r = rechnung();
    const t = tx({ reference: "Gutschrift wegen Terminausfall" });
    const result = matchTransaktion(t, [r], new Set());
    expect(result.grund).toBe("gutschrift");
    expect(result.autoBuchbar).toBe(false);
  });

  it("doppelte Zahlung (Dublette in Batch) -> konflikt", () => {
    const r = rechnung();
    const t = tx({ reference: "RE-2026-0001" });
    const verarbeitet = new Set(["tx1"]);
    const result = matchTransaktion(t, [r], verarbeitet);
    expect(result.konfidenz).toBe("konflikt");
    expect(result.grund).toBe("doppelte_zahlung");
  });

  it("abweichender Zahler (Firmenkunde zahlt für Schüler) -> wahrscheinlich, nicht autoBuchbar", () => {
    const r = rechnung({ schuelerName: "Erika Musterfrau", betragCent: 15_000 });
    const t = tx({ reference: "Fahrschulbeitrag", counterparty: "Musterfirma GmbH", amountCent: 15_000 });
    const result = matchTransaktion(t, [r], new Set());
    expect(result.grund).toBe("abweichender_zahler");
    expect(result.autoBuchbar).toBe(false);
  });

  it("Konflikt: mehrere Rechnungen mit identischem Namen/Betrag im Zeitraum", () => {
    const r1 = rechnung({ id: "r1" });
    const r2 = rechnung({ id: "r2" });
    const t = tx({ reference: "Danke" });
    const result = matchTransaktion(t, [r1, r2], new Set());
    expect(result.konfidenz).toBe("konflikt");
    expect(result.rechnungIds.sort()).toEqual(["r1", "r2"]);
  });

  it("keine Regel greift -> manuell, unklar", () => {
    const r = rechnung({ schuelerName: "Jemand Anderes", betragCent: 999 });
    const t = tx({ reference: "irgendwas", counterparty: "Fremde Person", amountCent: 12_345 });
    const result = matchTransaktion(t, [r], new Set());
    expect(result.grund).toBe("manuell");
    expect(result.autoBuchbar).toBe(false);
  });

  it("nur 'sicher' ist autoBuchbar über den gesamten Batch", () => {
    const r1 = rechnung({ id: "r1", rechnungsnummer: "RE-1" });
    const r2 = rechnung({ id: "r2", rechnungsnummer: "RE-2", betragCent: 20_000, schuelerName: "Anna Beispiel" });
    const batch = [
      tx({ id: "tx1", reference: "RE-1", amountCent: 10_000 }),
      tx({ id: "tx2", reference: "Danke", counterparty: "Anna Beispiel", amountCent: 20_000, bookedAt: new Date("2026-06-15") }),
    ];
    const results = matchBatch(batch, [r1, r2]);
    const autoBuchbare = results.filter((r) => r.autoBuchbar);
    expect(autoBuchbare).toHaveLength(1);
    expect(autoBuchbare[0].konfidenz).toBe("sicher");
    expect(results.every((r) => r.konfidenz !== "sicher" || r.autoBuchbar)).toBe(true);
  });

  it("Bar/Karte-Zahlungsart wird durchgereicht ohne die Kaskade zu ändern", () => {
    const r = rechnung();
    const t = tx({ reference: "RE-2026-0001", zahlungsart: "karte" });
    const result = matchTransaktion(t, [r], new Set());
    expect(result.konfidenz).toBe("sicher");
  });
});

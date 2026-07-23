/**
 * Fahrzeug-Vollkostenrechnung. Reine, testbare Formeln – keine hartkodierten
 * Zahlen, alle Eingaben kommen aus echten DB-Feldern (Migration 0006).
 */

export interface FahrzeugKostenInput {
  periodeTage: number;
  einsatzstundenPeriode: number;
  kilometerPeriode: number;
  // fixe Kosten für die Periode (bereits auf die Periode umgelegt)
  leasingRateCent: number;
  versicherungCentProPeriode: number;
  steuerCentProPeriode: number;
  // variable Kosten für die Periode
  energieCentGesamt: number;
  wartungCentGesamt: number;
  reparaturenCentGesamt: number;
  reifenCentGesamt: number;
  ausfalltage: number;
}

export interface FahrzeugKostenErgebnis {
  fixkostenCent: number;
  variableKostenCent: number;
  vollkostenCent: number;
  kostenJeStundeCent: number | null;
  kostenJeKilometerCent: number | null;
  ausfallkostenCent: number;
  datenqualitaet: "vollstaendig" | "teilweise" | "unzureichend";
}

/**
 * Ausfallkosten = anteilige Fixkosten der Ausfalltage (das Fahrzeug kostet
 * weiter Leasing/Versicherung/Steuer, erwirtschaftet aber keinen Umsatz).
 * Bewusst NICHT inkl. entgangenem Deckungsbeitrag – das wäre eine
 * Opportunitätskostenrechnung und braucht eine bestätigte Auslastungs-
 * annahme (siehe docs/fachliche-bestaetigungen.md, UNBESTAETIGT).
 */
export function berechneFahrzeugkosten(input: FahrzeugKostenInput): FahrzeugKostenErgebnis {
  const fixkostenCent = input.leasingRateCent + input.versicherungCentProPeriode + input.steuerCentProPeriode;
  const variableKostenCent =
    input.energieCentGesamt + input.wartungCentGesamt + input.reparaturenCentGesamt + input.reifenCentGesamt;
  const vollkostenCent = fixkostenCent + variableKostenCent;

  const kostenJeStundeCent =
    input.einsatzstundenPeriode > 0 ? Math.round(vollkostenCent / input.einsatzstundenPeriode) : null;
  const kostenJeKilometerCent =
    input.kilometerPeriode > 0 ? Math.round(vollkostenCent / input.kilometerPeriode) : null;

  const fixkostenProTag = input.periodeTage > 0 ? fixkostenCent / input.periodeTage : 0;
  const ausfallkostenCent = Math.round(fixkostenProTag * input.ausfalltage);

  let datenqualitaet: FahrzeugKostenErgebnis["datenqualitaet"] = "vollstaendig";
  if (input.einsatzstundenPeriode === 0 || input.kilometerPeriode === 0) datenqualitaet = "teilweise";
  if (fixkostenCent === 0 && variableKostenCent === 0) datenqualitaet = "unzureichend";

  return {
    fixkostenCent,
    variableKostenCent,
    vollkostenCent,
    kostenJeStundeCent,
    kostenJeKilometerCent,
    ausfallkostenCent,
    datenqualitaet,
  };
}

export interface DeckungsbeitragInput {
  umsatzCent: number;
  variableKostenCent: number;
}

/** Deckungsbeitrag I = Umsatz - variable Kosten (bewusst ohne Fixkostenumlage). */
export function berechneDeckungsbeitrag(input: DeckungsbeitragInput): number {
  return input.umsatzCent - input.variableKostenCent;
}

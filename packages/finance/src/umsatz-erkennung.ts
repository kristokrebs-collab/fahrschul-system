/**
 * Trennung von Leistung, Umsatz, Zahlungseingang, Forderung – niemals
 * konfliert (siehe Aufgabenstellung PROMPT 4). Alle Beträge in Cent,
 * Brutto/Netto sauber getrennt (kein impliziter Steuersatz im Code).
 */

export interface Leistung {
  id: string;
  erbrachtAm: Date; // Leistungszeitpunkt (z.B. gehaltene Fahrstunde)
  bruttoCent: number;
  steuersatz: number; // z.B. 0.19
}

export interface Faktura {
  id: string;
  leistungIds: string[];
  fakturiertAm: Date; // Rechnungsdatum
  periodeVon: Date;
  periodeBis: Date;
  bruttoCent: number;
  steuersatz: number;
}

export interface ZahlungBuchung {
  id: string;
  rechnungId: string;
  eingegangenAm: Date; // Zahlungszeitpunkt (Bankwertstellung)
  bruttoCent: number;
}

export function nettoVonBrutto(bruttoCent: number, steuersatz: number): number {
  return Math.round(bruttoCent / (1 + steuersatz));
}

/**
 * Periodenabgrenzung: ordnet erbrachte Leistung der Periode zu, in der sie
 * ERBRACHT wurde (Leistungszeitpunkt) - unabhängig davon wann fakturiert
 * oder bezahlt wurde. Das ist bewusst getrennt von "fakturierter Umsatz"
 * und "Zahlungseingang", die jeweils eigene Zeitstempel/Perioden haben.
 */
export function summiereErbrachteLeistungInPeriode(
  leistungen: Leistung[],
  periodeVon: Date,
  periodeBis: Date,
): { bruttoCent: number; nettoCent: number; anzahl: number } {
  const inPeriode = leistungen.filter((l) => l.erbrachtAm >= periodeVon && l.erbrachtAm <= periodeBis);
  const bruttoCent = inPeriode.reduce((sum, l) => sum + l.bruttoCent, 0);
  const nettoCent = inPeriode.reduce((sum, l) => sum + nettoVonBrutto(l.bruttoCent, l.steuersatz), 0);
  return { bruttoCent, nettoCent, anzahl: inPeriode.length };
}

export function summiereFakturiertenUmsatzInPeriode(
  fakturen: Faktura[],
  periodeVon: Date,
  periodeBis: Date,
): { bruttoCent: number; nettoCent: number; anzahl: number } {
  const inPeriode = fakturen.filter((f) => f.fakturiertAm >= periodeVon && f.fakturiertAm <= periodeBis);
  const bruttoCent = inPeriode.reduce((sum, f) => sum + f.bruttoCent, 0);
  const nettoCent = inPeriode.reduce((sum, f) => sum + nettoVonBrutto(f.bruttoCent, f.steuersatz), 0);
  return { bruttoCent, nettoCent, anzahl: inPeriode.length };
}

export function summiereZahlungseingangInPeriode(
  zahlungen: ZahlungBuchung[],
  periodeVon: Date,
  periodeBis: Date,
): { bruttoCent: number; anzahl: number } {
  const inPeriode = zahlungen.filter((z) => z.eingegangenAm >= periodeVon && z.eingegangenAm <= periodeBis);
  return { bruttoCent: inPeriode.reduce((sum, z) => sum + z.bruttoCent, 0), anzahl: inPeriode.length };
}

/** Forderung (offene Posten) = fakturiert - bereits zugeordnet gezahlt, nur nicht-negative offene Rechnungen. */
export function berechneOffeneForderung(
  fakturen: Faktura[],
  zahlungenProRechnung: Map<string, number>,
): { forderungCent: number; anzahlOffen: number } {
  let forderungCent = 0;
  let anzahlOffen = 0;
  for (const f of fakturen) {
    const bezahlt = zahlungenProRechnung.get(f.id) ?? 0;
    const rest = f.bruttoCent - bezahlt;
    if (rest > 0) {
      forderungCent += rest;
      anzahlOffen += 1;
    }
  }
  return { forderungCent, anzahlOffen };
}

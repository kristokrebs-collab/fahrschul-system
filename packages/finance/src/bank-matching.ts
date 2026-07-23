/**
 * Bankabgleich-Kaskade (PROMPT 4).
 *
 * Kaskade, in dieser Reihenfolge:
 *   1) Rechnungsnummer im Verwendungszweck
 *   2) strukturierte Referenz (z.B. EPC/SEPA-Referenz "RG-<uuid>")
 *   3) Name + Betrag + Zeitraum
 *   4) Teil-/Sammelzahlung
 *   5) manuell (keine Regel greift -> Review-Queue)
 *
 * NUR die Konfidenzstufe "sicher" darf automatisch verbucht werden
 * (Non-Negotiable). "wahrscheinlich" / "unklar" / "Konflikt" landen immer
 * in der Review-Queue, unabhängig vom Kaskadenschritt der sie erzeugt hat.
 */

export type Konfidenz = "sicher" | "wahrscheinlich" | "unklar" | "konflikt";

export type MatchGrund =
  | "rechnungsnummer"
  | "strukturierte_referenz"
  | "name_betrag_zeitraum"
  | "teilzahlung"
  | "sammelzahlung"
  | "ueberzahlung"
  | "ruecklastschrift"
  | "gutschrift"
  | "doppelte_zahlung"
  | "abweichender_zahler"
  | "manuell";

export interface OffeneRechnung {
  id: string;
  rechnungsnummer: string;
  schuelerName: string;
  standortId: string;
  betragCent: number; // offener Restbetrag (Brutto)
  faelligAm: Date | null;
  bereitsBezahltCent: number;
}

export interface BankTransaktion {
  id: string;
  amountCent: number; // positiv = Zahlungseingang, negativ = Rücklastschrift/Belastung
  bookedAt: Date;
  reference: string; // Verwendungszweck
  counterparty: string; // Name laut Bank
  zahlungsart?: "ueberweisung" | "lastschrift" | "bar" | "karte";
  istRuecklastschriftVon?: string; // Original-Transaktions-ID, falls Rückbuchung
}

export interface MatchErgebnis {
  transaktionId: string;
  konfidenz: Konfidenz;
  grund: MatchGrund;
  rechnungIds: string[]; // 0..n zugeordnete Rechnungen (Sammelzahlung => mehrere)
  aufteilung?: Record<string, number>; // rechnungId -> zugeordneter Cent-Betrag
  hinweis: string;
  autoBuchbar: boolean; // true genau dann wenn konfidenz === "sicher"
  restCent?: number; // Über-/Unterdeckung nach Zuordnung
}

const ZEITRAUM_TOLERANZ_TAGE = 45;

function tageDiff(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9äöüß]/g, "");
}

/** Sucht eine Rechnungsnummer (Format "RG-<...>") im Verwendungszweck. */
function findeRechnungsnummer(ref: string, rechnungen: OffeneRechnung[]): OffeneRechnung | undefined {
  const upper = ref.toUpperCase();
  return rechnungen.find((r) => upper.includes(r.rechnungsnummer.toUpperCase()));
}

/**
 * Strukturierte Referenz: SEPA-Verwendungszweck der exakt "RG-<rechnungId>"
 * oder eine EPC-QR-Referenz enthält. Bewusst getrennt von Schritt 1, weil in
 * der Praxis die Rechnungsnummer (menschenlesbar, z.B. "RE-2026-00042") von
 * der strukturierten Zahlungsreferenz (maschinenlesbar, z.B. die Rechnungs-
 * UUID oder eine EPC-Referenz) abweichen kann.
 */
function findeStrukturierteReferenz(
  ref: string,
  rechnungen: OffeneRechnung[],
): OffeneRechnung | undefined {
  return rechnungen.find((r) => ref.includes(r.id));
}

export interface BankMatchingOptions {
  jetzt?: Date;
}

/**
 * Matcht eine einzelne Banktransaktion gegen die Liste offener Rechnungen.
 * Reine Funktion, keine DB-Zugriffe – so bleibt die Logik unit-testbar
 * (siehe __tests__/bank-matching.test.ts) und die API-Schicht kann sie
 * gegen echte oder gemockte Daten aufrufen.
 */
export function matchTransaktion(
  tx: BankTransaktion,
  offeneRechnungen: OffeneRechnung[],
  bereitsVerarbeiteteTxIds: Set<string>,
  _options: BankMatchingOptions = {},
): MatchErgebnis {
  // Rücklastschrift: negativer Betrag mit Verweis auf eine bereits gebuchte
  // Zahlung. Nie automatisch verbuchen – Rechnung muss wieder geöffnet werden,
  // das ist ein manueller/Finanzen-Schritt.
  if (tx.amountCent < 0 || tx.istRuecklastschriftVon) {
    return {
      transaktionId: tx.id,
      konfidenz: "unklar",
      grund: "ruecklastschrift",
      rechnungIds: [],
      hinweis: "Rücklastschrift/Belastung erkannt – Rechnung muss manuell wieder geöffnet werden.",
      autoBuchbar: false,
    };
  }

  // Dublette: identischer Betrag, identischer Verwendungszweck, bereits
  // verarbeitete Transaktions-ID in der Session/Batch (z.B. Feed lieferte
  // dieselbe Transaktion zweimal, oder Zahler hat doppelt überwiesen).
  if (bereitsVerarbeiteteTxIds.has(tx.id)) {
    return {
      transaktionId: tx.id,
      konfidenz: "konflikt",
      grund: "doppelte_zahlung",
      rechnungIds: [],
      hinweis: "Transaktion wurde bereits verarbeitet (mögliche Dublette) – manuelle Prüfung nötig.",
      autoBuchbar: false,
    };
  }

  // Gutschrift: Verwendungszweck signalisiert explizit eine Rückerstattung /
  // Gutschrift (kein Rechnungsbezug erwartet).
  if (/gutschrift|erstattung/i.test(tx.reference)) {
    return {
      transaktionId: tx.id,
      konfidenz: "unklar",
      grund: "gutschrift",
      rechnungIds: [],
      hinweis: "Als Gutschrift erkannt – kein automatischer Rechnungsbezug, manuell zuordnen.",
      autoBuchbar: false,
    };
  }

  // --- Kaskade Schritt 1: Rechnungsnummer im Verwendungszweck -------------
  const perRechnungsnummer = findeRechnungsnummer(tx.reference, offeneRechnungen);
  if (perRechnungsnummer) {
    return bewerteEinzelmatch(tx, perRechnungsnummer, "rechnungsnummer");
  }

  // --- Kaskade Schritt 2: strukturierte Referenz ---------------------------
  const perStrukturiert = findeStrukturierteReferenz(tx.reference, offeneRechnungen);
  if (perStrukturiert) {
    return bewerteEinzelmatch(tx, perStrukturiert, "strukturierte_referenz");
  }

  // --- Kaskade Schritt 3: Name + Betrag + Zeitraum -------------------------
  const kandidaten = offeneRechnungen.filter(
    (r) =>
      normName(r.schuelerName) === normName(tx.counterparty) &&
      r.betragCent === tx.amountCent &&
      (r.faelligAm ? tageDiff(r.faelligAm, tx.bookedAt) <= ZEITRAUM_TOLERANZ_TAGE : true),
  );
  if (kandidaten.length === 1) {
    return bewerteEinzelmatch(tx, kandidaten[0], "name_betrag_zeitraum", "wahrscheinlich");
  }
  if (kandidaten.length > 1) {
    return {
      transaktionId: tx.id,
      konfidenz: "konflikt",
      grund: "name_betrag_zeitraum",
      rechnungIds: kandidaten.map((k) => k.id),
      hinweis: `${kandidaten.length} offene Rechnungen mit identischem Namen/Betrag im Zeitraum – Konflikt, manuelle Auswahl nötig.`,
      autoBuchbar: false,
    };
  }

  // Namensmatch ohne exakten Betrag: mögliche Teilzahlung, Überzahlung oder
  // Sammelzahlung über mehrere Rechnungen desselben Zahlers.
  const nachName = offeneRechnungen.filter((r) => normName(r.schuelerName) === normName(tx.counterparty));
  if (nachName.length > 0) {
    return bewerteMehrfachzahlung(tx, nachName);
  }

  // Firmenkunde / abweichender Zahler: Betrag exakt trifft eine Rechnung,
  // aber der Name weicht ab (z.B. Firmenkonto zahlt für Azubi).
  const betragMatches = offeneRechnungen.filter((r) => r.betragCent === tx.amountCent);
  if (betragMatches.length === 1) {
    return {
      transaktionId: tx.id,
      konfidenz: "wahrscheinlich",
      grund: "abweichender_zahler",
      rechnungIds: [betragMatches[0].id],
      aufteilung: { [betragMatches[0].id]: tx.amountCent },
      hinweis: `Betrag exakt, aber Zahler "${tx.counterparty}" weicht vom Rechnungsnamen ab (evtl. Firmenkunde/Angehöriger) – vor Buchung bestätigen.`,
      autoBuchbar: false,
    };
  }

  // --- Kaskade Schritt 5: manuell ------------------------------------------
  return {
    transaktionId: tx.id,
    konfidenz: "unklar",
    grund: "manuell",
    rechnungIds: [],
    hinweis: "Keine Zuordnungsregel hat gegriffen – manuelle Zuordnung erforderlich.",
    autoBuchbar: false,
  };
}

function bewerteEinzelmatch(
  tx: BankTransaktion,
  rechnung: OffeneRechnung,
  grund: MatchGrund,
  konfidenzHint?: Konfidenz,
): MatchErgebnis {
  if (tx.amountCent === rechnung.betragCent) {
    return {
      transaktionId: tx.id,
      konfidenz: konfidenzHint ?? "sicher",
      grund,
      rechnungIds: [rechnung.id],
      aufteilung: { [rechnung.id]: tx.amountCent },
      hinweis: `Exakter Treffer über ${grund} auf Rechnung ${rechnung.rechnungsnummer}.`,
      autoBuchbar: (konfidenzHint ?? "sicher") === "sicher",
      restCent: 0,
    };
  }
  if (tx.amountCent < rechnung.betragCent) {
    return {
      transaktionId: tx.id,
      konfidenz: "wahrscheinlich",
      grund: "teilzahlung",
      rechnungIds: [rechnung.id],
      aufteilung: { [rechnung.id]: tx.amountCent },
      hinweis: `Teilzahlung auf Rechnung ${rechnung.rechnungsnummer}: ${tx.amountCent} von ${rechnung.betragCent} Cent. Rest bleibt offen.`,
      autoBuchbar: false,
      restCent: rechnung.betragCent - tx.amountCent,
    };
  }
  // amountCent > betragCent -> Überzahlung
  return {
    transaktionId: tx.id,
    konfidenz: "wahrscheinlich",
    grund: "ueberzahlung",
    rechnungIds: [rechnung.id],
    aufteilung: { [rechnung.id]: rechnung.betragCent },
    hinweis: `Überzahlung auf Rechnung ${rechnung.rechnungsnummer}: ${tx.amountCent} statt ${rechnung.betragCent} Cent. Differenz ${
      tx.amountCent - rechnung.betragCent
    } Cent muss erstattet oder verrechnet werden.`,
    autoBuchbar: false,
    restCent: rechnung.betragCent - tx.amountCent, // negativ = Guthaben
  };
}

/**
 * Ein Zahler mit mehreren offenen Rechnungen und einem Betrag, der nicht
 * exakt zu einer einzelnen Rechnung passt: entweder eine Sammelzahlung
 * (Betrag deckt mehrere Rechnungen exakt oder teilweise) oder unklar.
 */
function bewerteMehrfachzahlung(tx: BankTransaktion, rechnungen: OffeneRechnung[]): MatchErgebnis {
  const sortiert = [...rechnungen].sort((a, b) => a.betragCent - b.betragCent);
  let rest = tx.amountCent;
  const aufteilung: Record<string, number> = {};
  const getroffen: string[] = [];
  for (const r of sortiert) {
    if (rest <= 0) break;
    const anteil = Math.min(rest, r.betragCent);
    aufteilung[r.id] = anteil;
    getroffen.push(r.id);
    rest -= anteil;
  }
  const summeOffen = rechnungen.reduce((sum, r) => sum + r.betragCent, 0);

  if (getroffen.length >= 2 && rest === 0) {
    return {
      transaktionId: tx.id,
      konfidenz: "wahrscheinlich",
      grund: "sammelzahlung",
      rechnungIds: getroffen,
      aufteilung,
      hinweis: `Sammelzahlung erkannt: ${tx.amountCent} Cent verteilt auf ${getroffen.length} Rechnungen von "${tx.counterparty}".`,
      autoBuchbar: false,
      restCent: 0,
    };
  }
  if (tx.amountCent === summeOffen) {
    return {
      transaktionId: tx.id,
      konfidenz: "wahrscheinlich",
      grund: "sammelzahlung",
      rechnungIds: rechnungen.map((r) => r.id),
      aufteilung: Object.fromEntries(rechnungen.map((r) => [r.id, r.betragCent])),
      hinweis: "Sammelzahlung deckt alle offenen Rechnungen dieses Zahlers exakt.",
      autoBuchbar: false,
      restCent: 0,
    };
  }
  return {
    transaktionId: tx.id,
    konfidenz: "unklar",
    grund: "manuell",
    rechnungIds: rechnungen.map((r) => r.id),
    hinweis: `Zahler hat ${rechnungen.length} offene Rechnungen, Betrag passt zu keiner Kombination eindeutig – manuelle Zuordnung.`,
    autoBuchbar: false,
  };
}

/** Matcht einen ganzen Batch, in Reihenfolge, damit Dubletten innerhalb des Batches erkannt werden. */
export function matchBatch(
  transaktionen: BankTransaktion[],
  offeneRechnungen: OffeneRechnung[],
): MatchErgebnis[] {
  const verarbeitet = new Set<string>();
  const ergebnisse: MatchErgebnis[] = [];
  for (const tx of transaktionen) {
    ergebnisse.push(matchTransaktion(tx, offeneRechnungen, verarbeitet));
    verarbeitet.add(tx.id);
  }
  return ergebnisse;
}

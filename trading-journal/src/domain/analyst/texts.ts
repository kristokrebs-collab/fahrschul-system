/** Fixed sentences of the analyst card (one place, so the wording is the same in the panel, the thesis monitor and the tests). */

export const CONSENSUS_TEXT = "Kein Konsens, nur gemeldete Zahlen: Erwartungen von Analysten gibt es in kostenlosen Daten nicht – ob ein Quartal „besser als erwartet“ war, lässt sich hier nicht sagen.";

export const SEASONAL_TEXT = "Viele Geschäfte sind saisonal: zuerst mit dem Vorjahresquartal vergleichen, der Vergleich zum Vorquartal sagt darüber wenig.";

export const CASHFLOW_DERIVED_TEXT = "Der Cashflow steht in den 10-Qs nur kumuliert (3, 6, 9 Monate). Das Einzelquartal ist die Differenz zweier gemeldeter Werte.";

export const EPS_APPROX_TEXT = "Das verwässerte EPS eines abgeleiteten Quartals ist nur näherungsweise richtig (die Aktienzahl ändert sich im Jahr).";

export const DEBT_RULE_TEXT = "Finanzschulden = die gemeldeten Schuldenposten (lang- und kurzfristig, Commercial Paper), ohne Leasingverbindlichkeiten. Nettoverschuldung = Finanzschulden − Kasse − kurzfristige Wertpapiere; langfristige Wertpapiere zählen nicht mit.";

/** The derivation, in words, per `Derivation`. */
export const DERIVATION_TEXT = {
  "ytd-diff": "Differenz zweier kumulierter Werte",
  "fy-minus-9m": "Jahreswert (10-K) minus 9-Monats-Wert",
  "fy-minus-quarters": "Jahreswert (10-K) minus die drei Quartale",
  calc: "gerechnet aus gemeldeten Werten",
} as const;

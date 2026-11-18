> **[ANWALT]** ENTWURF – Prüfung durch Anwalt nötig. Grundlagen: Preisangabenverordnung (PAngV, Fassung seit 28.05.2022), § 312d BGB / Art. 246a EGBGB, UWG §§ 5, 5a; EU-Umsatzsteuer: OSS-Verfahren. Keine Rechtsberatung. Die Anzeige in der App ist in der Checkliste mit Befunden aufgeführt.

## Preisangaben und Steuern

### Preise

Alle Preise stehen in Euro. Gegenüber Verbrauchern gelten Gesamtpreise einschließlich der gesetzlichen Umsatzsteuer. Je Tarif nennen wir den Preis pro Monat bzw. pro Jahr (Team: pro Sitz und Monat bzw. Jahr), die Abrechnungsdauer und dass sich der Tarif automatisch verlängert, wenn er nicht gekündigt wird. Nach einer Testphase beginnt der bezahlte Zeitraum zum angegebenen Preis.

Kurzer Hinweis neben jedem Preis (Konstante `PRICE_TAX_NOTE`, noch nicht in die Preisseite eingebaut):

> Preise in Euro, für Verbraucher inklusive gesetzlicher Umsatzsteuer. Steuer und Endbetrag zeigt der Bezahlschritt vor dem Abschluss.

### Steuer weltweit

- **Deutschland und EU (Verbraucher):** Es wird die Umsatzsteuer des Landes des Kunden berechnet; wir melden sie im Verfahren der einzigen Anlaufstelle (OSS) {{TODO: OSS-Registrierung, 10.000-EUR-Schwelle und Sitzstaat prüfen}}. Der Bezahlschritt zeigt Steuersatz, Steuerbetrag und Endbetrag vor dem Abschluss.
- **Unternehmer in der EU:** Mit gültiger Umsatzsteuer-ID kann die Steuer entfallen (Steuerschuld beim Leistungsempfänger); die ID wird im Bezahlschritt abgefragt.
- **Vereinigtes Königreich, Schweiz, Norwegen u. a.:** eigene Digitalsteuern; {{TODO: Registrierungspflichten prüfen}}.
- **USA:** Je nach Bundesstaat kann Sales Tax auf Software-Abos anfallen; sie wird im Bezahlschritt addiert, wenn wir dort registriert sind {{TODO: Nexus und Registrierung prüfen}}.
- **Andere Länder:** Preise ohne ausgewiesene lokale Steuer; im Bezahlschritt wird eine anfallende Steuer gesondert ausgewiesen.

Steuerberechnung, Rechnungen und Zahlung führt Stripe aus (Stripe Tax, falls vom Betreiber eingeschaltet: Umgebungsvariable `STRIPE_AUTOMATIC_TAX`; ohne sie berechnet Checkout keine Steuer). Wenn der Betrag im Bezahlschritt anders ist als der angezeigte Preis, gilt der dort angezeigte Endbetrag vor Bestellung.

### Rabatte und Aktionen

Gutscheincodes und Empfehlungs-Vorteile werden im Bezahlschritt abgezogen und dort ausgewiesen. Jahrespreise werden mit dem Gesamtbetrag pro Jahr genannt; ein Vergleich „spare X %“ bezieht sich auf zwölf Monatsbeiträge des gleichen Tarifs.

> **[ANWALT]** Prüfen, ob „Jährlich −X %“ und Aktions-Rabatte als Preisermäßigung nach § 11 PAngV (niedrigster Preis der letzten 30 Tage) behandelt werden müssen.

### Preisänderungen

Preisänderungen für laufende Abos gelten erst für die folgende Laufzeit und werden vorher in Textform mitgeteilt {{TODO: Verfahren nach AGB § 13 festlegen}}.

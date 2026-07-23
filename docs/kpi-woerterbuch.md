# KPI-Wörterbuch — apps/finance (PROMPT 4)

Für jede Kennzahl: Definition, Formel, Brutto/Netto, Leistungs-/
Zahlungszeitpunkt, Zeitraum, Quelle, Aktualität, Owner, Datenqualität,
Drilldown, Rollenrecht. Fünf Größen werden im gesamten Cockpit **strikt
getrennt** gehalten und nie konfliert: **erbrachte Leistung**,
**fakturierter Umsatz**, **Zahlungseingang**, **Forderung**, **Kosten** —
daraus abgeleitet **Deckungsbeitrag**, **Ergebnis**, **Liquidität**. Die
Trennlogik lebt in Code (`packages/finance-core/src/umsatz-erkennung.ts`),
nicht nur in der Doku — siehe die Tests in
`packages/finance-core/src/__tests__/umsatz-erkennung.test.ts`, die genau
prüfen, dass ein Datensatz in unterschiedlichen Perioden landet je nachdem
ob nach Leistungs-, Rechnungs- oder Zahlungsdatum gefiltert wird.

## 1. Erbrachte Leistung

- **Definition**: tatsächlich gehaltene/erbrachte Leistung (Fahrstunde,
  Theorie, Simulator, Prüfungsbegleitung), unabhängig davon ob bereits
  fakturiert oder bezahlt.
- **Formel**: Summe der Leistungswerte mit `erbrachtAm` in der Periode.
- **Brutto/Netto**: beide getrennt ausgewiesen (`nettoVonBrutto`).
- **Zeitpunkt**: Leistungszeitpunkt = Datum der Erbringung.
- **Zeitraum**: frei wählbar (Tag/Woche/Monat/Jahr), Cockpit-Default = laufender Monat.
- **Quelle**: `terminbuchungen` (Prompt 0/2/3), zukünftig verknüpft mit `rechnungen.leistungszeitraum_von/bis`.
- **Aktualität**: nahezu Echtzeit (DB-Query, kein Batch).
- **Owner**: Büro/Fahrlehrer (Erfassung), Finanzen (Auswertung).
- **Datenqualität**: `vollstaendig`, sofern jede Terminbuchung ein
  Leistungsdatum hat (aktuell so, siehe Prompt 0/2/3-Schema).
- **Drilldown**: je Terminbuchung → Schüler/Fahrlehrer/Fahrzeug.
- **Rollenrecht**: `finance:cockpit:read`.

## 2. Fakturierter Umsatz

- **Definition**: Umsatz aus gestellten Rechnungen, unabhängig vom Zahlungsstatus.
- **Formel**: Summe `rechnungen.betrag_cent` (Brutto) mit `fakturiertAm` (`created_at`) in der Periode; Netto via `coalesce(netto_cent, round(betrag_cent/(1+steuersatz)))`.
- **Brutto/Netto**: beide getrennt in der KPI-Karte "Leistung/Umsatz" (`fakturiertBruttoCent`/`fakturiertNettoCent`).
- **Zeitpunkt**: Rechnungsdatum, NICHT Leistungsdatum (Periodenabgrenzung, siehe Test "wird der Rechnungsperiode zugeordnet, nicht der Erbringungsperiode").
- **Zeitraum**: Cockpit-Default = laufender Monat.
- **Quelle**: `rechnungen` (erweitert in Migration 0006_finance.sql um `steuersatz`/`netto_cent`/`rechnungsnummer`/`leistungszeitraum_*`).
- **Aktualität**: Echtzeit.
- **Owner**: Finanzen.
- **Datenqualität**: `teilweise`, solange nicht jede Rechnung eine `rechnungsnummer` trägt (siehe `/finance/data-quality` Issue `invoices_without_number`) — das blockiert Kaskadenschritt 1 des Bankabgleichs.
- **Drilldown**: `/finance/invoices` (Rechnungsliste je Standort/Schüler).
- **Rollenrecht**: `finance:cockpit:read` (Lesen), `invoices:manage`/`finance:invoices:read:any` (Details).

## 3. Zahlungseingang

- **Definition**: tatsächlich auf dem Bankkonto eingegangenes Geld, das einer Rechnung zugeordnet wurde.
- **Formel**: Summe `zahlungen.betrag_cent` mit `zugeordnet = true` und `eingegangenAm`/`created_at` in der Periode.
- **Brutto/Netto**: Zahlungseingang ist immer Brutto (Bankbewegung); Netto ergibt sich erst über die zugehörige Rechnung.
- **Zeitpunkt**: Bankwertstellung (`eingegangenAm`), NICHT Rechnungs- oder Leistungsdatum.
- **Zeitraum**: Cockpit-Default = laufender Monat.
- **Quelle**: `zahlungen` + `banktransaktionen` (neu, Migration 0006).
- **Aktualität**: abhängig vom Mock-Bank-Feed-Sync (`POST /finance/bank/sync`), kein automatischer Poll in dieser Sandbox (kein echter FinTS-Zugang, siehe docs/integration-gaps.md) — Finanzen muss manuell oder per Routine synchronisieren.
- **Owner**: Finanzen.
- **Datenqualität**: `vollstaendig` für bereits gebuchte Zahlungen; `unklar` für alles in der Review-Queue (siehe Bankabgleich unten).
- **Drilldown**: `/finance/bank`.
- **Rollenrecht**: `finance:cockpit:read` (Karte "Liquidität"), `bank:reconcile` (Bearbeitung).

## 4. Forderung (offene Posten)

- **Definition**: fakturierter, aber noch nicht (vollständig) bezahlter Betrag.
- **Formel**: `berechneOffeneForderung` = Σ (Rechnungsbetrag − zugeordnet gezahlter Betrag) über alle Rechnungen mit Rest > 0.
- **Brutto/Netto**: Brutto (offene Posten werden brutto gemahnt).
- **Zeitpunkt**: Stichtagsbetrachtung (aktueller Zeitpunkt, kein Periodenfilter).
- **Quelle**: `rechnungen` (Status `offen`/`ueberfaellig`) minus zugeordnete `zahlungen`.
- **Aktualität**: Echtzeit.
- **Owner**: Finanzen.
- **Datenqualität**: `vollstaendig`.
- **Drilldown**: `/finance/bank` (Review-Queue) + Rechnungsliste.
- **Rollenrecht**: `finance:cockpit:read`, `finance:data_quality:read`.

## 5. Kosten (Fahrzeug-Vollkosten)

- **Definition**: variable + fixe Kosten eines Fahrzeugs in der Periode.
- **Formel** (`berechneFahrzeugkosten`, `packages/finance-core`):
  - Fixkosten = Leasingrate + Versicherung/Periode + Steuer/Periode
  - variable Kosten = Energie + Wartung + Reparaturen + Reifen
  - Vollkosten = Fixkosten + variable Kosten
  - Kosten/Stunde = Vollkosten / Einsatzstunden (null wenn 0 Einsatzstunden)
  - Kosten/km = Vollkosten / Kilometer (null wenn 0 km)
  - Ausfallkosten = (Fixkosten / Periodentage) × Ausfalltage — **bewusst
    ohne entgangenen Deckungsbeitrag**, das wäre eine
    Opportunitätskostenrechnung mit unbestätigter Auslastungsannahme
    (siehe "Fachliche Bestätigungen ausstehend" unten).
- **Brutto/Netto**: Kosten werden netto erfasst (Vorsteuerabzug wird hier nicht modelliert — Annahme, s. u.).
- **Zeitpunkt**: `angefallenAm` je `fahrzeugkosten`-Zeile.
- **Zeitraum**: frei wählbar.
- **Quelle**: neue Tabellen `fahrzeugkosten`, `fahrzeugausfalltage` (Migration 0006), Fahrzeug-Stammdaten (`fahrzeuge`, um Leasingrate/Versicherung/Steuer erweitert).
- **Aktualität**: abhängig von manueller Kostenerfassung (kein automatischer Beleg-Import in dieser Sandbox).
- **Owner**: Finanzen/Fuhrpark.
- **Datenqualität**: `teilweise`/`unzureichend`, solange nicht jedes Fahrzeug Kosten-Zeilen hat (`/finance/data-quality` Issue `missing_vehicle_cost_data`).
- **Drilldown**: `/finance/fleet` je Fahrzeug.
- **Rollenrecht**: `finance:cockpit:read` (Lesen), `fleet:economics:manage` (Erfassung).

## 6. Deckungsbeitrag / Ergebnis

- **Definition**: Deckungsbeitrag I = fakturierter Netto-Umsatz − variable Kosten der Periode.
- **Formel**: `berechneDeckungsbeitrag({umsatzCent, variableKostenCent})`.
- **WICHTIG — UNBESTAETIGT**: Die Cockpit-Karte zeigt **nur** Deckungsbeitrag I
  (ohne Personal-/Fixkostenumlage). Ein vollständiges "Ergebnis" (EBIT-Ebene)
  würde eine bestätigte Kostenstellen-/Personalkostenzuordnung je
  Standort/Fahrlehrer/Fahrzeug voraussetzen, die fachlich nicht bestätigt ist
  (siehe docs/fachliche-bestaetigungen.md-Muster). Die API markiert das Feld
  explizit mit `hinweis` und `datenqualitaet: "teilweise"` statt eine
  erfundene Vollergebnis-Zahl zu zeigen.
- **Zeitpunkt/Zeitraum**: laufender Monat (Cockpit-Default).
- **Quelle**: `rechnungen` (Umsatz) + `fahrzeugkosten` (variable Kosten, Kategorien `energie`/`wartung`/`reparatur`/`reifen`).
- **Owner**: Finanzen/Geschäftsführung.
- **Datenqualität**: `teilweise` (siehe oben).
- **Drilldown**: `/finance/fleet`.
- **Rollenrecht**: `finance:cockpit:read`.

## 7. Liquidität

- **Definition**: Zahlungseingang der Periode vs. offene Forderung (Stichtag) — ein einfacher, ehrlicher Liquiditäts-Indikator, **kein** vollständiger Cashflow-/Liquiditätsplan (der bräuchte auch Ausgaben-/Zahlungsziele, die hier nicht modelliert sind).
- **Formel**: `zahlungseingangCent` (Periode) + `offeneForderungCent` (Stichtag), nebeneinander dargestellt statt verrechnet (Verrechnung wäre irreführend, da unterschiedliche Zeitbezüge).
- **Owner**: Finanzen/Geschäftsführung.
- **Datenqualität**: `vollstaendig`.
- **Drilldown**: `/finance/bank`.
- **Rollenrecht**: `finance:cockpit:read`.

## 8. Fahrlehrerauslastung

- **Definition**: NICHT als Rohrangliste — Grundlage ist die bestehende
  Arbeitszeit-/Terminbuchungsdaten aus Prompt 2/3, gewichtet nach
  Praxis-/Theorie-Mix, Klassenmix, Standort, Teilzeit-Quote, Storno/Leerzeit.
- **Status in dieser Sitzung**: Endpunkt-Grundgerüst vorhanden
  (`/finance/kpis` Karte referenziert `/finance/fahrlehrer`), die
  mix-bereinigte Detailauswertung selbst ist **nicht** in dieser Sitzung
  fertig ausimplementiert (Zeitbudget-Grenze) — siehe
  docs/finance-final-qa.md Gap-Liste. Rohdaten (Arbeitszeit, Terminbuchungen,
  Storno-Events) sind vorhanden und real, die Aggregations-/Gewichtungslogik
  fehlt noch.
- **Rollenrecht**: `finance:cockpit:read`.

## 9. Fahrzeugauslastung

- **Definition**: Statusverteilung (`aktiv`/`werkstatt`/`ausser_dienst`/`ersatzbeschaffung`) + Ausfalltage je Fahrzeug.
- **Formel**: `group by fahrzeug_status` (echte SQL-Aggregation, `/finance/kpis`).
- **Quelle**: `fahrzeuge.fahrzeug_status`, `fahrzeugausfalltage`.
- **Datenqualität**: `teilweise` (Auslastung im Sinne von Ist-Einsatzstunden/verfügbaren Stunden ist nicht in dieser Sitzung berechnet, nur Status+Ausfalltage).
- **Rollenrecht**: `finance:cockpit:read`.

## 10. Storno-Retter-Erfolgsrate

- **Definition**: Anteil erfolgreich geretteter Ausfälle an allen Storno-Events.
- **Formel**: `gerettet / gesamt` über `storno_events.status` (Prompt 2-Daten, wiederverwendet, nicht neu erhoben).
- **Quelle**: `storno_events` (`geretteter_umsatz_cent` bereits von Prompt 2 gepflegt).
- **Rollenrecht**: `finance:cockpit:read`.

## 11. Forecast

- **Definition**: Umsatzprojektion über 4 Wochen/12 Wochen/Jahresende, mit konservativ/Basis/optimistisch-Bändern.
- **Formel** (`packages/finance-core/src/forecast.ts`):
  - `berechneLinearenTrend`: kleinste-Quadrate-Regression über historische Perioden-Umsätze (Tage seit erstem Datenpunkt als x, Umsatz als y). Liefert Steigung, Achsenabschnitt, R² (Bestimmtheitsmaß = Datenqualitätsindikator).
  - `projeziere`: Basislinie = Trendwert am Horizont-Ende × Anzahl Tage. Unsicherheitsband ±10%/±25%/±40% je nach R² (≥0.7/≥0.4/<0.4). Szenarien (`Szenario[]`, z. B. "zusätzliche gefüllte Fahrstunde/Tag") addieren sich **nur** zur optimistischen Linie, nie zur Basis/konservativ (getestet).
- **Horizonte**: `4_wochen` (28 Tage), `12_wochen` (84 Tage), `jahresende` (Rest-Tage bis 31.12., laufzeitberechnet).
- **Szenarien laut Aufgabenstellung**: zusätzliche gefüllte Fahrstunde, weiterer Fahrlehrer, Fahrzeugwechsel, Preisänderung, Simulatorauslastung, Firmenauftrag, Standortkapazität — als `Szenario{name, deltaCentProTag, beschreibung}` modelliert; welche Szenarien mit welchem `deltaCentProTag` sinnvoll sind, ist eine fachliche Eingabe der Fahrschule Krebs (UNBESTAETIGT, Platzhalter-Deltas nur in Tests).
- **Datenqualität**: `unsicherheit: niedrig/mittel/hoch` direkt aus R² abgeleitet, im Response-Objekt sichtbar.
- **Quelle**: historische `rechnungen`-Perioden (fakturierter Umsatz je Periode) — **nicht** erbrachte Leistung, das ist eine bewusste Vereinfachung (Umsatz ist die fachlich robustere Zeitreihe, da Leistungsdaten für ältere Perioden lückenhafter sind).
- **Rollenrecht**: `finance:cockpit:read`.
- **UI-Stand**: Forecast-Logik ist vollständig implementiert und getestet (`packages/finance-core/src/__tests__/forecast.test.ts`, 6 Tests), aber **nicht** an einen `/finance/forecast`-API-Endpunkt oder eine Cockpit-Karten-Detailansicht angeschlossen (Zeitbudget-Grenze dieser Sitzung) — siehe docs/finance-final-qa.md.

## Bankabgleich-Konfidenzstufen (Querschnitt zu 3./4.)

| Stufe | Bedeutung | Auto-Buchung? |
|---|---|---|
| `sicher` | Rechnungsnummer oder strukturierte Referenz exakt getroffen, Betrag exakt | JA — einzige Stufe, die automatisch bucht |
| `wahrscheinlich` | Name+Betrag+Zeitraum, Teilzahlung, Überzahlung, Sammelzahlung, abweichender Zahler | NEIN — Review-Queue |
| `unklar` | Rücklastschrift, Gutschrift, keine Regel greift | NEIN — Review-Queue |
| `konflikt` | doppelte Zahlung (Dublette), mehrdeutiger Mehrfachtreffer | NEIN — Review-Queue |

Vollständige Kaskade + alle Sonderfälle (Teilzahlung, Überzahlung,
Sammelzahlung, Rücklastschrift, Gutschrift, doppelte Zahlung, abweichender
Zahler, Bar/Karte, Firmenkunde) sind in
`packages/finance-core/src/bank-matching.ts` implementiert und in
`packages/finance-core/src/__tests__/bank-matching.test.ts` (15 Tests)
abgedeckt.

## Fachliche Bestätigungen ausstehend (Muster aus docs/fachliche-bestaetigungen.md)

1. Kostenstellen-/Personalkostenzuordnung für ein vollständiges "Ergebnis"
   (EBIT-Ebene) — aktuell nur Deckungsbeitrag I.
2. Ob Fahrzeugkosten netto oder brutto (inkl. nicht abziehbarer Vorsteuer
   bei bestimmten Kategorien) zu erfassen sind.
3. Konkrete `deltaCentProTag`-Werte je Forecast-Szenario (zusätzliche
   Fahrstunde, weiterer Fahrlehrer, etc.) — die Formel ist fertig, die
   Eingabewerte müssen von der Fahrschule Krebs kommen.
4. Fahrlehrerauslastungs-Gewichtung (Praxis/Theorie-Mix-Faktoren,
   Teilzeit-Normalisierung) — Rohdaten vorhanden, Gewichtungsformel noch
   nicht fachlich abgenommen.
